// services/tgl-ops/src/agents/aeo-audit-engine/worker.ts
// Production entry point for the daily Citation Tracker (cron 06:00 IST, config/agents.yaml).
import { isTestMode } from "../../config.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { checkAgentCostCap, recordApiSpend } from "../../lib/cost-cap.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { supabaseStore } from "./store.js";
import { AGENT, runTracker, summaryLine, type TrackerSummary } from "./tracker.js";

export async function runCitationTracking(options?: { brandId?: string; kind?: "daily" | "audit" }): Promise<TrackerSummary | null> {
  const alert = (text: string) => postLine({ channel: getAlertsChannel(), text }).catch(() => {});
  if (isTestMode()) {
    console.log("[Citation Tracker] test mode — no API calls, no writes.");
    return null;
  }
  const sb = getSupabase();
  if (!sb) {
    await alert("[Warning] *@aeo-audit-engine* Citation Tracker skipped: `SUPABASE_SERVICE_ROLE_KEY` is not set on tgl-ops.");
    return null;
  }
  const usdInr = Number(process.env.USD_INR_RATE);
  if (!process.env.USD_INR_RATE || !isFinite(usdInr) || usdInr <= 0) {
    await alert("[Warning] *@aeo-audit-engine* Citation Tracker skipped: `USD_INR_RATE` is not set (needed to record spend in ₹ for usage_costs).");
    return null;
  }

  const runDate = getTodayDateString();
  const summary = await runTracker({
    store: supabaseStore(sb),
    runDate,
    usdInr,
    brandId: options?.brandId,
    kind: options?.kind,
    canSpend: async () => (await checkAgentCostCap(AGENT)).allowed,
    // Gemini grounding: free searches per month (5,000 shared across Gemini 3 models, ai.google.dev pricing, 31 Oct 2026). Unset = 0 (spend is an upper bound).
    freeSearchesPerMonth: { gemini: Math.max(0, Number(process.env.AEO_GEMINI_FREE_SEARCHES_PER_MONTH) || 0) },
    onSpend: (engine, model, usd, detail) =>
      recordApiSpend({ agent: AGENT, apiName: `${engine}:${model}`, totalCostUsd: usd, details: detail }),
  });

  const line = summaryLine(summary, getCurrentTimeIST());
  console.log(`[Citation Tracker] ${line}`);
  const ran = summary.outcomes.filter((o) => o.status !== "skipped");
  if (ran.length || summary.notConfigured.length) {
    appendFileInRepo(`logs/${runDate}/${AGENT}.md`, line + "\n", `chore(log): citation tracker run ${runDate}`).catch((err) =>
      console.warn("[Citation Tracker] log append failed:", err?.message ?? err)
    );
  }
  const failed = ran.filter((o) => o.status !== "succeeded");
  if (failed.length || summary.notConfigured.length || summary.stoppedByCap) {
    const lines = [
      `[Warning] *@aeo-audit-engine* Citation Tracker ${runDate} needs a look`,
      ...failed.map((o) => `• ${o.brand} · ${o.engine}: ${o.status} (${o.ok}/${o.total})${o.note ? ` — \`${o.note.slice(0, 200)}\`` : ""}`),
      ...summary.notConfigured.map((n) => `• ${n.engine} not configured — missing: ${n.missing.join(", ")}`),
      ...(summary.stoppedByCap ? ["• stopped by the daily cost cap (config/agents.yaml → daily_cost_cap_usd)"] : []),
    ];
    await alert(lines.join("\n"));
  }
  return summary;
}


// ── First audit on submit ────────────────────────────────────────────────────
// Architect, 3 Nov: a customer who finishes setup should see numbers within minutes, not after verification.
// Every minute: any brand whose latest setup submission is newer than its latest run gets an immediate audit
// (all prompts × all engines). Verification still follows and refines competitors and prompts.
const inFlight = new Set<string>();

const STALL_MS = 8 * 60_000;   // a running engine with no new answer for 8 minutes was cut off (e.g. a redeploy)
const MAX_ATTEMPTS = 3;         // per submission, so a broken engine can't loop on spend

export async function runFirstAudits(): Promise<void> {
  if (isTestMode()) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: brands, error } = await sb.from("brands").select("id, name, setup_submitted_at")
    .eq("onboarding_step", 4).not("setup_submitted_at", "is", null)
    .in("setup_status", ["pending_verification", "needs_changes", "verified"]);
  if (error || !brands?.length) return;
  for (const b of brands) {
    if (inFlight.has(b.id)) continue;
    const { data: since } = await sb.from("runs").select("id, status, started_at, created_at")
      .eq("brand_id", b.id).gte("created_at", b.setup_submitted_at).order("created_at", { ascending: false });
    const runs = since ?? [];

    // Runs this process isn't driving that have stalled → mark failed so the audit can be retried.
    const running = runs.filter((r: any) => r.status === "running");
    let stalled = 0;
    for (const r of running) {
      const { data: lastAns } = await sb.from("answers").select("created_at").eq("run_id", r.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const lastActivity = Date.parse(lastAns?.created_at ?? r.started_at ?? r.created_at);
      if (Date.now() - lastActivity > STALL_MS) {
        await sb.from("runs").update({ status: "failed", error: "cut off mid-run (service restarted); retrying", finished_at: new Date().toISOString() }).eq("id", r.id).eq("status", "running");
        stalled++;
      }
    }
    if (running.length - stalled > 0) continue;                       // still in progress somewhere
    // Done when every active prompt has an answer since the submission (or from today's runs — the tracker skips
    // those too, so an approval that adds prompts after the 06:00 run asks only the new ones).
    if (Date.now() - Date.parse(b.setup_submitted_at) > 2 * 86_400_000) continue;   // old submissions: the daily run covers them
    const today = getTodayDateString();
    const from = new Date(Math.min(Date.parse(b.setup_submitted_at), Date.parse(`${today}T00:00:00+05:30`))).toISOString();
    const [{ data: act }, { data: ans }] = await Promise.all([
      sb.from("prompts").select("id").eq("brand_id", b.id).eq("status", "active"),
      sb.from("answers").select("prompt_id, runs!inner(status)").eq("brand_id", b.id).gte("created_at", from).in("runs.status", ["succeeded", "partial"]).limit(2000),
    ]);
    const answered = new Set((ans ?? []).map((x: any) => x.prompt_id));
    const unanswered = (act ?? []).filter((p: any) => !answered.has(p.id)).length;
    if (!act?.length || unanswered === 0) continue;
    const attempts = new Set(runs.map((r: any) => String(r.created_at).slice(0, 16))).size;  // runs of one attempt start together
    if (attempts >= MAX_ATTEMPTS) continue;

    inFlight.add(b.id);
    runCitationTracking({ brandId: b.id, kind: "audit" })
      .catch((e) => console.error("[First Audit] failed", b.name, e))
      .finally(() => inFlight.delete(b.id));
  }
}

/** Daily at 07:00 IST (after the 06:00 run): the Gemini cost experiment, only while AEO_GEMINI_EXPERIMENT_MODELS is set. */
export async function runGeminiExperimentJob(): Promise<void> {
  if (isTestMode() || !process.env.AEO_GEMINI_EXPERIMENT_MODELS?.trim()) return;
  const sb = getSupabase();
  if (!sb) return;
  const { runGeminiExperiment } = await import("./experiment.js");
  const out = await runGeminiExperiment(sb, getTodayDateString());
  if (out) console.log("[Gemini Experiment]", out);
}

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
    const { data: last } = await sb.from("runs").select("created_at").eq("brand_id", b.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    // Any run (even one still running) created after the submission means this submission is already being audited.
    if (last && Date.parse(last.created_at) >= Date.parse(b.setup_submitted_at)) continue;
    inFlight.add(b.id);
    runCitationTracking({ brandId: b.id, kind: "audit" })
      .catch((e) => console.error("[First Audit] failed", b.name, e))
      .finally(() => inFlight.delete(b.id));
  }
}

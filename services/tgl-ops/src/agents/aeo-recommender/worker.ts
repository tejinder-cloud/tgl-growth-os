// Recommendations (plan Day 22): after a completed Citation Tracker run, at most one batch per brand per week.
// Also relays "Start managed AEO" requests from the dashboard to #doors-aeo.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import { slackClient } from "../../lib/slack-client.js";
import { postLine, resolveChannelId } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { getTodayDateString } from "../../lib/standup.js";
import { checkAgentCostCap, recordApiSpend } from "../../lib/cost-cap.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { gatherRecEvidence } from "./gather.js";
import { proposeRecommendations } from "./propose.js";
import type { Recommendation } from "./types.js";

export const AGENT = "aeo-recommender";   // own daily cost cap in config/agents.yaml
const WEEK_MS = 7 * 86_400_000;
const inFlight = new Set<string>();

/** After a completed run: generate only if that run has no batch yet and the last batch is a week old. Pure; tested. */
export function shouldGenerate(p: { verified: boolean; latestRunId: string | null; batchForRun: boolean; lastBatchAt: string | null; now?: number; force?: boolean }): { go: boolean; why: string } {
  if (!p.verified) return { go: false, why: "setup not verified" };
  if (!p.latestRunId) return { go: false, why: "no completed run" };
  if (p.batchForRun) return { go: false, why: "latest run already has recommendations" };
  if (!p.force && p.lastBatchAt && (p.now ?? Date.now()) - Date.parse(p.lastBatchAt) < WEEK_MS) return { go: false, why: "last batch under a week old" };   // monthly deep run refreshes regardless
  return { go: true, why: "due" };
}

/** Called by the Citation Tracker when a brand's run completes. Never throws. */
export async function recommendAfterRun(sb: SupabaseClient, brandId: string, opts: { force?: boolean } = {}): Promise<void> {
  if (isTestMode() || inFlight.has(brandId)) return;
  inFlight.add(brandId);
  try {
    const [{ data: brand }, { data: run }, { data: lastRec }] = await Promise.all([
      sb.from("brands").select("name, onboarding_step, setup_status").eq("id", brandId).single(),
      sb.from("runs").select("id").eq("brand_id", brandId).in("status", ["succeeded", "partial"]).order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      sb.from("recommendations").select("created_at, run_id").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const latestRunId = (run?.id as string | undefined) ?? null;
    const { data: forRun } = latestRunId ? await sb.from("recommendations").select("id").eq("brand_id", brandId).eq("run_id", latestRunId).limit(1) : { data: [] };
    const d = shouldGenerate({ verified: brand?.onboarding_step === 4 && brand?.setup_status === "verified", latestRunId, batchForRun: !!forRun?.length, lastBatchAt: lastRec?.created_at ?? null, force: opts.force });
    if (!d.go) { console.log(`[Recommendations] ${brand?.name ?? brandId}: skipped — ${d.why}`); return; }
    await generateRecommendations(sb, brandId, latestRunId!);
  } catch (err: any) {
    console.error("[Recommendations] failed", brandId, err);
    await sb.from("experiments").insert({ name: "recommender_log", run_date: getTodayDateString(), brand_id: brandId, summary: { error: String(err?.message ?? err).slice(0, 1000) } }).then(() => {}, () => {});
    await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* couldn't write recommendations for brand \`${brandId}\`: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
  } finally { inFlight.delete(brandId); }
}

export async function generateRecommendations(sb: SupabaseClient, brandId: string, runId: string): Promise<number> {
  const cap = await checkAgentCostCap(AGENT);
  if (!cap.allowed) {
    await sb.from("experiments").insert({ name: "recommender_log", run_date: getTodayDateString(), brand_id: brandId, summary: { skipped: "daily cost cap", spend: cap.currentSpend, cap: cap.cap } }).then(() => {}, () => {});
    return 0;
  }
  const ev = await gatherRecEvidence(sb, brandId);
  if (!ev || !ev.prompts.length) return 0;
  const { recs, dropped, usd, model, tokens } = await proposeRecommendations(ev);
  recordApiSpend({ agent: AGENT, apiName: `anthropic:${model}`, totalCostUsd: usd, details: `recommendations ${ev.name} (${tokens.in} in / ${tokens.out} out)` });
  const usdInr = Number(process.env.USD_INR_RATE);
  if (isFinite(usdInr) && usdInr > 0 && usd > 0) {
    await sb.from("usage_costs").insert({
      tenant_id: ev.tenantId, brand_id: brandId, product: "truevisible", cost_date: getTodayDateString(), category: "llm", engine: null, units: 1,
      amount_inr: Number((usd * usdInr).toFixed(4)), detail: { model, purpose: "recommendations", input_tokens: tokens.in, output_tokens: tokens.out, usd, usd_inr_rate: usdInr },
    });
  }
  if (!recs.length) throw new Error(`no usable recommendations (dropped: ${dropped.slice(0, 3).join("; ") || "none returned"})`);
  await saveBatch(sb, ev.tenantId, brandId, recs, runId);
  const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
  if (config.slackBotToken && channel) {
    await slackClient.chat.postMessage({ channel, text: `*${ev.name}* — ${recs.length} recommendations on the dashboard (${recs.map((r) => r.asset.kind).join(", ")}) · $${usd.toFixed(3)}${dropped.length ? ` · ${dropped.length} dropped by checks` : ""}` }).catch(() => {});
  }
  return recs.length;
}

async function saveBatch(sb: SupabaseClient, tenantId: string, brandId: string, recs: Recommendation[], runId: string) {
  const batch = randomUUID();
  const { data: assets, error: aErr } = await sb.from("assets").insert(recs.map((r) => ({
    tenant_id: tenantId, brand_id: brandId, kind: r.asset.kind, title: r.asset.title, content: { format: r.asset.format, body: r.asset.content },
  }))).select("id");
  if (aErr || !assets || assets.length !== recs.length) throw new Error(`save assets: ${aErr?.message ?? "count mismatch"}`);
  // Untouched recommendations from the last batch are replaced; ones the customer acted on stay.
  await sb.from("recommendations").update({ status: "superseded" }).eq("brand_id", brandId).eq("status", "open");
  const { error } = await sb.from("recommendations").insert(recs.map((r, i) => ({
    tenant_id: tenantId, brand_id: brandId, title: r.title, body: r.body, impact: r.impact, ease: r.ease, category: r.category,
    asset_refs: [assets[i].id], evidence: r.evidence, batch_id: batch, run_id: runId,
  })));
  if (error) throw new Error(`save recommendations: ${error.message}`);
}

/** Every minute: new "Start managed AEO" requests → one Slack line each in #doors-aeo. */
export async function relayManagedAeoRequests(): Promise<void> {
  if (isTestMode()) return;
  const sb = getSupabase();
  if (!sb || !config.slackBotToken) return;
  const { data: reqs } = await sb.from("managed_aeo_requests").select("id, brand_id, email, note, recommendation_id, created_at").is("notified_at", null).order("created_at").limit(10);
  for (const r of reqs ?? []) {
    const [{ data: brand }, { data: rec }] = await Promise.all([
      sb.from("brands").select("name, primary_domain, tenant_id").eq("id", r.brand_id).single(),
      r.recommendation_id ? sb.from("recommendations").select("title").eq("id", r.recommendation_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // The requesting tenant's own plan (service role sees every tenant — filter explicitly).
    const { data: sub } = brand?.tenant_id
      ? await sb.from("subscriptions").select("plan, status").eq("tenant_id", brand.tenant_id).eq("product", "truevisible").is("brand_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
    const text = [
      `:raised_hand: *${r.note && /^(Clicked|Asked)/.test(r.note) ? r.note.replace(/ in the dashboard$/, "") : "Clicked Start managed AEO"}* — *${brand?.name ?? r.brand_id}*${brand?.primary_domain ? ` (${brand.primary_domain})` : ""}`,
      `From ${r.email ?? "unknown"} · plan ${sub ? `${sub.plan} (${sub.status})` : "—"}${rec?.title ? ` · from “${rec.title}”` : ""}`,
      r.note && !/^(Clicked|Asked)/.test(r.note) ? `> ${String(r.note).slice(0, 500)}` : null,
      `Sent to the AEO page on thegrowthlab.co.in from the dashboard. Worth a personal follow-up.`,
    ].filter(Boolean).join("\n");
    const msg = await slackClient.chat.postMessage({ channel, text }).catch((e) => { console.error("[Managed AEO] slack", e); return null; });
    if (msg?.ts) await sb.from("managed_aeo_requests").update({ notified_at: new Date().toISOString(), slack_ts: msg.ts }).eq("id", r.id);
  }
}

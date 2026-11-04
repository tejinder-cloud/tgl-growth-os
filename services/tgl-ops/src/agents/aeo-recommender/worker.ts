// Recommendations (plan Day 22): weekly per verified brand, right after its first completed run.
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

export const AGENT = "aeo-strategist";   // recommendations are strategist work (SPEC §8)
const WEEK_MS = 7 * 86_400_000;
const inFlight = new Set<string>();

/** Due: never generated, or last batch over a week old and a newer run exists. Pure; tested. */
export function isDue(lastBatchAt: string | null, lastRunDate: string | null, now = Date.now()): boolean {
  if (!lastRunDate) return false;
  if (!lastBatchAt) return true;
  return now - Date.parse(lastBatchAt) >= WEEK_MS && Date.parse(lastRunDate + "T23:59:59+05:30") > Date.parse(lastBatchAt);
}

export async function pollRecommendations(): Promise<void> {
  if (isTestMode()) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: brands } = await sb.from("brands").select("id, name").eq("onboarding_step", 4).eq("setup_status", "verified");
  for (const b of brands ?? []) {
    if (inFlight.has(b.id)) continue;
    const [{ data: lastRec }, { data: lastRun }] = await Promise.all([
      sb.from("recommendations").select("created_at").eq("brand_id", b.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("v_visibility_daily").select("run_date").eq("brand_id", b.id).order("run_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!isDue(lastRec?.created_at ?? null, lastRun?.run_date ?? null)) continue;
    inFlight.add(b.id);
    try { await generateRecommendations(sb, b.id); }
    catch (err: any) {
      console.error("[Recommendations] failed", b.name, err);
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* couldn't write recommendations for *${b.name}*: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    } finally { inFlight.delete(b.id); }
  }
}

export async function generateRecommendations(sb: SupabaseClient, brandId: string): Promise<number> {
  const cap = await checkAgentCostCap(AGENT);
  if (!cap.allowed) return 0;
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
  await saveBatch(sb, ev.tenantId, brandId, recs);
  const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
  if (config.slackBotToken && channel) {
    await slackClient.chat.postMessage({ channel, text: `*${ev.name}* — ${recs.length} recommendations on the dashboard (${recs.map((r) => r.asset.kind).join(", ")}) · $${usd.toFixed(3)}${dropped.length ? ` · ${dropped.length} dropped by checks` : ""}` }).catch(() => {});
  }
  return recs.length;
}

async function saveBatch(sb: SupabaseClient, tenantId: string, brandId: string, recs: Recommendation[]) {
  const batch = randomUUID();
  const { data: assets, error: aErr } = await sb.from("assets").insert(recs.map((r) => ({
    tenant_id: tenantId, brand_id: brandId, kind: r.asset.kind, title: r.asset.title, content: { format: r.asset.format, body: r.asset.content },
  }))).select("id");
  if (aErr || !assets || assets.length !== recs.length) throw new Error(`save assets: ${aErr?.message ?? "count mismatch"}`);
  // Untouched recommendations from the last batch are replaced; ones the customer acted on stay.
  await sb.from("recommendations").update({ status: "superseded" }).eq("brand_id", brandId).eq("status", "open");
  const { error } = await sb.from("recommendations").insert(recs.map((r, i) => ({
    tenant_id: tenantId, brand_id: brandId, title: r.title, body: r.body, impact: r.impact, ease: r.ease, category: r.category,
    asset_refs: [assets[i].id], evidence: r.evidence, batch_id: batch,
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
      `:raised_hand: *Start managed AEO* — *${brand?.name ?? r.brand_id}*${brand?.primary_domain ? ` (${brand.primary_domain})` : ""}`,
      `From ${r.email ?? "unknown"} · plan ${sub ? `${sub.plan} (${sub.status})` : "—"}${rec?.title ? ` · from “${rec.title}”` : ""}`,
      r.note ? `> ${String(r.note).slice(0, 500)}` : null,
      `They were told we'll be in touch to agree a 90-day plan. Reply to them, then mark the request contacted.`,
    ].filter(Boolean).join("\n");
    const msg = await slackClient.chat.postMessage({ channel, text }).catch((e) => { console.error("[Managed AEO] slack", e); return null; });
    if (msg?.ts) await sb.from("managed_aeo_requests").update({ notified_at: new Date().toISOString(), slack_ts: msg.ts }).eq("id", r.id);
  }
}

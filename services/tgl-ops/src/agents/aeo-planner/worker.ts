// The 90-day plan for managed AEO (plan Day 29b, SPEC §8): every 15 minutes, each verified brand on Managed, Managed
// Plus or TGL's own account without a live plan gets one drafted from its measured answers and open recommendations.
// Code sets the scope and checks the draft; a person approves it in Slack (or, in "flagged" mode, only plans that fail
// a check or are sampled reach a person). Approved plans show on the client's Plan tab and are emailed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import { slackClient, openModal, getActorDisplayName } from "../../lib/slack-client.js";
import { postLine, resolveChannelId } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { checkAgentCostCap, recordApiSpend } from "../../lib/cost-cap.js";
import { isArchitectUser } from "../../lib/org.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { gatherRecEvidence } from "../aeo-recommender/gather.js";
import { recipients, sendEmail } from "../aeo-reports/worker.js";
import { planReadyEmail } from "../aeo-reports/email.js";
import { checkPlan, needsPerson, scopeFor, tierFor, type Item, type Month, type Tier } from "./plan.js";
import { draftPlan, type OpenRec } from "./propose.js";
import { decided, planBlocks } from "./card.js";

export const AGENT = "aeo-planner";
const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

/** The managed tier a brand's workspace (or its agency) pays for, or null. */
async function tierOf(sb: SupabaseClient, tenantId: string): Promise<Tier | null> {
  const { data: t } = await sb.from("tenants").select("parent_tenant_id").eq("id", tenantId).maybeSingle();
  const payers = [tenantId, t?.parent_tenant_id].filter(Boolean) as string[];
  const { data: subs } = await sb.from("subscriptions").select("plan, status").eq("product", "truevisible").is("brand_id", null).in("tenant_id", payers).order("created_at", { ascending: false });
  for (const s of (subs ?? []) as any[]) {
    if (s.plan === "internal" || ["active", "past_due"].includes(s.status)) { const tier = tierFor(s.plan); if (tier) return tier; }
  }
  return null;
}

export async function runPlanner(): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data: brands } = await sb.from("brands").select("id, tenant_id, name").eq("setup_status", "verified");
  let n = 0;
  for (const b of (brands ?? []) as any[]) {
    const { data: last } = await sb.from("aeo_plans").select("id, status, created_at, review").eq("brand_id", b.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && ["pending_review", "approved"].includes(last.status)) continue;
    if (last?.status === "failed" && Date.now() - Date.parse(last.created_at) < DAY) continue;
    const tier = await tierOf(sb, b.tenant_id);
    if (!tier) continue;
    try {
      await makePlan(sb, b.id, tier, last?.status === "needs_changes" ? last.review?.instructions ?? null : null);
      n++;
    } catch (err: any) {
      await sb.from("aeo_plans").insert({ tenant_id: b.tenant_id, brand_id: b.id, tier, status: "failed", scope: {}, baseline: {}, summary: "", months: [], items: [], checks: { passed: false, problems: [String(err?.message ?? err).slice(0, 300)] } }).then(() => {}, () => {});
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* couldn't draft the 90-day plan for *${b.name}*: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
  return n;
}

export async function makePlan(sb: SupabaseClient, brandId: string, tier: Tier, instructions: string | null): Promise<string | null> {
  const cap = await checkAgentCostCap(AGENT);
  if (!cap.allowed) return null;
  const ev = await gatherRecEvidence(sb, brandId, { days: 14 });
  if (!ev || !ev.prompts.length) return null; // no completed run yet — next poll
  const [{ data: recRows }, { data: wp }] = await Promise.all([
    sb.from("recommendations").select("id, title, category, asset_refs").eq("brand_id", brandId).in("status", ["open", "diy"]).order("priority", { ascending: false }).limit(20),
    sb.from("integrations").select("status").eq("brand_id", brandId).eq("provider", "wordpress").maybeSingle(),
  ]);
  const assetIds = ((recRows ?? []) as any[]).map((r) => r.asset_refs?.[0]).filter(Boolean);
  const { data: assets } = assetIds.length ? await sb.from("assets").select("id, kind").in("id", assetIds) : { data: [] as any[] };
  const recs: OpenRec[] = ((recRows ?? []) as any[]).map((r) => ({ id: r.id, title: r.title, category: r.category, kind: (assets ?? []).find((a: any) => a.id === r.asset_refs?.[0])?.kind ?? null }));
  const scope = scopeFor(tier, ev.prompts.length);
  const wordpress = wp?.status === "connected";
  const d = await draftPlan({ ev, recs, scope, tier, wordpress, instructions });
  recordApiSpend({ agent: AGENT, apiName: `anthropic:${d.model}`, totalCostUsd: d.usd, details: `90-day plan ${ev.name} (${d.tokens.in} in / ${d.tokens.out} out)` });
  const usdInr = Number(process.env.USD_INR_RATE);
  if (isFinite(usdInr) && usdInr > 0 && d.usd > 0) {
    await sb.from("usage_costs").insert({ tenant_id: ev.tenantId, brand_id: brandId, product: "truevisible", cost_date: getTodayDateString(), category: "llm", engine: null, units: 1,
      amount_inr: Number((d.usd * usdInr).toFixed(4)), detail: { model: d.model, purpose: "aeo_plan", input_tokens: d.tokens.in, output_tokens: d.tokens.out, usd: d.usd, usd_inr_rate: usdInr } }).then(() => {}, () => {});
  }
  const checks = checkPlan(d, scope, new Set(recs.map((r) => r.id)));
  if (d.dropped.length) checks.problems.push(`${d.dropped.length} malformed item(s) dropped`);
  // Baseline: measured by code, never by the model.
  const compCount = new Map<string, number>();
  for (const p of ev.prompts) for (const c of p.competitorsNamed) compCount.set(c, (compCount.get(c) ?? 0) + 1);
  const baseline = { from: ev.from, to: ev.to, answers: ev.totalAnswers, named: ev.namedAnswers, own_site_cited: ev.ownCited,
    competitors_named_most: [...compCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, questions]) => ({ name, questions })) };

  const mode = (process.env.AEO_PLAN_REVIEW ?? "all").trim();
  const sampleEvery = Number(process.env.AEO_PLAN_SAMPLE_EVERY ?? 5);
  const { count: autoSoFar } = await sb.from("aeo_plans").select("id", { count: "exact", head: true }).eq("status", "approved").contains("review", { auto: true });
  const decision = needsPerson({ mode, passed: checks.passed, autoApprovedSoFar: autoSoFar ?? 0, sampleEvery });

  const today = getTodayDateString();
  const row: Record<string, any> = { tenant_id: ev.tenantId, brand_id: brandId, tier, scope, baseline, summary: d.summary, months: d.months, items: d.items, checks, cost_usd: d.usd,
    ...(decision.person ? { status: "pending_review", review: { mode, why: decision.why, instructions } }
      : { status: "approved", starts_on: today, ends_on: addDays(today, 90), review: { mode, why: decision.why, auto: true, decided_at: new Date().toISOString() } }) };
  const { data: saved, error } = await sb.from("aeo_plans").insert(row).select("id").single();
  if (error) throw new Error(`save plan: ${error.message}`);

  const channel = (await resolveChannelId(decision.person ? "#approvals" : "#doors-aeo")) || config.approvalsChannelId;
  if (config.slackBotToken && channel) {
    const blocks = planBlocks({ planId: saved.id, brand: ev.name, domain: ev.domain, tier, scope, baseline, summary: d.summary, months: d.months, items: d.items, checks, why: decision.why, costUsd: d.usd, buttons: decision.person });
    const msg = await slackClient.chat.postMessage({ channel, blocks, text: `90-day plan · ${ev.name} — ${decision.person ? "waiting for approval" : "approved automatically"}` }).catch(() => null);
    if (msg?.ts) await sb.from("aeo_plans").update({ review: { ...row.review, slack_channel: msg.channel, slack_ts: msg.ts } }).eq("id", saved.id);
  }
  if (!decision.person) await goLive(sb, saved.id, "TrueVisible (all checks passed)");
  return saved.id;
}

/** An approved plan replaces the previous one and is emailed to the client. */
async function goLive(sb: SupabaseClient, planId: string, by: string) {
  const { data: p } = await sb.from("aeo_plans").select("id, tenant_id, brand_id, summary, months, items, starts_on, ends_on").eq("id", planId).single();
  if (!p) return;
  await sb.from("aeo_plans").update({ status: "superseded" }).eq("brand_id", p.brand_id).eq("status", "approved").neq("id", planId);
  const { data: b } = await sb.from("brands").select("name").eq("id", p.brand_id).single();
  const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
  if (appUrl) {
    const to = await recipients(sb, p.tenant_id, "weekly");
    const first = ((p.items ?? []) as Item[]).filter((i) => i.week <= 2).map((i) => `Week ${i.week}: ${i.title}`);
    if (to.length) {
      const err = await sendEmail(to, planReadyEmail({ brand: b?.name ?? "your brand", summary: p.summary, months: p.months as Month[], firstWeeks: first, startsOn: p.starts_on, endsOn: p.ends_on }, appUrl));
      if (err) await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* plan email not sent: \`${err}\`` }).catch(() => {});
    }
  }
  appendFileInRepo(`decisions/${getTodayDateString()}.md`, `- ${getCurrentTimeIST()} IST · ${by} · APPROVE · ${AGENT} · 90-day plan live: ${b?.name ?? p.brand_id} (${p.starts_on} – ${p.ends_on}) · plan ${planId}`,
    `chore(decision): 90-day plan for ${b?.name ?? p.brand_id}`).catch(() => {});
}

// ── Slack ─────────────────────────────────────────────────────────────────────

export async function handlePlanAction(payload: any, action: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const planId = String(action.value || "");
  const { data: plan } = await sb.from("aeo_plans").select("id, status, review").eq("id", planId).maybeSingle();
  const say = (text: string) => slackClient.chat.postEphemeral({ channel: payload.channel?.id, user: payload.user?.id, text }).catch(() => {});
  if (!plan || plan.status !== "pending_review") { await say("This plan is no longer waiting for a decision."); return; }
  const actor = await getActorDisplayName(payload.user);
  if (!((await isArchitectUser(payload.user)) || (await isArchitectUser(actor)))) { await say("Only the Architect may approve a client's 90-day plan."); return; }

  if (action.action_id === "plan_changes") {
    await openModal(payload.trigger_id, {
      type: "modal", callback_id: "plan_changes_modal",
      private_metadata: JSON.stringify({ planId, channel: payload.channel?.id, ts: payload.container?.message_ts }),
      title: { type: "plain_text", text: "Needs changes" }, submit: { type: "plain_text", text: "Redraft" },
      blocks: [{ type: "input", block_id: "instructions", label: { type: "plain_text", text: "What should the strategist change? (never shown to the client)" },
        element: { type: "plain_text_input", action_id: "text", multiline: true, max_length: 1500, placeholder: { type: "plain_text", text: "e.g. Put Google Business Profile in week 1; fewer blog posts, more directory listings in month 2." } } }],
    });
    return;
  }
  if (action.action_id !== "plan_approve") return;
  const today = getTodayDateString();
  const { data: claimed } = await sb.from("aeo_plans").update({ status: "approved", starts_on: today, ends_on: addDays(today, 90),
    review: { ...(plan.review ?? {}), decided_by: actor, decided_at: new Date().toISOString(), auto: false } }).eq("id", planId).eq("status", "pending_review").select("id");
  if (!claimed?.length) return;
  await goLive(sb, planId, actor);
  const outcome = `*Approved* by ${actor} at ${getCurrentTimeIST()} IST — live on the client's Plan tab, ${today} – ${addDays(today, 90)}; client emailed.`;
  await slackClient.chat.update({ channel: payload.channel?.id, ts: payload.container?.message_ts, blocks: decided(payload.message?.blocks, outcome), text: outcome }).catch(() => {});
}

export async function handlePlanChangesSubmission(payload: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const meta = JSON.parse(payload.view?.private_metadata || "{}");
  const instructions = String(payload.view?.state?.values?.instructions?.text?.value ?? "").trim().slice(0, 1500);
  const actor = await getActorDisplayName(payload.user);
  const { data: plan } = await sb.from("aeo_plans").select("review").eq("id", meta.planId).maybeSingle();
  const { data: claimed } = await sb.from("aeo_plans").update({ status: "needs_changes", review: { ...(plan?.review ?? {}), decided_by: actor, decided_at: new Date().toISOString(), instructions } })
    .eq("id", meta.planId).eq("status", "pending_review").select("id");
  if (!claimed?.length) return;
  const outcome = `*Sent back* by ${actor} at ${getCurrentTimeIST()} IST — “${instructions}”. A new draft follows within 15 minutes.`;
  if (meta.channel && meta.ts) {
    const hist: any = await slackClient.conversations.history({ channel: meta.channel, latest: meta.ts, inclusive: true, limit: 1 }).catch(() => null);
    await slackClient.chat.update({ channel: meta.channel, ts: meta.ts, blocks: decided(hist?.messages?.[0]?.blocks ?? [], outcome), text: outcome }).catch(() => {});
  }
}

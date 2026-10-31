// services/tgl-ops/src/agents/aeo-strategist/worker.ts — Setup-verification queue (plan Day 19).
// Poll → snapshot → evidence → proposal → #approvals card → human decision → apply + verify → first run.
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import { slackClient, openModal, getActorDisplayName } from "../../lib/slack-client.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { checkAgentCostCap, recordApiSpend } from "../../lib/cost-cap.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { runCitationTracking } from "../aeo-audit-engine/worker.js";
import { gatherEvidence } from "./evidence.js";
import { proposeChanges, changeCount } from "./propose.js";
import { buildReviewBlocks, decidedBlocks, readSelection } from "./card.js";
import { applyAndVerify, describePlan, EMPTY_PLAN, planApply, planSize } from "./apply.js";
import type { Proposal, SetupSnapshot } from "./types.js";

export const AGENT = "aeo-strategist";
const REMIND_AFTER_H = 20; // SLA is 24h (SPEC §3)

function limitFor(plan: string, status: string, trialEndsAt: string | null): number {
  if (plan === "internal") return 50;
  if (plan === "trial") return status === "trialing" && trialEndsAt && Date.parse(trialEndsAt) > Date.now() ? 10 : 0;
  return ["active", "past_due"].includes(status) ? 50 : 0;
}

export async function loadSnapshot(sb: SupabaseClient, brandId: string): Promise<SetupSnapshot> {
  const { data: b, error } = await sb.from("brands").select("id, tenant_id, name, primary_domain, site_platform, languages, updated_at").eq("id", brandId).single();
  if (error || !b) throw new Error(`brand ${brandId}: ${error?.message ?? "not found"}`);
  const [t, subs, v, m, c, p] = await Promise.all([
    sb.from("tenants").select("name, parent_tenant_id").eq("id", b.tenant_id).single(),
    sb.from("subscriptions").select("tenant_id, plan, status, trial_ends_at, created_at").eq("product", "truevisible").is("brand_id", null).order("created_at", { ascending: false }),
    sb.from("brand_variants").select("name").eq("brand_id", brandId),
    sb.from("products_icps").select("id, product, icp, location").eq("brand_id", brandId).order("created_at").limit(1),
    sb.from("competitors").select("id, name, domain").eq("brand_id", brandId).eq("status", "active").order("created_at"),
    sb.from("prompts").select("id, text, language, journey_phase").eq("brand_id", brandId).eq("status", "active").order("created_at"),
  ]);
  const payers = [b.tenant_id, t.data?.parent_tenant_id].filter(Boolean);
  const sub = (subs.data ?? []).find((s: any) => payers.includes(s.tenant_id));
  return {
    brandId: b.id, tenantId: b.tenant_id, tenantName: t.data?.name ?? b.tenant_id, name: b.name,
    domain: b.primary_domain, platform: b.site_platform, languages: b.languages ?? ["en"],
    variants: (v.data ?? []).map((x: any) => x.name),
    market: (m.data ?? [])[0] ?? null,
    competitors: c.data ?? [], prompts: (p.data ?? []) as SetupSnapshot["prompts"],
    plan: sub?.plan ?? "none", promptLimit: sub ? limitFor(sub.plan, sub.status, sub.trial_ends_at) : 0,
    submittedAt: b.updated_at,
  };
}

/** Every 10 minutes: open a review for each newly submitted setup; supersede reviews the customer has since edited; remind at 20h. */
export async function pollSetupQueue(): Promise<void> {
  if (isTestMode()) return;
  const sb = getSupabase();
  if (!sb) return;

  const [{ data: pending }, { data: open }] = await Promise.all([
    sb.from("brands").select("id, tenant_id, name, updated_at").eq("setup_status", "pending_verification"),
    sb.from("setup_reviews").select("id, brand_id, created_at, slack_channel, slack_ts, reminded_at").eq("status", "proposed"),
  ]);

  for (const b of pending ?? []) {
    const review = (open ?? []).find((r: any) => r.brand_id === b.id);
    if (review) {
      // Customer re-submitted after the card went out → the card is stale.
      if (Date.parse(b.updated_at) > Date.parse(review.created_at) + 60_000) {
        await sb.from("setup_reviews").update({ status: "superseded" }).eq("id", review.id).eq("status", "proposed");
        await markCardStale(review, "_Superseded — the customer changed their setup. A new check follows._");
      } else {
        await maybeRemind(sb, review, b.name);
        continue;
      }
    }
    try {
      await openReview(sb, b.id);
    } catch (err: any) {
      console.error("[Setup Queue] review failed", b.id, err);
      await postLine({ channel: getAlertsChannel(), text: `⚠️ *@${AGENT}* couldn't prepare the setup check for *${b.name}*: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
}

async function markCardStale(review: any, text: string) {
  if (!review.slack_channel || !review.slack_ts || !config.slackBotToken) return;
  await slackClient.chat.postMessage({ channel: review.slack_channel, thread_ts: review.slack_ts, text }).catch(() => {});
}

async function maybeRemind(sb: SupabaseClient, review: any, brandName: string) {
  const ageH = (Date.now() - Date.parse(review.created_at)) / 3_600_000;
  if (ageH < REMIND_AFTER_H || review.reminded_at || !review.slack_ts) return;
  await sb.from("setup_reviews").update({ reminded_at: new Date().toISOString() }).eq("id", review.id);
  await slackClient.chat.postMessage({
    channel: review.slack_channel, thread_ts: review.slack_ts,
    text: `⏰ *${brandName}* has waited ${Math.floor(ageH)}h for its setup check. The customer was told we check before the first audit — please decide today.`,
  }).catch(() => {});
}

export async function openReview(sb: SupabaseClient, brandId: string): Promise<string | null> {
  const cap = await checkAgentCostCap(AGENT);
  if (!cap.allowed) return null; // checkAgentCostCap already alerted; retried on the next poll
  const s = await loadSnapshot(sb, brandId);

  const { evidence, aiCostUsd } = await gatherEvidence(s);
  const { proposal, usd, model, tokens } = await proposeChanges(s, evidence);

  recordApiSpend({ agent: AGENT, apiName: "perplexity:setup-evidence", totalCostUsd: aiCostUsd, details: `setup check ${s.name}` });
  recordApiSpend({ agent: AGENT, apiName: `anthropic:${model}`, totalCostUsd: usd, details: `setup check ${s.name} (${tokens.in} in / ${tokens.out} out)` });
  const usdInr = Number(process.env.USD_INR_RATE);
  if (isFinite(usdInr) && usdInr > 0) {
    const today = getTodayDateString();
    const rows = [
      { category: "llm", engine: null, usd, detail: { model, purpose: "setup_review", input_tokens: tokens.in, output_tokens: tokens.out } },
      { category: "engine_api", engine: "perplexity", usd: aiCostUsd, detail: { purpose: "setup_review_evidence" } },
    ].filter((r) => r.usd > 0);
    if (rows.length) {
      await sb.from("usage_costs").insert(rows.map((r) => ({
        tenant_id: s.tenantId, brand_id: s.brandId, product: "truevisible", cost_date: today, category: r.category, engine: r.engine,
        units: 1, amount_inr: Number((r.usd * usdInr).toFixed(4)), detail: { ...r.detail, usd: r.usd, usd_inr_rate: usdInr },
      })));
    }
  }

  const { data: review, error } = await sb.from("setup_reviews").insert({ tenant_id: s.tenantId, brand_id: s.brandId, status: "proposed", proposal, evidence }).select("id").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return null; // another process opened it
    throw new Error(`save review: ${error.message}`);
  }

  const evLine = [
    evidence.site ? (evidence.site.ok ? "site ✓" : `site ✗ (${evidence.site.error})`) : "no site",
    evidence.aiAnswer ? `AI answer ✓ (${evidence.aiEngine})` : `AI answer ✗ (${evidence.aiError ?? "—"})`,
    `$${(usd + aiCostUsd).toFixed(4)}`,
  ].join(" · ");
  const blocks = buildReviewBlocks(s, proposal, review.id, evLine);
  if (!config.slackBotToken) return review.id;
  const msg = await slackClient.chat.postMessage({
    channel: config.approvalsChannelId, blocks,
    text: `Setup check · ${s.name} — ${changeCount(proposal)} suggested change(s)`,
  });
  await sb.from("setup_reviews").update({ slack_channel: msg.channel, slack_ts: msg.ts }).eq("id", review.id);
  return review.id;
}

// ── Slack interactions ────────────────────────────────────────────────────────

async function loadOpenReview(sb: SupabaseClient, reviewId: string) {
  const { data } = await sb.from("setup_reviews").select("*").eq("id", reviewId).single();
  return data;
}

async function ephemeral(payload: any, text: string) {
  await slackClient.chat.postEphemeral({ channel: payload.channel?.id, user: payload.user?.id, text }).catch(() => {});
}

export async function handleSetupAction(payload: any, action: any): Promise<void> {
  if (action.action_id?.startsWith("setup_select_")) return; // tick-box changes are read from state on the button click
  const sb = getSupabase();
  if (!sb) return;
  const reviewId = String(action.value || "");
  const review = await loadOpenReview(sb, reviewId);
  if (!review || review.status !== "proposed") {
    await ephemeral(payload, "This setup check is no longer open (already decided or superseded).");
    return;
  }

  if (action.action_id === "setup_changes") {
    await openModal(payload.trigger_id, {
      type: "modal", callback_id: "setup_changes_modal",
      private_metadata: JSON.stringify({ reviewId, channel: payload.channel?.id, ts: payload.container?.message_ts }),
      title: { type: "plain_text", text: "Needs changes" },
      submit: { type: "plain_text", text: "Send to customer" },
      blocks: [{
        type: "input", block_id: "note",
        label: { type: "plain_text", text: "Message to the customer (shown on their dashboard)" },
        element: { type: "plain_text_input", action_id: "text", multiline: true, max_length: 500,
          placeholder: { type: "plain_text", text: "e.g. Please add your main competitors in Mohali — we'll check again as soon as you save." } },
      }],
    });
    return;
  }

  const actor = await getActorDisplayName(payload.user);
  const s = await loadSnapshot(sb, review.brand_id);
  const proposal = review.proposal as Proposal;
  const plan = action.action_id === "setup_approve" ? planApply(s, proposal, readSelection(payload.state?.values)) : EMPTY_PLAN;

  // Claim the review first so a double click can't apply twice.
  const { data: claimed } = await sb.from("setup_reviews")
    .update({ status: "approved", decided_by: actor, decided_at: new Date().toISOString(), applied: plan })
    .eq("id", reviewId).eq("status", "proposed").select("id");
  if (!claimed?.length) return;

  try {
    await applyAndVerify(sb, s, plan, actor);
  } catch (err: any) {
    await sb.from("setup_reviews").update({ status: "failed", error: String(err?.message ?? err).slice(0, 500) }).eq("id", reviewId);
    await ephemeral(payload, `Couldn't apply: ${String(err?.message ?? err).slice(0, 300)}. Nothing was marked verified.`);
    return;
  }

  const time = getCurrentTimeIST();
  const what = describePlan(plan);
  const outcome = `✅ *Verified* by ${actor} at ${time} IST — ${planSize(plan) ? what : "approved as entered"}. First AI check started.`;
  await slackClient.chat.update({ channel: payload.channel?.id, ts: payload.container?.message_ts, blocks: decidedBlocks(payload.message?.blocks, outcome), text: outcome }).catch(() => {});
  appendFileInRepo(`decisions/${getTodayDateString()}.md`, `- ${time} IST · ${actor} · APPROVE · ${AGENT} · Setup verified: ${s.name} (${what}) · review ${reviewId}`,
    `chore(decision): setup verified for ${s.name} per ${actor}`).catch((e) => console.warn("[Setup Queue] decision log failed", e?.message ?? e));

  // First audit for this brand right away (Citation Tracker; idempotent per engine × day).
  runCitationTracking({ brandId: s.brandId }).catch((e) => console.error("[Setup Queue] first run failed", e));
}

export async function handleSetupChangesSubmission(payload: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const meta = JSON.parse(payload.view?.private_metadata || "{}");
  const note = String(payload.view?.state?.values?.note?.text?.value ?? "").trim().slice(0, 500);
  const actor = await getActorDisplayName(payload.user);
  const { data: claimed } = await sb.from("setup_reviews")
    .update({ status: "changes_requested", decided_by: actor, decided_at: new Date().toISOString(), note })
    .eq("id", meta.reviewId).eq("status", "proposed").select("brand_id");
  if (!claimed?.length) return;
  const brandId = claimed[0].brand_id;
  await sb.from("brands").update({ setup_status: "needs_changes", setup_note: note || null }).eq("id", brandId);
  const { data: b } = await sb.from("brands").select("name").eq("id", brandId).single();
  const time = getCurrentTimeIST();
  const outcome = `↩️ *Sent back* by ${actor} at ${time} IST — “${note}”`;
  if (meta.channel && meta.ts) {
    const hist: any = await slackClient.conversations.history({ channel: meta.channel, latest: meta.ts, inclusive: true, limit: 1 }).catch(() => null);
    const blocks = hist?.messages?.[0]?.blocks ?? [];
    await slackClient.chat.update({ channel: meta.channel, ts: meta.ts, blocks: decidedBlocks(blocks, outcome), text: outcome }).catch(() => {});
  }
  appendFileInRepo(`decisions/${getTodayDateString()}.md`, `- ${time} IST · ${actor} · REJECT · ${AGENT} · Setup needs changes: ${b?.name ?? brandId} — ${note} · review ${meta.reviewId}`,
    `chore(decision): setup sent back for ${b?.name ?? brandId} per ${actor}`).catch(() => {});
}

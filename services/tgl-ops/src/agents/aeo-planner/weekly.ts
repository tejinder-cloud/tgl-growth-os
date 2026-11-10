// The team's weekly to-do from each live 90-day plan (Day 29b follow-up): Monday 09:15 IST, one message per client in
// #doors-aeo listing this week's and carried-over items, each with a Done button (optional proof link and note — the
// client sees both). Done items show on the client's Plan tab and, if they changed something, in "What changed".
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import { slackClient, openModal, getActorDisplayName } from "../../lib/slack-client.js";
import { resolveChannelId } from "../../lib/post.js";
import { getTodayDateString } from "../../lib/standup.js";
import { getSupabase } from "../prospect-researcher/db.js";
import type { Item } from "./plan.js";

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Week of the plan (1–13); 0 before it starts, 14 after (same rule as the app's lib/aeo-plan.ts). */
export function planWeek(startsOn: string, today: string): number {
  const days = Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(startsOn + "T00:00:00Z")) / 86_400_000);
  return days < 0 ? 0 : Math.min(14, Math.floor(days / 7) + 1);
}

/** Items due by this week and not done: this week's first, then carried over (pure; tested). */
export function dueItems(items: Item[], week: number, done: Set<string>, recDone: Set<string>): Item[] {
  return items.filter((i) => i.week <= week && !done.has(i.id) && !(i.recommendation_id && recDone.has(i.recommendation_id)))
    .sort((a, b) => Number(b.week === week) - Number(a.week === week) || a.week - b.week);
}

export function weekBlocks(brand: string, planId: string, week: number, items: Item[]): any[] {
  const blocks: any[] = [{ type: "header", text: { type: "plain_text", text: cut(`Week ${week} · ${brand} — plan items`, 150) } }];
  if (!items.length) return [...blocks, { type: "section", text: { type: "mrkdwn", text: "Nothing due — all caught up." } }];
  for (const i of items.slice(0, 45)) {
    blocks.push({
      type: "section", block_id: `item_${i.id}`,
      text: { type: "mrkdwn", text: cut(`${i.week < week ? "_carried over from week " + i.week + "_ · " : ""}*${esc(i.title)}*${i.count > 1 ? ` ×${i.count}` : ""} _(${i.kind}, ${i.path})_\n${esc(i.detail)}${i.recommendation_id ? "\n_Delivered through its recommendation on the dashboard._" : ""}`, 2900) },
      ...(i.recommendation_id && i.path === "wordpress" ? {} : { accessory: { type: "button", action_id: "planitem_done", value: `${planId}|${i.id}`, text: { type: "plain_text", text: "Done" } } }),
    });
  }
  return blocks;
}

export async function postWeeklyPlanItems(today = getTodayDateString()): Promise<number> {
  if (isTestMode() || !config.slackBotToken) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
  const { data: plans } = await sb.from("aeo_plans").select("id, brand_id, starts_on, items").eq("status", "approved");
  let n = 0;
  for (const p of (plans ?? []) as any[]) {
    const week = planWeek(p.starts_on, today);
    if (week < 1 || week > 13) continue;
    const items = p.items as Item[];
    const recIds = items.map((i) => i.recommendation_id).filter(Boolean) as string[];
    const [{ data: prog }, { data: recs }, { data: b }] = await Promise.all([
      sb.from("aeo_plan_progress").select("item_id").eq("plan_id", p.id),
      recIds.length ? sb.from("recommendations").select("id").in("id", recIds).in("status", ["done", "managed"]) : Promise.resolve({ data: [] as any[] }),
      sb.from("brands").select("name").eq("id", p.brand_id).single(),
    ]);
    const due = dueItems(items, week, new Set((prog ?? []).map((x: any) => x.item_id)), new Set((recs ?? []).map((x: any) => x.id)));
    await slackClient.chat.postMessage({ channel, blocks: weekBlocks(b?.name ?? "client", p.id, week, due), text: `Week ${week} · ${b?.name} — ${due.length} plan item(s) due` }).catch(() => {});
    n++;
  }
  return n;
}

export async function handlePlanItemDone(payload: any, action: any): Promise<void> {
  const [planId, itemId] = String(action.value ?? "").split("|");
  if (!planId || !itemId) return;
  await openModal(payload.trigger_id, {
    type: "modal", callback_id: "planitem_done_modal",
    private_metadata: JSON.stringify({ planId, itemId, channel: payload.channel?.id, ts: payload.container?.message_ts }),
    title: { type: "plain_text", text: "Mark done" }, submit: { type: "plain_text", text: "Done" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: cut(payload.message?.blocks?.find((x: any) => x.block_id === `item_${itemId}`)?.text?.text ?? "Plan item", 2900) } },
      { type: "input", block_id: "url", optional: true, label: { type: "plain_text", text: "Link to proof (the client sees it)" }, element: { type: "url_text_input", action_id: "v", placeholder: { type: "plain_text", text: "https://… the listing, page or post" } } },
      { type: "input", block_id: "note", optional: true, label: { type: "plain_text", text: "Note (the client sees it)" }, element: { type: "plain_text_input", action_id: "v", max_length: 500, placeholder: { type: "plain_text", text: "e.g. Listed on Sortlist and Semrush Agencies; GoodFirms pending review." } } },
    ],
  });
}

export async function handlePlanItemDoneSubmission(payload: any, sbIn?: SupabaseClient): Promise<void> {
  const sb = sbIn ?? getSupabase();
  if (!sb) return;
  const meta = JSON.parse(payload.view?.private_metadata || "{}");
  const v = payload.view?.state?.values ?? {};
  const url = String(v.url?.v?.value ?? "").trim() || null;
  const note = String(v.note?.v?.value ?? "").trim().slice(0, 500) || null;
  const actor = await getActorDisplayName(payload.user);
  const { error } = await sb.rpc("svc_plan_item_done", { p_plan: meta.planId, p_item: meta.itemId, p_url: url, p_note: note, p_by: actor });
  if (!meta.channel || !meta.ts) return;
  const hist: any = await slackClient.conversations.history({ channel: meta.channel, latest: meta.ts, inclusive: true, limit: 1 }).catch(() => null);
  const blocks = (hist?.messages?.[0]?.blocks ?? []).map((b: any) => b.block_id === `item_${meta.itemId}`
    ? { type: "section", block_id: b.block_id, text: { type: "mrkdwn", text: cut(`${b.text?.text ?? ""}\n${error ? `Not saved: ${esc(error.message)}` : `Done: ${esc(actor)}${url ? ` · <${url}|proof>` : ""}${note ? ` · ${esc(note)}` : ""}`}`, 2900) } }
    : b);
  await slackClient.chat.update({ channel: meta.channel, ts: meta.ts, blocks, text: "Plan items" }).catch(() => {});
}

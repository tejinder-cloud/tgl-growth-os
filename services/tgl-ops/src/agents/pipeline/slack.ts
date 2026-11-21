// services/tgl-ops/src/agents/pipeline/slack.ts
// The Architect's taps: after a call, "Call happened" or "No-show"; then "Proposal sent" (amount and currency) or
// "Lost" (a reason); then "Won" or "Lost". Only the Architect can move a deal.
import { money, STAGE_LABEL, type Currency, type Deal } from "./stages.js";
import type { ActionResult, Pipeline } from "./service.js";

export const PIPELINE_ACTIONS = ["pipeline_call_done", "pipeline_no_show", "pipeline_proposal", "pipeline_won", "pipeline_lost"] as const;
export const PROPOSAL_MODAL = "pipeline_proposal_modal";
export const LOST_MODAL = "pipeline_lost_modal";

export function isPipelineAction(id: unknown): boolean {
  return typeof id === "string" && (PIPELINE_ACTIONS as readonly string[]).includes(id);
}
export function isPipelineModal(id: unknown): boolean {
  return id === PROPOSAL_MODAL || id === LOST_MODAL;
}

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } });
const button = (text: string, action_id: string, value: string, style?: "primary" | "danger") => ({ type: "button", text: { type: "plain_text", text }, action_id, value, ...(style ? { style } : {}) });

export function istLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) + " IST";
}

export function who(d: Deal): string {
  return `${d.contact_name ? `${d.contact_name}, ` : ""}${d.company}`;
}

/** The card after a call has ended. */
export function afterCallBlocks(d: Deal): unknown[] {
  return [
    section(`*Call with ${who(d)}*${d.call_at ? ` (${istLabel(d.call_at)})` : ""} should be over. How did it go?`),
    { type: "actions", elements: [button("Call happened", "pipeline_call_done", d.id, "primary"), button("No-show", "pipeline_no_show", d.id)] },
  ];
}

/** The card after a deal moves, with the next buttons for its stage. */
export function stageBlocks(d: Deal, line: string): unknown[] {
  const blocks: unknown[] = [section(`*${who(d)}*: ${STAGE_LABEL[d.stage]}\n${line}`)];
  if (d.stage === "call_done" || d.stage === "replied" || d.stage === "call_booked") {
    blocks.push({ type: "actions", elements: [button("Proposal sent", "pipeline_proposal", d.id, "primary"), button("Lost", "pipeline_lost", d.id, "danger")] });
  } else if (d.stage === "proposal_sent") {
    blocks.push({ type: "actions", elements: [button("Won", "pipeline_won", d.id, "primary"), button("Lost", "pipeline_lost", d.id, "danger")] });
  }
  return blocks;
}

export function proposalModal(d: Deal, meta: object): unknown {
  return {
    type: "modal",
    callback_id: PROPOSAL_MODAL,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "Proposal sent" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      section(`*${who(d)}*`),
      { type: "input", block_id: "amount", label: { type: "plain_text", text: "Amount a month" }, element: { type: "number_input", action_id: "v", is_decimal_allowed: true, min_value: "1", placeholder: { type: "plain_text", text: "for example 25000" } } },
      {
        type: "input",
        block_id: "currency",
        label: { type: "plain_text", text: "Currency" },
        element: {
          type: "static_select",
          action_id: "v",
          initial_option: { text: { type: "plain_text", text: "Rupees (INR)" }, value: "INR" },
          options: [
            { text: { type: "plain_text", text: "Rupees (INR)" }, value: "INR" },
            { text: { type: "plain_text", text: "US dollars (USD)" }, value: "USD" },
          ],
        },
      },
    ],
  };
}

export function lostModal(d: Deal, meta: object): unknown {
  return {
    type: "modal",
    callback_id: LOST_MODAL,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "Mark as lost" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      section(`*${who(d)}*`),
      { type: "input", block_id: "reason", label: { type: "plain_text", text: "Why, in a few words" }, element: { type: "plain_text_input", action_id: "v", max_length: 300, placeholder: { type: "plain_text", text: "for example: budget, chose another agency, no reply" } } },
    ],
  };
}

export interface SlackPorts {
  pipeline: Pipeline;
  getDeal: (id: string) => Promise<Deal | null>;
  isArchitect: (user: any) => Promise<boolean>;
  actorName: (user: any) => Promise<string>;
  updateMessage: (channel: string, ts: string, text: string, blocks: unknown[]) => Promise<void>;
  postThread: (channel: string, ts: string | undefined, text: string) => Promise<void>;
  openModal: (triggerId: string, view: unknown) => Promise<void>;
}

async function finish(p: SlackPorts, channel: string, ts: string | undefined, r: ActionResult): Promise<string> {
  if (!r.ok) {
    await p.postThread(channel, ts, r.message);
    return "refused";
  }
  if (ts) await p.updateMessage(channel, ts, `${who(r.deal)}: ${STAGE_LABEL[r.deal.stage]}`, stageBlocks(r.deal, r.line));
  else await p.postThread(channel, ts, r.line);
  return r.deal.stage;
}

export async function handlePipelineAction(payload: any, action: any, p: SlackPorts): Promise<string> {
  const channel: string = payload.channel?.id || payload.container?.channel_id || "";
  const ts: string | undefined = payload.container?.message_ts || payload.message?.ts;
  if (!(await p.isArchitect(payload.user).catch(() => false))) {
    await p.postThread(channel, ts, "Only the Architect can move a deal. Nothing was changed.");
    return "not_architect";
  }
  const id = String(action.value || "");
  const by = await p.actorName(payload.user).catch(() => "the Architect");
  if (action.action_id === "pipeline_proposal" || action.action_id === "pipeline_lost") {
    const d = await p.getDeal(id);
    if (!d) {
      await p.postThread(channel, ts, "That deal was not found.");
      return "missing";
    }
    const meta = { id, channel, ts };
    await p.openModal(payload.trigger_id, action.action_id === "pipeline_proposal" ? proposalModal(d, meta) : lostModal(d, meta));
    return "modal";
  }
  const r =
    action.action_id === "pipeline_call_done" ? await p.pipeline.callHappened(id, by)
    : action.action_id === "pipeline_no_show" ? await p.pipeline.noShow(id, by)
    : await p.pipeline.won(id, by);
  return finish(p, channel, ts, r);
}

/** Field errors keep the box open (Slack's response_action "errors"). */
export function pipelineModalResponse(payload: any): { response_action: "clear" } | { response_action: "errors"; errors: Record<string, string> } {
  const v = payload?.view?.state?.values || {};
  if (payload?.view?.callback_id === PROPOSAL_MODAL) {
    const amount = Number(v.amount?.v?.value);
    if (!(amount > 0)) return { response_action: "errors", errors: { amount: "Enter the amount a month, above zero." } };
  } else if (!String(v.reason?.v?.value || "").trim()) {
    return { response_action: "errors", errors: { reason: "Add a short reason." } };
  }
  return { response_action: "clear" };
}

export async function handlePipelineModal(payload: any, p: SlackPorts): Promise<string> {
  let meta: { id?: string; channel?: string; ts?: string } = {};
  try {
    meta = JSON.parse(payload?.view?.private_metadata || "{}");
  } catch {
    meta = {};
  }
  const channel = meta.channel || "";
  if (!(await p.isArchitect(payload.user).catch(() => false))) {
    await p.postThread(channel, meta.ts, "Only the Architect can move a deal. Nothing was changed.");
    return "not_architect";
  }
  const by = await p.actorName(payload.user).catch(() => "the Architect");
  const v = payload?.view?.state?.values || {};
  const r =
    payload.view.callback_id === PROPOSAL_MODAL
      ? await p.pipeline.proposalSent(String(meta.id), Number(v.amount?.v?.value), (v.currency?.v?.selected_option?.value === "USD" ? "USD" : "INR") as Currency, by)
      : await p.pipeline.lost(String(meta.id), String(v.reason?.v?.value || ""), by);
  return finish(p, channel, meta.ts, r);
}

export { money };

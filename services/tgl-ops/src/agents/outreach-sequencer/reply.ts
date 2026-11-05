// services/tgl-ops/src/agents/outreach-sequencer/reply.ts
// Inbound reply handling: parse the GHL webhook, classify intent deterministically (no LLM, no cost),
// stop or defer the sequence, annotate GHL, and route to the Sales Desk.
import { postLine } from "../../lib/post.js";
import type { GhlClient } from "./ghl.js";
import { addBusinessDays } from "./sequence.js";
import { getOutreachState, type ProspectStore } from "./store.js";
import type { OutreachState, ReplyIntent } from "./types.js";

export interface ParsedReply {
  contactId?: string;
  email?: string;
  text: string;
  messageId?: string;
}

const ACTION_INTENTS: ReplyIntent[] = ["meeting_request", "positive_interest", "question", "referral"];

export function classifyIntent(raw: string): ReplyIntent {
  const t = (raw || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return "other";

  const optOutPhrase =
    /(unsubscribe|remove me|take me off|opt.?out|do not (contact|email|message|write|call)|don'?t (contact|email|message|write|call)|stop (emailing|messaging|writing|contacting|sending)|no more (emails|messages))/;
  const bareStop = /^(please )?stop[.! ]*$/.test(t) || (t.length <= 40 && /\bstop\b/.test(t));
  if (optOutPhrase.test(t) || bareStop) return "opt_out";

  if (/(out of (the )?office|auto.?reply|automatic reply|on leave|currently away|away from (my )?(desk|email)|will be back)/.test(t)) {
    return "out_of_office";
  }

  if (/(wrong person|not the right person|right person (is|would be)|reach out to|contact my|please (talk|speak) to|forward(ed)? (this|it)|handled by|handles (this|marketing))/.test(t)) {
    return "referral";
  }

  if (/(not interested|no thanks|no thank you|not (a )?(priority|required|needed|looking)|already (have|work|working)|we have an agency|don'?t need|do not need)/.test(t)) {
    return "not_interested";
  }

  if (/(let'?s (talk|connect|speak|schedule|do it|catch up)|schedule (a|the|it)|book (a|the|it)|set up a|send (me )?(some )?(times|slots)|when are you free|are you free|free (on|at|tomorrow|this)|happy to (talk|connect|speak|chat|meet)|call me|can we (talk|speak|meet|connect|jump)|share (your )?(calendar|availability))/.test(t)) {
    return "meeting_request";
  }

  if (/(interested|sounds good|\byes\b|please send|tell me more|share more|send (me )?(the )?(details|more|audit|report)|looks (good|interesting)|curious|go ahead)/.test(t)) {
    return "positive_interest";
  }

  if (t.includes("?") || /\b(how|what|why|which|cost|price|pricing|fee|charge|charges)\b/.test(t)) {
    return "question";
  }

  return "other";
}

/** Tolerant parser for GHL inbound-message and workflow webhook shapes. Returns null for outbound or empty. */
export function parseGhlReplyPayload(body: any): ParsedReply | null {
  if (!body || typeof body !== "object") return null;

  const type = String(body.type || "");
  const direction = String(body.direction || body.message?.direction || "").toLowerCase();
  if (type === "OutboundMessage" || direction === "outbound") return null;

  const text =
    (typeof body.body === "string" && body.body) ||
    (typeof body.message === "string" && body.message) ||
    body.message?.body ||
    body.message?.text ||
    (typeof body.text === "string" && body.text) ||
    "";
  const clean = String(text).trim();
  if (!clean) return null;

  const contactId = body.contactId || body.contact_id || body.contact?.id;
  const email = body.email || body.from || body.contact?.email;
  const messageId = body.messageId || body.message_id || body.message?.id || body.id;

  return {
    contactId: contactId ? String(contactId) : undefined,
    email: email && String(email).includes("@") ? String(email).trim() : undefined,
    text: clean,
    messageId: messageId ? String(messageId) : undefined,
  };
}

export interface ReplyDeps {
  store: ProspectStore;
  ghl?: GhlClient;
  notify?: (channel: string, text: string) => Promise<unknown>;
  now?: () => Date;
  salesDeskChannel?: string;
}

export interface ReplyResult {
  status: "routed" | "ignored" | "duplicate";
  matched: boolean;
  intent?: ReplyIntent;
  sequenceAction?: "stopped" | "deferred" | "opted_out" | "none";
}

export function salesDeskChannel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SALES_DESK_CHANNEL_ID || "#revenue").trim();
}

function actionLabel(intent: ReplyIntent): string {
  return ACTION_INTENTS.includes(intent) ? "action needed" : "FYI";
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

export async function handleReply(payload: any, deps: ReplyDeps): Promise<ReplyResult> {
  const parsed = parseGhlReplyPayload(payload);
  if (!parsed) return { status: "ignored", matched: false };

  const now = (deps.now || (() => new Date()))();
  const notify = deps.notify || ((channel: string, text: string) => postLine({ channel, text }));
  const channel = deps.salesDeskChannel || salesDeskChannel();
  const intent = classifyIntent(parsed.text);

  let prospect = parsed.contactId ? await deps.store.findByGhlContactId(parsed.contactId) : null;
  if (!prospect && parsed.email) prospect = await deps.store.findByEmail(parsed.email);

  if (!prospect) {
    await notify(
      channel,
      `*Prospect reply (unmatched)* intent: *${intent}* [${actionLabel(intent)}]\nGHL contact: ${parsed.contactId || "unknown"}${parsed.email ? ` | ${parsed.email}` : ""}\nNot matched to a running sequence; no sequence state changed.\n> ${clip(parsed.text, 600)}`
    );
    return { status: "routed", matched: false, intent, sequenceAction: "none" };
  }

  const prior = getOutreachState(prospect);
  if (!prior) {
    return { status: "ignored", matched: false };
  }
  if (parsed.messageId && prior.last_reply_message_id === parsed.messageId && prior.last_reply_routed) {
    return { status: "duplicate", matched: true, intent: prior.last_reply_intent };
  }

  const next: OutreachState = {
    ...prior,
    last_reply_message_id: parsed.messageId,
    last_reply_intent: intent,
    last_reply_at: now.toISOString(),
    last_reply_routed: false,
  };
  let sequenceAction: ReplyResult["sequenceAction"] = "stopped";
  let status: "rejected" | undefined;
  const tags = [`tgl-intent-${intent.replace(/_/g, "-")}`];

  const repliedTouch = prior.touches.length > 0 ? prior.touches[prior.touches.length - 1].n : 0;

  if (intent === "opt_out") {
    next.state = "opted_out";
    status = "rejected";
    sequenceAction = "opted_out";
    tags.push("tgl-opt-out", "DND");
  } else if (intent === "out_of_office") {
    const base = new Date(Math.max(now.getTime(), new Date(prior.next_due_at).getTime()));
    next.next_due_at = addBusinessDays(base, 3).toISOString();
    sequenceAction = "deferred";
  } else {
    next.state = "replied";
    tags.push("tgl-replied");
  }

  // Stop/defer first: a Slack outage must never leave a replied prospect in the send queue.
  await deps.store.saveState(prospect.id, next, status);

  if (deps.ghl && prior.ghl_contact_id) {
    try {
      await deps.ghl.addTags(prior.ghl_contact_id, tags);
      await deps.ghl.addNote(prior.ghl_contact_id, `Reply after touch ${repliedTouch} (intent: ${intent}): ${clip(parsed.text, 1000)}`);
    } catch (err: any) {
      console.warn(`[Outreach Reply] GHL annotate failed for ${prior.ghl_contact_id}:`, err?.message || err);
    }
  }

  const dm = prospect.decision_maker;
  const sequenceLine =
    sequenceAction === "opted_out"
      ? "Sequence: stopped. Prospect opted out; do not contact again."
      : sequenceAction === "deferred"
        ? `Sequence: next touch deferred to ${next.next_due_at.slice(0, 10)}.`
        : "Sequence: stopped. Sales Desk owns this conversation.";
  await notify(
    channel,
    [
      `*Prospect reply: ${prospect.company}* (${prospect.city}) intent: *${intent}* [${actionLabel(intent)}]`,
      `Decision-maker: ${dm?.name || "Owner"}${dm?.role ? `, ${dm.role}` : ""}${dm?.email ? ` | ${dm.email}` : ""}${dm?.phone ? ` | ${dm.phone}` : ""}`,
      `Replied after touch ${repliedTouch} of 5 | Fit score: ${prospect.fit_score} | ${prospect.website}`,
      sequenceLine,
      `> ${clip(parsed.text, 600)}`,
      ...(prospect.fit_reasons?.length ? [`Fit reasons: ${prospect.fit_reasons.slice(0, 3).join("; ")}`] : []),
    ].join("\n")
  );

  await deps.store.saveState(prospect.id, { ...next, last_reply_routed: true }, status);

  return { status: "routed", matched: true, intent, sequenceAction };
}

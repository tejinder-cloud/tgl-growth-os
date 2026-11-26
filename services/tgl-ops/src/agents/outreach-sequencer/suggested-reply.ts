// services/tgl-ops/src/agents/outreach-sequencer/suggested-reply.ts
// Suggested replies to prospect emails (25 Nov 2026). When a prospect answers with interest, a meeting request,
// a question, a referral or something unclear, a draft reply is posted in #revenue with three free 20-minute
// slots from the booking calendar (on different days) and the booking link. Nothing goes to the prospect until
// the Architect presses Send as written or Edit and send. A draft is sent once, as a reply in the same email
// thread, and never to someone who opted out. The draft states no numbers or claims: only times and the link.
import type { DaySlots } from "../booking/slots.js";
import type { OutreachEmail } from "./email.js";
import type { OutreachState, ReplyIntent } from "./types.js";
import type { OutreachProspect } from "./store.js";
import { cleanBusinessName } from "./names.js";

export const SEND_ACTION = "reply_send";
export const EDIT_ACTION = "reply_edit";
export const EDIT_MODAL = "reply_edit_modal";
/** Left in a draft that needs the Architect's own words; such a draft cannot be sent until it is replaced. */
export const PLACEHOLDER = "[Write your answer here]";

export function isSuggestedReplyAction(id: unknown): boolean {
  return id === SEND_ACTION || id === EDIT_ACTION;
}
export function isSuggestedReplyModal(id: unknown): boolean {
  return id === EDIT_MODAL;
}

export interface SuggestedReply {
  text: string;
  subject: string;
  /** The address the prospect wrote from. */
  to: string;
  in_reply_to?: string;
  intent: ReplyIntent;
  needs_edit: boolean;
  /** Storage path of the one-page PDF to attach: a YES to the first email asked for it (26 Nov 2026). */
  attach_path?: string;
  created_at: string;
  status: "draft" | "sending" | "sent";
  sent_at?: string;
  sent_by?: string;
  message_id?: string;
  channel?: string;
  ts?: string;
}

/** Intents that get a draft. Opt-outs, out-of-office and "not interested" never do. */
export const DRAFT_INTENTS: ReplyIntent[] = ["meeting_request", "positive_interest", "question", "referral", "other"];

/** "Dr Asha Rao" -> "Dr Rao"; "Neha Motwani" -> "Neha"; a role or placeholder -> "". */
export function greetingName(name?: string | null): string {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (!n || n.includes("/") || /dm unknown|contact found|^owner\b|lead doctor|team|^the /i.test(n)) return "";
  const parts = n.replace(/\./g, "").split(" ").filter(Boolean);
  if (/^(dr|doctor)$/i.test(parts[0]) && parts.length > 1) return `Dr ${parts[parts.length - 1]}`;
  return parts[0];
}

/** Up to n slots, the first free one on each day, so the prospect gets a spread of days. */
export function pickSlots(days: DaySlots[], n = 3): string[] {
  const out: string[] = [];
  for (const d of days) {
    if (d.slots.length) out.push(d.slots[0]);
    if (out.length >= n) break;
  }
  return out;
}

/** "Thu 26 Nov, 3:00 pm". */
export function slotLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/^(\w+), /, "$1 ")
    .replace(/ (am|pm)$/i, (m) => m.toLowerCase());
}

export function replySubject(subject?: string | null): string {
  const s = String(subject || "").replace(/\s+/g, " ").trim();
  if (!s) return "Re: your reply";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export interface DraftInput {
  intent: ReplyIntent;
  /** The report is attached to this reply (they asked for it and have not had it yet). */
  withReport?: boolean;
  name?: string | null;
  company: string;
  slots: string[];
  bookingLink?: string;
  senderName: string;
}

/** The draft text, or null when this kind of reply gets no draft. Pure. */
export function draftReply(d: DraftInput): { text: string; needsEdit: boolean } | null {
  if (!DRAFT_INTENTS.includes(d.intent)) return null;
  const hello = greetingName(d.name) ? `Hi ${greetingName(d.name)},` : "Hello,";
  const company = cleanBusinessName(d.company);
  const times = d.slots.length ? `${d.slots.map((s) => `- ${slotLabel(s)}`).join("\n")}\n(all times IST)` : "";
  const link = d.bookingLink ? `Or pick any time that suits you here: ${d.bookingLink}` : "";
  const offer = (lead: string) => [lead, times, link].filter(Boolean).join("\n\n");
  let body: string;
  let needsEdit = false;
  if (d.withReport && (d.intent === "meeting_request" || d.intent === "positive_interest")) {
    body = [
      `Thank you. The one-page result for ${company} is attached: the five questions, what each assistant said, and who they named.`,
      times || link ? offer(times ? "If it helps, I can take you through it in 20 minutes. These times are free:" : "If it helps, I can take you through it in 20 minutes.") : "If it helps, I can take you through it in 20 minutes. When would suit you?",
    ].join("\n\n");
  } else if (d.intent === "meeting_request" || d.intent === "positive_interest") {
    body = [
      `Thank you for getting back to me. I would be glad to take you through what we found for ${company} and what to fix first. It takes 20 minutes.`,
      times || link ? offer(times ? "Would one of these times suit you?" : "") : "When would suit you for a 20-minute call?",
    ].join("\n\n");
  } else if (d.intent === "referral") {
    body = [
      "Thank you for pointing me to the right person. Could you share their name and email, or forward this to them? I will keep it short.",
      times || link ? offer(times ? "If they would like to talk, these times are free:" : "") : "",
    ].filter(Boolean).join("\n\n");
  } else {
    needsEdit = true;
    body = [`Thank you for your reply.`, PLACEHOLDER, times || link ? offer(times ? "If it is easier to talk it through, I have 20 minutes free at:" : "") : ""].filter(Boolean).join("\n\n");
  }
  return { text: `${hello}\n\n${body.replace(/\n{3,}/g, "\n\n").trim()}\n\n${d.senderName}`, needsEdit };
}

/** The Slack message for a draft: who replied, the draft as a quote, and the buttons. */
export function suggestionBlocks(company: string, reply: SuggestedReply, prospectId: string): any[] {
  const quoted = reply.text.split("\n").map((l) => `> ${l}`).join("\n");
  const buttons: any[] = [];
  if (!reply.needs_edit) buttons.push({ type: "button", text: { type: "plain_text", text: "Send as written" }, style: "primary", action_id: SEND_ACTION, value: prospectId });
  buttons.push({ type: "button", text: { type: "plain_text", text: "Edit and send" }, action_id: EDIT_ACTION, value: prospectId });
  return [
    { type: "section", text: { type: "mrkdwn", text: `*Suggested reply to ${cleanBusinessName(company)}*${reply.needs_edit ? " (add your answer before sending)" : ""}\nSubject: ${reply.subject}${reply.attach_path ? "\nThe one-page report PDF is attached." : ""}` } },
    { type: "section", text: { type: "mrkdwn", text: quoted.slice(0, 2900) } },
    { type: "actions", elements: buttons },
    { type: "context", elements: [{ type: "mrkdwn", text: "Nothing is sent until you press a button. It goes as a reply in the same email thread." }] },
  ];
}

// ---------------------------------------------------------------------------
// Drafting, called by the reply handler after a reply is routed
// ---------------------------------------------------------------------------

export interface SuggestInput {
  prospect: OutreachProspect;
  state: OutreachState;
  intent: ReplyIntent;
  from: string;
  subject?: string;
  messageId?: string;
}

export interface SuggestPorts {
  now: () => Date;
  slots: () => Promise<string[]>;
  save: (id: string, state: OutreachState) => Promise<void>;
  post: (text: string, blocks: any[]) => Promise<{ channel?: string; ts?: string }>;
  senderName: string;
  bookingLink?: string;
}

/** Drafts and posts a suggested reply. Returns the draft, or null when this reply gets none. */
export async function suggestReply(input: SuggestInput, ports: SuggestPorts): Promise<SuggestedReply | null> {
  if (input.state.state === "opted_out") return null;
  const slots = await ports.slots().catch(() => [] as string[]);
  // They have not had the report yet (it goes with touch 3) and it is stored: the reply carries it.
  const reportSent = (input.state.touches || []).some((t) => t.n === 3 && !t.dry_run && t.sent_at);
  const withReport = !reportSent && Boolean(input.state.onepager_path) && (input.intent === "positive_interest" || input.intent === "meeting_request");
  const draft = draftReply({ intent: input.intent, withReport, name: input.prospect.decision_maker?.name, company: input.prospect.company, slots, bookingLink: ports.bookingLink, senderName: ports.senderName });
  if (!draft) return null;
  const reply: SuggestedReply = {
    text: draft.text,
    subject: replySubject(input.subject),
    to: input.from,
    ...(input.messageId && /^<[^<>\s]+@[^<>\s]+>$/.test(input.messageId) ? { in_reply_to: input.messageId } : {}),
    intent: input.intent,
    needs_edit: draft.needsEdit,
    ...(withReport ? { attach_path: input.state.onepager_path as string } : {}),
    created_at: ports.now().toISOString(),
    status: "draft",
  };
  const posted = await ports.post(`Suggested reply to ${cleanBusinessName(input.prospect.company)}`, suggestionBlocks(input.prospect.company, reply, input.prospect.id));
  const saved = { ...reply, channel: posted.channel, ts: posted.ts };
  await ports.save(input.prospect.id, { ...input.state, suggested_reply: saved } as OutreachState);
  return saved;
}

// ---------------------------------------------------------------------------
// Sending, from the buttons
// ---------------------------------------------------------------------------

export interface SendPorts {
  now: () => Date;
  isArchitect: (user: any) => Promise<boolean>;
  actorName: (user: any) => Promise<string>;
  load: (id: string) => Promise<{ prospect: OutreachProspect; state: OutreachState } | null>;
  save: (id: string, state: OutreachState) => Promise<void>;
  send: (email: OutreachEmail) => Promise<{ messageId: string }>;
  /** A signed link to a stored one-pager, for the attachment. */
  signReport: (path: string) => Promise<string>;
  tell: (channel: string, ts: string | undefined, text: string) => Promise<void>;
  openModal: (triggerId: string, view: any) => Promise<void>;
  recordSent: (prospect: OutreachProspect) => Promise<void>;
}

function draftOf(state: OutreachState): SuggestedReply | undefined {
  const r = (state as any).suggested_reply;
  return r && typeof r === "object" ? (r as SuggestedReply) : undefined;
}

function editModal(prospectId: string, company: string, reply: SuggestedReply, where: { channel: string; ts?: string }): any {
  return {
    type: "modal",
    callback_id: EDIT_MODAL,
    private_metadata: JSON.stringify({ id: prospectId, channel: where.channel, ts: where.ts }),
    title: { type: "plain_text", text: "Edit and send" },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `To *${cleanBusinessName(company)}*\nSubject: ${reply.subject}` } },
      { type: "input", block_id: "body", label: { type: "plain_text", text: "Your reply" }, element: { type: "plain_text_input", action_id: "v", multiline: true, initial_value: reply.text.slice(0, 2900) } },
    ],
  };
}

/** Why a reply cannot go out, or null when it can. */
export function blockedReason(prospect: OutreachProspect | undefined, state: OutreachState | undefined, reply: SuggestedReply | undefined, text: string): string | null {
  if (!prospect || !state || !reply) return "The draft was not found. Nothing was sent.";
  if (state.state === "opted_out") return `${cleanBusinessName(prospect.company)} has opted out. Nothing was sent.`;
  if (reply.status === "sent") return `Already sent${reply.sent_at ? ` at ${slotLabel(reply.sent_at)}` : ""}. Not sent again.`;
  if (reply.status === "sending") return "This reply is being sent right now. Not sent again.";
  if (!/\S+@\S+\.\S+/.test(reply.to)) return "There is no address to reply to. Nothing was sent.";
  if (text.includes(PLACEHOLDER)) return "The draft still has the placeholder for your answer. Use Edit and send.";
  if (text.trim().length < 20) return "The reply is too short. Nothing was sent.";
  return null;
}

async function doSend(id: string, text: string, user: any, where: { channel: string; ts?: string }, ports: SendPorts): Promise<string> {
  const loaded = await ports.load(id).catch(() => null);
  const reply = loaded ? draftOf(loaded.state) : undefined;
  const why = blockedReason(loaded?.prospect, loaded?.state, reply, text);
  if (why) {
    await ports.tell(where.channel, where.ts, why);
    return "blocked";
  }
  const { prospect, state } = loaded!;
  const r = reply!;
  // Mark as sending first, so a double click never sends twice.
  await ports.save(id, { ...state, suggested_reply: { ...r, status: "sending" } } as OutreachState);
  try {
    const attach = r.attach_path ? { attachmentUrl: await ports.signReport(r.attach_path), attachmentFilename: `${cleanBusinessName(prospect.company).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-AI-visibility.pdf` } : {};
    const sent = await ports.send({ prospectId: id, to: r.to, subject: r.subject, text, inReplyTo: r.in_reply_to, ...attach });
    const by = await ports.actorName(user).catch(() => "the Architect");
    const at = ports.now().toISOString();
    await ports.save(id, { ...state, suggested_reply: { ...r, text, status: "sent", sent_at: at, sent_by: by, message_id: sent.messageId } } as OutreachState);
    await ports.recordSent(prospect).catch(() => {});
    await ports.tell(where.channel, where.ts, `Sent to ${cleanBusinessName(prospect.company)} at ${slotLabel(at)} by ${by}.`);
    return "sent";
  } catch (err) {
    await ports.save(id, { ...state, suggested_reply: { ...r, status: "draft" } } as OutreachState).catch(() => {});
    const { plainError } = await import("../../lib/plain-error.js");
    await ports.tell(where.channel, where.ts, `Not sent: ${plainError(err)}. The draft is kept; try again.`);
    return "failed";
  }
}

export async function handleSuggestedReplyAction(payload: any, action: any, override?: Partial<SendPorts>): Promise<string> {
  const ports = { ...(await liveSendPorts()), ...(override || {}) } as SendPorts;
  const where = { channel: payload.channel?.id || payload.container?.channel_id || "", ts: payload.container?.message_ts || payload.message?.ts };
  if (!(await ports.isArchitect(payload.user).catch(() => false))) {
    await ports.tell(where.channel, where.ts, "Only the Architect can send a reply to a prospect. Nothing was sent.");
    return "not_architect";
  }
  const id = String(action.value || "");
  if (action.action_id === EDIT_ACTION) {
    const loaded = await ports.load(id).catch(() => null);
    const reply = loaded ? draftOf(loaded.state) : undefined;
    const why = blockedReason(loaded?.prospect, loaded?.state, reply, "x".repeat(20));
    if (why) {
      await ports.tell(where.channel, where.ts, why);
      return "blocked";
    }
    await ports.openModal(payload.trigger_id, editModal(id, loaded!.prospect.company, reply!, where));
    return "edit_modal";
  }
  const loaded = await ports.load(id).catch(() => null);
  const reply = loaded ? draftOf(loaded.state) : undefined;
  return doSend(id, reply?.text || "", payload.user, where, ports);
}

function modalText(payload: any): string {
  return String(payload?.view?.state?.values?.body?.v?.value || "").replace(/\r/g, "").trim();
}

/** Keeps the box open with a message when the text cannot be sent; otherwise closes it. */
export function suggestedReplyModalResponse(payload: any): { response_action: "errors"; errors: Record<string, string> } | { response_action: "clear" } {
  const text = modalText(payload);
  if (text.includes(PLACEHOLDER)) return { response_action: "errors", errors: { body: "Replace the placeholder with your answer." } };
  if (text.length < 20) return { response_action: "errors", errors: { body: "The reply is too short." } };
  return { response_action: "clear" };
}

export async function handleSuggestedReplyModal(payload: any, override?: Partial<SendPorts>): Promise<string> {
  const ports = { ...(await liveSendPorts()), ...(override || {}) } as SendPorts;
  let meta: { id?: string; channel?: string; ts?: string } = {};
  try {
    meta = JSON.parse(payload?.view?.private_metadata || "{}");
  } catch {
    meta = {};
  }
  const where = { channel: meta.channel || "", ts: meta.ts };
  if (!(await ports.isArchitect(payload.user).catch(() => false))) {
    await ports.tell(where.channel, where.ts, "Only the Architect can send a reply to a prospect. Nothing was sent.");
    return "not_architect";
  }
  return doSend(String(meta.id || ""), modalText(payload), payload.user, where, ports);
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

export function bookingLinkFor(env: NodeJS.ProcessEnv = process.env, publicUrl = ""): string | undefined {
  const set = (env.OUTREACH_BOOKING_LINK || "").trim();
  if (/^https:\/\/\S+$/.test(set)) return set;
  return publicUrl ? `${publicUrl}/book` : undefined;
}

export async function liveSuggestPorts(env: NodeJS.ProcessEnv = process.env): Promise<SuggestPorts> {
  const { loadEmailConfig } = await import("./email.js");
  const { postLine } = await import("../../lib/post.js");
  const { slackClient } = await import("../../lib/slack-client.js");
  const { resolveChannelId } = await import("../../lib/post.js");
  const { salesDeskChannel } = await import("./reply.js");
  const { createSupabaseStore } = await import("./store.js");
  const cfg = loadEmailConfig(env);
  const store = createSupabaseStore();
  return {
    now: () => new Date(),
    senderName: (env.OUTREACH_SENDER_NAME || "Tejinder Singh").trim(),
    bookingLink: bookingLinkFor(env, cfg.publicUrl),
    async slots() {
      const { bookingService } = await import("../booking/live.js");
      const s = await bookingService().slots();
      return s.open ? pickSlots(s.days) : [];
    },
    save: (id, state) => store.saveState(id, state),
    async post(text, blocks) {
      try {
        const channel = await resolveChannelId(salesDeskChannel());
        const r = await slackClient.chat.postMessage({ channel, text, blocks, unfurl_links: false });
        return { channel: r.channel as string, ts: r.ts as string };
      } catch (err) {
        await postLine({ channel: salesDeskChannel(), text: `${text}: the draft could not be posted (${(err as Error).message}).` }).catch(() => {});
        return {};
      }
    },
  };
}

async function liveSendPorts(): Promise<SendPorts> {
  const env = process.env;
  const { slackClient, openModal, getActorDisplayName } = await import("../../lib/slack-client.js");
  const { isArchitectUser } = await import("../../lib/org.js");
  const { createSupabaseStore, getOutreachState } = await import("./store.js");
  const { loadEmailConfig, createResendSender } = await import("./email.js");
  const store = createSupabaseStore();
  const cfg = loadEmailConfig(env);
  return {
    now: () => new Date(),
    isArchitect: (u) => isArchitectUser(u),
    actorName: (u) => getActorDisplayName(u),
    async load(id) {
      const p = (await store.loadSequenced()).find((r) => r.id === id);
      const s = p ? getOutreachState(p) : undefined;
      return p && s ? { prospect: p, state: s } : null;
    },
    save: (id, state) => store.saveState(id, state),
    async signReport(path) {
      const { signOnePagerPath } = await import("./live.js");
      return signOnePagerPath(path, env);
    },
    async send(email) {
      if (cfg.via === "gmail") {
        const { liveGmailSender } = await import("../gmail/live.js");
        return liveGmailSender(env, fetch).send(email);
      }
      if (!cfg.apiKey || !cfg.from) throw new Error("the outreach email sender is not configured");
      return createResendSender(cfg, fetch).send(email);
    },
    async tell(channel, ts, text) {
      if (!channel) return;
      await slackClient.chat.postMessage({ channel, text, ...(ts ? { thread_ts: ts } : {}) });
    },
    openModal: (t, v) => openModal(t, v),
    async recordSent(prospect) {
      const { recordEvent } = await import("../../lib/events.js");
      await recordEvent({ agent: "outreach-sequencer", kind: "sent", prospectId: prospect.id, summary: `Reply sent to ${cleanBusinessName(prospect.company)}.` });
    },
  };
}

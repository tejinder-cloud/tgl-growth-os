// services/tgl-ops/src/agents/outreach-sequencer/inbound.ts
// What happens when the email provider tells us something about an outreach email: a prospect replied,
// an address bounced, a recipient marked us as spam, or someone used the unsubscribe link.
// Every path stops or defers the sequence first and tells the Sales Desk second, so a Slack outage
// can never leave a prospect who said STOP in the send queue.
import { postLine } from "../../lib/post.js";
import type { EmailSender, ReceivedEmail } from "./email.js";
import { handleReply, salesDeskChannel, type ReplyDeps, type ReplyResult } from "./reply.js";
import { getOutreachState, type OutreachProspect } from "./store.js";
import type { OutreachState } from "./types.js";

export interface InboundDeps extends ReplyDeps {
  /** Reads the full received email (the webhook carries metadata only). */
  fetchReceived: (emailId: string) => Promise<ReceivedEmail>;
  /** Present when the service sends its own email; used to forward replies to the Architect. */
  sender?: EmailSender;
  /** The Architect's mailbox. Unset: replies appear in Slack only. */
  forwardTo?: string;
}

export interface InboundResult {
  status: "routed" | "ignored" | "duplicate" | "bounced" | "complained";
  matched: boolean;
  reply?: ReplyResult;
  forwarded?: boolean;
  forwardError?: string;
}

function notifier(deps: ReplyDeps): (text: string) => Promise<unknown> {
  const notify = deps.notify || ((channel: string, text: string) => postLine({ channel, text }));
  const channel = deps.salesDeskChannel || salesDeskChannel();
  return (text) => notify(channel, text);
}

function firstAddress(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const raw = String(first || "").trim();
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
  return (angled ? angled[1] : raw).toLowerCase();
}

async function onReceived(data: any, deps: InboundDeps): Promise<InboundResult> {
  const emailId = String(data?.email_id || "").trim();
  if (!emailId) return { status: "ignored", matched: false };

  const mail = await deps.fetchReceived(emailId);
  if (!mail.from) return { status: "ignored", matched: false };

  const known = await deps.store.findByEmail(mail.from);
  // Delivery notices and other machine mail from addresses we never wrote to are not prospect replies.
  if (!known && mail.automated) return { status: "ignored", matched: false };

  const reply = await handleReply(
    {
      email: mail.from,
      text: mail.text || mail.subject || "(empty reply)",
      messageId: mail.messageId || mail.id,
      autoReply: mail.automated,
    },
    deps
  );
  if (reply.status !== "routed") return { status: reply.status, matched: reply.matched, reply };

  const result: InboundResult = { status: "routed", matched: reply.matched, reply };
  if (deps.sender && deps.forwardTo) {
    try {
      await deps.sender.forward({
        to: deps.forwardTo,
        replyTo: mail.from,
        subject: `Prospect reply: ${mail.subject || "(no subject)"}`,
        text: [
          `${known ? known.company : "Unmatched sender"} replied to an outreach email.`,
          `From: ${mail.from}`,
          "Reply to this email to answer them directly.",
          "",
          mail.text || "(empty reply)",
        ].join("\n"),
      });
      result.forwarded = true;
    } catch (err) {
      // The Slack card has already been posted, so the reply is not lost; say plainly that the forward failed.
      result.forwarded = false;
      result.forwardError = (err as Error)?.message || String(err);
      console.warn(`[Outreach Inbound] forward failed: ${result.forwardError}`);
      await notifier(deps)(`*Reply not forwarded to email.* The reply from ${mail.from} is in the card above; forwarding failed: ${result.forwardError}`);
    }
  }
  return result;
}

async function stopForDelivery(kind: "bounced" | "complained", data: any, deps: InboundDeps): Promise<InboundResult> {
  const address = firstAddress(data?.to);
  if (!address) return { status: "ignored", matched: false };
  const prospect = await deps.store.findByEmail(address);
  const prior = prospect ? getOutreachState(prospect) : undefined;
  if (!prospect || !prior) return { status: "ignored", matched: false };

  const alreadyStopped = kind === "complained" ? prior.state === "opted_out" : prior.state !== "active";
  if (alreadyStopped) return { status: "duplicate", matched: true };

  const next: OutreachState =
    kind === "complained"
      ? { ...prior, state: "opted_out", pause_reason: "recipient marked the email as spam" }
      : { ...prior, state: "paused", pause_reason: `email to ${address} bounced` };
  await deps.store.saveState(prospect.id, next, kind === "complained" ? "rejected" : undefined);

  await notifier(deps)(
    kind === "complained"
      ? `*Outreach stopped: ${prospect.company}* marked our email as spam. Sequence ended; do not contact again.`
      : `*Outreach paused: ${prospect.company}* the email to ${address} bounced. Sequence paused; the address needs checking before anything else is sent.`
  );
  return { status: kind, matched: true };
}

/** Entry point for a verified Resend webhook event. */
export async function handleResendEvent(event: any, deps: InboundDeps): Promise<InboundResult> {
  const type = String(event?.type || "");
  if (type === "email.received") return onReceived(event.data, deps);
  if (type === "email.bounced") return stopForDelivery("bounced", event.data, deps);
  if (type === "email.complained") return stopForDelivery("complained", event.data, deps);
  return { status: "ignored", matched: false };
}

export interface UnsubscribeResult {
  found: boolean;
  alreadyStopped: boolean;
}

/** The unsubscribe link was confirmed. Idempotent: a second click changes nothing and posts nothing. */
export async function handleUnsubscribe(prospectId: string, deps: ReplyDeps): Promise<UnsubscribeResult> {
  const rows: OutreachProspect[] = await deps.store.loadSequenced();
  const prospect = rows.find((p) => p.id === prospectId);
  const prior = prospect ? getOutreachState(prospect) : undefined;
  if (!prospect || !prior) return { found: false, alreadyStopped: false };
  if (prior.state === "opted_out") return { found: true, alreadyStopped: true };

  await deps.store.saveState(prospect.id, { ...prior, state: "opted_out", pause_reason: "unsubscribed by link" }, "rejected");
  await notifier(deps)(`*Outreach stopped: ${prospect.company}* used the unsubscribe link. Sequence ended; do not contact again.`);
  return { found: true, alreadyStopped: false };
}

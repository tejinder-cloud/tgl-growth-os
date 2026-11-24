// services/tgl-ops/src/agents/gmail/inbox.ts
// Every 10 minutes: reads the last 3 days of the Gmail inbox and acts on two kinds of mail only.
//   1. A reply from a prospect's address: routed exactly like a Resend reply (stop or defer the sequence, then #revenue).
//   2. A delivery failure (mailer-daemon/postmaster) naming a prospect's address: that sequence is paused.
// Everything else (personal mail, newsletters, booking notices) is skipped without being read further or stored.
import { getOutreachState } from "../outreach-sequencer/store.js";
import { handleBouncedAddress, handleReceivedMail, type InboundDeps, type InboundResult } from "../outreach-sequencer/inbound.js";
import { stripQuotedReply } from "../outreach-sequencer/email.js";
import { bouncedAddresses, getMessage, isBounceSender, listMessageIds, type GmailMessage, type TokenProvider } from "./gmail.js";

export const INBOX_QUERY = "in:inbox newer_than:3d -from:me";

export interface InboxPollDeps extends Omit<InboundDeps, "fetchReceived"> {
  token: TokenProvider;
  /** The connected account, so it is never mistaken for a bounced prospect address. */
  ownAddress: string;
  fetchImpl?: typeof fetch;
  /** Gmail ids already handled by this process. Survives between polls; a restart re-checks, which is safe. */
  seen?: Set<string>;
}

export interface InboxPollResult {
  connected: boolean;
  checked: number;
  replies: InboundResult[];
  bounces: InboundResult[];
}

export async function pollGmailInbox(deps: InboxPollDeps): Promise<InboxPollResult> {
  const fetchImpl = deps.fetchImpl || fetch;
  const seen = deps.seen || new Set<string>();
  const out: InboxPollResult = { connected: false, checked: 0, replies: [], bounces: [] };
  const token = await deps.token();
  if (!token) return out;
  out.connected = true;

  for (const id of await listMessageIds(token, INBOX_QUERY, fetchImpl)) {
    if (seen.has(id)) continue;
    let msg: GmailMessage;
    try {
      msg = await getMessage(token, id, fetchImpl);
    } catch (err) {
      console.warn(`[Gmail Inbox] could not read message ${id}: ${(err as Error).message}`);
      continue;
    }
    out.checked++;

    if (isBounceSender(msg.from)) {
      for (const address of bouncedAddresses(msg.text, deps.ownAddress)) {
        const r = await handleBouncedAddress(address, deps);
        if (r.matched) out.bounces.push(r);
      }
      seen.add(id);
      continue;
    }

    const prospect = await deps.store.findByEmail(msg.from);
    if (!prospect) {
      // Not a prospect: personal or other mail. Never posted, never stored.
      seen.add(id);
      continue;
    }
    const state = getOutreachState(prospect);
    // Already routed on an earlier poll (or before a restart): the stored reply is this one or a later one.
    if (state?.last_reply_message_id === msg.messageId || (state?.last_reply_at && new Date(state.last_reply_at).getTime() >= msg.receivedAt)) {
      seen.add(id);
      continue;
    }

    const r = await handleReceivedMail(
      { id: msg.id, from: msg.from, to: [deps.ownAddress], subject: msg.subject, text: stripQuotedReply(msg.text), messageId: msg.messageId, automated: msg.automated },
      deps
    );
    out.replies.push(r);
    seen.add(id);
  }
  return out;
}

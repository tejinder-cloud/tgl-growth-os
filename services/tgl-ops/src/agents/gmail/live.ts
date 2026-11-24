// services/tgl-ops/src/agents/gmail/live.ts
// Real wiring for Gmail: the access token comes from the bookings Google sign-in (one refresh token in Vault
// covers the calendar and Gmail), the sender address is BOOKING_CALENDAR_EMAIL, replies go to #revenue.
import { accessToken, configIssues, loadGoogleBookingConfig } from "../booking/google.js";
import { bookingStore } from "../booking/live.js";
import type { BookingStore } from "../booking/store.js";
import { loadEmailConfig } from "../outreach-sequencer/email.js";
import { createSupabaseStore } from "../outreach-sequencer/store.js";
import { createGmailSender, type TokenProvider } from "./gmail.js";
import { pollGmailInbox, type InboxPollResult } from "./inbox.js";

export const DEFAULT_SENDER_NAME = "Tejinder Singh";

export function gmailTokenProvider(env: NodeJS.ProcessEnv = process.env, store?: BookingStore, fetchImpl: typeof fetch = fetch): TokenProvider {
  let cached: { token: string; at: number } | null = null;
  return async () => {
    const cfg = loadGoogleBookingConfig(env);
    if (configIssues(cfg).length > 0) return null;
    const refresh = await (store || bookingStore()).getRefreshToken();
    if (!refresh) return null;
    if (!cached || Date.now() - cached.at > 45 * 60 * 1000) {
      cached = { token: await accessToken(cfg, refresh, fetchImpl), at: Date.now() };
    }
    return cached.token;
  };
}

/** "Tejinder Singh <calls.thegrowthlab@gmail.com>": the name from OUTREACH_SENDER_NAME, the address of the signed-in account. */
export function gmailFrom(env: NodeJS.ProcessEnv = process.env): string {
  const name = (env.OUTREACH_SENDER_NAME || "").trim() || DEFAULT_SENDER_NAME;
  const address = loadGoogleBookingConfig(env).calendarEmail;
  return address ? `${name} <${address}>` : "";
}

export function liveGmailSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch) {
  const cfg = loadEmailConfig(env);
  return createGmailSender({ from: gmailFrom(env), publicUrl: cfg.publicUrl, unsubscribeSecret: cfg.unsubscribeSecret }, gmailTokenProvider(env, undefined, fetchImpl), fetchImpl);
}

const seen = new Set<string>();

/** One inbox poll. Does nothing unless outreach email runs through Gmail. */
export async function runGmailInboxPoll(env: NodeJS.ProcessEnv = process.env): Promise<InboxPollResult | null> {
  const cfg = loadEmailConfig(env);
  if (cfg.via !== "gmail") return null;
  const result = await pollGmailInbox({
    token: gmailTokenProvider(env),
    ownAddress: loadGoogleBookingConfig(env).calendarEmail,
    store: createSupabaseStore(),
    sender: liveGmailSender(env),
    forwardTo: cfg.forwardTo,
    seen,
  });
  if (!result.connected) console.warn("[Gmail Inbox] not connected: sign in at /book/connect");
  else if (result.replies.length || result.bounces.length) {
    console.log(`[Gmail Inbox] checked ${result.checked}: ${result.replies.length} replies, ${result.bounces.length} bounces`);
  }
  return result;
}

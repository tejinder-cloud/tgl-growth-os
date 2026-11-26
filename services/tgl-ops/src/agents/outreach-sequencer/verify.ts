// services/tgl-ops/src/agents/outreach-sequencer/verify.ts
// Mailbox check before a business's first email (Architect, 26 Nov 2026: Reoon, free plan, 20 checks a day).
// Power mode asks the mail server whether the mailbox exists. Addresses that would bounce or hurt the sending
// domain are held; "risky" ones (catch-all servers, role addresses such as info@) still go, because most small
// businesses publish exactly those. When the check cannot answer (no key, no credits, timeout), the email goes:
// the domain check in pool.ts has already run, and the weekly bounce rule in worker.ts is the backstop.

export type MailboxStatus = "safe" | "invalid" | "disabled" | "disposable" | "inbox_full" | "catch_all" | "role_account" | "spamtrap" | "unknown";

export interface MailboxCheck {
  status: MailboxStatus | "not_checked";
  /** Why the email is held, or undefined when it may go. */
  hold?: string;
  /** Why the check could not answer, when status is not_checked. */
  note?: string;
}

const HOLD: Partial<Record<MailboxStatus, string>> = {
  invalid: "the mailbox does not exist",
  disabled: "the mailbox has been disabled",
  inbox_full: "the mailbox is full, so the email would bounce",
  spamtrap: "the address is a spam trap",
  disposable: "the address is a throwaway mailbox",
};

/** What to do with a verifier status. Pure, for tests. */
export function decide(status: string): MailboxCheck {
  const s = status as MailboxStatus;
  if (s in HOLD) return { status: s, hold: `${HOLD[s]} (mailbox check)` };
  if (["safe", "catch_all", "role_account", "unknown"].includes(s)) return { status: s };
  return { status: "not_checked", note: `the check gave an unexpected answer: ${status || "none"}` };
}

export async function checkMailbox(email: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): Promise<MailboxCheck> {
  const key = (env.REOON_API_KEY || "").trim();
  if (!key) return { status: "not_checked", note: "REOON_API_KEY is not set" };
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}&mode=power`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => ({}))) as { status?: string; reason?: string };
    if (!res.ok || body.status === "error") return { status: "not_checked", note: `the check failed: ${body.reason || `HTTP ${res.status}`}` };
    return decide(String(body.status || ""));
  } catch (err) {
    return { status: "not_checked", note: `the check did not answer: ${(err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message}` };
  }
}

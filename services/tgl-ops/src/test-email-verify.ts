// Offline checks for the mailbox check before a first email (Reoon, 26 Nov 2026). No network: fetch is faked.
import assert from "node:assert/strict";
import { checkMailbox, decide } from "./agents/outreach-sequencer/verify.js";

const KEY = { REOON_API_KEY: "test-key" } as any;
function fake(body: unknown, status = 200, seen?: string[]): typeof fetch {
  return (async (url: string) => {
    seen?.push(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as any;
}

async function main() {
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout does not hold the process open on its own
  // 1. Held: addresses that would bounce or harm the domain.
  for (const s of ["invalid", "disabled", "inbox_full", "spamtrap", "disposable"]) {
    assert.ok(decide(s).hold, `${s} is held`);
    assert.match(String(decide(s).hold), /\(mailbox check\)$/);
  }
  // 2. Sent: safe, and the risky kinds small businesses publish.
  for (const s of ["safe", "catch_all", "role_account", "unknown"]) assert.equal(decide(s).hold, undefined, `${s} goes`);
  assert.equal(decide("weird").status, "not_checked");

  // 3. The request: power mode, the address encoded, the key from the setting.
  const seen: string[] = [];
  const ok = await checkMailbox("owner+x@clinic.in", KEY, fake({ status: "safe", overall_score: 98 }, 200, seen));
  assert.deepEqual(ok, { status: "safe" });
  assert.match(seen[0], /^https:\/\/emailverifier\.reoon\.com\/api\/v1\/verify\?email=owner%2Bx%40clinic\.in&key=test-key&mode=power$/);

  const bad = await checkMailbox("gone@clinic.in", KEY, fake({ status: "invalid" }));
  assert.equal(bad.status, "invalid");
  assert.equal(bad.hold, "the mailbox does not exist (mailbox check)");

  // 4. When the check cannot answer, the email goes and the reason is kept.
  const noKey = await checkMailbox("a@b.in", {} as any, fake({ status: "safe" }));
  assert.deepEqual(noKey, { status: "not_checked", note: "REOON_API_KEY is not set" });
  const noCredit = await checkMailbox("a@b.in", KEY, fake({ status: "error", reason: "Not enough credits" }));
  assert.equal(noCredit.hold, undefined);
  assert.match(String(noCredit.note), /Not enough credits/);
  const http = await checkMailbox("a@b.in", KEY, fake({}, 500));
  assert.match(String(http.note), /HTTP 500/);
  const slow = await checkMailbox("a@b.in", KEY, ((_u: string, init: any) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))) as any, 20);
  assert.equal(slow.status, "not_checked");
  assert.match(String(slow.note), /timed out/);

  clearInterval(keepAlive);
  console.log("test-email-verify: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Offline checks for the Gmail inbox pool (26 Nov 2026): warm-up limits, rotation, same inbox for a business's
// follow-ups, bounce pause, the address check before a first email, and the pool's limit in the tick. Nothing is sent.
import assert from "node:assert/strict";
import { addressProblem, createPoolSender, healthByInbox, inboxCap, lastInbox, pickInbox, poolCapacity, poolRemaining, rampFrom, sentTodayByInbox, shouldPause, type InboxRow } from "./agents/gmail/pool.js";
import { runTick } from "./agents/outreach-sequencer/worker.js";

const A: InboxRow = { email: "a@gmail.com", status: "active", warm_start: "2026-11-26" };
const B: InboxRow = { email: "b@gmail.com", status: "active", warm_start: "2026-11-05" };
const P: InboxRow = { email: "p@gmail.com", status: "paused", warm_start: "2026-10-01", paused_reason: "bounces" };

async function main() {
  // 1. Warm-up: 5 in week one, rising weekly, 25 from week five; nothing before the start or when paused.
  assert.equal(inboxCap(A, "2026-11-26"), 5);
  assert.equal(inboxCap(A, "2026-12-02"), 5);
  assert.equal(inboxCap(A, "2026-12-03"), 10);
  assert.equal(inboxCap(A, "2026-12-24"), 25);
  assert.equal(inboxCap(A, "2027-02-01"), 25);
  assert.equal(inboxCap(A, "2026-11-25"), 0, "not started yet");
  assert.equal(inboxCap(P, "2026-11-26"), 0, "paused");
  assert.equal(inboxCap(B, "2026-11-26"), 20, "21 days in is week four");
  assert.deepEqual(rampFrom({ OUTREACH_INBOX_RAMP: "3, 6, 9" } as any), [3, 6, 9]);
  assert.deepEqual(rampFrom({ OUTREACH_INBOX_RAMP: "x" } as any), [5, 10, 15, 20, 25]);

  // 2. Pool totals.
  assert.equal(poolCapacity([A, B, P], "2026-11-26"), 25);
  assert.equal(poolRemaining([A, B, P], { "a@gmail.com": 5, "b@gmail.com": 3 }, "2026-11-26"), 17);

  // 3. Rotation: most room first; a business stays with its inbox while that inbox has room.
  assert.equal(pickInbox([A, B], {}, "2026-11-26")?.email, "b@gmail.com");
  assert.equal(pickInbox([A, B], {}, "2026-11-26", "a@gmail.com")?.email, "a@gmail.com", "follow-up from the same inbox");
  assert.equal(pickInbox([A, B], { "a@gmail.com": 5 }, "2026-11-26", "a@gmail.com")?.email, "b@gmail.com", "full inbox hands over");
  assert.equal(pickInbox([A, P], { "a@gmail.com": 5 }, "2026-11-26"), null, "no room anywhere");

  // 4. Counting from saved touches (IST day), and the last inbox per business.
  const rows: any[] = [
    { signals: { outreach: { touches: [{ n: 1, sent_at: "2026-11-26T04:00:00Z", inbox: "a@gmail.com" }, { n: 2, sent_at: "2026-11-26T05:00:00Z", dry_run: true, inbox: "a@gmail.com" }] } } },
    { signals: { outreach: { touches: [{ n: 1, sent_at: "2026-11-25T20:00:00Z", inbox: "b@gmail.com" }] } } },
    { signals: { outreach: { state: "paused", pause_reason: "touch 1 bounced", touches: [{ n: 1, sent_at: "2026-11-24T04:00:00Z", inbox: "b@gmail.com" }] } } },
    { signals: { outreach: { state: "paused", pause_reason: "email bounced", touches: [{ n: 1, sent_at: "2026-11-24T05:00:00Z", inbox: "b@gmail.com" }] } } },
    { signals: null },
  ];
  assert.deepEqual(sentTodayByInbox(rows, "2026-11-26"), { "a@gmail.com": 1, "b@gmail.com": 1 }, "20:00 UTC on the 25th is the 26th in IST; dry runs do not count");
  assert.equal(lastInbox(rows[0]), "a@gmail.com");
  assert.equal(lastInbox(rows[4]), undefined);

  // 5. Bounce pause: 2 bounces in 3 sends pauses; 1 bounce does not.
  const health = healthByInbox(rows, new Date("2026-11-26T10:00:00Z"));
  assert.deepEqual(health["b@gmail.com"], { sent: 3, bounced: 2 });
  assert.equal(shouldPause(health["b@gmail.com"]), true);
  assert.equal(shouldPause({ sent: 40, bounced: 1 }), false);
  assert.equal(shouldPause({ sent: 60, bounced: 2 }), false, "2 in 60 is under 5%");

  // 6. The pool sender sends through the chosen inbox and reports it.
  const via: string[] = [];
  const sender = createPoolSender({
    inboxes: async () => [A, B],
    sentToday: async () => ({ "b@gmail.com": 20 }),
    today: () => "2026-11-26",
    previousFor: () => undefined,
    sendVia: async (inbox) => { via.push(inbox); return { messageId: "m1" }; },
  });
  const out = await sender.send({ prospectId: "x", to: "owner@clinic.in", subject: "s", text: "t" } as any);
  assert.deepEqual(out, { messageId: "m1", inbox: "a@gmail.com" });
  const full = createPoolSender({ inboxes: async () => [A], sentToday: async () => ({ "a@gmail.com": 5 }), today: () => "2026-11-26", previousFor: () => undefined, sendVia: async () => ({ messageId: "no" }) });
  await assert.rejects(full.send({ prospectId: "x", to: "o@c.in", subject: "s", text: "t" } as any), /no sending inbox has room/);

  // 7. Address check before a first email.
  const mx = async (d: string) => {
    if (d === "clinic.in") return [{ exchange: "mx.clinic.in" }];
    if (d === "gone.in") throw Object.assign(new Error("x"), { code: "ENOTFOUND" });
    if (d === "flaky.in") throw Object.assign(new Error("x"), { code: "ETIMEOUT" });
    return [];
  };
  assert.equal(await addressProblem("owner@clinic.in", mx), null);
  assert.match(String(await addressProblem("owner@gone.in", mx)), /does not receive email/);
  assert.match(String(await addressProblem("owner@empty.in", mx)), /does not receive email/);
  assert.equal(await addressProblem("owner@flaky.in", mx), null, "a lookup hiccup does not hold the email");
  assert.match(String(await addressProblem("not an email", mx)), /not a valid email/);

  // 8. The tick uses the pool's limit when it has one.
  const sent: string[] = [];
  const summary = await runTick({
    now: () => new Date("2026-11-27T04:00:00Z"),
    env: { OUTREACH_LIVE: "1", OUTREACH_DAILY_SEND_CAP: "5" } as any,
    countToday: async () => 0,
    capFor: async () => 2,
    listDue: async () => ["p1", "p2", "p3"].map((id, i) => ({ prospectId: id, company: id, touch: 1, channel: "Email", dueAt: `2026-11-27T03:0${i}:00Z` })) as any,
    execute: async (item: any) => { sent.push(item.prospectId); return { status: "sent" } as any; },
    alert: async () => {},
  });
  assert.equal(summary.cap, 2);
  assert.deepEqual(sent, ["p1", "p2"]);

  console.log("test-gmail-pool: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

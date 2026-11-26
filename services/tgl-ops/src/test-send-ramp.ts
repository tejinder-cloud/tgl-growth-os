// Offline checks for the warm-up safety rule (26 Nov 2026): a step in OUTREACH_CAP_SCHEDULE takes effect only
// when the last 7 days had bounces under 3% and no spam complaint. Nothing is sent.
import assert from "node:assert/strict";
import { emailHealth, guardedCap } from "./agents/outreach-sequencer/worker.js";

const SCHEDULE = "2026-11-26=5,2026-12-03=10,2026-12-10=15,2026-12-17=20,2026-12-24=25,2026-12-31=35,2027-01-07=50";
const env = { OUTREACH_CAP_SCHEDULE: SCHEDULE } as any;
const at = (iso: string) => new Date(iso);
const clean = { sent: 30, bounced: 0, complained: 0 };

function touches(n: number, start: string) {
  return Array.from({ length: n }, (_, i) => ({ n: 1, channel: "Email", sent_at: new Date(Date.parse(start) + i * 3600_000).toISOString() }));
}

async function main() {
  // 1. Clean weeks follow the schedule, IST dates.
  assert.equal(guardedCap(env, at("2026-11-26T05:00:00Z"), clean).cap, 5);
  assert.equal(guardedCap(env, at("2026-12-02T19:00:00Z"), clean).cap, 10, "00:30 IST on 3 Dec is the new step");
  assert.equal(guardedCap(env, at("2027-01-08T05:00:00Z"), clean).cap, 50);

  // 2. The first step is never held; there is nothing lower to hold at.
  assert.equal(guardedCap(env, at("2026-11-27T05:00:00Z"), { sent: 10, bounced: 3, complained: 1 }).cap, 5);

  // 3. Bounces at or over 3% hold the previous step and say why.
  const held = guardedCap(env, at("2026-12-04T05:00:00Z"), { sent: 30, bounced: 1, complained: 0 });
  assert.equal(held.cap, 5);
  assert.match(String(held.held), /1 bounce in 30 emails .*3\.3%/);
  assert.equal(guardedCap(env, at("2026-12-04T05:00:00Z"), { sent: 40, bounced: 1, complained: 0 }).cap, 10, "1 in 40 is 2.5%");

  // 4. Any spam complaint holds.
  const spam = guardedCap(env, at("2027-01-08T05:00:00Z"), { sent: 200, bounced: 0, complained: 1 });
  assert.equal(spam.cap, 35);
  assert.match(String(spam.held), /1 spam complaint in the last 7 days/);

  // 5. Without a schedule the setting decides; a zero day stays zero.
  assert.equal(guardedCap({ OUTREACH_DAILY_SEND_CAP: "5" } as any, at("2026-12-04T05:00:00Z"), { sent: 1, bounced: 1, complained: 0 }).cap, 5);
  assert.equal(guardedCap({ ...env, OUTREACH_SEND_DAYS: "1-6" }, at("2026-12-06T05:00:00Z"), clean).cap, 0, "Sunday");

  // 6. Health counts only real email touches in the last 7 days, and bounces or complaints on those businesses.
  const now = at("2026-12-04T05:00:00Z");
  const rows: any[] = [
    { signals: { outreach: { state: "active", touches: touches(20, "2026-12-01T04:00:00Z") } } },
    { signals: { outreach: { state: "paused", pause_reason: "email to x@y.in bounced", touches: touches(1, "2026-12-02T04:00:00Z") } } },
    { signals: { outreach: { state: "opted_out", pause_reason: "recipient marked the email as spam", touches: touches(1, "2026-12-03T04:00:00Z") } } },
    { signals: { outreach: { state: "paused", pause_reason: "email to old@y.in bounced", touches: touches(1, "2026-11-20T04:00:00Z") } } },
    { signals: { outreach: { state: "active", touches: [{ n: 1, channel: "Email", sent_at: "2026-12-02T04:00:00Z", dry_run: true }, { n: 2, channel: "WhatsApp", sent_at: "2026-12-03T04:00:00Z" }] } } },
    { signals: null },
  ];
  assert.deepEqual(emailHealth(rows, now), { sent: 22, bounced: 1, complained: 1 });

  console.log("test-send-ramp: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

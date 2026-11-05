// services/tgl-ops/src/test-day10-outreach.ts
// Offline checks for the outreach tick rules and the webhook secret comparison. No network, no credentials.
import assert from "node:assert/strict";
import {
  runTick,
  isSendWindow,
  dailyCap,
  isLive,
  type DueTouch,
  type ExecuteResult,
  type SendMode,
  type TickPorts,
} from "./agents/outreach-sequencer/worker.js";
import { secretsMatch } from "./routes/outreach.js";

// 2026-03-09 is a Monday. IST = UTC + 5:30.
const MON_1000_IST = new Date("2026-03-09T04:30:00Z");
const MON_0900_IST = new Date("2026-03-09T03:30:00Z");
const MON_1730_IST = new Date("2026-03-09T12:00:00Z");
const SAT_1100_IST = new Date("2026-03-14T05:30:00Z");

function due(n: number, touch: DueTouch["touch"], dueAt: string): DueTouch {
  return { prospectId: `p${n}`, company: `Company ${n}`, touch, channel: "email", dueAt };
}

function ports(over: Partial<TickPorts> & { items?: DueTouch[]; results?: Record<string, ExecuteResult> }): TickPorts & { alerts: string[]; executed: string[]; modes: string[] } {
  const alerts: string[] = [];
  const executed: string[] = [];
  const modes: string[] = [];
  return {
    now: () => MON_1000_IST,
    env: {},
    listDue: async () => over.items || [],
    countToday: async () => 0,
    execute: async (item: DueTouch, mode: SendMode) => {
      executed.push(`${item.prospectId}:${item.touch}`);
      modes.push(mode);
      return over.results?.[`${item.prospectId}:${item.touch}`] || { status: mode === "live" ? "sent" : "dry_run", attachmentUrl: item.touch === 3 ? "https://example.test/one-pager.pdf" : undefined };
    },
    alert: async (t: string) => {
      alerts.push(t);
    },
    ...over,
    alerts,
    executed,
    modes,
  } as any;
}

async function main() {
  // Send window
  assert.equal(isSendWindow(MON_1000_IST), true);
  assert.equal(isSendWindow(MON_0900_IST), false, "before 09:30 IST");
  assert.equal(isSendWindow(MON_1730_IST), false, "17:30 IST is closed");
  assert.equal(isSendWindow(SAT_1100_IST), false, "weekend");

  // Env parsing
  assert.equal(isLive({}), false);
  assert.equal(isLive({ OUTREACH_LIVE: "1" }), true);
  assert.equal(isLive({ OUTREACH_LIVE: "true" }), false);
  assert.equal(dailyCap({}), 20);
  assert.equal(dailyCap({ OUTREACH_DAILY_SEND_CAP: "5" }), 5);
  assert.equal(dailyCap({ OUTREACH_DAILY_SEND_CAP: "0" }), 0);
  assert.equal(dailyCap({ OUTREACH_DAILY_SEND_CAP: "abc" }), 20);

  // Outside the window nothing is listed or executed
  {
    const p = ports({ now: () => SAT_1100_IST, items: [due(1, 1, "2026-03-09T00:00:00Z")] });
    const s = await runTick(p);
    assert.equal(s.ran, false);
    assert.equal(s.reason, "outside_window");
    assert.equal(p.executed.length, 0);
  }

  // Dry by default
  {
    const p = ports({ items: [due(1, 1, "2026-03-09T00:00:00Z")] });
    const s = await runTick(p);
    assert.equal(s.mode, "dry_run");
    assert.deepEqual(p.modes, ["dry_run"]);
  }

  // Live only with OUTREACH_LIVE=1
  {
    const p = ports({ env: { OUTREACH_LIVE: "1" }, items: [due(1, 1, "2026-03-09T00:00:00Z")] });
    const s = await runTick(p);
    assert.equal(s.mode, "live");
    assert.deepEqual(p.modes, ["live"]);
  }

  // Cap: oldest first, remainder rolls over
  {
    const p = ports({
      env: { OUTREACH_DAILY_SEND_CAP: "2" },
      countToday: async () => 1,
      items: [due(3, 1, "2026-03-09T03:00:00Z"), due(1, 1, "2026-03-06T03:00:00Z"), due(2, 3, "2026-03-07T03:00:00Z")],
    });
    const s = await runTick(p);
    assert.deepEqual(p.executed, ["p1:1"], "only one slot left, oldest due first");
    assert.equal(s.deferredByCap, 2);
  }

  // Cap reached
  {
    const p = ports({ env: { OUTREACH_DAILY_SEND_CAP: "1" }, countToday: async () => 1, items: [due(1, 1, "2026-03-09T00:00:00Z")] });
    const s = await runTick(p);
    assert.equal(s.reason, "cap_reached");
    assert.equal(p.executed.length, 0);
  }

  // The one-pager touch (3) without an attachment is held and alerted, never reported as sent
  {
    const p = ports({
      items: [due(1, 3, "2026-03-09T00:00:00Z")],
      results: { "p1:3": { status: "sent" } },
    });
    const s = await runTick(p);
    assert.equal(s.outcomes[0].result.status, "held");
    assert.equal(p.alerts.length, 1);
  }

  // The one-pager touch with an attachment passes
  {
    const p = ports({ items: [due(1, 3, "2026-03-09T00:00:00Z")], results: { "p1:3": { status: "sent", attachmentUrl: "https://example.test/a.pdf" } } });
    const s = await runTick(p);
    assert.equal(s.outcomes[0].result.status, "sent");
    assert.equal(p.alerts.length, 0);
  }

  // Third failed attempt alerts once; earlier attempts do not
  {
    const p1 = ports({ items: [due(1, 2, "2026-03-09T00:00:00Z")], results: { "p1:2": { status: "held", reason: "pdf upload failed", attempts: 2 } } });
    await runTick(p1);
    assert.equal(p1.alerts.length, 0);
    const p3 = ports({ items: [due(1, 2, "2026-03-09T00:00:00Z")], results: { "p1:2": { status: "held", reason: "pdf upload failed", attempts: 3 } } });
    await runTick(p3);
    assert.equal(p3.alerts.length, 1);
    assert.ok(p3.alerts[0].includes("pdf upload failed"));
  }

  // A throwing execute does not abort the rest of the batch
  {
    const p = ports({
      items: [due(1, 1, "2026-03-09T00:00:00Z"), due(2, 1, "2026-03-09T01:00:00Z")],
      execute: async (item) => {
        if (item.prospectId === "p1") throw new Error("ghl 500");
        return { status: "dry_run" };
      },
    });
    const s = await runTick(p);
    assert.equal(s.outcomes.length, 2);
    assert.equal(s.outcomes[0].result.status, "held");
    assert.equal(s.outcomes[1].result.status, "dry_run");
  }

  // Webhook secret: fails closed
  assert.equal(secretsMatch(undefined, "s3cret"), false);
  assert.equal(secretsMatch("s3cret", undefined), false);
  assert.equal(secretsMatch("s3cret", ""), false);
  assert.equal(secretsMatch("wrong!", "s3cret"), false);
  assert.equal(secretsMatch("s3cret", "s3cret"), true);

  console.log("test-day10-outreach: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

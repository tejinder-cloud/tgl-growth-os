// Offline checks for the events record (25 Nov 2026): what is written, what is kept out, and what the dashboard
// shows from it. Test mode keeps events in memory; nothing reaches the database.
import assert from "node:assert/strict";
import { cleanSummary, recordEvent, resetEventsForTests, setEventWriterForTests, testEvents, listEvents } from "./lib/events.js";
import { runTick } from "./agents/outreach-sequencer/worker.js";
import { runPreaudits } from "./agents/outreach-sequencer/preaudit.js";
import { buildLiveView } from "./agents/pipeline/live-view.js";
import { renderOverviewMain } from "./agents/pipeline/overview-page.js";
import type { AuditSummary } from "./agents/outreach-sequencer/types.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;

async function main() {
  // Personal contact data never lands in a summary.
  assert.equal(cleanSummary("Reply from dr.rao@clinic.example, call +91 98765 43210 today"), "Reply from [email], call [phone] today");
  assert.equal(cleanSummary("Delhi NCR, hospital: 65 found on Google, 6 qualified (5 with an email)."), "Delhi NCR, hospital: 65 found on Google, 6 qualified (5 with an email).", "ordinary counts are untouched");

  // The row shape sent to the database.
  const rows: Record<string, unknown>[] = [];
  setEventWriterForTests(async (r) => { rows.push(r); });
  await recordEvent({ agent: "booking", kind: "booked", summary: "Call booked with Smile Hub.", prospectId: "p1" });
  setEventWriterForTests(async () => { throw new Error("db down"); });
  await recordEvent({ agent: "booking", kind: "booked", summary: "x" }); // a failed write never throws
  setEventWriterForTests(null);
  assert.deepEqual(rows, [{ tenant_id: "tgl", agent: "booking", kind: "booked", summary: "Call booked with Smile Hub.", prospect_id: "p1", detail: {} }]);

  // Outreach: a send and a hold are recorded; a dry run is not.
  resetEventsForTests();
  const now = new Date("2026-11-25T05:00:00Z"); // 10:30 IST
  const due = [
    { prospectId: "a", company: "Dental IQ | Best dentist in Mohali", touch: 1, channel: "Email", dueAt: "2026-11-25T04:00:00Z" },
    { prospectId: "b", company: "Smile Hub", touch: 1, channel: "Email", dueAt: "2026-11-25T04:01:00Z" },
  ] as any[];
  await runTick({
    now: () => now,
    env: { OUTREACH_LIVE: "1", OUTREACH_DAILY_SEND_CAP: "5" } as any,
    listDue: async () => due,
    countToday: async () => 0,
    execute: async (item) => (item.prospectId === "a" ? { status: "sent" } : { status: "held", reason: 'audit or one-pager failed: HTTP 402: {"error":"credits depleted"}', attempts: 1 }) as any,
    alert: async () => {},
  });
  const ev = testEvents();
  assert.deepEqual(ev.map((e) => e.kind), ["sent", "held"]);
  assert.equal(ev[0].summary, "First email sent to Dental IQ.", "listing title cleaned");
  assert.equal(ev[1].summary, "Smile Hub held before first email: credits depleted");
  assert.equal(ev[0].prospectId, "a");

  // Advance AI checks record one event each.
  resetEventsForTests();
  await runPreaudits({
    now: () => now,
    limit: 5,
    list: async () => [{ id: "p9", company: "Bloom IVF | Top IVF centre", website: "https://bloom.example", status: "reviewed", door: "aeo", fit_score: 80, decision_maker: { email: "", phone: "0987654321" }, signals: {} }],
    audit: async () => ({ mentions: 0, total_queries: 15 }) as AuditSummary,
    save: async () => {},
  });
  assert.deepEqual(testEvents().map((e) => e.summary), ["Advance AI check for Bloom IVF: named in 0 of 15 answers."]);

  // The dashboard: feed newest first, citation runs from events, job failures under Problems.
  resetEventsForTests();
  await recordEvent({ agent: "aeo-audit-engine", kind: "run", summary: "Checked 1 brand: named in 6 of 48 AI answers.", at: "2026-11-25T00:37:00Z" });
  await recordEvent({ agent: "system", kind: "error", summary: "09:30 IST Prospect Researcher Run failed: Google Places rejected the key.", at: "2026-11-25T04:05:00Z" });
  await recordEvent({ agent: "outreach-sequencer", kind: "sent", summary: "First email sent to Dental IQ.", at: "2026-11-25T04:30:00Z" });
  const events = await listEvents("2026-11-24T18:30:00Z");
  assert.deepEqual(events?.map((e) => e.kind), ["sent", "error", "run"], "newest first");
  const v = buildLiveView({ now, prospects: [], deals: [], agents: [], spend: null, capToday: 5, events });
  assert.equal(v.activity.find((a) => a.name === "Citation tracker")?.state, "done", "from events, no log needed");
  assert.ok(v.problems.some((p) => p.text.startsWith("09:30 IST Prospect Researcher Run failed")));
  const html = renderOverviewMain(v, now);
  assert.ok(html.includes("Recent activity") && html.includes("3 today") && html.includes("First email sent to Dental IQ."));
  const feedHtml = html.slice(html.indexOf("Recent activity"));
  assert.ok(feedHtml.indexOf("First email sent to Dental IQ.") < feedHtml.indexOf("Checked 1 brand"), "newest first in the feed");
  assert.ok(!EMOJI.test(html));
  const unread = renderOverviewMain(buildLiveView({ now, prospects: [], deals: [], agents: [], spend: null, capToday: 5, events: null }), now);
  assert.ok(unread.includes("The activity record could not be read just now."));
  const quiet = renderOverviewMain(buildLiveView({ now, prospects: [], deals: [], agents: [], spend: null, capToday: 5, events: [] }), now);
  assert.ok(quiet.includes("Nothing recorded yet today."));

  console.log("test-events: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });

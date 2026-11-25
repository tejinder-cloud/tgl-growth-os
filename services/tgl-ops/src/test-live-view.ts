// services/tgl-ops/src/test-live-view.ts
// Offline checks for /pipeline/live (24 Nov 2026): every number on the page from fixture data, the call list,
// grouped problems, the outbox, spend, agent logs from two sources, escaping, no emojis, and the route
// (signed out, signed in, the refreshing part).
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { makeSession, SESSION_COOKIE } from "./agents/pipeline/auth.js";
import { lastHeading, mergeAgentLines, sumSpend } from "./agents/pipeline/live-data.js";
import { buildLiveView, pauseGroup, readableTimes, type LiveProspect } from "./agents/pipeline/live-view.js";
import { renderOverviewMain, renderOverviewPage } from "./agents/pipeline/overview-page.js";
import { BUILD_PLAN } from "./agents/pipeline/build-plan.js";
import { renderOutreachMain, renderOutreachPage } from "./agents/pipeline/outreach-page.js";
import type { Deal } from "./agents/pipeline/stages.js";
import { setLiveLoaderForTests } from "./routes/pipeline.js";
import { isMirroredSpend, recordApiSpend, resetCostLedgerForTests, setDurableSpendWriterForTests } from "./lib/cost-cap.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;
// 24 Nov 2026, 15:00 IST
const NOW = new Date("2026-11-24T09:30:00Z");

function p(id: string, over: Partial<LiveProspect> = {}): LiveProspect {
  return { id, company: `Clinic ${id} | Best clinic in town`, city: "Mohali", category: "cosmetic_dental", status: "handed_to_outreach", fit_score: 70, created_at: "2026-11-20T04:00:00Z", decision_maker: { name: "Owner / Lead Doctor", email: `x@${id}.example` }, signals: {}, ...over };
}

async function main() {
  const prospects: LiveProspect[] = [
    p("a", { signals: { outreach: { state: "active", touches: [{ n: 1, channel: "Email", sent_at: "2026-11-24T08:05:00Z" }, { n: 2, channel: "WhatsApp", sent_at: "2026-11-24T08:06:00Z", dry_run: true }] } } }),
    p("b", { signals: { outreach: { state: "replied", last_reply_at: "2026-11-24T07:00:00Z", touches: [{ n: 1, channel: "Email", sent_at: "2026-11-21T05:00:00Z" }, { n: 3, channel: "Email", sent_at: "2026-11-23T05:00:00Z" }] } } }),
    p("c", { signals: { outreach: { state: "paused", pause_reason: 'touch 1: audit or one-pager failed: HTTP 402: {"error":{"message":"Your prepayment credits are depleted."}}', touches: [] } } }),
    p("c2", { company: "Dental IQ | Dental clinic in chandigarh", signals: { outreach: { state: "paused", pause_reason: "touch 1: held by the last check: Kochar's named in 7, the audit says nothing", touches: [] } } }),
    p("c3", { company: "Dr. Manju's Dental", signals: { outreach: { state: "paused", pause_reason: 'touch 1: held by the last check: "Manju" is presented as a business', touches: [] } } }),
    p("d", { status: "rejected", signals: { outreach: { state: "paused", pause_reason: "touch 1: HTTP 402", touches: [] } } }),
    p("e", { status: "new" }),
    p("f", { status: "new" }),
    p("g", { status: "reviewed" }),
    p("ph1", { status: "reviewed", fit_score: 66, decision_maker: { name: "Owner / Lead Doctor", email: "", phone: "098765 43210" } }),
    p("ph2", { status: "reviewed", fit_score: 81, company: "Smile Hub", category: "hotels", city: "Patiala", decision_maker: { name: "Dr Asha Rao", email: "", phone: "+91 99887 76655" }, signals: { preaudit: { mentions: 0, total_queries: 15, audited_at: "2026-11-25T05:30:00Z", weakest_competitor: "Grand Stay", competitor_mentions: { "Grand Stay": 7 } } } as any }),
    p("nophone", { status: "reviewed", decision_maker: { name: "", email: "", phone: "" } }),
    p("h", { status: "bench" }),
  ];
  const deals = [
    { id: "1", company: "Clinic b", source: "outreach", stage: "replied", history: [] },
    { id: "2", company: "Smile <Studio>", source: "booking", stage: "call_booked", call_at: "2026-11-25T10:00:00Z", history: [] },
    { id: "3", company: "Old Call", source: "booking", stage: "call_booked", call_at: "2026-11-20T10:00:00Z", history: [] },
    { id: "4", company: "Won Co", source: "outreach", stage: "won", amount: 25000, currency: "INR", history: [] },
  ] as unknown as Deal[];
  const spend = sumSpend(
    [
      { product: "truevisible", cost_date: "2026-11-24", amount_inr: "100.5" },
      { product: "truevisible", cost_date: "2026-11-02", amount_inr: 400 },
      { product: "tgl_ops", cost_date: "2026-11-24", amount_inr: 12 },
    ],
    "2026-11-24"
  );
  assert.deepEqual(spend, { todayInr: 112.5, monthInr: 512.5, byProduct: { truevisible: 500.5, tgl_ops: 12 } });

  const v = buildLiveView({ now: NOW, prospects, deals, agents: [{ agent: "prospect-researcher", last: "Run, 09:30 IST (Ludhiana, hotels)" }], spend, capToday: 5 });

  assert.deepEqual(v.today, { sent: 1, cap: 5, replies: 1, callsBooked: 1, nextCall: v.today.nextCall }, "dry runs and other days not counted; only future calls");
  assert.match(v.today.nextCall || "", /^Smile <Studio>, Wed/);
  // Journey: found excludes bench; approved excludes rejected; contacted counts real sends only; today's additions.
  assert.deepEqual(v.journey.map((j) => [j.label, j.count, j.today]), [["Found", 12, 0], ["Approved", 9, null], ["Contacted", 2, 1], ["Replied", 1, 1], ["Call booked", 3, null], ["Won", 1, null]]);
  assert.deepEqual(v.stuck, { approval: 2, nextInLine: 1, whatsapp: 2, paused: 3 });
  assert.deepEqual(v.nextInLine.map((r) => r.company), ["Clinic g"]);

  // Waiting for WhatsApp: approved, never emailed, no email, a phone; highest fit first; the advance AI check.
  assert.deepEqual(v.calls.map((c) => [c.company, c.fit]), [["Smile Hub", 81], ["Clinic ph1", 66]]);
  assert.match(v.calls[0].check, /^Named in 0 of 15 AI answers; Grand Stay named in 7 \(checked .*25 Nov.*\)\.$/);
  assert.equal(v.calls[1].check, "", "no check yet, nothing invented");
  assert.equal(v.calls[0].type, "hotel");

  assert.deepEqual(v.waiting, [
    "Approve or reject 2 new businesses in #revenue.",
    "Answer 1 reply (open the pipeline).",
    `Prepare for your next call: ${v.today.nextCall}.`,
  ]);

  // Activity comes from records: outreach shows as done because it sent, with no log file needed.
  const act = Object.fromEntries(v.activity.map((a) => [a.name, a]));
  assert.equal(act["Outreach"].state, "done");
  assert.equal(act["Outreach"].what, "Sent 1 email of 5 allowed today.");
  assert.equal(act["Prospect researcher"].state, "problem", "nothing saved today and it is past 11:00");
  assert.equal(act["Citation tracker"].state, "problem");
  assert.equal(act["Replies"].state, "done");
  const cit = buildLiveView({ now: NOW, prospects, deals, agents: [{ agent: "aeo-audit-engine", last: "06:07 IST — Citation Tracker: 1 brand(s) · brand named in 6/48 answers · engine spend $0.4590" }], spend, capToday: 5 }).activity.find((a) => a.name === "Citation tracker");
  assert.equal(cit?.state, "done");
  assert.equal(cit?.what, "TGL named in 6 of 48 AI answers.");
  assert.equal(cit?.at, "2026-11-24T00:37:00.000Z");
  assert.equal(lastHeading("# Log\n- 06:07 IST — Citation Tracker: x\n- 07:10 IST — again"), "07:10 IST — again", "timed lines count as entries");

  // Problems grouped by cause, names listed, a rejected business left out, no raw JSON.
  const held = v.problems.find((x) => x.text.startsWith("Held before sending"));
  assert.deepEqual(held?.names, ["Dental IQ", "Dr. Manju's Dental"]);
  assert.ok(v.problems.some((x) => x.text.startsWith("Paused: Gemini has run out of credits") && x.names.length === 1));
  assert.ok(!v.problems.some((x) => x.text.includes("{")), "no JSON");
  assert.ok(v.problems.some((x) => x.text.startsWith("Citation tracker: No run recorded today")));
  assert.equal(pauseGroup("touch 3: email to a@b.example bounced"), "Paused: an email bounced, so the address needs checking");

  // Outbox: named messages, newest first.
  assert.deepEqual(v.outbox.map((r) => [r.company, r.what, r.today]), [["Clinic a", "First email", true], ["Clinic b", "Report email", false], ["Clinic b", "First email", false]]);

  // Overview
  const html = renderOverviewPage(v, "me@x.example", NOW);
  assert.ok(html.includes("1<small> of 5</small>"));
  assert.ok(html.includes("From found to won") && html.includes("+1 today"), "the journey with today's additions");
  assert.ok(html.includes("₹513") && html.includes("TrueVisible"), "spend from the recorded table");
  assert.ok(html.includes('href="/pipeline/live" aria-current="page"') && html.includes('id="refresh"'), "current tab marked; a refresh button");
  assert.ok(html.includes("Smile &lt;Studio&gt;") && !html.includes("Smile <Studio>"), "escaped");
  const planned = renderOverviewMain(v, NOW, { ...BUILD_PLAN, tasks: [{ title: "Sign the test plan", owner: "You", due: "2026-11-26", status: "todo" }, { title: "Far away", owner: "You", due: "2026-12-14", status: "todo" }] });
  assert.ok(planned.includes("Sign the test plan") && !planned.includes("Far away"), "build tasks due this week join Needs you");
  assert.ok(!html.includes('href="tel:'), "no tap-to-call: no cold calls");
  assert.ok(!EMOJI.test(html), "no emojis");
  assert.ok(!html.includes("x@a.example"), "no email addresses on the page");
  for (const tab of ["/pipeline/live", "/pipeline/outreach", "/pipeline", "/pipeline/build"]) assert.ok(html.includes(`href="${tab}"`), `tab ${tab}`);
  assert.ok(html.indexOf("From found to won") < html.indexOf("Needs you") && html.indexOf("Needs you") < html.indexOf("What the system did today"), "journey first, then actions, then activity");

  // Outreach page
  const out = renderOutreachPage(v, "me@x.example");
  assert.ok(out.includes('id="sent"') && out.includes('id="next"') && out.includes('id="whatsapp"') && out.includes('id="paused"'));
  assert.ok(out.includes("Waiting for WhatsApp") && !/call list/i.test(out), "no call-list framing");
  assert.ok(out.includes("AI check not run yet") && out.includes("Grand Stay named in 7"));
  assert.ok(out.includes("Clinic g") && out.includes("1 sending day"));
  assert.ok(!EMOJI.test(out));

  const full = renderOverviewMain(buildLiveView({ now: NOW, prospects, deals, agents: [], spend, capToday: 1 }), NOW);
  assert.ok(full.includes("limit reached"), "a full day says so");

  const empty = buildLiveView({ now: NOW, prospects: [], deals: [], agents: null, spend: null, capToday: 2 });
  const quiet = renderOverviewMain(empty, NOW) + renderOutreachMain(empty);
  for (const t of ["Nothing has been sent yet.", "Today's log could not be read.", "Spend could not be read just now.", "No approved business is waiting for WhatsApp.", "No approved business with an email is waiting.", "Nothing is paused."]) {
    assert.ok(quiet.includes(t), `empty state: ${t}`);
  }

  // Route
  const env = { ...process.env };
  process.env.PIPELINE_ALLOWED_EMAILS = "me@x.example";
  process.env.PIPELINE_SESSION_SECRET = "s3cret";
  setLiveLoaderForTests(async () => v);
  const server = createApp("x").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const out = await (await fetch(`${base}/pipeline/live`)).text();
    assert.match(out, /Sign in with Google/, "signed out: the sign-in page, no numbers");
    assert.ok(!out.includes("emails sent today"));
    assert.equal((await fetch(`${base}/pipeline/live?part=main`)).status, 401);
    const cookie = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(makeSession("me@x.example", "s3cret"))}` };
    const page = await fetch(`${base}/pipeline/live`, { headers: cookie });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.ok((await page.text()).includes("Today at"));
    const part = await (await fetch(`${base}/pipeline/live?part=main`, { headers: cookie })).text();
    assert.ok(part.startsWith('<ul class="stats">') && !part.includes("<html"), "the refreshing part only");
    assert.equal((await fetch(`${base}/pipeline/outreach?part=main`)).status, 401);
    const o = await fetch(`${base}/pipeline/outreach`, { headers: cookie });
    assert.equal(o.status, 200);
    assert.ok((await o.text()).includes("business by business"));
    setLiveLoaderForTests(async () => { throw new Error("db down"); });
    assert.equal((await fetch(`${base}/pipeline/live`, { headers: cookie })).status, 503);
  } finally {
    server.close();
    setLiveLoaderForTests(null);
    process.env = env;
  }

  console.log("test-live-view: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

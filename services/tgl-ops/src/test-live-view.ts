// services/tgl-ops/src/test-live-view.ts
// Offline checks for /pipeline/live (24 Nov 2026): every number on the page from fixture data, the problems and
// waiting lists, the outbox order, escaping, no emojis, and the route (signed out, signed in, the refreshing part).
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { makeSession, SESSION_COOKIE } from "./agents/pipeline/auth.js";
import { lastHeading } from "./agents/pipeline/live-data.js";
import { buildLiveView, renderLiveMain, renderLivePage, type LiveProspect } from "./agents/pipeline/live-view.js";
import type { Deal } from "./agents/pipeline/stages.js";
import { setLiveLoaderForTests } from "./routes/pipeline.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;
// 24 Nov 2026, 15:00 IST
const NOW = new Date("2026-11-24T09:30:00Z");

function p(id: string, over: Partial<LiveProspect> = {}): LiveProspect {
  return { id, company: `Clinic ${id} | Best clinic in town`, city: "Mohali", category: "cosmetic_dental", status: "handed_to_outreach", fit_score: 70, created_at: "2026-11-20T04:00:00Z", signals: {}, ...over };
}

async function main() {
  const prospects: LiveProspect[] = [
    p("a", { signals: { outreach: { state: "active", touches: [{ n: 1, channel: "Email", sent_at: "2026-11-24T08:05:00Z" }, { n: 2, channel: "WhatsApp", sent_at: "2026-11-24T08:06:00Z", dry_run: true }] } } }),
    p("b", { signals: { outreach: { state: "replied", last_reply_at: "2026-11-24T07:00:00Z", touches: [{ n: 1, channel: "Email", sent_at: "2026-11-21T05:00:00Z" }] } } }),
    p("c", { signals: { outreach: { state: "paused", pause_reason: 'touch 1: audit or one-pager failed: HTTP 402: {"error":{"message":"Your prepayment credits are depleted."}}', touches: [] } } }),
    p("d", { status: "rejected", signals: { outreach: { state: "paused", pause_reason: "touch 1: HTTP 402", touches: [] } } }),
    p("e", { status: "new" }),
    p("f", { status: "new" }),
    p("g", { status: "reviewed" }),
    p("h", { status: "bench" }),
  ];
  const deals = [
    { id: "1", company: "Clinic b", source: "outreach", stage: "replied", history: [] },
    { id: "2", company: "Smile <Studio>", source: "booking", stage: "call_booked", call_at: "2026-11-25T10:00:00Z", history: [] },
    { id: "3", company: "Old Call", source: "booking", stage: "call_booked", call_at: "2026-11-20T10:00:00Z", history: [] },
    { id: "4", company: "Won Co", source: "outreach", stage: "won", amount: 25000, currency: "INR", history: [] },
  ] as unknown as Deal[];

  const v = buildLiveView({ now: NOW, prospects, deals, agents: [{ agent: "prospect-researcher", last: "Run, 09:30 IST (Ludhiana, hotels)" }], spend: { todayUsd: 1, monthUsd: 10 }, usdInr: 85, capToday: 5 });

  assert.deepEqual(v.today, { sent: 1, cap: 5, replies: 1, callsBooked: 1, nextCall: v.today.nextCall }, "dry runs and other days not counted; only future calls");
  assert.match(v.today.nextCall || "", /^Smile <Studio>, Wed/);
  assert.deepEqual(v.funnel.map((f) => [f.label, f.count]), [["Qualified", 7], ["Approved", 4], ["Emailed", 2], ["Replied", 1], ["Call booked", 3], ["Won", 1]], "bench left out; calls count booked and later stages");
  assert.ok(v.waiting.some((w) => w === "2 businesses are waiting for your approval in #revenue."));
  assert.ok(v.waiting.some((w) => w.startsWith("1 reply needs an answer")));
  assert.deepEqual(v.problems.filter((x) => x.includes("paused")), ["1 sequence is paused: Gemini has run out of credits. Top up in Google AI Studio (Billing), and check that the Gemini key in Railway belongs to the project you topped up."], "a rejected business is not a problem; the reason is one plain sentence");
  assert.ok(v.problems.includes("The citation tracker has not reported a run today."));
  assert.ok(!v.problems.some((x) => x.includes("prospect researcher")), "the researcher reported");
  assert.deepEqual(v.outbox.map((r) => [r.company, r.touch]), [["Clinic a", 1], ["Clinic b", 1]], "newest first, names cleaned");
  assert.equal(v.spend?.monthInr, 850);

  const html = renderLivePage(v, "me@x.example");
  assert.ok(html.includes("Smile &lt;Studio&gt;") && !html.includes("Smile <Studio>"), "escaped");
  assert.ok(html.includes("1<small> of 5</small>"), "emails today against the cap");
  assert.ok(html.includes("₹850"), "spend in rupees");
  assert.ok(html.includes("The full text of every email is in #revenue."));
  assert.ok(!EMOJI.test(html), "no emojis");
  assert.ok(!html.includes("0c5d0f05") && !html.includes("@clinic"), "no ids or addresses on the page");

  const quiet = renderLiveMain(buildLiveView({ now: NOW, prospects: [], deals: [], agents: null, spend: null, usdInr: 85, capToday: 2 }));
  assert.ok(quiet.includes("Nothing sent yet.") && quiet.includes("Today's agent logs could not be read.") && quiet.includes("unknown"), "unreadable parts are said, never shown as zero");

  assert.equal(lastHeading("# Log\n### Run, 09:30 IST (A)\n- x\n### Run, 10:30 IST (B)\n- y"), "Run, 10:30 IST (B)");
  assert.equal(lastHeading("no headings"), "");
  assert.ok(renderLiveMain(buildLiveView({ now: NOW, prospects: [], deals: [], agents: [{ agent: "aeo-audit-engine", last: "x" }, { agent: "new-agent", last: "y" }], spend: null, usdInr: 85, capToday: 2 })).includes("<b>Citation tracker</b>"), "agents shown by plain name");

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

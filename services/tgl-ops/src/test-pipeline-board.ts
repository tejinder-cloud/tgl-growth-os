// services/tgl-ops/src/test-pipeline-board.ts
// The private board: only an allowed, signed-in Google account sees it; names are escaped; totals add up.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { allowedEmails, makeSession, readSession, SESSION_COOKIE } from "./agents/pipeline/auth.js";
import { isPlaceholderContact, renderBoard, totals, daysInStage } from "./agents/pipeline/board.js";
import { setBoardSourcesForTests } from "./routes/pipeline.js";
import type { Deal } from "./agents/pipeline/stages.js";

const now = new Date("2026-11-21T10:00:00Z");
const deal = (o: Partial<Deal>): Deal => ({ id: o.id || "d", company: "Clinic", source: "outreach", stage: "in_outreach", history: [{ stage: o.stage || "in_outreach", at: "2026-11-19T10:00:00Z", by: "system" }], ...o }) as Deal;
const deals: Deal[] = [
  deal({ id: "a", company: "Luma Fertility : Top IVF Centre in Bandra Mumbai l Best IVF", contact_name: "Neha", city: "Mumbai", prospect_id: "p1" }),
  deal({ id: "b", company: "<script>x</script> Dental", stage: "call_booked", call_at: "2026-11-23T09:30:00Z" }),
  deal({ id: "c", company: "Sharma Classes", stage: "proposal_sent", amount: 25000, currency: "INR" }),
  deal({ id: "d", company: "Global Co", stage: "proposal_sent", amount: 800, currency: "USD" }),
  deal({ id: "e", company: "Won Clinic", stage: "won", amount: 30000, currency: "INR" }),
  deal({ id: "f", company: "Lost Clinic", stage: "lost", lost_reason: "Budget" }),
];

async function main() {
  const t = totals(deals);
  assert.deepEqual(t, { open: 4, callsBooked: 1, proposalsOut: 2, proposedMonthly: { INR: 25000, USD: 800 }, wonMonthly: { INR: 30000 } });
  assert.equal(daysInStage(deals[0], now), 2);
  const html = renderBoard(deals, { now, email: "me@x.example", audits: { p1: "AI check 2026-11-21: named in 2 of 15 answers." } });
  assert.doesNotMatch(html, /<script>x<\/script>/, "names are escaped");
  assert.match(html, /Luma Fertility</, "long listing titles are cleaned");
  assert.match(html, /Rs 25,000 \+ \$800/);
  assert.match(html, /named in 2 of 15 answers/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="https?:/);
  assert.match(html, /href="\/pipeline" aria-current="page"/, "the shared tabs, Pipeline marked");

  // Rejected businesses leave the board; placeholder roles are not shown as names (25 Nov 2026).
  const more = [...deals, deal({ id: "r", company: "JP Academy", prospect_id: "rej" }), deal({ id: "o", company: "Tutors Hub", contact_name: "Owner / Lead Doctor", city: "Mumbai" })];
  const h2 = renderBoard(more, { now, email: "me@x.example", rejected: new Set(["rej"]) });
  assert.doesNotMatch(h2, /JP Academy/);
  assert.match(h2, /Tutors Hub/);
  assert.doesNotMatch(h2, /Owner \/ Lead Doctor/);
  assert.equal(isPlaceholderContact("Contact found, DM unknown"), true);
  assert.equal(isPlaceholderContact("Dr Asha Rao"), false);

  // Sessions.
  const allowed = new Set(["me@x.example"]);
  const tok = makeSession("Me@X.example", "s3cret", now);
  assert.equal(readSession(tok, "s3cret", allowed, now), "me@x.example");
  assert.equal(readSession(tok, "other", allowed, now), null, "forged");
  assert.equal(readSession(tok, "s3cret", new Set(["someone@else.example"]), now), null, "removed from the list");
  assert.equal(readSession(tok, "s3cret", allowed, new Date(now.getTime() + 8 * 86400000)), null, "expired after 7 days");
  assert.deepEqual([...allowedEmails({ PIPELINE_ALLOWED_EMAILS: " A@x.example, b@y.example " } as any)], ["a@x.example", "b@y.example"]);
  assert.equal(allowedEmails({} as any).size, 0, "nobody by default");

  // Through the app.
  const env = { ...process.env };
  process.env.PIPELINE_ALLOWED_EMAILS = "me@x.example";
  process.env.PIPELINE_SESSION_SECRET = "s3cret";
  process.env.GOOGLE_BOOKING_CLIENT_ID = "cid";
  process.env.GOOGLE_BOOKING_CLIENT_SECRET = "csec";
  process.env.BOOKING_PUBLIC_URL = "https://svc.example";
  setBoardSourcesForTests(async () => deals, async () => ({}));
  const server = createApp("x").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const anon = await (await fetch(`${base}/pipeline`)).text();
    assert.match(anon, /Sign in with Google/);
    assert.doesNotMatch(anon, /Sharma Classes/, "no deals without a session");
    const bad = await (await fetch(`${base}/pipeline`, { headers: { cookie: `${SESSION_COOKIE}=forged.value` } })).text();
    assert.doesNotMatch(bad, /Sharma Classes/);
    const ok = await fetch(`${base}/pipeline`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(makeSession("me@x.example", "s3cret"))}` } });
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.match(await ok.text(), /Sharma Classes/);
    const go = await fetch(`${base}/pipeline/connect`, { redirect: "manual" });
    assert.equal(go.status, 302);
    assert.match(go.headers.get("location") || "", /scope=openid\+email/);
    assert.match(go.headers.get("location") || "", /redirect_uri=https%3A%2F%2Fsvc\.example%2Fpipeline%2Foauth%2Fcallback/);
    assert.equal((await fetch(`${base}/pipeline/oauth/callback?code=c&state=forged`)).status, 400);
    const out = await fetch(`${base}/pipeline/logout`, { redirect: "manual" });
    assert.match(out.headers.get("set-cookie") || "", /Max-Age=0/);
  } finally {
    server.close();
    process.env = env;
    setBoardSourcesForTests(null, null);
  }
  console.log("test-pipeline-board: all checks passed");
}
main().catch((err) => { console.error(err); process.exit(1); });

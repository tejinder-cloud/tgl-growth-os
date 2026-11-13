// services/tgl-ops/src/test-ops-revenue.ts
// GET /ops/revenue (project dashboard's revenue strip) and the 09:00 card's Money line. Offline: the counts
// provider is a fake; binds an ephemeral localhost port only. No Slack post, no write to decisions/ or logs/.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { buildMoneySentence, REVENUE_TARGET } from "./agents/chief-of-staff/plain-card.js";
import { setRevenueCountsProvider, toPublicRevenue } from "./routes/ops-revenue.js";

async function main() {
  // Public shape: the target and four counts; anything else is dropped; a bad count becomes null.
  const pub = toPublicRevenue(
    { auditsRequested: 2, auditsSent: 0, callsBooked: -1, retainersWon: 1.5, businessNames: ["Secret Clinic"] } as any,
    new Date("2026-11-13T11:00:00Z")
  );
  assert.deepEqual(pub, {
    target: { since: REVENUE_TARGET.since, due: REVENUE_TARGET.due, conversations: REVENUE_TARGET.conversations, retainers: REVENUE_TARGET.retainers },
    audits_requested: 2,
    audits_sent: 0,
    calls_booked: null,
    retainers_won: null,
    read_at: "2026-11-13T11:00:00.000Z",
  });
  assert.equal(JSON.stringify(pub).includes("Secret"), false);

  // Money line: the audit figure is the same one the revenue line uses whenever it can be read.
  const revenue = { auditRequests: 0, diagnosticCallsBooked: 0, proposalsSent: 0, retainersWon: 0, rupeesInvoiced: 0 };
  assert.ok(buildMoneySentence({ revenue, spendRupees: 48.57, revenueProgress: { auditsRequested: 2, auditsSent: 0 } }, "morning").startsWith("2 audit requests,"));
  assert.ok(buildMoneySentence({ revenue: { ...revenue, auditRequests: 1 }, spendRupees: 0, revenueProgress: null }, "morning").startsWith("1 audit request,"), "falls back to the GHL count when the audits cannot be read");

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    setRevenueCountsProvider(null);
    assert.equal((await fetch(`${base}/ops/revenue`)).status, 503, "mounted; refuses with no provider");

    let calls = 0;
    setRevenueCountsProvider(async () => {
      calls++;
      return { auditsRequested: 3, auditsSent: 1, callsBooked: 0, retainersWon: 0 };
    });
    const res = await fetch(`${base}/ops/revenue`, { headers: { origin: "https://project.thegrowthlab.co.in" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://project.thegrowthlab.co.in");
    const body = (await res.json()) as any;
    assert.equal(body.audits_requested, 3);
    assert.equal(body.audits_sent, 1);
    assert.equal(body.target.due, "2026-11-26");

    const other = await fetch(`${base}/ops/revenue`, { headers: { origin: "https://elsewhere.example" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null, "other sites cannot read it from a browser");
    assert.equal(calls, 1, "answers are cached; refreshes do not multiply reads");

    setRevenueCountsProvider(async () => {
      throw new Error("database down");
    });
    assert.equal((await fetch(`${base}/ops/revenue`)).status, 503, "a failure is a 503, never invented figures");
  } finally {
    setRevenueCountsProvider(null);
    server.close();
  }
  console.log("test-ops-revenue: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

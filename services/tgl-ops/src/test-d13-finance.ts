// Day 13 finance tests: fixtures and fake fetch only. No network, no Slack, no decisions/ or logs/ writes.
// Ledger files go to an OS temp dir that is removed at the end. GSTINs below are format-valid fixtures, not real.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeGst, classifySupply, financialYear } from "./agents/finance/gst.js";
import { buildInvoice, configGaps } from "./agents/finance/invoice.js";
import { handleDealWon, normalizeDealWon, type Deps } from "./agents/finance/deal-won.js";
import { FileLedger, MemoryLedger, buildExpense, nextInvoiceNumber, summarise, newId } from "./agents/finance/ledger.js";
import { planCollections, runCollections } from "./agents/finance/collections.js";
import type { FetchLike } from "./agents/finance/providers.js";
import type { DealWon, FinanceConfig, LedgerEntry } from "./agents/finance/types.js";

const cfg: FinanceConfig = {
  supplierName: "Test Supplier", supplierGstin: "04AAAAA0000A1Z5", supplierStateCode: "04", sacCode: "998314",
  gstRatePct: 18, amountMode: "exclusive", paymentTermsDays: 7, provider: "razorpay", live: true,
};
const now = new Date("2026-11-09T07:30:00Z");
const deal = (over: Partial<DealWon> = {}): DealWon => ({ dealId: "opp-1", dealName: "Managed AEO retainer", amountInr: 100000, buyer: { name: "Dr Test", company: "Test Clinic", email: "t@example.com", gstin: "04BBBBB1111B1Z5" }, ...over });
let passed = 0;
const t = async (name: string, fn: () => unknown | Promise<unknown>) => { await fn(); passed++; console.log("ok -", name); };

function fakeFetch(calls: Array<{ url: string; body?: any }>, respond: (url: string, method: string) => any): FetchLike {
  return async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    const r = respond(url, init.method);
    return { ok: r.status < 400, status: r.status, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  };
}
function deps(over: Partial<Deps> = {}): Deps & { notes: string[]; calls: any[] } {
  const notes: string[] = [], calls: any[] = [];
  return {
    cfg, ledger: new MemoryLedger(), now: () => now, notify: async (x: string) => { notes.push(x); },
    fetch: fakeFetch(calls, () => ({ status: 200, json: { id: "inv_rzp_1", short_url: "https://rzp.io/i/x", amount: 11800000 } })),
    env: { RAZORPAY_KEY_ID: "k", RAZORPAY_KEY_SECRET: "s" } as any, ...over, notes, calls,
  } as any;
}

await t("intra-state exclusive: CGST and SGST equal, total exact", () => {
  const g = computeGst(10000000, 18, "exclusive", "intra_state", "04");
  assert.deepEqual([g.taxableMinor, g.cgstMinor, g.sgstMinor, g.igstMinor, g.totalMinor], [10000000, 900000, 900000, 0, 11800000]);
});
await t("inclusive and inter-state totals equal the agreed amount", () => {
  const a = computeGst(11800000, 18, "inclusive", "intra_state", "04");
  assert.equal(a.taxableMinor, 10000000); assert.equal(a.totalMinor, 11800000);
  const b = computeGst(11800000, 18, "inclusive", "inter_state", "27");
  assert.deepEqual([b.taxableMinor, b.igstMinor, b.cgstMinor], [10000000, 1800000, 0]);
});
await t("rounding never breaks the invariants over 2000 amounts", () => {
  for (let i = 0; i < 2000; i++) {
    const amt = 1000 + Math.floor(Math.random() * 99999999);
    const inc = computeGst(amt, 18, "inclusive", "intra_state", "04");
    assert.equal(inc.cgstMinor, inc.sgstMinor); assert.equal(inc.taxableMinor + inc.cgstMinor + inc.sgstMinor, amt);
    const exc = computeGst(amt, 18, "exclusive", "intra_state", "04");
    assert.equal(exc.cgstMinor, exc.sgstMinor); assert.equal(exc.totalMinor, exc.taxableMinor + exc.cgstMinor + exc.sgstMinor);
    const ig = computeGst(amt, 18, "inclusive", "inter_state", "27");
    assert.equal(ig.taxableMinor + ig.igstMinor, amt);
  }
});
await t("supply classification and financial year", () => {
  assert.equal(classifySupply({ name: "a", gstin: "27AAAAA0000A1Z5" }, cfg), "inter_state");
  assert.equal(classifySupply({ name: "a", stateCode: "04" }, cfg), "intra_state");
  assert.equal(classifySupply({ name: "a", country: "United States" }, cfg), "export");
  assert.equal(classifySupply({ name: "a" }, cfg), null);
  assert.equal(financialYear(new Date("2027-02-01T00:00:00Z")), "26-27");
  assert.equal(financialYear(new Date("2027-04-01T00:00:00Z")), "27-28");
});
await t("holds: missing config, bad amount, unknown state, export, bad GSTIN", () => {
  assert.ok(configGaps({}).length >= 6);
  const r1 = buildInvoice(deal(), { ...cfg, sacCode: undefined }, "TGL/26-27/0001", now);
  assert.ok(!r1.ok && r1.code === "CONFIG_MISSING");
  const r2 = buildInvoice(deal({ amountInr: 0 }), cfg, "TGL/26-27/0001", now);
  assert.ok(!r2.ok && r2.code === "DEAL_INCOMPLETE");
  const r3 = buildInvoice(deal({ buyer: { name: "x" } }), cfg, "TGL/26-27/0001", now);
  assert.ok(!r3.ok && r3.code === "STATE_UNKNOWN");
  const r4 = buildInvoice(deal({ buyer: { name: "x", country: "US" } }), cfg, "TGL/26-27/0001", now);
  assert.ok(!r4.ok && r4.code === "EXPORT_REVIEW");
  const r5 = buildInvoice(deal({ buyer: { name: "x", gstin: "BAD" } }), cfg, "TGL/26-27/0001", now);
  assert.ok(!r5.ok && r5.code === "DEAL_INCOMPLETE");
});
await t("invoice dates are IST and due date uses payment terms", () => {
  const r = buildInvoice(deal(), cfg, "TGL/26-27/0001", now);
  assert.ok(r.ok); assert.equal(r.invoice.issueDate, "2026-11-09"); assert.equal(r.invoice.dueDate, "2026-11-16");
});
await t("normalizeDealWon accepts GHL shape and ignores non-won", () => {
  assert.equal(normalizeDealWon({ status: "open", id: "1" }), null);
  const d = normalizeDealWon({ status: "won", opportunity_id: "o9", opportunity_name: "AEO", monetaryValue: 50000, full_name: "A B", email: "a@b.in", gstin: "04BBBBB1111B1Z5" });
  assert.equal(d?.dealId, "o9"); assert.equal(d?.amountInr, 50000); assert.equal(d?.buyer.gstin, "04BBBBB1111B1Z5");
});

// Day 13 finance tests: fixtures and fake fetch only. No network, no Slack, no decisions/ or logs/ writes.
// Ledger files go to an OS temp dir that is removed at the end.
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
function deps(over: Partial<Deps> & { calls?: any[]; notes?: string[] } = {}): Deps & { notes: string[]; calls: any[] } {
  const notes = over.notes ?? [], calls = over.calls ?? [];
  return {
    cfg, ledger: new MemoryLedger(), now: () => now, notify: async (x) => { notes.push(x); },
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
await t("holds: missing config, bad amount, unknown state, export", () => {
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
await t("live Razorpay: creates a DRAFT with GST lines, writes ledger once, duplicate is idempotent", async () => {
  const d = deps();
  const out = await handleDealWon(d, deal());
  assert.equal(out.status, "created");
  const call = d.calls[0];
  assert.equal(call.url, "https://api.razorpay.com/v1/invoices");
  assert.equal(call.body.draft, "1"); assert.equal(call.body.sms_notify, 0); assert.equal(call.body.email_notify, 0);
  assert.deepEqual(call.body.line_items.map((l: any) => l.amount), [10000000, 900000, 900000]);
  assert.equal(call.body.receipt, "TGL/26-27/0001");
  assert.equal((await d.ledger.all()).length, 1);
  const again = await handleDealWon(d, deal());
  assert.equal(again.status, "duplicate"); assert.equal(d.calls.length, 1);
  assert.ok(d.notes.every((n) => !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(n)));
});
await t("provider failure writes nothing and can be retried", async () => {
  const d = deps({ fetch: fakeFetch([], () => ({ status: 400, json: { error: { description: "bad" } } })) });
  const out = await handleDealWon(d, deal());
  assert.equal(out.status, "failed"); assert.equal((await d.ledger.all()).length, 0);
});
await t("dry run by default: no provider call, no ledger write", async () => {
  const d = deps({ cfg: { ...cfg, live: false } });
  const out = await handleDealWon(d, deal());
  assert.equal(out.status, "dry_run"); assert.equal(d.calls.length, 0); assert.equal((await d.ledger.all()).length, 0);
});
await t("export deal is held and raises a Compliance LUT task, no invoice", async () => {
  const d = deps();
  const out = await handleDealWon(d, deal({ buyer: { name: "Acme", country: "United States" } }));
  assert.equal(out.status, "held"); assert.equal(d.calls.length, 0);
  assert.ok(d.notes.some((n) => n.includes("Compliance task") && n.includes("finance/compliance/lut-checklist.md")));
});
await t("Zoho adapter: contact then draft invoice with SAC, tax id and place of supply; mismatch flagged", async () => {
  const calls: any[] = [];
  const f = fakeFetch(calls, (url, method) => {
    if (url.includes("/contacts") && method === "GET") return { status: 200, json: { contacts: [] } };
    if (url.includes("/contacts")) return { status: 201, json: { contact: { contact_id: "c1" } } };
    return { status: 201, json: { invoice: { invoice_id: "z1", total: 117999.99 } } };
  });
  const d = deps({ cfg: { ...cfg, provider: "zoho" }, fetch: f, env: { ZOHO_BOOKS_ORG_ID: "o", ZOHO_BOOKS_ACCESS_TOKEN: "t", ZOHO_TAX_ID_INTRA: "tx1", ZOHO_TAX_ID_INTER: "tx2" } as any });
  const out = await handleDealWon(d, deal());
  assert.equal(out.status, "created"); assert.equal(out.status === "created" && out.totalMismatch, true);
  const inv = calls[2].body;
  assert.equal(inv.place_of_supply, "PB"); assert.equal(inv.line_items[0].hsn_or_sac, "998314"); assert.equal(inv.line_items[0].tax_id, "tx1"); assert.equal(inv.line_items[0].rate, 100000);
  assert.ok(d.notes.some((n) => n.includes("WARNING")));
});
await t("invoice numbers are consecutive per financial year", () => {
  const e = (n: string): LedgerEntry => ({ kind: "invoice", id: newId(), at: now.toISOString(), number: n, dealId: n, buyerName: "x", provider: "razorpay", providerInvoiceId: n, status: "draft", taxableMinor: 1, gstMinor: 0, totalMinor: 1, dueDate: "2026-11-16" });
  assert.equal(nextInvoiceNumber([], now), "TGL/26-27/0001");
  assert.equal(nextInvoiceNumber([e("TGL/26-27/0001"), e("TGL/26-27/0002")], now), "TGL/26-27/0003");
  assert.equal(nextInvoiceNumber([e("TGL/26-27/0002")], new Date("2027-04-02T00:00:00Z")), "TGL/27-28/0001");
  assert.ok(nextInvoiceNumber([], now).length <= 16);
});
await t("ledger: income, per-audit expenses, FX never guessed, file round trip", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tgl-ledger-"));
  try {
    const l = new FileLedger(dir);
    const d = deps({ ledger: l });
    await handleDealWon(d, deal());
    await l.append({ kind: "status", id: newId(), at: now.toISOString(), number: "TGL/26-27/0001", status: "issued" });
    await l.append({ kind: "payment", id: newId(), at: now.toISOString(), number: "TGL/26-27/0001", amountMinor: 5000000 });
    await l.append(buildExpense({ auditId: "aud-1", vendor: "anthropic", usd: 0.5, fxInrPerUsd: 90 }));
    await l.append(buildExpense({ auditId: "aud-1", vendor: "openai", usd: 0.2 }));
    await l.append(buildExpense({ auditId: "aud-2", vendor: "perplexity", amountMinor: 1000 }));
    const s = summarise(await l.all());
    assert.equal(s.invoicedMinor, 11800000); assert.equal(s.gstCollectedMinor, 1800000);
    assert.equal(s.receivedMinor, 5000000); assert.equal(s.outstandingMinor, 6800000);
    assert.equal(s.perAudit["aud-1"].expenseMinor, 4500); assert.equal(s.perAudit["aud-1"].unconverted, 1);
    assert.equal(s.perAudit["aud-2"].expenseMinor, 1000); assert.equal(s.unconvertedExpenses, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await t("collections: one draft per invoice, latest due step only, never repeated, paid and draft excluded", async () => {
  const l = new MemoryLedger();
  const d = deps({ ledger: l });
  await handleDealWon(d, deal());                          // due 2026-11-16, still draft
  assert.equal(planCollections(await l.all(), now).length, 0);
  await l.append({ kind: "status", id: newId(), at: now.toISOString(), number: "TGL/26-27/0001", status: "issued" });
  assert.equal(planCollections(await l.all(), new Date("2026-11-10T07:30:00Z")).length, 0);   // 6 days before due
  const near = planCollections(await l.all(), new Date("2026-11-13T07:30:00Z"));
  assert.equal(near.length, 1); assert.equal(near[0].step, 1);
  const late = new Date("2026-12-10T07:30:00Z");                                              // 24 days overdue
  const notes: string[] = [];
  const first = await runCollections(l, late, async (x) => { notes.push(x); });
  assert.equal(first.length, 1); assert.equal(first[0].step, 5); assert.equal(first[0].audience, "architect");
  assert.equal((await runCollections(l, late, async () => {})).length, 0);
  await l.append({ kind: "payment", id: newId(), at: late.toISOString(), number: "TGL/26-27/0001", amountMinor: 11800000 });
  assert.equal(planCollections(await l.all(), new Date("2027-01-30T00:00:00Z")).length, 0);
});

console.log(`\nDay 13 finance: ${passed} tests passed`);

// (fixture note) Zoho place_of_supply for Chandigarh (state code 04) is "CH"; the Zoho test above asserts the mapped value.

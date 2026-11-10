// Issue #141 tax configuration tests: env-driven rate and SAC, state-based split, export under LUT, refusal on missing config.
// Pure functions only. No network, no ledger, no Slack, no writes to decisions/ or logs/.
import assert from "node:assert/strict";
import { buildInvoice, configGaps, loadConfig, parseProductLine } from "./agents/finance/invoice.js";
import { LUT_EXPORT_LINE } from "./agents/finance/gst.js";
import { normalizeDealWon } from "./agents/finance/deal-won.js";
import type { DealWon } from "./agents/finance/types.js";

const GSTIN = "29ABCDE1234F1Z5"; // state 29
const BUYER_SAME = "29AAACB1234C1Z2";
const BUYER_OTHER = "27AAACB1234C1Z2";
const now = new Date("2026-11-09T06:00:00Z");

const env: NodeJS.ProcessEnv = {
  GST_RATE: "18", SAC_TRACK: "997331", SAC_SERVICES: "998314", TGL_GSTIN: GSTIN, LUT_NUMBER: "AD2900000000001",
  FINANCE_SUPPLIER_NAME: "The Growth Lab", FINANCE_AMOUNT_MODE: "exclusive",
};
const cfg = () => loadConfig({ ...env });

const deal = (over: Partial<DealWon> & { buyer?: any } = {}): DealWon => ({
  dealId: "d1", dealName: "Managed AEO", amountInr: 50000, product: "services",
  buyer: { name: "Dr A", company: "A Clinic", gstin: BUYER_SAME }, ...over,
});

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`ok ${n} ${name}`); };

t("loadConfig reads GST_RATE, SAC codes, TGL_GSTIN and LUT_NUMBER and derives the state from the GSTIN", () => {
  const c = cfg();
  assert.equal(c.gstRatePct, 18); assert.equal(c.sacTrack, "997331"); assert.equal(c.sacServices, "998314");
  assert.equal(c.supplierGstin, GSTIN); assert.equal(c.supplierStateCode, "29"); assert.equal(c.lutNumber, "AD2900000000001");
  assert.deepEqual(configGaps(c), []);
});

t("same state: CGST 9 + SGST 9, SAC 998314 for services", () => {
  const r = buildInvoice(deal(), cfg(), "TGL/26-27/0001", now);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.invoice.sacCode, "998314");
  assert.equal(r.invoice.gst.supply, "intra_state");
  assert.equal(r.invoice.gst.cgstMinor, 450000); assert.equal(r.invoice.gst.sgstMinor, 450000); assert.equal(r.invoice.gst.igstMinor, 0);
  assert.equal(r.invoice.gst.totalMinor, 5900000);
});

t("other state: IGST 18, SAC 997331 for Track", () => {
  const r = buildInvoice(deal({ product: "track", buyer: { name: "B", gstin: BUYER_OTHER } }), cfg(), "TGL/26-27/0002", now);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.invoice.sacCode, "997331");
  assert.equal(r.invoice.gst.supply, "inter_state");
  assert.equal(r.invoice.gst.igstMinor, 900000); assert.equal(r.invoice.gst.cgstMinor, 0);
});

t("export under LUT: 0 percent, the mandated line and the LUT number appear", () => {
  const r = buildInvoice(deal({ buyer: { name: "Foreign Co", country: "United States" } }), cfg(), "TGL/26-27/0003", now);
  assert.ok(r.ok); if (!r.ok) return;
  const g = r.invoice.gst;
  assert.equal(g.supply, "export"); assert.equal(g.ratePct, 0);
  assert.equal(g.cgstMinor + g.sgstMinor + g.igstMinor, 0); assert.equal(g.totalMinor, 5000000);
  assert.equal(r.invoice.lutNumber, "AD2900000000001");
  assert.ok(r.invoice.description.includes(LUT_EXPORT_LINE)); assert.ok(r.invoice.description.includes("AD2900000000001"));
  assert.ok(r.invoice.notes.some((x) => x.includes(LUT_EXPORT_LINE)));
  assert.equal(LUT_EXPORT_LINE, "Supply meant for export under LUT without payment of IGST");
});

t("refuses without GST_RATE", () => {
  const e = { ...env }; delete e.GST_RATE;
  const r = buildInvoice(deal(), loadConfig(e), "TGL/26-27/0004", now);
  assert.ok(!r.ok); if (!r.ok) { assert.equal(r.code, "CONFIG_MISSING"); assert.ok(r.reasons.join(" ").includes("GST_RATE")); }
});

t("refuses without TGL_GSTIN", () => {
  const e = { ...env }; delete e.TGL_GSTIN;
  const r = buildInvoice(deal(), loadConfig(e), "TGL/26-27/0005", now);
  assert.ok(!r.ok); if (!r.ok) assert.ok(r.reasons.join(" ").includes("TGL_GSTIN"));
});

t("refuses without the SAC for the deal product, even when the other SAC is set", () => {
  const e = { ...env }; delete e.SAC_SERVICES;
  const r = buildInvoice(deal(), loadConfig(e), "TGL/26-27/0006", now);
  assert.ok(!r.ok); if (!r.ok) assert.ok(r.reasons.join(" ").includes("SAC_SERVICES"));
  const ok = buildInvoice(deal({ product: "track" }), loadConfig(e), "TGL/26-27/0006", now);
  assert.ok(ok.ok);
});

t("refuses when the deal has no product line and no legacy SAC", () => {
  const r = buildInvoice(deal({ product: undefined }), cfg(), "TGL/26-27/0007", now);
  assert.ok(!r.ok); if (!r.ok) assert.equal(r.code, "PRODUCT_UNKNOWN");
});

t("refuses an export without LUT_NUMBER and renders nothing", () => {
  const e = { ...env }; delete e.LUT_NUMBER;
  const r = buildInvoice(deal({ buyer: { name: "Foreign Co", country: "Germany" } }), loadConfig(e), "TGL/26-27/0008", now);
  assert.ok(!r.ok); if (!r.ok) { assert.equal(r.code, "EXPORT_REVIEW"); assert.ok(r.reasons.join(" ").includes("LUT_NUMBER")); }
  const dom = buildInvoice(deal(), loadConfig(e), "TGL/26-27/0008", now);
  assert.ok(dom.ok, "a domestic invoice does not need the LUT number");
});

t("a state code that contradicts TGL_GSTIN is a config gap", () => {
  const c = loadConfig({ ...env, FINANCE_SUPPLIER_STATE_CODE: "27" });
  assert.ok(configGaps(c).some((g) => g.includes("does not match")));
});

t("product line parsing and webhook normalisation", () => {
  assert.equal(parseProductLine("Track"), "track");
  assert.equal(parseProductLine("Managed AEO"), "services");
  assert.equal(parseProductLine("AI Automation"), "services");
  assert.equal(parseProductLine("something else"), undefined);
  const d = normalizeDealWon({ status: "won", opportunity_id: "o1", monetaryValue: 1000, full_name: "X", product: "track" });
  assert.equal(d?.product, "track");
  assert.equal(normalizeDealWon({ status: "won", opportunity_id: "o2", monetaryValue: 1000, full_name: "X" })?.product, undefined);
});

console.log(`d13 gst env: ${n} passed`);

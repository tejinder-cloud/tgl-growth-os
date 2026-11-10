process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { amountInWords, financialYear, invoiceNumber, money, taxFor } from "./agents/aeo-billing/invoice.js";
import { invoicePdf } from "./agents/aeo-billing/invoice-pdf.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

async function main() {
await t("place of supply → tax: Chandigarh CGST+UTGST, other states IGST, unknown = supplier's state, exports zero-rated", () => {
  const intra = taxFor({ currency: "INR", gstMinor: 71982, gstRate: 18, customerState: "04", lutArn: null });
  assert.equal(intra.kind, "intra"); assert.deepEqual(intra.lines.map((l) => [l.label, l.rate, l.minor]), [["CGST", 9, 35991], ["UTGST", 9, 35991]]);
  const punjab = taxFor({ currency: "INR", gstMinor: 71982, gstRate: 18, customerState: "03", lutArn: null });
  assert.equal(punjab.kind, "inter"); assert.deepEqual(punjab.lines, [{ label: "IGST", rate: 18, minor: 71982 }]); assert.equal(punjab.posName, "Punjab");
  const odd = taxFor({ currency: "INR", gstMinor: 71983, gstRate: 18, customerState: null, lutArn: null });
  assert.equal(odd.posName, "Chandigarh"); assert.equal(odd.lines[0].minor + odd.lines[1].minor, 71983);
  const mh = taxFor({ currency: "INR", gstMinor: 100, gstRate: 18, customerState: "27", lutArn: null, supplier: "27" });
  assert.equal(mh.lines[1].label, "SGST");
  const exp = taxFor({ currency: "USD", gstMinor: 0, gstRate: 0, customerState: null, lutArn: "AD0412260012345" });
  assert.equal(exp.kind, "export"); assert.match(exp.note!, /under LUT without payment of IGST \(ARN AD0412260012345\)/);
  assert.match(taxFor({ currency: "USD", gstMinor: 0, gstRate: 0, customerState: null, lutArn: null }).note!, /LUT not on record/);
});

await t("numbers per financial year; amounts in words", () => {
  assert.equal(financialYear(new Date("2026-11-10T10:00:00Z")), "2026-27");
  assert.equal(financialYear(new Date("2027-03-31T17:00:00Z")), "2026-27");      // 31 Mar 22:30 IST
  assert.equal(financialYear(new Date("2027-03-31T19:00:00Z")), "2027-28");      // 1 Apr 00:30 IST
  assert.equal(invoiceNumber("FM", "2026-27", 7), "FM/2026-27/0007");
  assert.equal(amountInWords(471882, "INR"), "Rupees Four Thousand Seven Hundred Eighteen and Paise Eighty Two Only");
  assert.equal(amountInWords(2949882, "INR"), "Rupees Twenty Nine Thousand Four Hundred Ninety Eight and Paise Eighty Two Only");
  assert.equal(amountInWords(12345678900, "INR"), "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only");
  assert.equal(amountInWords(4900, "USD"), "US Dollars Forty Nine Only");
  assert.equal(money(471882, "INR"), "INR 4,718.82");
});

await t("tax invoice PDF renders with every required field", async () => {
  const pdf = await invoicePdf({ number: "FM/2026-27/0001", date: "10-11-2026", currency: "INR", taxableMinor: 399900, tax: taxFor({ currency: "INR", gstMinor: 71982, gstRate: 18, customerState: "03", lutArn: null }),
    sac: "998319", description: "TrueVisible Track — monthly subscription", period: "Period 10-11-2026 to 10-12-2026", customer: { name: "Acme Clinic Pvt Ltd", gstin: "03ABCDE1234F1Z5", email: "a@b.in" }, paymentRef: "pay_123" });
  assert.ok(pdf.length > 5000 && pdf.subarray(0, 4).toString() === "%PDF");
  if (process.env.SAVE_PDF) fs.writeFileSync(process.env.SAVE_PDF, pdf);
});
console.log(`\nDay 32: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

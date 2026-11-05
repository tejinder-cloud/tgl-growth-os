// Day 24 — monthly review: built from stored answers, one-page PDF, email with the PDF attached.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildMonthly, previousMonth, type AnswerRow } from "./agents/aeo-reports/build.js";
import { monthlyPdf } from "./agents/aeo-reports/pdf.js";
import { monthlyEmail } from "./agents/aeo-reports/email.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; }
}
const a = (o: Partial<AnswerRow>): AnswerRow => ({ prompt_id: "p1", prompt_text: "Best AEO agency in India", engine: "chatgpt", date: "2026-11-03", mentioned: false, competitors: [], created_at: "2026-11-03T01:00:00Z", ...o });

async function main() {
await t("previous month boundaries", () => {
  assert.deepEqual(previousMonth("2026-12-01"), { month: "2026-11", start: "2026-11-01", end: "2026-11-30", prevStart: "2026-10-01", prevEnd: "2026-10-31" });
  assert.deepEqual(previousMonth("2027-01-01"), { month: "2026-12", start: "2026-12-01", end: "2026-12-31", prevStart: "2026-11-01", prevEnd: "2026-11-30" });
});

const rows = [
  a({ date: "2026-11-03", mentioned: true }), a({ date: "2026-11-10", mentioned: true }), a({ engine: "gemini", date: "2026-11-10", mentioned: false }),
  a({ prompt_id: "p2", prompt_text: "AEO cost India", date: "2026-11-03", mentioned: false, competitors: ["Wevia"] }),
  a({ prompt_id: "p3", prompt_text: "Is The Growth Lab good?", date: "2026-11-03", mentioned: true }),
];
const prev = [a({ date: "2026-10-20", mentioned: false }), a({ prompt_id: "p2", prompt_text: "AEO cost India", date: "2026-10-20", mentioned: true })];
const m = buildMonthly({ brand: "The Growth Lab", month: "2026-11", start: "2026-11-01", end: "2026-11-30", rows, prevRows: prev, isBranded: (x) => x.includes("Growth Lab"),
  competitorNames: ["Wevia"], sites: [{ domain: "justdial.com", answers: 4 }], recsDone: 2, openRecs: 6, plan: ["Add schema markup", "Publish an AEO page", "Get listed on Clutch", "Fourth"] });

await t("monthly: totals, week-by-week per engine, won/lost unbranded questions, plan of three", () => {
  assert.deepEqual(m.overall, { n: 3, of: 5 });
  assert.deepEqual(m.weeks, [{ start: "2026-11-02", engines: { chatgpt: 67, gemini: null } }, { start: "2026-11-09", engines: { chatgpt: 100, gemini: 0 } }]);
  assert.deepEqual(m.won, ["Best AEO agency in India"]);
  assert.deepEqual(m.lost, ["AEO cost India"]);
  assert.equal(m.plan.length, 3);
  assert.equal(m.recsDone, 2);
});

await t("one-page PDF renders with the brand's numbers", async () => {
  const pdf = await monthlyPdf(m, "thegrowthlab.co.in");
  assert.ok(pdf.subarray(0, 5).toString() === "%PDF-");
  assert.ok(pdf.length < 2_000_000);
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 1);
  if (process.env.WRITE_PDF) fs.writeFileSync(process.env.WRITE_PDF, pdf);
});

await t("monthly email points to the review and lists next month's plan", () => {
  const e = monthlyEmail(m, "https://app.x", "rep9");
  assert.equal(e.subject, "The Growth Lab · AI visibility review · November 2026");
  assert.ok(e.text.includes("named in 3 of 5 AI answers (+2 vs 1 of 2)"));
  assert.ok(e.text.includes("1. Add schema markup") && e.text.includes("https://app.x/dashboard/reports/rep9"));
});

console.log(`\nDay 24: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

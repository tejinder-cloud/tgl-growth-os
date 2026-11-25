// Offline checks for the one daily approval card (24 Nov 2026). No Slack, no Supabase.
import assert from "node:assert/strict";
import { buildDailyReviewSummary, type DailyRun } from "./agents/prospect-researcher/reports.js";
import { cardScopes } from "./agents/prospect-researcher/db.js";
import { buttonMetadata } from "./lib/post.js";
import type { ProspectRecord } from "./agents/prospect-researcher/types.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;

function row(company: string, fit: number, email: string, phone = "0987654321", city = "Mumbai"): ProspectRecord {
  return { company, website: `https://${company.replace(/\W/g, "").toLowerCase()}.example`, city, fit_score: fit, decision_maker: { name: "x", role: "Owner", email, phone }, fit_reasons: [] } as unknown as ProspectRecord;
}

async function main() {
  const runs: DailyRun[] = [
    { city: "Delhi NCR", category: "hospitals", rows: [row("Sama Hospital | Best in Delhi", 80, "info@sama.example", "", "Delhi NCR"), row("Care Clinic", 70, "", "0987654321", "Delhi NCR")] },
    { city: "Chandigarh Tricity", category: "cosmetic_dental", rows: [] },
    { city: "Mumbai", category: "ivf_fertility", rows: [row("Bloom IVF", 90, "hello@bloom.example")] },
  ];
  const s = buildDailyReviewSummary(runs, "Wed 25 Nov");
  assert.equal(s.total, 3);
  assert.equal(s.title, "New businesses to approve, Wed 25 Nov");
  assert.match(s.summary, /\*3\* new businesses from 3 searches this morning\. \*2\* can be emailed; the other 1 wait for WhatsApp\./);
  assert.match(s.summary, /- Delhi NCR, hospital: \*2\* \(1 with an email, 1 phone only\)/);
  assert.match(s.summary, /- Chandigarh Tricity, dental clinic: \*0\*\n/);
  assert.ok(s.summary.indexOf("Bloom IVF") < s.summary.indexOf("Sama Hospital"), "highest fit first, across searches");
  assert.ok(s.summary.includes("|Sama Hospital>*") && !s.summary.includes("Best in Delhi"), "listing titles cleaned");
  assert.match(s.summary, /Approve sends every business on this card into outreach\. Reject removes them all\./);
  assert.ok(!EMOJI.test(s.summary), "no emojis");

  const none = buildDailyReviewSummary([{ city: "Pune", category: "hotels", rows: [] }], "Wed 25 Nov");
  assert.equal(none.total, 0);
  assert.match(none.summary, /No new businesses met the bar today in Pune \(hotel\)\. Nothing to approve\./);

  // Approve and Reject act on every search on the card; a card that lost its scope changes nothing.
  assert.deepEqual(cardScopes({ pairs: [{ city: "Delhi NCR", category: "hospitals" }, { city: "Mumbai", category: "ivf_fertility" }] }), [{ city: "Delhi NCR", category: "hospitals" }, { city: "Mumbai", category: "ivf_fertility" }]);
  assert.deepEqual(cardScopes({ city: "Pune", category: "hotels" }), [{ city: "Pune", category: "hotels" }], "older per-run cards still work");
  assert.deepEqual(cardScopes({}), [], "no scope: nothing approved");
  assert.deepEqual(cardScopes({ pairs: [{ city: "", category: "x" }, null] }), []);

  // A very long card keeps its scope in the button value.
  const meta = JSON.parse(buttonMetadata({ agent: "prospect-researcher", door: "aeo", title: "t".repeat(3000), summary: "s".repeat(5000), channel: "#revenue", pairs: [{ city: "Mumbai", category: "ivf_fertility" }] }));
  assert.deepEqual(meta.pairs, [{ city: "Mumbai", category: "ivf_fertility" }]);
  console.log("test-daily-card: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });

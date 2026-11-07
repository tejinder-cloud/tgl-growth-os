// Day 23 — reports: daily digest + weekly trend from stored answers; emails in the TrueVisible voice.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { buildDaily, buildWeekly, dailyHasNews, dedupe, type AnswerRow } from "./agents/aeo-reports/build.js";
import { dailyEmail, weeklyEmail } from "./agents/aeo-reports/email.js";
import { previousWeek, sendEmail } from "./agents/aeo-reports/worker.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; }
}
const a = (o: Partial<AnswerRow>): AnswerRow => ({ prompt_id: "p1", prompt_text: "Best AEO agency in India", engine: "chatgpt", date: "2026-11-05", mentioned: false, competitors: [], created_at: "2026-11-05T01:00:00Z", ...o });

async function main() {
const today = [
  a({ mentioned: false, created_at: "2026-11-05T00:30:00Z" }), a({ mentioned: true, created_at: "2026-11-05T08:00:00Z" }),   // daily + audit → later wins
  a({ prompt_id: "p2", prompt_text: "Is The Growth Lab good?", mentioned: true }),
  a({ prompt_id: "p3", prompt_text: "New <question> & co", engine: "gemini", competitors: ["Wevia"] }),                     // not asked yesterday
  a({ prompt_id: "p4", prompt_text: "AEO cost India", engine: "perplexity", mentioned: false, competitors: ["Wevia"] }),
];
const prev = [
  a({ date: "2026-11-04", mentioned: false }), a({ prompt_id: "p2", prompt_text: "Is The Growth Lab good?", date: "2026-11-04", mentioned: true }),
  a({ prompt_id: "p4", prompt_text: "AEO cost India", engine: "perplexity", date: "2026-11-04", mentioned: true }),
];
const d = buildDaily({ brand: "The Growth Lab", date: "2026-11-05", today, prev, prevDate: "2026-11-04", competitorNames: ["Wevia", "Dovetail Solutions"],
  sitesToday: ["justdial.com", "new.example", "aa.example", "new.example"], sitesBefore: ["justdial.com"], openRecs: 8, topRec: "Add schema markup" });

await t("daily: one answer per question × engine × day; gained/lost only for questions asked both days", () => {
  assert.equal(dedupe(today).length, 4);
  assert.deepEqual(d.overall, { n: 2, of: 4 });
  assert.deepEqual(d.prevOverall, { n: 2, of: 3 });
  assert.deepEqual(d.gained, [{ prompt: "Best AEO agency in India", engine: "chatgpt" }]);
  assert.deepEqual(d.lost, [{ prompt: "AEO cost India", engine: "perplexity" }]);
  assert.equal(d.comparedPairs, 3);
  assert.deepEqual(d.competitors, [{ name: "Wevia", today: 2, prev: 0 }]);
  assert.deepEqual(d.newSites, ["new.example", "aa.example"]);   // most-cited first, not alphabetical
  assert.equal(dailyHasNews(d), true);
  const quiet = buildDaily({ brand: "X", date: "2026-11-05", today: prev.map((r) => ({ ...r, date: "2026-11-05" })), prev, prevDate: "2026-11-04", competitorNames: [], sitesToday: [], sitesBefore: [], openRecs: 0, topRec: null });
  assert.equal(dailyHasNews(quiet), false);   // nothing changed → stored, not emailed
});

await t("daily email: counts from the report, escaped, one next step, signed by the team, settings link", () => {
  const e = dailyEmail(d, "https://app.truevisible.example");
  assert.equal(e.subject, "The Growth Lab: named in 2 of 4 AI answers · 5 Nov");
  assert.ok(e.text.includes("named The Growth Lab in 2 of 4 answers (same as before)"));
  assert.ok(e.text.includes("• “Best AEO agency in India” — ChatGPT"));
  assert.ok(e.text.includes("Add schema markup — one of 8 recommendations"));
  assert.ok(e.text.includes("• Wevia: named in 2 answers (was 0)"));
  const one = dailyEmail({ ...d, competitors: [{ name: "Dovetail Solutions", today: 1, prev: 0 }] }, "https://x");
  assert.ok(one.text.includes("named in 1 answer (was 0)"));
  assert.ok(e.text.includes("— your TrueVisible team") && e.text.includes("/dashboard/settings"));
  assert.ok(e.html.includes("New &lt;question&gt; &amp; co") === false);   // p3 wasn't asked yesterday, so it isn't listed
  assert.ok(!e.html.includes("<question>"));
});

await t("weekly: totals vs previous week, unbranded split, never-named list, competitors vs you", () => {
  const week = [
    a({ date: "2026-10-27", mentioned: true }), a({ date: "2026-10-28", mentioned: false }),
    a({ prompt_id: "p2", prompt_text: "Is The Growth Lab good?", date: "2026-10-27", mentioned: true }),
    a({ prompt_id: "p4", prompt_text: "AEO cost India", date: "2026-10-27", competitors: ["Wevia"] }),
  ];
  const w = buildWeekly({ brand: "The Growth Lab", start: "2026-10-27", end: "2026-11-02", week, prevWeek: [a({ date: "2026-10-20" })], isBranded: (t) => t.includes("Growth Lab"),
    competitorNames: ["Wevia"], sites: [{ domain: "a.com", answers: 2 }, { domain: "b.com", answers: 5 }], recsDone: 1, openRecs: 7, topRec: "Add schema markup" });
  assert.deepEqual(w.overall, { n: 2, of: 4 }); assert.deepEqual(w.prevOverall, { n: 0, of: 1 });
  assert.deepEqual(w.unbranded, { n: 1, of: 3 });
  assert.deepEqual(w.strongest, [{ prompt: "Best AEO agency in India", named: 1, of: 2 }]);
  assert.deepEqual(w.neverNamed, ["AEO cost India"]);
  assert.deepEqual(w.competitors, [{ name: "Wevia", answers: 1 }]);
  assert.equal(w.topSites[0].domain, "b.com");
  const e = weeklyEmail(w, "https://app.x");
  assert.ok(e.text.includes("named in 2 of 4 AI answers (+2 vs 0 of 1)"));
  assert.ok(e.text.includes("You completed 1 recommendation this week."));
});

await t("weekly report covers the 7 days ending today (Monday's weekly run included)", () => {
  assert.deepEqual(previousWeek("2026-11-09"), { start: "2026-11-03", end: "2026-11-09" });
});

await t("Resend: needs key + from; posts subject/html/text to recipients", async () => {
  delete process.env.RESEND_API_KEY;
  assert.match(String(await sendEmail(["x@y.z"], { subject: "s", text: "t", html: "h" })), /not set/);
  process.env.RESEND_API_KEY = "k"; process.env.REPORTS_FROM = "TrueVisible <reports@mail.example>";
  let body: any;
  const err = await sendEmail(["x@y.z"], { subject: "s", text: "t", html: "h" }, (async (_u: any, init: any) => { body = JSON.parse(init.body); return new Response("{}", { status: 200 }); }) as any);
  assert.equal(err, null); assert.deepEqual(body.to, ["x@y.z"]); assert.equal(body.from, "TrueVisible <reports@mail.example>");
});

console.log(`\nDay 23: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

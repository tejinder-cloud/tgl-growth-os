// Day 26 — tiers, cadence and the 7-day trial (Architect decision 7 Nov 2026).
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { cadenceFor, dueToday, startTrialClock } from "./agents/aeo-audit-engine/cadence.js";
import { buildBaseline, type AnswerRow } from "./agents/aeo-reports/build.js";
import { baselineEmail } from "./agents/aeo-reports/email.js";
import { shouldGenerate } from "./agents/aeo-recommender/worker.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }
const sub = (o: object) => ({ tenant_id: "t", plan: "trial", status: "trialing", trial_started_at: null, trial_ends_at: null, ...o });

async function main() {
const now = Date.parse("2026-11-10T06:00:00+05:30");
await t("cadence by plan: internal daily; trial daily only inside its 7 days; paid weekly; else none", () => {
  assert.equal(cadenceFor(sub({ plan: "internal", status: "active" }), now), "daily");
  assert.equal(cadenceFor(sub({}), now), "none");                                         // trial not started: first audit only
  assert.equal(cadenceFor(sub({ trial_started_at: "2026-11-08T10:00:00Z", trial_ends_at: "2026-11-15T10:00:00Z" }), now), "daily");
  assert.equal(cadenceFor(sub({ trial_started_at: "2026-11-01T10:00:00Z", trial_ends_at: "2026-11-08T10:00:00Z" }), now), "none");
  for (const plan of ["track", "managed", "managed_plus"]) assert.equal(cadenceFor(sub({ plan, status: "active" }), now), "weekly");
  assert.equal(cadenceFor(sub({ plan: "track", status: "cancelled" }), now), "none");
  assert.equal(cadenceFor(null, now), "none");
});

await t("weekly plans run on Mondays, on the 1st (deep run), or when a week was missed", () => {
  assert.deepEqual(dueToday("weekly", "2026-11-09", "2026-11-02"), { run: true, deep: false });   // Monday
  assert.deepEqual(dueToday("weekly", "2026-11-10", "2026-11-09"), { run: false, deep: false });  // Tuesday
  assert.deepEqual(dueToday("weekly", "2026-12-01", "2026-11-30"), { run: true, deep: true });    // 1st: deep run
  assert.deepEqual(dueToday("weekly", "2026-11-12", null), { run: true, deep: false });           // new subscriber
  assert.deepEqual(dueToday("weekly", "2026-11-12", "2026-11-02"), { run: true, deep: false });   // missed a Monday
  assert.deepEqual(dueToday("daily", "2026-11-10", "2026-11-09"), { run: true, deep: false });
  assert.deepEqual(dueToday("none", "2026-11-09", null), { run: false, deep: false });
});

await t("trial clock: starts once, at the first completed run after verification, for 7 days", async () => {
  let update: any = null; const filters: any[] = [];
  const chain: any = { eq: (k: string, v: any) => { filters.push([k, v]); return chain; }, is: (k: string, v: any) => { filters.push([k, v]); return chain; }, select: async () => ({ data: [{ tenant_id: "t1" }] }) };
  const sb: any = { from: (tbl: string) => tbl === "brands"
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { tenant_id: "t1", setup_status: "verified" } }) }) }) }
    : { update: (u: any) => { update = u; return chain; } } };
  assert.equal(await startTrialClock(sb, "b1", new Date("2026-11-08T10:00:00Z")), true);
  assert.equal(update.trial_ends_at, "2026-11-15T10:00:00.000Z");
  assert.ok(filters.some(([k, v]) => k === "trial_started_at" && v === null));   // never restarts a started trial
  const unverified: any = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { tenant_id: "t1", setup_status: "pending_verification" } }) }) }) }) };
  assert.equal(await startTrialClock(unverified, "b1"), false);
});

await t("recommendations run per completed run, skip if run already has recommendations", () => {
  const base = { verified: true, latestRunId: "r2", batchForRun: false, lastBatchAt: "2026-11-28T00:00:00Z", now: Date.parse("2026-12-01T01:00:00Z") };
  assert.equal(shouldGenerate(base).go, true);
  assert.equal(shouldGenerate({ ...base, batchForRun: true }).go, false);
});

await t("day-7 baseline: answers read, named in N, no trend claim, three fixes, two ways forward", () => {
  const a = (o: Partial<AnswerRow>): AnswerRow => ({ prompt_id: "p1", prompt_text: "Best AEO agency in India", engine: "chatgpt", date: "2026-11-09", mentioned: false, competitors: [], created_at: "2026-11-09T01:00:00Z", ...o });
  const rows = [a({}), a({ engine: "gemini", competitors: ["Wevia"] }), a({ prompt_id: "p2", prompt_text: "Is The Growth Lab good?", mentioned: true }), a({ date: "2026-11-10" })];
  const b = buildBaseline({ brand: "The Growth Lab", start: "2026-11-08", end: "2026-11-15", rows, isBranded: (x) => x.includes("Growth Lab"), competitorNames: ["Wevia"],
    sites: [{ domain: "justdial.com", answers: 3 }], fixes: ["Add schema markup", "Get listed on Clutch", "Publish an AEO page", "Fourth"] });
  assert.deepEqual(b.overall, { n: 1, of: 4 }); assert.equal(b.questions, 2); assert.deepEqual(b.unbranded, { n: 0, of: 3 }); assert.equal(b.fixes.length, 3);
  const e = baselineEmail(b, "https://app.x", "rep1", "https://thegrowthlab.co.in/aeo?utm_source=truevisible");
  assert.equal(e.subject, "The Growth Lab: your 7-day AI visibility baseline");
  assert.ok(e.text.includes("we read 4 answers from ChatGPT, Gemini and Perplexity to your 2 questions. They named The Growth Lab in 1."));
  assert.ok(e.text.includes("too short to call a trend"));
  assert.ok(e.text.includes("1. Add schema markup") && !e.text.includes("Fourth"));
  assert.ok(e.text.includes("Keep watching — Track: https://app.x/dashboard/upgrade") && e.text.includes("Have it done — Managed: https://thegrowthlab.co.in/aeo"));
});

console.log(`\nDay 26: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

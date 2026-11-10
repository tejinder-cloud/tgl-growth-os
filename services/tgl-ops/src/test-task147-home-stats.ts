// Task 147 item 5: Home page Client Zero figures. Fixture source only; no network, no Slack, no decisions/ or logs/ writes.
import assert from "node:assert/strict";
import { computeHomeStats, type HomeStatsSource } from "./agents/aeo-audit-engine/home-stats.js";
import { sanitiseHomeStats } from "./routes/home-stats.js";

function source(opts: { brand?: string | null; prompts?: number; runs?: Array<{ id: string; run_date: string; engine: string }>; answers?: Record<string, { total: number; named: number }> }): HomeStatsSource & { calls: number } {
  const o = { brand: "b1", prompts: 16, runs: [], answers: {}, ...opts };
  const s = {
    calls: 0,
    async tglBrandId() { return o.brand ?? null; },
    async activePromptCount() { return o.prompts; },
    async dailyRuns() { return o.runs; },
    async answerCounts(ids: string[]) {
      s.calls++;
      return ids.reduce((acc, id) => { const a = o.answers[id] ?? { total: 0, named: 0 }; return { total: acc.total + a.total, named: acc.named + a.named }; }, { total: 0, named: 0 });
    },
  };
  return s;
}
const E = ["chatgpt", "gemini", "perplexity"];
const day = (d: string, perEngine: { total: number; named: number } | null) => ({
  runs: E.map((e) => ({ id: `${d}-${e}`, run_date: d, engine: e })),
  answers: Object.fromEntries(E.map((e) => [`${d}-${e}`, perEngine ?? { total: 0, named: 0 }])),
});

let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log("ok -", name); };

async function main(): Promise<void> {
  await t("days with runs but no stored answers are skipped; first and latest come from days with answers", async () => {
    const d1 = day("2026-11-02", null), d2 = day("2026-11-04", { total: 10, named: 2 }), d3 = day("2026-11-10", { total: 16, named: 2 });
    const src = source({ runs: [...d1.runs, ...d2.runs, ...d3.runs], answers: { ...d1.answers, ...d2.answers, ...d3.answers } });
    const s = await computeHomeStats(src);
    assert.deepEqual(s, { questions_tracked: 16, engines_checked: 3, times_named_latest: 6, first_run_figure: 6, first_run_date: "2026-11-04", last_run_date: "2026-11-10" });
    assert.ok(sanitiseHomeStats(s), "passes the route's sanitiser");
    assert.equal(src.calls, 3, "one count per day visited, not per run");
  });
  await t("a single day with answers is both first and latest", async () => {
    const d = day("2026-11-04", { total: 10, named: 1 });
    const s = await computeHomeStats(source({ runs: d.runs, answers: d.answers }));
    assert.equal(s?.first_run_date, "2026-11-04"); assert.equal(s?.last_run_date, "2026-11-04"); assert.equal(s?.first_run_figure, 3); assert.equal(s?.times_named_latest, 3);
  });
  await t("engines_checked counts engines on the latest day only", async () => {
    const d1 = day("2026-11-04", { total: 10, named: 0 });
    const d2 = { runs: [{ id: "x", run_date: "2026-11-10", engine: "gemini" }], answers: { x: { total: 16, named: 4 } } };
    const s = await computeHomeStats(source({ runs: [...d1.runs, ...d2.runs], answers: { ...d1.answers, ...d2.answers } }));
    assert.equal(s?.engines_checked, 1); assert.equal(s?.times_named_latest, 4); assert.equal(s?.first_run_figure, 0);
  });
  await t("no brand, no runs, or no answers anywhere: null, so the route answers 503 and tiles keep the dash", async () => {
    assert.equal(await computeHomeStats(source({ brand: null })), null);
    assert.equal(await computeHomeStats(source({ runs: [] })), null);
    const d = day("2026-11-02", null);
    assert.equal(await computeHomeStats(source({ runs: d.runs, answers: d.answers })), null);
  });
  await t("only the six public keys reach the response", async () => {
    const d = day("2026-11-04", { total: 10, named: 1 });
    const s = (await computeHomeStats(source({ runs: d.runs, answers: d.answers })))!;
    assert.deepEqual(Object.keys(sanitiseHomeStats({ ...s, email: "x@y", token: "t" })!).sort(), ["engines_checked", "first_run_date", "first_run_figure", "last_run_date", "questions_tracked", "times_named_latest"]);
  });
  console.log(`\nTask 147 home stats: ${passed} tests passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

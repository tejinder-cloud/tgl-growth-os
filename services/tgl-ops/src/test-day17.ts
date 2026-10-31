// services/tgl-ops/src/test-day17.ts — Citation Tracker (plan Day 17). Fixtures only: no network, no database.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { parseOpenAI, parseGemini, parsePerplexity, computeCostUsd, loadEngineConfig } from "./agents/aeo-audit-engine/engines.js";
import { analyzeAnswer, analyzeCitation, firstIndexOf } from "./agents/aeo-audit-engine/analyze.js";
import { runTracker, summaryLine } from "./agents/aeo-audit-engine/tracker.js";
import type { TrackerStore, TrackedBrand } from "./agents/aeo-audit-engine/store.js";
import type { BrandLens } from "./agents/aeo-audit-engine/types.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

const lens: BrandLens = {
  name: "The Growth Lab",
  variants: ["Growth Lab", "TGL"],
  domains: ["thegrowthlab.co.in"],
  competitors: [{ name: "Digital Pundit", domain: "digitalpundit.in" }, { name: "Brandingo", domain: null }],
};

// ── provider fixtures (shapes from each provider's documented response) ──
const openaiFx = {
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed" },
    { type: "message", content: [{ type: "output_text", text: "Top agencies in Chandigarh: Digital Pundit, then The Growth Lab (thegrowthlab.co.in).",
      annotations: [{ type: "url_citation", url: "https://www.thegrowthlab.co.in/coaching", title: "TGL" }, { type: "url_citation", url: "https://www.justdial.com/Chandigarh/x", title: "JD" }, { type: "url_citation", url: "https://www.justdial.com/Chandigarh/x", title: "dup" }] }] },
  ],
  usage: { input_tokens: 1200, output_tokens: 300 },
};
const geminiFx = {
  candidates: [{
    content: { parts: [{ text: "Brandingo and Digital Pundit are often recommended." }] },
    groundingMetadata: { webSearchQueries: ["agency chandigarh", "coaching marketing"], groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "reddit.com" } }] },
  }],
  usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 200, thoughtsTokenCount: 100 },
};
// Perplexity Agent API (POST /v1/agent) — shape from docs.perplexity.ai quickstart, 31 Oct 2026
const pplxFx = {
  model: "openai/gpt-5.6-sol",
  output: [
    { type: "search_results", queries: ["agency mohali"], results: [{ url: "https://ignored-unless-no-inline.example", title: "x" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Growth Lab works with coaching institutes in Mohali.", annotations: [{ type: "citation", url: "https://digitalpundit.in/about" }] }] },
  ],
  usage: { input_tokens: 3681, output_tokens: 780, cost: { currency: "USD", total_cost: 0.0061 }, tool_calls_details: { search_web: { invocation: 1 } } },
};

async function main() {
await t("OpenAI parser: text, deduped citations, search count, tokens", () => {
  const p = parseOpenAI(openaiFx);
  assert.match(p.text, /Digital Pundit/);
  assert.equal(p.citations.length, 2);
  assert.deepEqual(p.usage, { inputTokens: 1200, outputTokens: 300, searches: 1 });
});
await t("Gemini parser: thinking tokens billed as output, query count, redirect title kept as domain hint", () => {
  const p = parseGemini(geminiFx);
  assert.equal(p.usage.outputTokens, 300);
  assert.equal(p.usage.searches, 2);
  assert.equal(p.citations[0].domainHint, "reddit.com");
});
await t("Perplexity Agent API parser: inline citations first, provider-reported cost, search count", () => {
  const p = parsePerplexity(pplxFx);
  assert.deepEqual(p.citations.map((c) => c.url), ["https://digitalpundit.in/about"]);
  assert.equal(p.providerCostUsd, 0.0061);
  assert.equal(p.usage.searches, 1);
  const noInline = parsePerplexity({ ...pplxFx, output: [pplxFx.output[0], { type: "message", content: [{ type: "output_text", text: "x", annotations: [] }] }] });
  assert.equal(noInline.citations[0].url, "https://ignored-unless-no-inline.example");
});
await t("Perplexity config: needs an effort preset or a model, no price variables", () => {
  assert.deepEqual(loadEngineConfig("perplexity", { PERPLEXITY_API_KEY: "k" }).missing, ["AEO_PERPLEXITY_EFFORT"]);
  assert.equal(loadEngineConfig("perplexity", { PERPLEXITY_API_KEY: "k", AEO_PERPLEXITY_EFFORT: "fast" }).config?.model, "effort:fast");
});
await t("cost = tokens × price + searches × fee", () => {
  assert.equal(computeCostUsd({ priceInPerMTok: 1, priceOutPerMTok: 4, searchPricePer1k: 10 }, { inputTokens: 1_000_000, outputTokens: 500_000, searches: 2 }), 3.02);
});
await t("engine config: reports every missing variable, never defaults a model or price", () => {
  const r = loadEngineConfig("chatgpt", { OPENAI_API_KEY: "k", AEO_OPENAI_MODEL: "m" });
  assert.equal(r.config, undefined);
  assert.deepEqual(r.missing, ["AEO_OPENAI_PRICE_IN", "AEO_OPENAI_PRICE_OUT", "AEO_OPENAI_SEARCH_PRICE_PER_1K"]);
  const ok = loadEngineConfig("gemini", { GOOGLE_AI_API_KEY: "k", AEO_GEMINI_MODEL: "g", AEO_GEMINI_PRICE_IN: "0.75", AEO_GEMINI_PRICE_OUT: "3.75", AEO_GEMINI_SEARCH_PRICE_PER_1K: "14" });
  assert.equal(ok.config?.model, "g");
});

await t("mention: brand, variants and domain count; position is order among tracked businesses", () => {
  const a = analyzeAnswer(parseOpenAI(openaiFx).text, lens);
  assert.equal(a.mentioned, true);
  assert.equal(a.position, 2);
  assert.deepEqual(a.competitorsMentioned, ["Digital Pundit"]);
  const b = analyzeAnswer("Brandingo and Digital Pundit are often recommended.", lens);
  assert.deepEqual(b, { mentioned: false, position: null, competitorsMentioned: ["Brandingo", "Digital Pundit"] });
});
await t("mention: no false positives inside other words; short names ignored", () => {
  assert.equal(firstIndexOf("The Growth Laboratory", ["Growth Lab"]), -1);
  assert.equal(firstIndexOf("TGLX and TGL", ["TGL"]), 9);
  assert.equal(firstIndexOf("GL is great", ["GL"]), -1); // names under 3 characters are too ambiguous to count
});
await t("citation: owned, directory, competitor domain, Gemini redirect resolved to domain", () => {
  assert.deepEqual(analyzeCitation({ url: "https://www.thegrowthlab.co.in/coaching" }, lens), { domain: "thegrowthlab.co.in", url: "https://www.thegrowthlab.co.in/coaching", channelType: "owned", brandMentioned: true, competitorsMentioned: [] });
  assert.equal(analyzeCitation({ url: "https://www.justdial.com/x" }, lens)?.channelType, "directory");
  assert.deepEqual(analyzeCitation({ url: "https://digitalpundit.in/about" }, lens)?.competitorsMentioned, ["Digital Pundit"]);
  const g = analyzeCitation({ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", domainHint: "reddit.com" }, lens);
  assert.equal(g?.domain, "reddit.com"); assert.equal(g?.channelType, "forum"); assert.equal(g?.url, null);
  assert.equal(analyzeCitation({ url: "https://some-blog.example/post" }, lens)?.channelType, null); // unknown stays unknown
});

// ── tracker end-to-end with an in-memory store and fake providers ──
function memoryStore(brand: TrackedBrand) {
  const db = { runs: [] as any[], answers: [] as any[], citations: [] as any[], usage: [] as any[] };
  const store: TrackerStore = {
    async loadEligibleBrands() { return [brand]; },
    async hasCompletedRun(id, date, engine) { return db.runs.some((r) => r.brand === id && r.date === date && r.engine === engine && ["succeeded", "partial"].includes(r.status)); },
    async startRun(b, date, engine) { const id = `run${db.runs.length + 1}`; db.runs.push({ id, brand: b.id, date, engine, status: "running" }); return id; },
    async saveAnswer(_b, runId, promptId, ans, a, cites) { db.answers.push({ runId, promptId, engine: ans.engine, ...a }); db.citations.push(...cites); },
    async finishRun(runId, status, error) { Object.assign(db.runs.find((r) => r.id === runId), { status, error }); },
    async recordUsageCost(_b, date, engine, row) { db.usage.push({ date, engine, ...row }); },
  };
  return { db, store };
}
const env = {
  OPENAI_API_KEY: "k", AEO_OPENAI_MODEL: "gpt-x", AEO_OPENAI_PRICE_IN: "1", AEO_OPENAI_PRICE_OUT: "4", AEO_OPENAI_SEARCH_PRICE_PER_1K: "10",
  PERPLEXITY_API_KEY: "k", AEO_PERPLEXITY_EFFORT: "fast",
  // Gemini deliberately not configured
};
let pplxCalls = 0;
const fakeFetch: typeof fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("openai")) assert.equal(JSON.parse(String(init?.body)).max_tool_calls, 1);
  if (u.includes("perplexity")) assert.deepEqual(JSON.parse(String(init?.body)), { input: JSON.parse(String(init?.body)).input, effort: "fast" });
  if (u.includes("openai")) return new Response(JSON.stringify(openaiFx), { status: 200 });
  if (u.includes("perplexity")) { pplxCalls++; return pplxCalls === 2 ? new Response("bad", { status: 400 }) : new Response(JSON.stringify(pplxFx), { status: 200 }); }
  return new Response("nope", { status: 404 });
};
const brand: TrackedBrand = { id: "b1", tenantId: "tgl", name: "The Growth Lab", country: "IN", city: "Chandigarh", lens,
  prompts: [{ id: "p1", text: "best agency chandigarh", language: "en" }, { id: "p2", text: "coaching marketing agency", language: "en" }] };

await t("tracker: stores answers + citations, partial on a failed prompt, one usage_costs row per engine, skips unconfigured engine", async () => {
  const { db, store } = memoryStore(brand);
  const s = await runTracker({ store, runDate: "2026-10-31", usdInr: 88, env, fetchImpl: fakeFetch });
  assert.deepEqual(s.notConfigured.map((n) => n.engine), ["gemini"]);
  const byEngine = Object.fromEntries(s.outcomes.map((o) => [o.engine, o]));
  assert.equal(byEngine.chatgpt.status, "succeeded"); assert.equal(byEngine.chatgpt.ok, 2); assert.equal(byEngine.chatgpt.mentioned, 2);
  assert.equal(byEngine.perplexity.status, "partial"); assert.equal(byEngine.perplexity.ok, 1); assert.match(byEngine.perplexity.note ?? "", /HTTP 400/);
  assert.equal(db.answers.length, 3);
  assert.equal(db.usage.length, 2);
  const oa = db.usage.find((u) => u.engine === "chatgpt");
  // 2 calls × (1200×1 + 300×4)/1e6 + 1 search × $10/1k = 2 × 0.0124
  assert.equal(Number(oa.usd.toFixed(4)), 0.0248);
  assert.equal(Number(oa.inr.toFixed(4)), Number((0.0248 * 88).toFixed(4)));
  assert.equal(db.usage.find((u) => u.engine === "perplexity").detail.cost_source, "provider");
  assert.match(summaryLine(s, "06:00"), /ChatGPT 2\/2, Perplexity 1\/2 · brand named in 3\/3 answers · engine spend \$0\.0309 · not configured: Gemini/);
  assert.doesNotMatch(summaryLine(s, "06:00"), /cost/i);

  // Second run the same day: completed engines are not paid for twice
  const again = await runTracker({ store, runDate: "2026-10-31", usdInr: 88, env, fetchImpl: fakeFetch });
  assert.ok(again.outcomes.every((o) => o.status === "skipped"));
  assert.equal(db.answers.length, 3);
});
await t("tracker: daily cost cap stops before any call", async () => {
  const { db, store } = memoryStore(brand);
  const s = await runTracker({ store, runDate: "2026-11-01", usdInr: 88, env, fetchImpl: fakeFetch, canSpend: async () => false });
  assert.equal(s.stoppedByCap, true); assert.equal(db.runs.length, 0);
});

console.log(`\nDay 17: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

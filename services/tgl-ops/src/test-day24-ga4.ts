process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "sec";
import assert from "node:assert/strict";
import { engineForSource, parseReport, syncBrand, SOURCE_REGEX } from "./agents/aeo-impact/ga4.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

async function main() {
await t("AI sources map to engines; everything else ignored", () => {
  assert.equal(engineForSource("chatgpt.com"), "chatgpt"); assert.equal(engineForSource("chat.openai.com"), "chatgpt");
  assert.equal(engineForSource("gemini.google.com"), "gemini"); assert.equal(engineForSource("www.perplexity.ai"), "perplexity");
  assert.equal(engineForSource("copilot.microsoft.com"), "copilot"); assert.equal(engineForSource("claude.ai"), "claude");
  assert.equal(engineForSource("google"), null); assert.equal(engineForSource("notchatgpt.com.evil"), null);
  assert.ok(new RegExp(SOURCE_REGEX, "i").test("chatgpt.com"));
});
await t("runReport rows → daily rows with dates and numbers", () => {
  const rows = parseReport({ rows: [
    { dimensionValues: [{ value: "20261104" }, { value: "chatgpt.com" }], metricValues: [{ value: "5" }, { value: "3" }, { value: "1" }] },
    { dimensionValues: [{ value: "20261104" }, { value: "google" }], metricValues: [{ value: "50" }, { value: "30" }, { value: "4" }] },
  ] });
  assert.deepEqual(rows, [{ date: "2026-11-04", source: "chatgpt.com", engine: "chatgpt", sessions: 5, engaged_sessions: 3, key_events: 1 }]);
});
await t("sync: refresh → runReport (90 days first time) → upsert; revoked token flagged", async () => {
  const calls: any[] = []; let upserted: any[] = [];
  const sb: any = {
    rpc: async () => ({ data: "rt" }),
    from: (_t: string) => ({ select: () => ({ eq: async () => ({ count: 0 }) }), upsert: async (rows: any[]) => { upserted = rows; return { error: null }; } }),
  };
  const f: any = async (url: string, init: any) => {
    calls.push({ url, body: init.body });
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
    return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: "20261104" }, { value: "perplexity.ai" }], metricValues: [{ value: "2" }, { value: "2" }, { value: "0" }] }] }), { status: 200 });
  };
  const n = await syncBrand(sb, { tenant_id: "tgl", brand_id: "b1", config: { property_id: "properties/123" } }, f);
  assert.equal(n, 1); assert.equal(upserted[0].engine, "perplexity"); assert.equal(upserted[0].tenant_id, "tgl");
  assert.ok(calls[1].url.endsWith("properties/123:runReport")); assert.equal(JSON.parse(calls[1].body).dateRanges[0].startDate, "90daysAgo");
  const bad: any = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  await assert.rejects(syncBrand(sb, { tenant_id: "tgl", brand_id: "b1", config: { property_id: "properties/123" } }, bad), (e: any) => e.revoked === true);
});
console.log(`\nDay 24 GA4: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

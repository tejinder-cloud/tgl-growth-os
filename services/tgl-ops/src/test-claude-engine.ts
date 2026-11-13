// services/tgl-ops/src/test-claude-engine.ts
// Claude as a fourth assistant in prospect audits (Architect, 12 Nov 2026). Fixture responses and a fake fetch:
// no network, no model call, no Slack, no email, no write to decisions/ or logs/ on main.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askEngine, loadEngineConfig, parseClaude } from "./agents/aeo-audit-engine/engines.js";
import { API_ENGINES, type EngineAnswer, type EngineId } from "./agents/aeo-audit-engine/types.js";
import { runShortFormAudit } from "./agents/aeo-audit-engine/short-form.js";
import { engineColumns, enginesLine, generateAuditPdf, renderAuditHtml } from "./agents/aeo-audit-engine/pdf.js";
import { buildProspectAuditPrompts, resetProspectAuditMemoryForTests, runProspectAudit, type ProspectAuditDeps } from "./agents/aeo-audit-engine/prospect-audit.js";
import { memoryProspectAuditStore } from "./agents/aeo-audit-engine/prospect-audit-store.js";
import { assistantsAsked, buildProspectAuditEmail } from "./agents/aeo-audit-engine/prospect-audit-review.js";

if (process.env.TGL_TEST_MODE !== "1") {
  console.error("test-claude-engine must run with TGL_TEST_MODE=1.");
  process.exit(1);
}

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`ok - ${name}`);
}

const BUSINESS = "Sunrise Dental";
const LENS = { name: BUSINESS, variants: [BUSINESS], domains: ["sunrisedental.in"], competitors: [] };
const PROMPTS = buildProspectAuditPrompts("dental clinic", "Mohali");
const OTHERS = "1. **Clove Dental**: chain.\n2. **Apollo White Dental**: chain.";
const WITH_US = "1. **Clove Dental**: chain.\n2. **Sunrise Dental**: single clinic.";
function answer(engine: EngineId, text: string, costUsd = 0.01): EngineAnswer {
  return { engine, model: "fixture-model", text, citations: [], usage: {} as any, costUsd, costSource: "computed", raw: null } as EngineAnswer;
}
/** Claude names the prospect; the other three do not. */
const four = async (engine: EngineId): Promise<EngineAnswer> => answer(engine, engine === "claude" ? WITH_US : OTHERS);

// A Messages API response with web search, in the documented shape.
const CLAUDE_RESPONSE = {
  model: "claude-fixture-1",
  stop_reason: "end_turn",
  content: [
    { type: "text", text: "I'll look that up." },
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "best dental clinic in Mohali" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [
      { type: "web_search_result", url: "https://www.practo.com/mohali/dentist", title: "Dentists in Mohali" },
      { type: "web_search_result", url: "https://www.justdial.com/Mohali/Dentists", title: "Justdial" },
    ] },
    { type: "text", text: " Well-reviewed options include **Clove Dental**" },
    { type: "text", text: " and **Sunrise Dental**.", citations: [{ type: "web_search_result_location", url: "https://www.practo.com/mohali/dentist", title: "Dentists in Mohali", cited_text: "..." }] },
  ],
  usage: { input_tokens: 9000, output_tokens: 400, server_tool_use: { web_search_requests: 1 } },
};

async function main(): Promise<void> {
  // ---- configuration ----
  {
    const base = { ANTHROPIC_API_KEY: "sk-fixture", ANTHROPIC_MODEL: "claude-service-model", ANTHROPIC_PRICE_IN: "3", ANTHROPIC_PRICE_OUT: "15" } as any;
    const noSearchPrice = loadEngineConfig("claude", base);
    assert.equal(noSearchPrice.config, undefined);
    assert.deepEqual(noSearchPrice.missing, ["AEO_CLAUDE_SEARCH_PRICE_PER_1K"], "the search price is never guessed");
    const cfg = loadEngineConfig("claude", { ...base, AEO_CLAUDE_SEARCH_PRICE_PER_1K: "10" }).config!;
    assert.deepEqual({ engine: cfg.engine, model: cfg.model, in: cfg.priceInPerMTok, out: cfg.priceOutPerMTok, search: cfg.searchPricePer1k, url: cfg.baseUrl }, { engine: "claude", model: "claude-service-model", in: 3, out: 15, search: 10, url: "https://api.anthropic.com/v1/messages" });
    const own = loadEngineConfig("claude", { ...base, AEO_CLAUDE_SEARCH_PRICE_PER_1K: "10", AEO_CLAUDE_MODEL: "claude-other", AEO_CLAUDE_PRICE_IN: "1", AEO_CLAUDE_PRICE_OUT: "5" }).config!;
    assert.deepEqual([own.model, own.priceInPerMTok, own.priceOutPerMTok], ["claude-other", 1, 5]);
    assert.ok(loadEngineConfig("claude", { AEO_CLAUDE_SEARCH_PRICE_PER_1K: "10" } as any).missing.includes("ANTHROPIC_API_KEY"));
    assert.deepEqual(API_ENGINES, ["chatgpt", "gemini", "perplexity"], "the daily tracker still asks three engines");
    ok("config: model and token prices default to the service's own, the search price must be set, the tracker is untouched");
  }

  // ---- reading a response ----
  {
    const p = parseClaude(CLAUDE_RESPONSE);
    assert.equal(p.text, "I'll look that up. Well-reviewed options include **Clove Dental** and **Sunrise Dental**.");
    assert.deepEqual(p.citations, [{ url: "https://www.practo.com/mohali/dentist", title: "Dentists in Mohali" }], "inline citations win over the raw search results");
    assert.deepEqual(p.usage, { inputTokens: 9000, outputTokens: 400, searches: 1 });
    const uncited = parseClaude({ ...CLAUDE_RESPONSE, content: CLAUDE_RESPONSE.content.map((b: any) => ({ ...b, citations: undefined })), usage: { input_tokens: 10, output_tokens: 5 } });
    assert.equal(uncited.citations.length, 2, "with no inline citation the pages it read are kept");
    assert.equal(uncited.usage.searches, 1, "with no provider count, the search calls seen are counted");
    assert.deepEqual(parseClaude({}).usage, { inputTokens: 0, outputTokens: 0, searches: 0 });
    ok("parse: answer text joined, citations read, searches counted so spend is not understated");

    const calls: any[] = [];
    const cfg = loadEngineConfig("claude", { ANTHROPIC_API_KEY: "sk-fixture", ANTHROPIC_MODEL: "claude-service-model", ANTHROPIC_PRICE_IN: "3", ANTHROPIC_PRICE_OUT: "15", AEO_CLAUDE_SEARCH_PRICE_PER_1K: "10" } as any).config!;
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => JSON.stringify(CLAUDE_RESPONSE) };
    }) as unknown as typeof fetch;
    const a = await askEngine(cfg, "best dental clinic in Mohali", { fetchImpl, country: "IN" });
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].headers["x-api-key"], "sk-fixture");
    assert.equal(calls[0].headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "best dental clinic in Mohali" }], "the question is asked exactly as written, with no instruction added");
    assert.equal(calls[0].body.system, undefined);
    assert.deepEqual(calls[0].body.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 1, user_location: { type: "approximate", country: "IN" } }]);
    assert.equal(a.engine, "claude");
    assert.equal(a.model, "claude-fixture-1");
    // 9000 in at 3/M + 400 out at 15/M + 1 search at 10/1000 = 0.027 + 0.006 + 0.01
    assert.equal(a.costUsd, 0.043);
    const empty = (async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [], stop_reason: "max_tokens" }) })) as unknown as typeof fetch;
    await assert.rejects(() => askEngine(cfg, "q", { fetchImpl: empty }), /no answer text.*max_tokens/);
    ok("ask: Messages API with web search, one search, question unaltered, cost from tokens and the search");
  }

  // ---- a four-engine audit ----
  {
    const r = await runShortFormAudit(LENS, { prospect: { name: BUSINESS, website: "sunrisedental.in" }, prompts: PROMPTS, engines: [...API_ENGINES, "claude"], optionalEngines: ["claude"], engineMock: four, saveRawJson: false });
    assert.deepEqual(r.engines, ["chatgpt", "gemini", "perplexity", "claude"]);
    assert.equal(r.enginesCount, 4);
    assert.equal(r.totalQueries, 20);
    assert.deepEqual(r.summary.mentionsByEngine, { chatgpt: 0, gemini: 0, perplexity: 0, claude: 5 });
    assert.equal(r.summary.totalMentions, 5);
    assert.equal(r.summary.visibilityScorePercent, 25);
    assert.equal(r.results[0].engineResults.claude.badge, "Named #2");
    assert.equal(r.skippedEngines, undefined);
    assert.ok(r.nextSteps.formattedText.includes("ChatGPT, Gemini and Perplexity did not name Sunrise Dental"));
    assert.deepEqual(engineColumns(r), { engines: ["chatgpt", "gemini", "perplexity", "claude"], firstX: 318, width: 58 });
    assert.equal(enginesLine(r), "ChatGPT, Gemini, Perplexity, Claude");
    const html = renderAuditHtml(r);
    assert.ok(html.includes('<th class="engine-col">Claude</th>'));
    assert.equal((html.match(/<td class="engine-col">/g) || []).length, 20, "five rows of four cells");
    const pdf = await generateAuditPdf(r);
    assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
    ok("four engines: 20 answers, Claude has its own column and counts, the PDF lays out four columns");

    const three = await runShortFormAudit(LENS, { prospect: { name: BUSINESS, website: "sunrisedental.in" }, prompts: PROMPTS, engineMock: four, saveRawJson: false });
    assert.deepEqual(three.engines, ["chatgpt", "gemini", "perplexity"]);
    assert.equal(three.totalQueries, 15);
    assert.deepEqual(engineColumns(three), { engines: ["chatgpt", "gemini", "perplexity"], firstX: 340, width: 70 }, "the three-engine layout is exactly as before");
    assert.equal(enginesLine(three), "Perplexity, Gemini, ChatGPT");
    assert.ok(!renderAuditHtml(three).includes("Claude"));
    ok("three engines: nothing about the existing audit or its PDF changes");
  }

  // ---- Claude cannot be asked: the audit goes on without it ----
  {
    for (const failAt of [1, 3]) {
      let n = 0;
      const flaky = async (engine: EngineId): Promise<EngineAnswer> => {
        if (engine === "claude" && ++n >= failAt) throw new Error("HTTP 529: overloaded");
        return answer(engine, engine === "claude" ? WITH_US : OTHERS);
      };
      const r = await runShortFormAudit(LENS, { prospect: { name: BUSINESS, website: "sunrisedental.in" }, prompts: PROMPTS, engines: [...API_ENGINES, "claude"], optionalEngines: ["claude"], engineMock: flaky, saveRawJson: false });
      assert.deepEqual(r.engines, ["chatgpt", "gemini", "perplexity"], `failing at question ${failAt}`);
      assert.equal(r.totalQueries, 15);
      assert.deepEqual(r.summary.mentionsByEngine, { chatgpt: 0, gemini: 0, perplexity: 0 });
      assert.equal(r.summary.totalMentions, 0, "Claude's earlier answers do not count once it is dropped");
      assert.ok(r.results.every((x) => !("claude" in x.engineResults)));
      assert.deepEqual(r.skippedEngines, [{ engine: "claude", reason: "HTTP 529: overloaded" }]);
      assert.equal(n, failAt, "it is not asked again after failing");
      // 15 answers at 0.01, plus what Claude answered before failing.
      assert.equal(r.summary.totalCostUsd, Number((0.15 + 0.01 * (failAt - 1)).toFixed(4)), "what it cost before failing stays in the total");
      assert.equal(engineColumns(r).engines.length, 3);
    }
    ok("optional engine fails (first question or mid-way): dropped entirely, counts retaken, its spend kept, not asked again");

    const broken = async (engine: EngineId): Promise<EngineAnswer> => {
      if (engine === "gemini") throw new Error("HTTP 500");
      return answer(engine, OTHERS);
    };
    await assert.rejects(() => runShortFormAudit(LENS, { prospect: { name: BUSINESS, website: "sunrisedental.in" }, prompts: PROMPTS, engines: [...API_ENGINES, "claude"], optionalEngines: ["claude"], engineMock: broken, saveRawJson: false }), /HTTP 500/);
    ok("a core engine failing still stops the audit: three assistants is the floor");
  }

  // ---- through the prospect-audit runner ----
  {
    const make = (extra: EngineId[]) => {
      resetProspectAuditMemoryForTests();
      const store = memoryProspectAuditStore();
      const reviews: any[] = [];
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-engine-"));
      const deps: Partial<ProspectAuditDeps> = {
        store,
        renderPdf: async (result, outFile) => generateAuditPdf(result, path.join(tmp, path.basename(outFile))),
        readPdf: (file) => fs.readFileSync(path.join(tmp, path.basename(file))),
        postFile: async () => ({ ok: true, fileId: "F-1" }),
        postLine: async () => ({ ok: true }),
        postReview: async (o) => {
          reviews.push(o);
          return { ok: true, ts: "1700000000.000300", channelId: "C_REVENUE" };
        },
        getSpendUsd: async () => 0,
        getCapUsd: async () => 3,
        recordSpend: () => undefined,
        now: () => new Date("2026-11-12T12:00:00.000Z"),
        writeBrief: null,
        checkNames: null,
        extraEngines: () => extra,
      };
      return { deps, store, reviews };
    };
    const req = { businessName: BUSINESS, website: "sunrisedental.in", industry: "healthcare", city: "Mohali", source: "site_lead" as const, contactName: "Neha", contactEmail: "neha@sunrisedental.in" };

    const a = make(["claude"]);
    const out = await runProspectAudit(req, a.deps, { engineMock: four });
    assert.equal(out.status, "posted");
    const text = a.reviews[0].text as string;
    assert.ok(text.includes("Named in *5 of 20* answers (25%)"));
    assert.ok(text.includes("ChatGPT 0 of 5, Gemini 0 of 5, Perplexity 0 of 5, Claude 5 of 5."));
    const row = [...a.store.rows.values()][0];
    assert.deepEqual(row.summary.engines, ["chatgpt", "gemini", "perplexity", "claude"]);
    assert.equal(row.total_queries, 20);
    const email = buildProspectAuditEmail(row, {});
    assert.ok(email.text.includes("We asked ChatGPT, Gemini, Perplexity and Claude five questions"));
    ok("runner with Claude: 20 answers, Claude in the summary and the record, and the email names four assistants");

    const b = make(["claude"]);
    const failing = async (engine: EngineId): Promise<EngineAnswer> => {
      if (engine === "claude") throw new Error("Engine claude cannot run: missing environment variables [AEO_CLAUDE_SEARCH_PRICE_PER_1K]");
      return answer(engine, OTHERS);
    };
    const out2 = await runProspectAudit(req, b.deps, { engineMock: failing });
    assert.equal(out2.status, "posted", "the request is not lost because Claude could not be asked");
    const text2 = b.reviews[0].text as string;
    assert.ok(text2.includes("Named in *0 of 15* answers"));
    assert.ok(text2.includes("Claude was not asked in this audit (Engine claude cannot run: missing environment variables [AEO_CLAUDE_SEARCH_PRICE_PER_1K]). The figures are for the other 3 only."));
    assert.ok(!text2.includes("Claude 0 of 5"), "an assistant that was not asked is never shown as scoring zero");
    const row2 = [...b.store.rows.values()][0];
    assert.deepEqual(row2.summary.engines, ["chatgpt", "gemini", "perplexity"]);
    assert.ok(buildProspectAuditEmail(row2, {}).text.includes("We asked ChatGPT, Gemini and Perplexity five questions"), "the email never names an assistant that was not asked");
    ok("runner, Claude unavailable: three-assistant audit goes out, the summary says why, the email names three");

    const c = make([]);
    const out3 = await runProspectAudit(req, c.deps, { engineMock: four });
    assert.ok(out3.status === "posted" && out3.result.totalQueries === 15);
    assert.equal(assistantsAsked(undefined), "ChatGPT, Gemini and Perplexity");
    assert.equal(assistantsAsked({ engines: ["chatgpt", "gemini", "perplexity", "claude"] }), "ChatGPT, Gemini, Perplexity and Claude");
    assert.equal(assistantsAsked({ engines: ["claude", "nonsense"] }), "ChatGPT, Gemini and Perplexity", "a record without a usable list falls back to the three always asked");
    ok("off by default: without the switch the audit asks three assistants, as it does today");
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error("test-claude-engine FAILED:", err);
  process.exit(1);
});

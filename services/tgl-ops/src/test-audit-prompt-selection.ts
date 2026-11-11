// services/tgl-ops/src/test-audit-prompt-selection.ts
// Issue #174: short-form audit fixes. Fixture-only: no live engine call (engineMock returns canned text),
// no Slack post, no Supabase, no write to decisions/ or logs/ (saveRawJson is false).
//  1. Prompts are chosen by buyer intent (decision/comparison, then consideration, then the rest), stable within a phase.
//  2. Branded prompts (containing the brand name) are excluded from the five.
//  3. The "Mechanistic next steps" text is generated from the matrix only and carries no template phrase.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import {
  selectAuditPrompts,
  isBrandedPrompt,
  journeyPhaseRank,
  runShortFormAudit,
  generateMatrixNextSteps,
  type PromptAuditResult,
  type PromptEngineResult,
} from "./agents/aeo-audit-engine/short-form.js";
import { renderAuditHtml, generateAuditPdf, buildNextStepsText } from "./agents/aeo-audit-engine/pdf.js";
import type { VerifiedBrandProfile } from "./agents/aeo-audit-engine/setup-profile.js";
import type { EngineAnswer, EngineId } from "./agents/aeo-audit-engine/types.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const BRAND = "Acme Growth";
const ENGINES: EngineId[] = ["chatgpt", "gemini", "perplexity"];

// Phrases the old generator emitted regardless of the matrix. None may appear in the new text.
const TEMPLATE_PHRASES = [
  "counselling conversion keywords",
  "competing operators",
  "directory listings",
  "comparison entity schemas",
  "evaluated queries",
  "toward 90%",
  "To advance visibility",
];

function noTemplatePhrase(text: string): string | null {
  const lower = text.toLowerCase();
  return TEMPLATE_PHRASES.find((p) => lower.includes(p.toLowerCase())) || null;
}

// ── Prompt fixtures ─────────────────────────────────────────────────────────────────────────
const PROMPTS = [
  { id: "p1", text: "What is AEO and why does it matter?", language: "en", journey_phase: "awareness" },
  { id: "p2", text: "How do I choose an AEO agency", language: "en", journey_phase: "consideration" },
  { id: "p3", text: "Acme Growth reviews", language: "en", journey_phase: "decision" },
  { id: "p4", text: "Best AEO agencies compared", language: "en", journey_phase: "comparison" },
  { id: "p5", text: "Top AEO agency pricing for clinics", language: "en", journey_phase: "decision" },
  { id: "p6", text: "How to get cited by ChatGPT", language: "en", journey_phase: "awareness" },
  { id: "p7", text: "AEO agency vs SEO agency", language: "en", journey_phase: "comparison" },
  { id: "p8", text: "What does an AEO audit include", language: "en", journey_phase: "consideration" },
  { id: "p9", text: "AEO checklist for hotels", language: "en" },
  { id: "p10", text: "acme   GROWTH alternatives", language: "en", journey_phase: "decision" },
] as any[];

function profileWith(prompts: any[]): VerifiedBrandProfile {
  return {
    brandId: "brand_fixture",
    tenantId: "tenant_fixture",
    name: BRAND,
    primaryDomain: "acmegrowth.example",
    domains: ["acmegrowth.example"],
    variants: [],
    setupStatus: "verified",
    setupVerifiedAt: "2026-11-10T10:00:00Z",
    setupVerifiedBy: "architect",
    competitors: [
      { name: "RivalCo", domain: "rivalco.example" },
      { name: "OtherCo", domain: "otherco.example" },
    ],
    prompts,
  };
}

function cannedAnswer(engine: EngineId, text: string): EngineAnswer {
  return {
    engine,
    model: "fixture-model",
    text,
    citations: [],
    usage: { inputTokens: 1, outputTokens: 1, searches: 0 },
    costUsd: 0,
    costSource: "computed",
    raw: {},
  };
}

// ── Hand-built matrix cells (no analyzer, no engine) ────────────────────────────────────────
interface Cell {
  mentioned: boolean;
  position: number | null;
  comps?: string[];
}

function cell(engine: EngineId, c: Cell): PromptEngineResult {
  return {
    engine,
    model: "fixture-model",
    text: "fixture",
    badge: c.mentioned ? "Mentioned" : "—",
    analysis: { mentioned: c.mentioned, position: c.position, competitorsMentioned: c.comps || [] } as any,
    citations: [],
    costUsd: 0,
  };
}

function row(promptIndex: number, prompt: string, cells: Partial<Record<EngineId, Cell>>): PromptAuditResult {
  const engineResults = {} as Record<EngineId, PromptEngineResult>;
  for (const eng of ENGINES) {
    engineResults[eng] = cell(eng, cells[eng] || { mentioned: false, position: null });
  }
  return {
    promptIndex,
    prompt,
    engineResults,
    excerpt: { engine: "perplexity", badge: "—", text: "fixture" },
  };
}

async function main(): Promise<void> {
  console.log("Short-form audit prompt selection and next steps (issue #174)");

  // 1. Selection order
  console.log("\n[1] Selection by buyer intent");
  {
    check("journeyPhaseRank: decision and comparison share the top rank", journeyPhaseRank("decision") === 0 && journeyPhaseRank("comparison") === 0);
    check("journeyPhaseRank: consideration is next, everything else last", journeyPhaseRank("consideration") === 1 && journeyPhaseRank("awareness") === 2 && journeyPhaseRank(undefined) === 2 && journeyPhaseRank("anything") === 2);

    const picked = selectAuditPrompts(PROMPTS, BRAND);
    const ids = picked.map((p) => p.id);
    check("picks decision/comparison first (input order), then consideration", JSON.stringify(ids) === JSON.stringify(["p4", "p5", "p7", "p2", "p8"]), ids.join(","));
    check("returns exactly five", picked.length === 5);
    check("does not simply take the first five", JSON.stringify(ids) !== JSON.stringify(["p1", "p2", "p3", "p4", "p5"]));

    const noHigh = [
      { id: "a", text: "alpha", journey_phase: "awareness" },
      { id: "b", text: "bravo" },
      { id: "c", text: "charlie", journey_phase: "consideration" },
      { id: "d", text: "delta", journey_phase: "awareness" },
      { id: "e", text: "echo", journey_phase: "consideration" },
      { id: "f", text: "foxtrot", journey_phase: "decision" },
      { id: "g", text: "golf" },
    ];
    const ids2 = selectAuditPrompts(noHigh, BRAND).map((p) => p.id);
    check("falls through to the rest, keeping order within each phase", JSON.stringify(ids2) === JSON.stringify(["f", "c", "e", "a", "b"]), ids2.join(","));

    const input = PROMPTS.map((p) => p.id);
    selectAuditPrompts(PROMPTS, BRAND);
    check("does not mutate the input list", JSON.stringify(PROMPTS.map((p) => p.id)) === JSON.stringify(input));
  }

  // 2. Branded exclusion
  console.log("\n[2] Branded prompts are excluded");
  {
    check("isBrandedPrompt matches the brand name case-insensitively", isBrandedPrompt("Acme Growth reviews", BRAND) && isBrandedPrompt("ACME GROWTH pricing", BRAND));
    check("isBrandedPrompt tolerates extra whitespace", isBrandedPrompt("acme   growth alternatives", BRAND));
    check("isBrandedPrompt is false for unbranded text", !isBrandedPrompt("Best AEO agencies compared", BRAND));
    check("an empty brand name excludes nothing", !isBrandedPrompt("anything", ""));

    const ids = selectAuditPrompts(PROMPTS, BRAND, 10).map((p) => p.id);
    check("branded decision prompts (p3, p10) never appear, even when asking for all", !ids.includes("p3") && !ids.includes("p10") && ids.length === 8, ids.join(","));

    const seen: string[] = [];
    const result = await runShortFormAudit(profileWith(PROMPTS), {
      testMode: true,
      saveRawJson: false,
      engineMock: async (engine, prompt) => {
        seen.push(prompt);
        return cannedAnswer(engine, `${BRAND} is one option for "${prompt}".`);
      },
    });
    const audited = result.results.map((r) => r.prompt);
    const expected = ["Best AEO agencies compared", "Top AEO agency pricing for clinics", "AEO agency vs SEO agency", "How do I choose an AEO agency", "What does an AEO audit include"];
    check("runShortFormAudit audits the selected five in selection order", JSON.stringify(audited) === JSON.stringify(expected), audited.join(" | "));
    check("engines were only ever asked the selected prompts (5 prompts x 3 engines)", seen.length === 15 && seen.every((p) => expected.includes(p)));
    check("no branded prompt was sent to any engine", !seen.some((p) => isBrandedPrompt(p, BRAND)));
    check("journey phase follows the selected prompt, not its list position", result.results.map((r) => r.journeyPhase).join(",") === "comparison,decision,comparison,consideration,consideration", result.results.map((r) => r.journeyPhase).join(","));

    let refused = "";
    try {
      await runShortFormAudit(profileWith(PROMPTS.slice(0, 6)), {
        testMode: true,
        saveRawJson: false,
        engineMock: async (engine) => cannedAnswer(engine, "unused"),
      });
    } catch (err: any) {
      refused = err.message;
    }
    check("fewer than five non-branded prompts refuses the audit", /fewer than 5 non-branded/.test(refused) && /Audit refused/.test(refused), refused || "did not refuse");
  }

  // 3. Next steps from the matrix only
  console.log("\n[3] Next steps are generated from the matrix");
  {
    // 3a. Every count is zero: no mentions, no competitors, no citations.
    const zeroRows = [1, 2, 3, 4, 5].map((i) => row(i, `Zero query ${i}`, {}));
    const zero = generateMatrixNextSteps(zeroRows, undefined, BRAND);
    check("zero counts: no template phrase appears", noTemplatePhrase(zero.formattedText) === null, noTemplatePhrase(zero.formattedText) || "");
    check("zero counts: all three engines are named as having zero mentions", /ChatGPT, Gemini and Perplexity did not name Acme Growth in any of the 5 prompts/.test(zero.formattedText), zero.formattedText);
    check("zero counts: plainly says no competitor was named", /No competitor was named in any of the 15 answers\./.test(zero.formattedText), zero.formattedText);
    check("zero counts: no competitor or citation is invented", zero.winningCompetitor === "" && zero.winningCompetitorCount === 0 && zero.topCitationGap === "");
    check("zero counts: names the two weakest queries (ties keep prompt order)", zero.weakestQueries.join(",") === "1,2" && /Q1 "Zero query 1" \(0 of 3 engines named Acme Growth\); Q2 "Zero query 2"/.test(zero.formattedText), zero.formattedText);
    check("zero counts: 0 of 15 is stated", /named in 0 of 15 answers/.test(zero.formattedText));

    // 3b. A mixed matrix with a clear top competitor.
    // brand mentions: chatgpt 0; gemini q1,q2; perplexity q1..q4. RivalCo in 6 answers, OtherCo in 2.
    const mixed: PromptAuditResult[] = [
      row(1, "Mixed query 1", { chatgpt: { mentioned: false, position: null, comps: ["RivalCo"] }, gemini: { mentioned: true, position: 1 }, perplexity: { mentioned: true, position: 1 } }),
      row(2, "Mixed query 2", { chatgpt: { mentioned: false, position: null, comps: ["RivalCo"] }, gemini: { mentioned: true, position: 2, comps: ["RivalCo"] }, perplexity: { mentioned: true, position: 1 } }),
      row(3, "Mixed query 3", { chatgpt: { mentioned: false, position: null, comps: ["RivalCo", "OtherCo"] }, perplexity: { mentioned: true, position: 3, comps: ["RivalCo", "OtherCo"] } }),
      row(4, "Mixed query 4", { chatgpt: { mentioned: false, position: null, comps: ["RivalCo"] }, perplexity: { mentioned: true, position: 1 } }),
      row(5, "Mixed query 5", { chatgpt: { mentioned: false, position: null, comps: ["RivalCo"] } }),
    ];
    const ns = generateMatrixNextSteps(mixed, undefined, BRAND);
    check("mixed: engines with zero mentions are named (ChatGPT only)", ns.zeroMentionEngines.join(",") === "ChatGPT" && /ChatGPT did not name Acme Growth in any of the 5 prompts/.test(ns.formattedText) && !/Gemini did not/.test(ns.formattedText), ns.formattedText);
    check("mixed: the competitor with the most mentions is named with its count", ns.winningCompetitor === "RivalCo" && ns.winningCompetitorCount === 7 && /RivalCo was the competitor named most often, in 7 of 15 answers/.test(ns.formattedText), `${ns.winningCompetitor} ${ns.winningCompetitorCount} :: ${ns.formattedText}`);
    check("mixed: the two weakest queries are Q5 (0 engines) then Q3 (1 engine, worst position)", ns.weakestQueries.join(",") === "5,3" && /Weakest queries: Q5 "Mixed query 5" \(0 of 3 engines named Acme Growth\); Q3 "Mixed query 3" \(1 of 3 engines named Acme Growth\)\./.test(ns.formattedText), ns.formattedText);
    check("mixed: no template phrase appears", noTemplatePhrase(ns.formattedText) === null);
    check("mixed: does not claim no competitor was named", !/No competitor was named/.test(ns.formattedText));
    check("mixed: states the brand total (10 of 15 is not the count; 8 is)", /named in 8 of 15 answers/.test(ns.formattedText), ns.formattedText);

    // 3c. Every engine mentions the brand at least once: no zero-mention engine is invented.
    const allEngines: PromptAuditResult[] = [
      row(1, "All query 1", { chatgpt: { mentioned: true, position: 1 }, gemini: { mentioned: true, position: 1 }, perplexity: { mentioned: true, position: 1 } }),
      row(2, "All query 2", { chatgpt: { mentioned: false, position: null }, gemini: { mentioned: true, position: 2 }, perplexity: { mentioned: true, position: 1 } }),
    ];
    const ok = generateMatrixNextSteps(allEngines, undefined, BRAND);
    check("all engines mention: no zero-mention engine is named", ok.zeroMentionEngines.length === 0 && /Every engine named Acme Growth at least once; ChatGPT was the weakest, naming it in 1 of 2 prompts/.test(ok.formattedText), ok.formattedText);
  }

  // 4. End to end: zero counts through the audit, the HTML and the PDF
  console.log("\n[4] Zero counts through the audit, the HTML and the PDF");
  {
    const result = await runShortFormAudit(profileWith(PROMPTS), {
      testMode: true,
      saveRawJson: false,
      engineMock: async (engine) => cannedAnswer(engine, "No specific providers could be recommended for that search."),
    });
    check("audit with no mentions and no competitors: score is 0%", result.summary.visibilityScorePercent === 0 && Object.keys(result.summary.competitorMentions).length === 0);
    check("audit next steps contain no template phrase", noTemplatePhrase(result.nextSteps.formattedText) === null, result.nextSteps.formattedText);
    check("audit next steps say no competitor was named", /No competitor was named in any of the 15 answers\./.test(result.nextSteps.formattedText));

    // A stale stored text must never reach the page: the box is regenerated from the matrix at render time.
    const stale = { ...result, nextSteps: { ...result.nextSteps, formattedText: "STALE counselling conversion keywords against competing operators" } };
    const html = renderAuditHtml(stale);
    check("rendered box ignores stale stored text and carries no template phrase", !html.includes("STALE") && noTemplatePhrase(html) === null);
    check("rendered box contains the matrix-generated text", html.includes(buildNextStepsText(stale)) && /No competitor was named/.test(html));

    const pdf = await generateAuditPdf(stale);
    check("PDF still renders (under 2MB)", pdf.buffer.subarray(0, 5).toString("ascii") === "%PDF-" && pdf.sizeBytes < 2 * 1024 * 1024, `${pdf.sizeBytes}`);
  }

  console.log(failures === 0 ? "\nAll audit prompt selection tests passed." : `\n${failures} audit prompt selection test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-audit-prompt-selection crashed:", err);
  process.exit(1);
});

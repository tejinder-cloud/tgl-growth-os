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

// Prompt fixtures
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

// Hand-built matrix cells (no analyzer, no engine)
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

    const before = PROMPTS.map((p) => p.id).join(",");
    const picked = selectAuditPrompts(PROMPTS, BRAND);
    const ids = picked.map((p) => p.id);
    check("picks decision/comparison first (input order), then consideration", JSON.stringify(ids) === JSON.stringify(["p4", "p5", "p7", "p2", "p8"]), ids.join(","));
    check("returns exactly five", picked.length === 5);
    check("does not simply take the first five", JSON.stringify(ids) !== JSON.stringify(["p1", "p2", "p3", "p4", "p5"]));
    check("does not mutate the input list", PROMPTS.map((p) => p.id).join(",") === before);

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
    const phases = result.results.map((r) => r.journeyPhase).join(",");
    check("journey phase follows the selected prompt, not its list position", phases === "comparison,decision,comparison,consideration,consideration", phases);

    let refused = "";
    try {
      // p1 to p5 contains one branded prompt (p3), leaving four.
      await runShortFormAudit(profileWith(PROMPTS.slice(0, 5)), {
        testMode: true,
        saveRawJson: false,
        engineMock: async (engine) => cannedAnswer(engine, "unused"),
      });
    } catch (err: any) {
      refused = err.message;
    }
    check("fewer than five non-branded prompts refuses the audit", /fewer than 5 non-branded/.test(refused) && /Audit refused/.test(refused), refused || "did not refuse");
  }

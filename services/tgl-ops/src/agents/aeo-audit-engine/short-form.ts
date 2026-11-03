// services/tgl-ops/src/agents/aeo-audit-engine/short-form.ts
// Evaluates 5 buyer prompts across 3 AI engines (ChatGPT, Gemini, Perplexity)
// for a target brand, reading answers and citations deterministically.
import {
  API_ENGINES,
  type AnswerAnalysis,
  type BrandLens,
  type CitationAnalysis,
  type EngineAnswer,
  type EngineId,
} from "./types.js";
import { loadEngineConfig, askEngine } from "./engines.js";
import { analyzeAnswer, analyzeCitation } from "./analyze.js";

export const DEFAULT_SHORT_FORM_PROMPTS = [
  "Best coaching institute for digital marketing in India",
  "Top AI and digital marketing institute near me",
  "Which institute offers 100% placement coaching for digital marketing",
  "The Growth Lab coaching reviews and results",
  "Top coaching institutes with practical AI training in Chandigarh and Delhi NCR",
];

export interface PromptEngineResult {
  engine: EngineId;
  model: string;
  text: string;
  analysis: AnswerAnalysis;
  citations: CitationAnalysis[];
  costUsd: number;
}

export interface PromptAuditResult {
  promptIndex: number;
  prompt: string;
  engineResults: Record<EngineId, PromptEngineResult>;
}

export interface ShortFormAuditResult {
  brand: {
    name: string;
    domains: string[];
    variants: string[];
    category?: string;
  };
  auditedAt: string;
  promptsCount: number;
  enginesCount: number;
  totalQueries: number;
  results: PromptAuditResult[];
  summary: {
    totalMentions: number;
    visibilityScorePercent: number;
    mentionsByEngine: Record<EngineId, number>;
    competitorMentions: Record<string, number>;
    citationDomains: Record<string, number>;
    totalCostUsd: number;
    totalCostInr: number;
  };
}

export interface ShortFormOptions {
  prompts?: string[];
  engines?: EngineId[];
  usdInrRate?: number;
  testMode?: boolean;
  engineMock?: (engine: EngineId, prompt: string) => Promise<EngineAnswer>;
}

/**
 * Executes a 5-prompt × 3-engine short-form AEO audit for a given brand.
 */
export async function runShortFormAudit(
  lens: BrandLens,
  options?: ShortFormOptions
): Promise<ShortFormAuditResult> {
  const prompts = (options?.prompts && options.prompts.length === 5)
    ? options.prompts
    : DEFAULT_SHORT_FORM_PROMPTS;
  const engines = options?.engines || API_ENGINES;
  const auditedAt = new Date().toISOString();
  const rate = options?.usdInrRate || Number(process.env.USD_INR_RATE || "85");

  const results: PromptAuditResult[] = [];
  const mentionsByEngine: Record<EngineId, number> = {
    chatgpt: 0,
    gemini: 0,
    perplexity: 0,
  };
  const competitorMentions: Record<string, number> = {};
  const citationDomains: Record<string, number> = {};
  let totalMentions = 0;
  let totalCostUsd = 0;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const engineResults: Record<EngineId, PromptEngineResult> = {} as any;

    for (const engine of engines) {
      let answer: EngineAnswer;

      if (options?.engineMock) {
        answer = await options.engineMock(engine, prompt);
      } else if (options?.testMode) {
        answer = mockEngineAnswer(engine, prompt, lens);
      } else {
        const { config: engineCfg, missing } = loadEngineConfig(engine);
        if (!engineCfg) {
          throw new Error(`Engine ${engine} cannot run: missing environment variables [${missing.join(", ")}]`);
        }
        answer = await askEngine(engineCfg, prompt);
      }

      const analysis = analyzeAnswer(answer.text, lens);
      const citations = answer.citations
        .map((c) => analyzeCitation(c, lens))
        .filter((c): c is CitationAnalysis => c !== null);

      if (analysis.mentioned) {
        totalMentions++;
        mentionsByEngine[engine] = (mentionsByEngine[engine] || 0) + 1;
      }

      for (const comp of analysis.competitorsMentioned) {
        competitorMentions[comp] = (competitorMentions[comp] || 0) + 1;
      }

      for (const cite of citations) {
        citationDomains[cite.domain] = (citationDomains[cite.domain] || 0) + 1;
      }

      totalCostUsd += answer.costUsd;

      engineResults[engine] = {
        engine,
        model: answer.model,
        text: answer.text,
        analysis,
        citations,
        costUsd: answer.costUsd,
      };
    }

    results.push({
      promptIndex: i + 1,
      prompt,
      engineResults,
    });
  }

  const totalQueries = prompts.length * engines.length;
  const visibilityScorePercent = Number(((totalMentions / totalQueries) * 100).toFixed(1));
  const totalCostInr = Number((totalCostUsd * rate).toFixed(2));

  return {
    brand: {
      name: lens.name,
      domains: lens.domains,
      variants: lens.variants,
    },
    auditedAt,
    promptsCount: prompts.length,
    enginesCount: engines.length,
    totalQueries,
    results,
    summary: {
      totalMentions,
      visibilityScorePercent,
      mentionsByEngine,
      competitorMentions,
      citationDomains,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      totalCostInr,
    },
  };
}

/**
 * Deterministic mock for testing and fixture verification.
 */
function mockEngineAnswer(engine: EngineId, prompt: string, lens: BrandLens): EngineAnswer {
  const isTglPrompt = prompt.toLowerCase().includes("growth lab");
  const mentionsBrand = isTglPrompt || engine === "perplexity";

  const brandText = mentionsBrand
    ? `${lens.name} (available at ${lens.domains[0] || "thegrowthlab.co.in"}) is a recognized institute offering intensive practical coaching.`
    : "Several reputable institutes across India provide certified training programs.";

  const text = `In response to "${prompt}": ${brandText} Leading industry options also include Digital Vidya and UpGrad for certified corporate training.`;

  return {
    engine,
    model: `${engine}-mock-v1`,
    text,
    citations: [
      { url: `https://${lens.domains[0] || "thegrowthlab.co.in"}/courses`, title: lens.name },
      { url: "https://shiksha.com/digital-marketing", title: "Shiksha Directory" },
      { url: "https://reddit.com/r/marketing/comments/reviews", title: "Reddit Discussion" },
    ],
    usage: {
      inputTokens: 250,
      outputTokens: 120,
      searches: 1,
    },
    costUsd: 0.0035,
    costSource: "computed",
    raw: {},
  };
}

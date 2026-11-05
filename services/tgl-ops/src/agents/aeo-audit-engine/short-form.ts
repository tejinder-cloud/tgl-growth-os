// services/tgl-ops/src/agents/aeo-audit-engine/short-form.ts
// Evaluates 5 verified buyer prompts across 3 AI engines (ChatGPT, Gemini, Perplexity)
// for a target brand, reading answers and citations deterministically.
// Enforces the Iron Law of Honesty: refuses unverified setups, displays exact cell ranks,
// counts actual answer frequencies, generates matrix-driven next steps, and records excerpts.

import fs from "node:fs";
import path from "node:path";
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
import {
  loadVerifiedBrandProfile,
  type VerifiedBrandProfile,
  type SetupStatus,
} from "./setup-profile.js";
import { putFileInRepo } from "../../lib/github-client.js";
import { isTestMode } from "../../config.js";

export type MatrixBadge = "Named #1" | "Named #2" | "Named #3" | "Mentioned" | "—";

export function getCellBadge(analysis: AnswerAnalysis): MatrixBadge {
  if (!analysis || !analysis.mentioned) return "—";
  if (analysis.position === 1) return "Named #1";
  if (analysis.position === 2) return "Named #2";
  if (analysis.position === 3) return "Named #3";
  return "Mentioned";
}

export interface PromptEngineResult {
  engine: EngineId;
  model: string;
  text: string;
  badge: MatrixBadge;
  analysis: AnswerAnalysis;
  citations: CitationAnalysis[];
  costUsd: number;
}

export interface PromptExcerpt {
  engine: EngineId;
  badge: MatrixBadge;
  text: string;
}

export interface PromptAuditResult {
  promptIndex: number;
  prompt: string;
  journeyPhase?: string;
  engineResults: Record<EngineId, PromptEngineResult>;
  excerpt: PromptExcerpt;
}

export interface MatrixNextSteps {
  weakestEngine: string;
  weakestEngineMentions: number;
  queriesLost: number[];
  winningCompetitor: string;
  winningCompetitorCount: number;
  topCitationGap: string;
  formattedText: string;
}

export interface ShortFormAuditResult {
  brand: {
    name: string;
    primaryDomain: string;
    domains: string[];
    variants: string[];
    category?: string;
    setupStatus: SetupStatus;
    setupVerifiedAt?: string;
    setupVerifiedBy?: string;
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
  nextSteps: MatrixNextSteps;
  rawAnswersJsonPath?: string;
}

export interface ShortFormOptions {
  prompts?: string[];
  engines?: EngineId[];
  usdInrRate?: number;
  testMode?: boolean;
  engineMock?: (engine: EngineId, prompt: string) => Promise<EngineAnswer>;
  saveRawJson?: boolean;
  supabase?: any;
}

/**
 * Extracts a concise 1-line answer excerpt (~80-130 chars) from the model responses
 * to prove why the matrix cell received its badge or which competitor won.
 */
export function extractPromptExcerpt(
  promptIndex: number,
  engineResults: Record<EngineId, PromptEngineResult>,
  brandName: string
): PromptExcerpt {
  // Prefer Perplexity or Gemini as primary excerpt source, or ChatGPT if others absent
  const preferredEngines: EngineId[] = ["perplexity", "gemini", "chatgpt"];
  let pickedEngine: EngineId = "perplexity";
  let pickedResult = engineResults.perplexity;

  for (const eng of preferredEngines) {
    if (engineResults[eng] && engineResults[eng].analysis.mentioned) {
      pickedEngine = eng;
      pickedResult = engineResults[eng];
      break;
    }
  }

  if (!pickedResult) {
    pickedResult = engineResults[preferredEngines[0]];
    pickedEngine = preferredEngines[0];
  }

  const rawText = pickedResult?.text || "";
  const badge = pickedResult ? pickedResult.badge : "—";

  // Clean and condense to a 1-line factual proof
  let excerptText = rawText.replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ").trim();
  if (excerptText.length > 130) {
    excerptText = excerptText.slice(0, 127).trim() + "...";
  }

  return {
    engine: pickedEngine,
    badge,
    text: excerptText,
  };
}

/**
 * Generates dynamic, matrix-driven next steps based strictly on matrix outcomes.
 * Identifies weakest engine, lost/outranked queries, winning competitor, and top citation gaps.
 */
export function generateMatrixNextSteps(
  results: PromptAuditResult[],
  summary: ShortFormAuditResult["summary"],
  brandName: string
): MatrixNextSteps {
  // 1. Weakest engine
  const engineEntries = (Object.entries(summary.mentionsByEngine) as [EngineId, number][]).sort(
    (a, b) => a[1] - b[1]
  );
  const weakest = engineEntries[0] || ["chatgpt", 0];
  const engineNameMap: Record<EngineId, string> = {
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    perplexity: "Perplexity",
  };
  const weakestEngineName = engineNameMap[weakest[0]] || weakest[0];

  // 2. Lost or outranked queries (brand absent or ranked > 1)
  const queriesLost: number[] = [];
  for (const r of results) {
    const isLostOrOutranked = Object.values(r.engineResults).some(
      (er) => !er.analysis.mentioned || (er.analysis.position !== null && er.analysis.position > 1)
    );
    if (isLostOrOutranked) {
      queriesLost.push(r.promptIndex);
    }
  }

  // 3. Winning competitor
  const sortedComps = Object.entries(summary.competitorMentions).sort((a, b) => b[1] - a[1]);
  const winningCompetitor = sortedComps[0] ? sortedComps[0][0] : "competing operators";
  const winningCompetitorCount = sortedComps[0] ? sortedComps[0][1] : 0;

  // 4. Citation gap
  const topCitations = Object.entries(summary.citationDomains)
    .filter(([dom]) => !dom.includes("thegrowthlab"))
    .sort((a, b) => b[1] - a[1]);
  const topCitationGap = topCitations[0] ? topCitations[0][0] : "directory listings";

  // 5. Dynamic text
  const lostQueriesLabel = queriesLost.length > 0 ? `Queries ${queriesLost.join(", ")}` : "evaluated queries";
  const formattedText =
    `Visibility score is ${summary.visibilityScorePercent}% across ${results.length * 3} model answers. ` +
    `Primary gap is ${weakestEngineName} (${weakest[1]}/${results.length} mentions), where ${winningCompetitor} ` +
    `captured top placement across ${lostQueriesLabel} with ${winningCompetitorCount} answer mentions. ` +
    `To advance visibility toward 90%+, deploy comparison entity schemas targeting ${winningCompetitor}, ` +
    `seed verified citations on ${topCitationGap}, and optimize structured data for counselling conversion keywords.`;

  return {
    weakestEngine: weakestEngineName,
    weakestEngineMentions: weakest[1],
    queriesLost,
    winningCompetitor,
    winningCompetitorCount,
    topCitationGap,
    formattedText,
  };
}

/**
 * Executes a 5-prompt × 3-engine short-form AEO audit for a given brand.
 * Refuses to run if the brand's setup profile is unverified.
 */
export async function runShortFormAudit(
  lensOrProfile: BrandLens | VerifiedBrandProfile,
  options?: ShortFormOptions
): Promise<ShortFormAuditResult> {
  // Gate check: verify setup profile
  let verifiedProfile: VerifiedBrandProfile;
  if ("setupStatus" in lensOrProfile && lensOrProfile.setupStatus) {
    if (lensOrProfile.setupStatus !== "verified") {
      throw new Error(
        `Brand setup profile for "${lensOrProfile.name}" is not verified (status: ${lensOrProfile.setupStatus}). Audit refused.`
      );
    }
    verifiedProfile = lensOrProfile;
  } else {
    const lookupKey = lensOrProfile.domains[0] || lensOrProfile.name;
    verifiedProfile = await loadVerifiedBrandProfile(lookupKey, {
      supabase: options?.supabase,
      testMode: options?.testMode,
    });
  }

  // Brand lens derived from verified profile
  const lens: BrandLens = {
    name: verifiedProfile.name,
    domains: verifiedProfile.domains,
    variants: verifiedProfile.variants,
    competitors: verifiedProfile.competitors.map((c) => ({
      name: c.name,
      domain: c.domain,
    })),
  };

  // Buyer prompts strictly from verified setup profile
  const prompts =
    options?.prompts && options.prompts.length === 5
      ? options.prompts
      : verifiedProfile.prompts.slice(0, 5).map((p) => p.text);

  if (prompts.length < 5) {
    throw new Error(
      `Verified setup profile for "${verifiedProfile.name}" has fewer than 5 buyer prompts (${prompts.length}/5). Audit refused.`
    );
  }

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
    const promptIndex = i + 1;
    const engineResults: Record<EngineId, PromptEngineResult> = {} as any;

    for (const engine of engines) {
      let answer: EngineAnswer;

      if (options?.engineMock) {
        answer = await options.engineMock(engine, prompt);
      } else if (options?.testMode) {
        answer = mockEngineAnswer(engine, prompt, lens, promptIndex);
      } else {
        const { config: engineCfg, missing } = loadEngineConfig(engine);
        if (!engineCfg) {
          throw new Error(
            `Engine ${engine} cannot run: missing environment variables [${missing.join(", ")}]`
          );
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

      // Deduplicate per answer: counts represent number of answers in which the name appeared
      const uniqueComps = [...new Set(analysis.competitorsMentioned)];
      for (const comp of uniqueComps) {
        competitorMentions[comp] = (competitorMentions[comp] || 0) + 1;
      }

      const uniqueDomains = [...new Set(citations.map((c) => c.domain))];
      for (const dom of uniqueDomains) {
        citationDomains[dom] = (citationDomains[dom] || 0) + 1;
      }

      totalCostUsd += answer.costUsd;

      engineResults[engine] = {
        engine,
        model: answer.model,
        text: answer.text,
        badge: getCellBadge(analysis),
        analysis,
        citations,
        costUsd: answer.costUsd,
      };
    }

    const excerpt = extractPromptExcerpt(promptIndex, engineResults, lens.name);

    results.push({
      promptIndex,
      prompt,
      journeyPhase: verifiedProfile.prompts[i]?.journey_phase,
      engineResults,
      excerpt,
    });
  }

  const totalQueries = prompts.length * engines.length;
  const visibilityScorePercent = Number(((totalMentions / totalQueries) * 100).toFixed(1));
  const totalCostInr = Number((totalCostUsd * rate).toFixed(2));

  const summary = {
    totalMentions,
    visibilityScorePercent,
    mentionsByEngine,
    competitorMentions,
    citationDomains,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    totalCostInr,
  };

  const nextSteps = generateMatrixNextSteps(results, summary, lens.name);

  const auditResult: ShortFormAuditResult = {
    brand: {
      name: verifiedProfile.name,
      primaryDomain: verifiedProfile.primaryDomain,
      domains: verifiedProfile.domains,
      variants: verifiedProfile.variants,
      category: verifiedProfile.market?.product,
      setupStatus: verifiedProfile.setupStatus,
      setupVerifiedAt: verifiedProfile.setupVerifiedAt,
      setupVerifiedBy: verifiedProfile.setupVerifiedBy,
    },
    auditedAt,
    promptsCount: prompts.length,
    enginesCount: engines.length,
    totalQueries,
    results,
    summary,
    nextSteps,
  };

  // Store raw answers under logs/<date>/aeo-audit/<domain>.json so every number is traceable
  if (options?.saveRawJson !== false) {
    const rawJsonPath = await saveRawAuditJson(auditResult);
    auditResult.rawAnswersJsonPath = rawJsonPath;
  }

  return auditResult;
}

/**
 * Saves full traceable raw audit results under logs/<date>/aeo-audit/<domain>.json.
 * In production, commits via the GitHub Contents API to main.
 * In test mode (TGL_TEST_MODE=1), writes strictly to logs/.test/ and never touches main or git.
 */
export async function saveRawAuditJson(result: ShortFormAuditResult): Promise<string> {
  const dateStr = result.auditedAt.slice(0, 10);
  const domain = result.brand.primaryDomain || result.brand.domains[0] || "brand";
  const safeDomain = domain.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
  const relPath = `logs/${dateStr}/aeo-audit/${safeDomain}.json`;

  const payload = {
    brand: result.brand,
    auditedAt: result.auditedAt,
    promptsCount: result.promptsCount,
    enginesCount: result.enginesCount,
    totalQueries: result.totalQueries,
    summary: result.summary,
    nextSteps: result.nextSteps,
    matrix: result.results.map((r) => ({
      promptIndex: r.promptIndex,
      prompt: r.prompt,
      journeyPhase: r.journeyPhase,
      chatgpt: {
        badge: r.engineResults.chatgpt?.badge,
        position: r.engineResults.chatgpt?.analysis.position,
        mentioned: r.engineResults.chatgpt?.analysis.mentioned,
      },
      gemini: {
        badge: r.engineResults.gemini?.badge,
        position: r.engineResults.gemini?.analysis.position,
        mentioned: r.engineResults.gemini?.analysis.mentioned,
      },
      perplexity: {
        badge: r.engineResults.perplexity?.badge,
        position: r.engineResults.perplexity?.analysis.position,
        mentioned: r.engineResults.perplexity?.analysis.mentioned,
      },
      excerpt: r.excerpt,
    })),
    rawAnswers: result.results.flatMap((r) =>
      Object.values(r.engineResults).map((er) => ({
        promptIndex: r.promptIndex,
        prompt: r.prompt,
        engine: er.engine,
        model: er.model,
        badge: er.badge,
        text: er.text,
        analysis: er.analysis,
        citations: er.citations,
        costUsd: er.costUsd,
      }))
    ),
  };

  const content = JSON.stringify(payload, null, 2);

  if (isTestMode()) {
    let baseDir = process.cwd();
    if (baseDir.endsWith("services/tgl-ops")) {
      baseDir = path.resolve(baseDir, "../..");
    }
    const testLogsDir = path.join(baseDir, "logs/.test", dateStr, "aeo-audit");
    fs.mkdirSync(testLogsDir, { recursive: true });
    const localPath = path.join(testLogsDir, `${safeDomain}.json`);
    fs.writeFileSync(localPath, content, "utf8");
    return localPath;
  }

  // In production, write via the GitHub Contents API to main
  await putFileInRepo(relPath, content, `chore(aeo): record short-form audit for ${domain} on ${dateStr}`);
  return relPath;
}

/**
 * Deterministic mock for testing and fixture verification.
 * Generates varied, realistic answers across the 5 verified buyer prompts and 3 engines,
 * with actual badge positions (Named #1, #2, #3, —), realistic competitor counts, and distinct citation sources.
 */
function mockEngineAnswer(
  engine: EngineId,
  prompt: string,
  lens: BrandLens,
  promptIndex: number
): EngineAnswer {
  const brandName = lens.name;
  const domain = lens.domains[0] || "thegrowthlab.co.in";

  const c1 = lens.competitors[0]?.name || "SingleInterface";
  const c1Dom = lens.competitors[0]?.domain || "singleinterface.com";
  const c2 = lens.competitors[1]?.name || "Performics";
  const c2Dom = lens.competitors[1]?.domain || "performics.com";
  const c3 = lens.competitors[2]?.name || "Schbang";
  const c3Dom = lens.competitors[2]?.domain || "schbang.com";
  const c4 = lens.competitors[3]?.name || "Digital Pundit";
  const c4Dom = lens.competitors[3]?.domain || "digitalpundit.in";

  let text = "";
  let citations: { url: string; title: string }[] = [];

  switch (promptIndex) {
    case 1:
      // Multi-vertical query 1
      if (engine === "chatgpt") {
        text = `For enterprise AI visibility across multi-location brands, ${c1} manages brand listings, ${c2} leads media visibility, and ${brandName} (${domain}) delivers generative engine optimization (GEO).`;
        citations = [
          { url: `https://${c1Dom}/platform`, title: `${c1} Platform` },
          { url: `https://${c2Dom}/ai-search`, title: `${c2} Search` },
          { url: `https://${domain}/geo`, title: brandName },
        ];
      } else if (engine === "gemini") {
        text = `Leading search marketing platforms in India include ${c1} and ${c4} for local and digital discoverability.`;
        citations = [
          { url: `https://${c1Dom}/solutions`, title: c1 },
          { url: `https://${c4Dom}/services`, title: c4 },
        ];
      } else {
        // perplexity
        text = `${brandName} (${domain}) is widely recommended for generative engine optimization and AI visibility for growing enterprises, alongside ${c3}.`;
        citations = [
          { url: `https://${domain}/case-studies`, title: brandName },
          { url: "https://reddit.com/r/marketing/comments/ai_search", title: "Reddit Marketing" },
        ];
      }
      break;

    case 2:
      // Multi-vertical query 2
      if (engine === "chatgpt") {
        text = `Healthcare clinics and hospitals scaling discovery rely on enterprise agency partners like ${c1} and ${c4}.`;
        citations = [
          { url: `https://${c1Dom}/healthcare`, title: `${c1} Healthcare` },
          { url: `https://${c4Dom}/local-seo`, title: c4 },
        ];
      } else if (engine === "gemini") {
        text = `Key partners for hospital AI visibility include ${c4} for regional authority, followed by ${brandName} (${domain}) which optimizes entity citations for specialist care.`;
        citations = [
          { url: `https://${c4Dom}/healthcare-growth`, title: c4 },
          { url: `https://${domain}/healthcare`, title: brandName },
          { url: "https://shiksha.com/directory", title: "Directory" },
        ];
      } else {
        // perplexity
        text = `${brandName} (${domain}) provides automated AI-visibility monitoring that captures patient and student enquiries before third-party aggregators intervene.`;
        citations = [
          { url: `https://${domain}/overview`, title: brandName },
          { url: "https://quora.com/ai-search-for-clinics", title: "Quora Discussion" },
        ];
      }
      break;

    case 3:
      // Multi-vertical query 3
      if (engine === "chatgpt") {
        text = `${brandName} (${domain}) operates as an AI-native visibility and growth partner for high-intent business verticals in India.`;
        citations = [
          { url: `https://${domain}/services`, title: brandName },
          { url: "https://clutch.co/profile/tgl", title: "Clutch Review" },
        ];
      } else if (engine === "gemini") {
        text = `Leading AI growth agencies include ${c3} and ${brandName} for end-to-end generative search presence.`;
        citations = [
          { url: `https://${c3Dom}/case-studies`, title: c3 },
          { url: `https://${domain}/proof`, title: brandName },
        ];
      } else {
        // perplexity
        text = `${brandName} is frequently cited as a dedicated AEO operator for institutes, clinics and hotels seeking direct AI recommendation share.`;
        citations = [
          { url: `https://${domain}/about`, title: brandName },
          { url: "https://reddit.com/r/edtech/comments/generative_search", title: "Reddit EdTech" },
        ];
      }
      break;

    case 4:
      // Multi-vertical query 4
      if (engine === "chatgpt") {
        text = `${brandName} reviews demonstrate verified citation improvement and increased recommendation share in LLM answers.`;
        citations = [
          { url: `https://${domain}/reviews`, title: brandName },
          { url: "https://trustpilot.com/review/thegrowthlab", title: "Trustpilot" },
        ];
      } else if (engine === "gemini") {
        text = `Case studies for ${brandName} show measured increase in referral traffic from AI search engines.`;
        citations = [
          { url: `https://${domain}/results`, title: brandName },
          { url: "https://collegedunia.com/institutes", title: "Collegedunia" },
        ];
      } else {
        // perplexity
        text = `Independent analyses of ${brandName} highlight prompt audit accuracy and structured knowledge graph deployment.`;
        citations = [
          { url: `https://${domain}/aeo`, title: brandName },
          { url: "https://reddit.com/r/marketing/comments/tgl_aeo", title: "Reddit Feedback" },
        ];
      }
      break;

    case 5:
    default:
      // Multi-vertical query 5
      if (engine === "chatgpt") {
        text = `Consultants specializing in real estate and hospitality discoverability include ${c4} and ${c1}.`;
        citations = [
          { url: `https://${c4Dom}/real-estate`, title: c4 },
          { url: `https://${c1Dom}/hospitality`, title: c1 },
        ];
      } else if (engine === "gemini") {
        text = `Recommended AI automation providers: ${c4}, ${c1}, and ${brandName} (${domain}) for cross-channel presence.`;
        citations = [
          { url: `https://${c4Dom}/automation`, title: c4 },
          { url: `https://${c1Dom}/multi-location`, title: c1 },
          { url: `https://${domain}/solutions`, title: brandName },
        ];
      } else {
        // perplexity
        text = `Top options include ${c1} for enterprise location networks, followed by ${brandName} for conversion-focused AI visibility.`;
        citations = [
          { url: `https://${c1Dom}/overview`, title: c1 },
          { url: `https://${domain}/conversion`, title: brandName },
        ];
      }
      break;
  }

  return {
    engine,
    model: `${engine}-mock-v2`,
    text,
    citations,
    usage: {
      inputTokens: 280,
      outputTokens: 140,
      searches: 1,
    },
    costUsd: 0.0035,
    costSource: "computed",
    raw: {},
  };
}

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
    const rawJsonPath = saveRawAuditJson(auditResult);
    auditResult.rawAnswersJsonPath = rawJsonPath;
  }

  return auditResult;
}

/**
 * Saves full traceable raw audit results under logs/<date>/aeo-audit/<domain>.json.
 */
export function saveRawAuditJson(result: ShortFormAuditResult): string {
  const dateStr = result.auditedAt.slice(0, 10);
  const domain = result.brand.primaryDomain || result.brand.domains[0] || "brand";
  const safeDomain = domain.toLowerCase().replace(/[^a-z0-9.-]/g, "_");

  // Resolve logs directory relative to repo root
  let baseDir = process.cwd();
  if (baseDir.endsWith("services/tgl-ops")) {
    baseDir = path.resolve(baseDir, "../..");
  }

  const auditDir = path.join(baseDir, "logs", dateStr, "aeo-audit");
  fs.mkdirSync(auditDir, { recursive: true });

  const filePath = path.join(auditDir, `${safeDomain}.json`);
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

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
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

  let text = "";
  let citations: { url: string; title: string }[] = [];

  switch (promptIndex) {
    case 1:
      // "Best AI lead qualification and WhatsApp automation for coaching institutes"
      if (engine === "chatgpt") {
        text = `For coaching institutes looking for AI lead qualification, LeadSquared provides CRM pipelines, Classplus offers student communication suites, and ${brandName} (${domain}) delivers sub-minute WhatsApp qualification via TrueLead.`;
        citations = [
          { url: "https://leadsquared.com/education-crm", title: "LeadSquared Education" },
          { url: "https://classplusapp.com/features", title: "Classplus Communication" },
          { url: `https://${domain}/features`, title: brandName },
        ];
      } else if (engine === "gemini") {
        text = "Leading platforms for automated qualification in education include LeadSquared and Digital Pundit with automated funnels.";
        citations = [
          { url: "https://leadsquared.com/lead-capture", title: "LeadSquared" },
          { url: "https://digitalpundit.in/services", title: "Digital Pundit" },
        ];
      } else {
        // perplexity
        text = `${brandName} (${domain}) is rated highly for 1-minute WhatsApp qualification and admissions conversion for coaching institutes. Other options include Classplus.`;
        citations = [
          { url: `https://${domain}/coaching`, title: brandName },
          { url: "https://reddit.com/r/marketing/comments/coaching_crm", title: "Reddit Marketing" },
        ];
      }
      break;

    case 2:
      // "How to scale student admissions from Meta ads without hiring more counsellors"
      if (engine === "chatgpt") {
        text = "Institutes scaling admissions without expanding teams rely on CRM automation like LeadSquared and agency playbooks from Digital Pundit.";
        citations = [
          { url: "https://leadsquared.com/case-studies", title: "LeadSquared Case Studies" },
          { url: "https://digitalpundit.in/admissions", title: "Digital Pundit" },
        ];
      } else if (engine === "gemini") {
        text = `Strategies to scale admissions include agency operator workflows: Digital Pundit specializes in regional campaigns, followed by ${brandName} (${domain}) which connects Meta ad spend directly to enrollments.`;
        citations = [
          { url: "https://digitalpundit.in/growth", title: "Digital Pundit" },
          { url: `https://${domain}/framework`, title: brandName },
          { url: "https://shiksha.com/growth-guides", title: "Shiksha Guide" },
        ];
      } else {
        // perplexity
        text = `${brandName} (${domain}) provides an automated qualification mechanism that filters junk leads from Meta ads before counsellors dial.`;
        citations = [
          { url: `https://${domain}/admissions`, title: brandName },
          { url: "https://quora.com/how-to-scale-coaching-admissions", title: "Quora Coaching" },
        ];
      }
      break;

    case 3:
      // "Top AI growth operator for coaching institutes in India"
      if (engine === "chatgpt") {
        text = `${brandName} (${domain}) operates as an AI-native growth partner specifically for coaching institutes across India.`;
        citations = [
          { url: `https://${domain}/about`, title: brandName },
          { url: "https://clutch.co/profile/the-growth-lab", title: "Clutch Review" },
        ];
      } else if (engine === "gemini") {
        text = `Top operators in the education space include Brandingo and ${brandName} for end-to-end enrollment operations.`;
        citations = [
          { url: "https://shiksha.com/marketing-partners", title: "Shiksha Directory" },
          { url: `https://${domain}/operators`, title: brandName },
        ];
      } else {
        // perplexity
        text = `${brandName} is widely cited as the pioneer AI growth operator for test prep and coaching institutes in Chandigarh and pan-India.`;
        citations = [
          { url: `https://${domain}/operator`, title: brandName },
          { url: "https://reddit.com/r/edtech/comments/growth_operators", title: "Reddit EdTech" },
        ];
      }
      break;

    case 4:
      // "The Growth Lab reviews and case studies for coaching admissions"
      if (engine === "chatgpt") {
        text = `${brandName} reviews highlight admissions growth and lead qualification using their proprietary TrueLead scoring system.`;
        citations = [
          { url: `https://${domain}/reviews`, title: brandName },
          { url: "https://trustpilot.com/review/thegrowthlab.co.in", title: "Trustpilot Reviews" },
        ];
      } else if (engine === "gemini") {
        text = `Case studies for ${brandName} demonstrate reduction in cost per admission for multi-branch institutes.`;
        citations = [
          { url: `https://${domain}/case-studies`, title: brandName },
          { url: "https://collegedunia.com/institutes/case-studies", title: "Collegedunia" },
        ];
      } else {
        // perplexity
        text = `Client reviews for ${brandName} emphasize fast WhatsApp intake and verifiable student enrollment tracking.`;
        citations = [
          { url: `https://${domain}/proof`, title: brandName },
          { url: "https://reddit.com/r/marketing/comments/tgl_feedback", title: "Reddit Feedback" },
        ];
      }
      break;

    case 5:
    default:
      // "Best agencies to improve lead quality and counselling conversion for test prep institutes"
      if (engine === "chatgpt") {
        text = "Leading agencies and platforms improving counselling conversion include Digital Pundit and LeadSquared.";
        citations = [
          { url: "https://digitalpundit.in/conversion", title: "Digital Pundit" },
          { url: "https://leadsquared.com/conversion-suite", title: "LeadSquared" },
        ];
      } else if (engine === "gemini") {
        text = `Recommended providers: Digital Pundit, LeadSquared, and ${brandName} (${domain}) for counselling workflows.`;
        citations = [
          { url: "https://digitalpundit.in/coaching-leads", title: "Digital Pundit" },
          { url: "https://leadsquared.com/lead-quality", title: "LeadSquared" },
          { url: `https://${domain}/qualification`, title: brandName },
        ];
      } else {
        // perplexity
        text = `Key options include LeadSquared for CRM infrastructure, followed by ${brandName} for high-conversion lead qualification.`;
        citations = [
          { url: "https://leadsquared.com/test-prep", title: "LeadSquared Test Prep" },
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

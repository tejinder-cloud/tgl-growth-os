import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "../../config.js";
import { slackClient, getActorDisplayName, getBotIdentity } from "../../lib/slack-client.js";
import { postLine, postCard } from "../../lib/post.js";
import {
  createIssue,
  appendFileInRepo,
  getIssue,
  addCommentToIssue,
  removeLabelFromIssue,
  addLabelsToIssue,
} from "../../lib/github-client.js";
import { loadAgents, findAgentByName } from "../../lib/agents.js";
import { loadPlanEntries, getCurrentPlanDay, getPlanStatusAnswer } from "../../lib/plan.js";
import { dispatchPlanDay, isEntryAlreadyIssued } from "./dispatch.js";
import {
  checkAgentCostCap,
  callAnthropicWithCostCap,
  usageCostsLedger,
  formatCostUsd,
  getCostLedgerSummary,
  recordCostEntry,
  loadCostLedgerFromState,
  type UsageCostEntry,
} from "../../lib/cost-cap.js";
import { getAnthropicModel, getAnthropicPricing } from "./anthropic.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";

export type IntakeClassification =
  | "task"
  | "report"
  | "question"
  | "decision"
  | "dispatch"
  | "ambiguous"
  | "command_resume"
  | "command_block"
  | "command_setup";

export interface IntakeClassificationResult {
  category: IntakeClassification;
  agent?: string;
  brief?: string;
  clarifyingQuestion?: string;
  decisionText?: string;
  door?: string;
  targetDay?: number;
  issueNumber?: number;
  setupBrand?: string;
  setupMarket?: {
    product: string;
    buyers: string;
    location: string;
  };
  confidence: number;
}

export interface IntakeState {
  version: number;
  lastProcessedTsByChannel: Record<string, string>;
  lastPolledAt: string;
  failedAttemptsByMessageKey?: Record<string, number>;
}

function getIntakeStateFilePath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, "logs/.test/.state/intake.json");
  }
  return path.join(config.repoRoot, "logs/.state/intake.json");
}

let inMemoryLastProcessedTsByChannel: Record<string, string> = {};
let inMemoryFailedAttemptsByMessageKey: Record<string, number> = {};
let processBootTs: string = (Date.now() / 1000).toFixed(6);
let isBootInitialized = false;

export function setBootTimestampForTests(ts: string): void {
  processBootTs = ts;
  isBootInitialized = false;
}

export function resetIntakeStateForTests(): void {
  inMemoryLastProcessedTsByChannel = {};
  inMemoryFailedAttemptsByMessageKey = {};
  isBootInitialized = false;
  hasLoggedImFailure = false;
  const testPath = getIntakeStateFilePath(true);
  if (fs.existsSync(testPath)) {
    try {
      fs.unlinkSync(testPath);
    } catch {}
  }
}

export function loadIntakeState(testMode = isTestMode()): IntakeState {
  const filePath = getIntakeStateFilePath(testMode);
  let state: IntakeState = {
    version: 1,
    lastProcessedTsByChannel: { ...inMemoryLastProcessedTsByChannel },
    lastPolledAt: new Date().toISOString(),
    failedAttemptsByMessageKey: { ...inMemoryFailedAttemptsByMessageKey },
  };

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.lastProcessedTsByChannel === "object") {
        state = {
          version: parsed.version || 1,
          lastProcessedTsByChannel: { ...inMemoryLastProcessedTsByChannel, ...parsed.lastProcessedTsByChannel },
          lastPolledAt: parsed.lastPolledAt || new Date().toISOString(),
          failedAttemptsByMessageKey: {
            ...inMemoryFailedAttemptsByMessageKey,
            ...(parsed.failedAttemptsByMessageKey || {}),
          },
        };
      }
    } catch (err) {
      console.warn("[Intake State Load Warning]", err);
    }
  }

  inMemoryLastProcessedTsByChannel = { ...state.lastProcessedTsByChannel };
  inMemoryFailedAttemptsByMessageKey = { ...(state.failedAttemptsByMessageKey || {}) };
  return state;
}

export function saveIntakeState(state: IntakeState, testMode = isTestMode()): void {
  inMemoryLastProcessedTsByChannel = { ...state.lastProcessedTsByChannel };
  inMemoryFailedAttemptsByMessageKey = { ...(state.failedAttemptsByMessageKey || {}) };
  const filePath = getIntakeStateFilePath(testMode);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[Intake State Save Warning]", err);
  }
}

/**
 * Classifies an incoming message from the Architect via Anthropic.
 */
export async function classifyArchitectMessage(
  messageText: string,
  options?: { testMode?: boolean }
): Promise<IntakeClassificationResult & { tokens: { input: number; output: number; costUsd: number } }> {
  const isTest = options?.testMode === true || isTestMode();
  const modelName = getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();

  // Architect Operational Commands: "#N: resume" and "#N: block"
  const cleanCmdText = messageText.replace(/^[*_~`]+|[*_~`]+$/g, "").trim();
  const resumeCmdMatch = cleanCmdText.match(/^(?:issue\s*)?#?(\d+)\s*:\s*resume\b/i);
  if (resumeCmdMatch) {
    const issueNum = parseInt(resumeCmdMatch[1], 10);
    return {
      category: "command_resume",
      issueNumber: issueNum,
      confidence: 1.0,
      brief: messageText,
      tokens: { input: 0, output: 0, costUsd: 0 },
    };
  }

  const blockCmdMatch = cleanCmdText.match(/^(?:issue\s*)?#?(\d+)\s*:\s*block\b/i);
  if (blockCmdMatch) {
    const issueNum = parseInt(blockCmdMatch[1], 10);
    return {
      category: "command_block",
      issueNumber: issueNum,
      confidence: 1.0,
      brief: messageText,
      tokens: { input: 0, output: 0, costUsd: 0 },
    };
  }

  // Architect Operational Command: "setup <brand>: product = ...; buyers = ...; location = ..."
  const setupCmdMatch = cleanCmdText.match(/^setup\s+([^:]+):\s*(.+)$/i);
  if (setupCmdMatch) {
    const brandTarget = setupCmdMatch[1].trim();
    const paramsStr = setupCmdMatch[2].trim();
    const productM = /(?:product|category)\s*=\s*([^;\n]+)/i.exec(paramsStr);
    const buyersM = /(?:buyers?|icp|audience)\s*=\s*([^;\n]+)/i.exec(paramsStr);
    const locationM = /(?:location|city|region)\s*=\s*([^;\n]+)/i.exec(paramsStr);
    if (productM && buyersM && locationM) {
      return {
        category: "command_setup",
        setupBrand: brandTarget,
        setupMarket: {
          product: productM[1].trim(),
          buyers: buyersM[1].trim(),
          location: locationM[1].trim(),
        },
        confidence: 1.0,
        brief: messageText,
        tokens: { input: 0, output: 0, costUsd: 0 },
      };
    }
  }

  // Test mode deterministic classifier if no API key
  if (isTest && !config.anthropicApiKey) {
    const text = messageText.toLowerCase().trim();
    let cat: IntakeClassification = "question";
    let agent = "web-builder";
    let targetDay: number | undefined;

    // Check if the message names an issue (#N) with an instruction
    const issueMatch = messageText.match(/#(\d+)\b/);
    if (
      issueMatch &&
      (/(?:finish|resume|continue|complete|fix|work on|re-run|run|build|update|implement|proceed|do)\b/i.test(text) ||
        /(?:short-form|runner|pdf|lines left|remaining)/i.test(text))
    ) {
      const issueNum = parseInt(issueMatch[1], 10);
      recordCostEntry(
        {
          timestamp: new Date().toISOString(),
          issueNumber: issueNum,
          agent: "chief-of-staff",
          model: "claude-3-5-sonnet",
          inputTokens: 100,
          outputTokens: 50,
          totalCostUsd: 0.001,
        },
        options
      );
      return {
        category: "task",
        agent: "web-builder",
        door: "aeo",
        brief: messageText,
        confidence: 0.99,
        issueNumber: issueNum,
        tokens: { input: 100, output: 50, costUsd: 0.001 },
      };
    }

    if (/^(?:go\b|say go|day\s*(\d+)|dispatch\s*(?:day\s*)?(\d+)?)/i.test(text)) {
      cat = "dispatch";
      const match = text.match(/(?:day\s*|dispatch\s*(?:day\s*)?)(\d+)/i);
      targetDay = match ? parseInt(match[1], 10) : undefined;
      return {
        category: "dispatch",
        agent: "chief-of-staff",
        brief: messageText,
        confidence: 0.98,
        targetDay,
        tokens: { input: 100, output: 50, costUsd: 0.001 },
      };
    } else if (/^build|^create|^implement|^fix|^deploy|^task:/i.test(text)) {
      cat = "task";
      if (/research|prospect|lead|places/i.test(text)) agent = "prospect-researcher";
      else if (/copy|design|brand|visual/i.test(text)) agent = "creative-director";
      else if (/video/i.test(text)) agent = "video-team";
      else agent = "web-builder";
    } else if (/(?:counts? by|by (?:city|status|day))/i.test(text)) {
      cat = "question";
    } else if (/^report\b/i.test(text) || /(?:daily |ops |status )?report$/i.test(text.trim())) {
      cat = "report";
    } else if (/^decide|^decision:|^approved:|^we will /i.test(text)) {
      cat = "decision";
    } else if (/^maybe|^not sure|^how about|^what if|^consider|^we could|^should we|^let's think/i.test(text)) {
      cat = "ambiguous";
    } else {
      cat = "question";
    }

    recordCostEntry(
      {
        timestamp: new Date().toISOString(),
        issueNumber: 0,
        agent: "chief-of-staff",
        model: "claude-3-5-sonnet",
        inputTokens: 100,
        outputTokens: 50,
        totalCostUsd: 0.001,
      },
      options
    );

    return {
      category: cat,
      agent,
      brief: messageText,
      confidence: 0.95,
      targetDay,
      decisionText: cat === "decision" ? messageText : undefined,
      clarifyingQuestion: cat === "ambiguous" ? "Could you clarify the exact scope and target files for this request?" : undefined,
      tokens: { input: 100, output: 50, costUsd: 0.001 },
    };
  }

  const prompt = `You are the intake classifier for The Growth Lab's Chief of Staff.
Your job is to read an inbound message from the Architect (Tejinder Singh) and classify it into exactly one of six categories:
1. "dispatch": The Architect is triggering or directing the dispatch of a plan day (e.g. "go", "say go", "day 8", "day 9", "dispatch day 9", "proceed with day 8").
   - Extract "targetDay" as an integer if a specific day is named (e.g. 9 for "day 9"). If just "go", omit or leave null.
2. "task": The Architect is requesting work to be built, fixed, updated, researched, or executed, OR instructing action on an issue (e.g. "finish #53 — ...", "resume #53", "fix #12").
   - Extract "issueNumber" as an integer if an issue (#N) is mentioned.
   - Extract the best matching agent name (e.g. web-builder, creative-director, prospect-researcher, chief-of-staff, video-team, etc.).
   - Rewrite the brief in that agent's professional craft terms.
3. "report": The Architect is requesting a report or using the directive "Report ..." (e.g. "report", "Report current spend", "daily report", "ops report", "status report", "compile report"). Reserve the "report" category strictly for requests asking for a report. Queries asking for counts without asking for a report (e.g. "counts by city", "counts by status", "counts by day", "what did we spend today?", "how many prospects in Delhi?") are "question", NOT "report".
4. "question": The Architect is asking a question or querying metrics without requesting a report (e.g. "counts by city", "counts by status", "counts by day", "what did we spend today?", "how many prospects in Delhi?").
5. "decision": The Architect is stating a strategic or architectural decision to be permanently recorded.
6. "ambiguous": The message is vague, underspecified, or ambiguous (e.g. "maybe we should look at something", "not sure what to do next"). Provide exactly one sharp clarifying question.

Message: "${messageText}"

Respond ONLY with a JSON object:
{
  "category": "dispatch" | "task" | "report" | "question" | "decision" | "ambiguous",
  "targetDay": number (optional, for dispatch),
  "issueNumber": number (optional, for existing issue tasks),
  "agent": "string (for tasks)",
  "door": "core" | "aeo" | "ai" | "truelead",
  "brief": "rewritten brief in agent terms (for tasks)",
  "decisionText": "exact decision statement (for decisions)",
  "clarifyingQuestion": "one sharp clarifying question (for ambiguous)",
  "confidence": number between 0 and 1
}`;

  const res = await callAnthropicWithCostCap({
    agent: "chief-of-staff",
    params: {
      model: modelName,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    },
    options: { testMode: isTest },
  });

  const rawText = res.content[0]?.type === "text" ? res.content[0].text : "{}";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { category: "question", confidence: 0.5 };

  let category: IntakeClassification = parsed.category || "question";
  let issueNumber: number | undefined = parsed.issueNumber ? Number(parsed.issueNumber) : undefined;
  const issueMatch = messageText.match(/#(\d+)\b/);
  if (
    issueMatch &&
    (category === "task" ||
      issueNumber ||
      /(?:finish|resume|continue|complete|fix|work on|re-run|run|build|update|implement|proceed|do)\b/i.test(messageText) ||
      /(?:short-form|runner|pdf|lines left|remaining)/i.test(messageText))
  ) {
    category = "task";
    issueNumber = issueNumber || parseInt(issueMatch[1], 10);
  }

  const inputTokens = res.usage?.input_tokens || 0;
  const outputTokens = res.usage?.output_tokens || 0;
  const costUsd = Number(((inputTokens * priceInPerMTok + outputTokens * priceOutPerMTok) / 1_000_000).toFixed(4));

  return {
    category,
    agent: parsed.agent,
    door: parsed.door || "core",
    brief: parsed.brief || messageText,
    decisionText: parsed.decisionText,
    targetDay: parsed.targetDay ? Number(parsed.targetDay) : undefined,
    issueNumber,
    clarifyingQuestion: parsed.clarifyingQuestion,
    confidence: parsed.confidence || 0.9,
    tokens: { input: inputTokens, output: outputTokens, costUsd },
  };
}

/**
 * Compiles a real-time factual report for the Architect.
 * Every figure is strictly sourced, blanks as "—", never estimated.
 */
export async function compileArchitectReport(options?: { testMode?: boolean }): Promise<string> {
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();

  // 1. Gather spend from persistent cost ledger
  const ledgerSummary = getCostLedgerSummary(dateStr, options);
  const totalSpend = ledgerSummary.totalSpendUsd;
  const runsCount = ledgerSummary.runsCount;

  const agentBreakdown = Object.entries(ledgerSummary.byAgent)
    .map(([ag, info]) => {
      const parts = [];
      if (info.llmSpendUsd > 0) parts.push(`${formatCostUsd(info.llmSpendUsd)} LLM`);
      if (info.apiSpendUsd > 0) parts.push(`${formatCostUsd(info.apiSpendUsd)} API`);
      const typeStr = parts.length > 1 ? ` (${parts.join(" + ")})` : "";
      return `@${ag}: ${formatCostUsd(info.spendUsd)}${typeStr} [${info.runs}]`;
    })
    .join(", ");

  let spendLine = `• *Total LLM Spend Today:* ${formatCostUsd(totalSpend)} (${runsCount} call${runsCount === 1 ? "" : "s"}`;
  if (ledgerSummary.apiSpendUsd > 0) {
    spendLine = `• *Total Spend Today (Total LLM Spend Today ${formatCostUsd(ledgerSummary.llmSpendUsd)} + API ${formatCostUsd(ledgerSummary.apiSpendUsd)}):* ${formatCostUsd(totalSpend)} (${runsCount} call${runsCount === 1 ? "" : "s"}`;
  }

  if (agentBreakdown) {
    spendLine += ` · ${agentBreakdown})`;
  } else {
    spendLine += `)`;
  }

  // 2. Count prospect database rows strictly from SQL
  let prospectsTotal = "—";
  let prospectsReviewed = "—";
  let citySummary = "";
  try {
    const { getProspectMetricsFromSql } = await import("../prospect-researcher/db.js");
    const metrics = await getProspectMetricsFromSql(options);
    prospectsTotal = String(metrics.total);
    prospectsReviewed = String(metrics.byStatus["reviewed"] || 0);
    const cityList = Object.entries(metrics.byCity)
      .map(([c, n]) => `${c}: ${n}`)
      .join(", ");
    if (cityList) {
      citySummary = ` (${cityList})`;
    }
  } catch {}

  // 3. Count plan entries
  let planTotal = "—";
  try {
    const plan = await loadPlanEntries(options);
    planTotal = String(plan.length);
  } catch {}

  return `*The Growth Lab Ops Report — ${dateStr} ${timeStr} IST*
${spendLine}
• *Prospects Database:* ${prospectsTotal} sourced${citySummary} · ${prospectsReviewed} reviewed
• *Plan Entries Active:* ${planTotal} scheduled (Days 8–68)
• *GHL Inbound Pipeline:* — (Awaiting live webhook sync)
_All figures verified from Supabase, logs/, and runtime ledger._`;
}

/**
 * Answers questions asked by the Architect.
 * Specifically queries SQL (Supabase public.prospects) for counts by city, status, or day,
 * queries the cost ledger for real spend per call, or answers operational questions.
 */
export async function answerArchitectQuestion(
  questionText: string,
  options?: {
    testMode?: boolean;
    mockProspects?: any[];
    mockPlanEntries?: any[];
    mockIssues?: any[];
    mockCurrentDay?: number;
    channel?: string;
    thread_ts?: string;
  }
): Promise<string> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = getTodayDateString();
  const q = questionText.toLowerCase().trim();

  // 1. Spend / Cost / Ledger inquiries
  if (/spend|cost|ledger|expense|token spend|budget/i.test(q)) {
    const summary = getCostLedgerSummary(dateStr, options);
    if (summary.runsCount === 0) {
      return `*LLM Spend & Cost Ledger Today (${dateStr}):*\n• *Total Spend:* $0.00 (0 calls recorded today)\n_Verified from runtime cost ledger._`;
    }

    const callLines = summary.entries
      .slice(-15)
      .map((e, idx) => {
        const timePart = e.timestamp.includes("T") ? e.timestamp.split("T")[1].slice(0, 5) + " IST" : "";
        const issuePart = e.issueNumber > 0 ? ` · #${e.issueNumber}` : "";
        const typePart = e.costType === "api" ? ` [API: ${e.apiName || e.model}]` : ` [LLM: ${e.model}]`;
        const detailsPart = e.details ? ` (${e.details})` : (e.inputTokens || e.outputTokens ? ` (${e.inputTokens} in, ${e.outputTokens} out)` : "");
        return `  ${idx + 1}. ${timePart ? `${timePart} · ` : ""}@${e.agent}${issuePart}: ${formatCostUsd(e.totalCostUsd)}${typePart}${detailsPart}`;
      })
      .join("\n");

    const agentBreakdown = Object.entries(summary.byAgent)
      .map(([ag, info]) => {
        const parts = [];
        if (info.llmSpendUsd > 0) parts.push(`${formatCostUsd(info.llmSpendUsd)} LLM`);
        if (info.apiSpendUsd > 0) parts.push(`${formatCostUsd(info.apiSpendUsd)} API`);
        const typeStr = parts.length > 1 ? ` (${parts.join(" + ")})` : "";
        return `• *@${ag}:* ${formatCostUsd(info.spendUsd)}${typeStr} (${info.runs} call${info.runs === 1 ? "" : "s"})`;
      })
      .join("\n");

    const typeTotals = summary.apiSpendUsd > 0
      ? ` (${formatCostUsd(summary.llmSpendUsd)} LLM + ${formatCostUsd(summary.apiSpendUsd)} API)`
      : "";

    return `*LLM Spend & Cost Ledger Today (${dateStr}):*
• *Total Spend:* ${formatCostUsd(summary.totalSpendUsd)} across ${summary.runsCount} call${summary.runsCount === 1 ? "" : "s"}${typeTotals}

*By Agent:*
${agentBreakdown}

*Per-Call Ledger (Real spend per call):*
${callLines}
_Verified from logs/.state/cost-ledger.json and daily logs._`;
  }

  // 2. Plan status inquiries
  // Route any question containing "plan", "day N", "phase", "gate",
  // or "what's today's status" / "today's status" directly here, NEVER to prospects!
  const isPlanQuery =
    /\bplan\b|\bphase\b|\bgate\b/i.test(q) ||
    /\bday\s*(?:\d+|n\b)/i.test(q) ||
    /today['’]?s\s*status|status\s*(?:for\s*)?today|what(?:'s|\s+is)\s+today/i.test(q);

  if (isPlanQuery) {
    return await getPlanStatusAnswer(options as any);
  }

  // 3. Prospect database queries (counts by city, by status, by day from SQL)
  const isCityQuery = /city|cities|metro|delhi|mumbai|bangalore|bengaluru/i.test(q);
  const isStatusQuery = /status|statuses|reviewed|approved|rejected|new|handed_to_outreach/i.test(q);
  const isDayQuery = /by day|counts? by day|prospects? by day|days? breakdown/i.test(q);
  const isGeneralCountsQuery = /counts?|prospects?|how many prospects|prospect pipeline|prospect database|prospect rows|prospect records/i.test(q);

  if (isCityQuery || isStatusQuery || isDayQuery || isGeneralCountsQuery) {
    const {
      getProspectMetricsFromSql,
      formatProspectCityCounts,
      formatProspectStatusCounts,
      formatProspectDayCounts,
      formatAllProspectCounts,
    } = await import("../prospect-researcher/db.js");

    const metrics = await getProspectMetricsFromSql(options);

    // Specific: Counts by city
    if (isCityQuery && !isStatusQuery && !isDayQuery) {
      return formatProspectCityCounts(metrics);
    }

    // Specific: Counts by status
    if (isStatusQuery && !isCityQuery && !isDayQuery) {
      return formatProspectStatusCounts(metrics);
    }

    // Specific: Counts by day
    if (isDayQuery && !isCityQuery && !isStatusQuery) {
      return formatProspectDayCounts(metrics);
    }

    // Comprehensive breakdown
    return formatAllProspectCounts(metrics);
  }

  // 4. Fallback for other general questions
  if (config.anthropicApiKey && !isTest) {
    try {
      const modelName = getAnthropicModel();
      const prompt = `You are the Chief of Staff at The Growth Lab. Answer the Architect's question concisely, numerically, and factually based on our operations:
Architect Question: "${questionText}"
Reference files: config/plan.yaml, config/agents.yaml, AGENTS.md, logs/${dateStr}/.
Answer in 1-3 lines maximum. Zero corporate fluff. Never provide a summary of files read. If the question lacks sufficient detail or data to answer, ask one sharp clarifying question.`;

      const response = await callAnthropicWithCostCap({
        agent: "chief-of-staff",
        params: {
          model: modelName,
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        },
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      if (text.trim() && !text.includes("I've verified our current records") && !text.includes("Relevant files:")) {
        return `*Chief of Staff Response:*\n${text.trim()}`;
      }
    } catch {}
  }

  return `*Chief of Staff Clarification:*\nCould you specify which metric, agent, or plan day you need data for?`;
}

let hasLoggedImFailure = false;

export function resetImFailureLoggedForTests(): void {
  hasLoggedImFailure = false;
}

export let lastTriggeredRunnerIssue: number | null = null;

export function resetLastTriggeredRunnerIssueForTests(): void {
  lastTriggeredRunnerIssue = null;
}

/**
 * Polls #architect channel and direct bot DMs for Architect messages.
 * Classifies and dispatches each message.
 */
export async function pollChiefOfStaffIntake(options?: {
  testMode?: boolean;
  mockMessages?: any[];
  triggerRunnerInTestMode?: boolean;
}): Promise<{
  polledCount: number;
  processedCount: number;
}> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();

  // 1. Check Chief of Staff daily cost cap before running intake
  const costCheck = await checkAgentCostCap("chief-of-staff");
  if (!costCheck.allowed) {
    console.warn(`[Chief of Staff Intake] Daily cost cap reached ($${costCheck.currentSpend.toFixed(2)} >= $${costCheck.cap.toFixed(2)}). Intake paused.`);
    return { polledCount: 0, processedCount: 0 };
  }

  // 2. Read intake state before poll
  const state = loadIntakeState(isTest);
  const channelsToPoll: string[] = [];

  // Read channel strictly from ARCHITECT_CHANNEL_ID, never by channel name (e.g. #architect)
  if (config.architectChannelId && !config.architectChannelId.startsWith("#")) {
    channelsToPoll.push(config.architectChannelId);
  } else if (isTest && config.architectChannelId) {
    channelsToPoll.push(config.architectChannelId);
  }

  // Also query direct IM channels if Slack token available
  if (config.slackBotToken && !isTest) {
    try {
      const convos = await slackClient.conversations.list({ types: "im", limit: 10 });
      if (convos.channels) {
        for (const c of convos.channels) {
          if (c.id && !channelsToPoll.includes(c.id)) {
            channelsToPoll.push(c.id);
          }
        }
      }
    } catch (err: any) {
      if (!hasLoggedImFailure) {
        console.warn(`[Intake] IM access unavailable (${err.message}) — polling #architect channel only.`);
        hasLoggedImFailure = true;
      }
    }
  }

  if (channelsToPoll.length === 0) {
    return { polledCount: 0, processedCount: 0 };
  }

  // 3. On boot, start from "now", not from channel history
  if (!isBootInitialized) {
    for (const channel of channelsToPoll) {
      if (!state.lastProcessedTsByChannel[channel] || Number(state.lastProcessedTsByChannel[channel]) < Number(processBootTs)) {
        state.lastProcessedTsByChannel[channel] = processBootTs;
      }
    }
    saveIntakeState(state, isTest);
    isBootInitialized = true;
  }

  const botIdentity = await getBotIdentity();
  let polledCount = 0;
  let processedCount = 0;

  for (const channel of channelsToPoll) {
    let lastTs = state.lastProcessedTsByChannel[channel];
    let messages: any[] = [];

    if (config.slackBotToken && !isTest) {
      try {
        const historyParams: any = { channel, limit: 20 };
        if (lastTs) {
          historyParams.oldest = lastTs;
        }
        const history = await slackClient.conversations.history(historyParams);
        messages = history.messages || [];
      } catch (err: any) {
        if (channel === config.architectChannelId) {
          console.warn(`[Intake] Error reading architect channel ${channel}:`, err.message);
        } else {
          if (!hasLoggedImFailure) {
            console.warn(`[Intake] Error reading IM channel ${channel} (${err.message}) — continuing with #architect channel only.`);
            hasLoggedImFailure = true;
          }
        }
        continue; // Never fail the whole intake because DMs or an individual channel are unavailable
      }
    } else if (isTest && options?.mockMessages) {
      messages = options.mockMessages;
    }

    // Sort ascending by ts (oldest first) so messages are processed in chronological order
    const sortedMessages = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));

    for (const msg of sortedMessages) {
      polledCount++;

      // 1. Never process a message older than or equal to last processed ts
      if (lastTs && Number(msg.ts) <= Number(lastTs)) {
        continue;
      }

      // 2. Ignore the bot's own messages and thread replies it authored
      const isBotAuthor = Boolean(
        msg.bot_id ||
        msg.app_id ||
        msg.subtype === "bot_message" ||
        (botIdentity.userId && msg.user === botIdentity.userId) ||
        (botIdentity.botId && msg.bot_id === botIdentity.botId)
      );

      if (isBotAuthor) {
        if (!lastTs || Number(msg.ts) > Number(lastTs)) {
          lastTs = msg.ts;
          state.lastProcessedTsByChannel[channel] = lastTs;
          saveIntakeState(state, isTest);
        }
        continue;
      }

      const text = msg.text?.trim() || "";
      if (!text) {
        if (!lastTs || Number(msg.ts) > Number(lastTs)) {
          lastTs = msg.ts;
          state.lastProcessedTsByChannel[channel] = lastTs;
          saveIntakeState(state, isTest);
        }
        continue;
      }

      // Process Architect message
      const classification = await classifyArchitectMessage(text, { testMode: isTest });

      // Log intake token cost
      const logLine = `- ${timeStr} IST — Intake classification [${classification.category}]: ${classification.tokens.input} input, ${classification.tokens.output} output · Cost: $${classification.tokens.costUsd.toFixed(4)}`;
      if (isTest) {
        const testLogsDir = path.join(config.repoRoot, "logs/.test");
        fs.mkdirSync(testLogsDir, { recursive: true });
        fs.appendFileSync(path.join(testLogsDir, "chief-of-staff.md"), logLine + "\n", "utf8");
      } else {
        await appendFileInRepo(
          `logs/${dateStr}/chief-of-staff.md`,
          logLine,
          `chore(intake): log Architect message intake for ${dateStr}`
        ).catch(() => {});
      }

      // Execute response by category
      const threadTs = msg.ts;
      const msgKey = `${channel}:${msg.ts}`;
      const prevFailures = state.failedAttemptsByMessageKey?.[msgKey] || 0;
      let postResult: { ok: boolean; error?: string } = { ok: true };

      try {
        if (classification.category === "command_resume" && classification.issueNumber) {
          const issueNum = classification.issueNumber;
          const existingIssue = await getIssue(issueNum);

          // 1. Add Architect command comment
          await addCommentToIssue(
            issueNum,
            `**Architect Command (via Slack intake):** Resumed via \`#${issueNum}: resume\`. Cleared recovery attempts, removed status:blocked, set status:in-progress, and re-queued.`
          );

          // 2. Identify assigned agent
          let assignedAgent = "web-builder";
          if (existingIssue) {
            const forLabel = existingIssue.labels.find((l) => l.startsWith("for:"));
            if (forLabel) {
              assignedAgent = forLabel.replace(/^for:/, "");
            }
          }

          // 3. GitHub labels: remove status:blocked and status:needs-brief, add status:in-progress
          await removeLabelFromIssue(issueNum, "status:blocked").catch(() => {});
          await removeLabelFromIssue(issueNum, "status:needs-brief").catch(() => {});
          await addLabelsToIssue(issueNum, ["status:in-progress", `for:${assignedAgent}`]).catch(() => {});

          // 4. Door and channel
          let door = "core";
          if (existingIssue) {
            const doorLabel = existingIssue.labels.find((l) => l.startsWith("door:"));
            if (doorLabel) {
              door = doorLabel.replace(/^door:/, "");
            }
          }
          const doorChannel = `#doors-${door}`;

          // 5. Clear recoveryAttempts in runner state, release any active claim, and set status:in-progress
          const { resetRunnerIssue } = await import("../../runner/state.js");
          await resetRunnerIssue(
            issueNum,
            {
              agent: assignedAgent,
              door,
              title: existingIssue?.title || `Issue #${issueNum}`,
            },
            { testMode: isTest }
          );

          // 6. Re-queue once: trigger runner
          lastTriggeredRunnerIssue = issueNum;
          try {
            if (!isTest || options?.triggerRunnerInTestMode) {
              const { runIssueTask } = await import("../../runner/runner.js");
              const issueInput = {
                number: issueNum,
                title: existingIssue?.title || `Issue #${issueNum}`,
                body: existingIssue?.body || "",
                labels: existingIssue?.labels || ["status:in-progress", `for:${assignedAgent}`, `door:${door}`],
                html_url: existingIssue?.html_url,
                agentName: assignedAgent,
                door,
                slackChannel: channel,
                slackThreadTs: threadTs,
              };
              runIssueTask(issueInput, { testMode: isTest }).catch((err) => {
                console.warn(`[Intake] Error executing runner for issue #${issueNum}:`, err);
              });
            } else {
              console.log(`[Intake Test Mode] Runner re-queued for issue #${issueNum} (@${assignedAgent})`);
            }
          } catch (err: any) {
            console.warn(`[Intake] Could not trigger runner for issue #${issueNum}:`, err?.message || String(err));
          }

          // 7. Reply in-thread
          const replyText = `→ @${assignedAgent}, #${issueNum} resumed, re-queued.`;
          postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else if (classification.category === "command_block" && classification.issueNumber) {
          const issueNum = classification.issueNumber;

          // 1. Add Architect command comment
          await addCommentToIssue(
            issueNum,
            `**Architect Command (via Slack intake):** Halted via \`#${issueNum}: block\`. Status set to **status:blocked**.`
          );

          // 2. GitHub labels: remove status:in-progress, add status:blocked
          await removeLabelFromIssue(issueNum, "status:in-progress").catch(() => {});
          await addLabelsToIssue(issueNum, ["status:blocked"]).catch(() => {});

          // 3. Update runner state and release claim
          const { releaseRunnerClaim } = await import("../../runner/state.js");
          await releaseRunnerClaim(
            issueNum,
            undefined,
            {
              status: "blocked",
              error: "Blocked by Architect command (#N: block).",
              runCompletedAt: new Date().toISOString(),
            },
            { testMode: isTest }
          );

          // 4. Reply in-thread
          const replyText = `→ #${issueNum} blocked.`;
          postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else if (classification.category === "command_setup" && classification.setupBrand && classification.setupMarket) {
          const brandTarget = classification.setupBrand;
          const market = classification.setupMarket;
          const actor = await getActorDisplayName(msg.user);
          const time = getCurrentTimeIST();
          const today = getTodayDateString();

          const { getSupabase } = await import("../prospect-researcher/db.js");
          const sb = getSupabase();

          let brandName = brandTarget;
          let brandId: string | null = null;
          let tenantId = "tgl";

          if (sb) {
            const { data: b } = await sb
              .from("brands")
              .select("id, tenant_id, name, setup_status, setup_note")
              .or(`name.ilike.%${brandTarget}%,primary_domain.ilike.%${brandTarget}%`)
              .limit(1)
              .maybeSingle();

            if (b) {
              brandName = b.name;
              brandId = b.id;
              tenantId = b.tenant_id;

              // 1. Write products_icps directly
              const { data: existingMarket } = await sb
                .from("products_icps")
                .select("id")
                .eq("brand_id", brandId)
                .limit(1);

              if (existingMarket && existingMarket.length > 0) {
                await sb
                  .from("products_icps")
                  .update({
                    product: market.product,
                    icp: market.buyers,
                    location: market.location,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", existingMarket[0].id);
              } else {
                await sb.from("products_icps").insert({
                  tenant_id: tenantId,
                  brand_id: brandId,
                  product: market.product,
                  icp: market.buyers,
                  location: market.location,
                });
              }

              // 2. Set brand to needs_changes with persistent setup_note
              const noteText = `Architect market wording: product = ${market.product}; buyers = ${market.buyers}; location = ${market.location}`;
              await sb
                .from("brands")
                .update({
                  setup_status: "needs_changes",
                  setup_note: noteText,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", brandId);
            }
          }

          // 3. Log decision line to decisions/<date>.md
          const decisionLine = `- ${time} IST · ${actor} · DECISION · chief-of-staff · Market wording updated for ${brandName}: product = ${market.product}; buyers = ${market.buyers}; location = ${market.location}`;
          if (isTest) {
            const decisionsPath = path.join(config.repoRoot, `logs/.test/decisions/${today}.md`);
            fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
            fs.appendFileSync(decisionsPath, decisionLine + "\n", "utf8");
          } else {
            await appendFileInRepo(
              `decisions/${today}.md`,
              decisionLine,
              `chore(decision): update market wording for ${brandName} per ${actor}`
            ).catch((e) => console.warn("[Intake] Decision log failed:", e));
          }

          // 4. Reply in-thread
          const replyText = `Market wording updated for *${brandName}*:\n• *Product:* ${market.product}\n• *Buyers:* ${market.buyers}\n• *Location:* ${market.location}\n\nStatus set to \`needs_changes\`. Strategist will propose prompts and competitors for this market.`;
          postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else if (classification.category === "task") {
          if (classification.issueNumber) {
            const issueNum = classification.issueNumber;
            const existingIssue = await getIssue(issueNum);

            // 1. Add Architect's text as a comment
            await addCommentToIssue(
              issueNum,
              `**Architect Instruction (via Slack intake):**\n\n${text}`
            );

            // 2. Identify assigned agent: web-builder for build issues
            const isBuildIssue =
              existingIssue?.labels.some((l) => l === "type:build") ||
              /(?:runner|pdf|build|code|engine|script|app|short-form)/i.test(text) ||
              (existingIssue && /(?:runner|pdf|build|code|engine|script|app|short-form)/i.test(existingIssue.title));

            let assignedAgent = "web-builder";
            if (existingIssue) {
              const forLabel = existingIssue.labels.find((l) => l.startsWith("for:"));
              if (forLabel && !isBuildIssue) {
                assignedAgent = forLabel.replace(/^for:/, "");
              }
            }
            if (classification.agent && !isBuildIssue) {
              assignedAgent = classification.agent;
            }

            // 3. Set status:in-progress for the issue's agent
            await removeLabelFromIssue(issueNum, "status:needs-brief");
            await removeLabelFromIssue(issueNum, "status:blocked");
            await addLabelsToIssue(issueNum, ["status:in-progress", `for:${assignedAgent}`]);

            // 4. Derive door and channel
            let door = classification.door || "aeo";
            if (existingIssue) {
              const doorLabel = existingIssue.labels.find((l) => l.startsWith("door:"));
              if (doorLabel) {
                door = doorLabel.replace(/^door:/, "");
              }
            }
            const doorChannel = `#doors-${door}`;

            // 5. Trigger runner
            lastTriggeredRunnerIssue = issueNum;
            try {
              if (!isTest || options?.triggerRunnerInTestMode) {
                const { runIssueTask } = await import("../../runner/runner.js");
                const issueInput = {
                  number: issueNum,
                  title: existingIssue?.title || `Issue #${issueNum}`,
                  body: existingIssue?.body || "",
                  labels: existingIssue?.labels || ["type:build", "status:in-progress", `for:${assignedAgent}`, `door:${door}`],
                  html_url: existingIssue?.html_url,
                  agentName: assignedAgent,
                  door,
                  slackChannel: channel,
                  slackThreadTs: threadTs,
                };
                runIssueTask(issueInput, { testMode: isTest }).catch((err) => {
                  console.warn(`[Intake] Error executing runner for issue #${issueNum}:`, err);
                });
              } else {
                console.log(`[Intake Test Mode] Runner triggered for issue #${issueNum} (@${assignedAgent})`);
              }
            } catch (err: any) {
              console.warn(`[Intake] Could not trigger runner for issue #${issueNum}:`, err?.message || String(err));
            }

            // 6. Reply in-thread
            const replyText = `→ @${assignedAgent}, #${issueNum} resumed, card in ${doorChannel}`;
            postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
          } else {
            const rawAgent = classification.agent || "web-builder";
            const agentRecord = await findAgentByName(rawAgent);

            if (agentRecord) {
              // Agent exists: open issue and post card
              const brief = classification.brief || text;
              const issueRes = await createIssue({
                title: `[TASK]: ${text.slice(0, 60)}`,
                body: `### for-agent\n${agentRecord.name}\n\n### door\n${classification.door || "core"}\n\n### deliverable\n${brief}\n\n### reviewer\n${agentRecord.reviewer || "Creative Director"}\n`,
                labels: [`for:${agentRecord.name}`, `door:${classification.door || "core"}`, "type:build", "status:in-progress"],
              });

              const replyText = `• *Assigned Agent:* \`@${agentRecord.name}\`\n• *Issue:* <${issueRes.html_url}|#${issueRes.number}>\n• *Expected Completion:* ~1–2 hours`;
              postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
            } else {
              // Agent does not exist yet: check config/plan.yaml to find arrival day
              const allPlan = await loadPlanEntries({ testMode: isTest });
              const plannedEntry = allPlan.find((e) => e.agent === rawAgent);
              const arrivalNote = plannedEntry
                ? `Agent \`@${rawAgent}\` arrives on *Plan Day ${plannedEntry.day}*.`
                : `Agent \`@${rawAgent}\` is not yet provisioned in the roster.`;

              const replyText = `${arrivalNote}\n*Nearest available action:* \`@chief-of-staff\` can coordinate manually or \`@web-builder\` can scaffold.`;
              postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
            }
          }
        } else if (classification.category === "dispatch") {
          let targetDay = classification.targetDay;
          if (!targetDay) {
            const curDay = await getCurrentPlanDay({ testMode: isTest });
            const all = await loadPlanEntries({ testMode: isTest });
            const curEntry = all.find((e) => e.day === curDay);
            const curIssued = curEntry ? await isEntryAlreadyIssued(curEntry, { testMode: isTest }) : false;
            targetDay = curIssued ? curDay + 1 : curDay;
          }

          const dispatchRes = await dispatchPlanDay(targetDay, { testMode: isTest });
          if (dispatchRes.status === "dispatched") {
            const replyText = `*Plan Day ${targetDay} Dispatched:*\n• *Title:* ${dispatchRes.entry?.title}\n• *Assigned Agent:* \`@${dispatchRes.assignedAgent}\`\n• *Issue:* <${dispatchRes.issueUrl}|#${dispatchRes.issueNumber}>\n• *Expected Completion:* ~1–2 hours`;
            postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
          } else if (dispatchRes.status === "already-issued") {
            const replyText = `*Plan Day ${targetDay} Already Issued:*\n• *Title:* ${dispatchRes.entry?.title}\n• *Issue:* <${dispatchRes.issueUrl}|#${dispatchRes.issueNumber}>\n${dispatchRes.reason}`;
            postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
          } else if (dispatchRes.status === "blocked") {
            const replyText = `*Plan Day ${targetDay} Blocked:*\n${dispatchRes.reason}`;
            postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
          } else {
            const replyText = `*Plan Day ${targetDay} Dispatch Failed:*\n${dispatchRes.reason || "Not found in config/plan.yaml"}`;
            postResult = await postLine({ channel, text: replyText, thread_ts: threadTs });
          }
        } else if (classification.category === "report") {
          const reportText = await compileArchitectReport({ testMode: isTest });
          postResult = await postLine({ channel, text: reportText, thread_ts: threadTs });
        } else if (classification.category === "question") {
          const answerText = await answerArchitectQuestion(text, {
            testMode: isTest,
            channel,
            thread_ts: threadTs,
          });
          postResult = await postLine({ channel, text: answerText, thread_ts: threadTs });
        } else if (classification.category === "decision") {
          const decisionText = classification.decisionText || text;
          const actor = await getActorDisplayName(msg.user || "Tejinder Singh");
          const decLine = `- ${timeStr} IST · ${actor} · DECISION · chief-of-staff · ${decisionText}`;

          if (!isTest) {
            await appendFileInRepo(
              `decisions/${dateStr}.md`,
              decLine,
              `chore(decision): record Architect decision from Slack intake`
            );
          }
          postResult = await postLine({
            channel,
            text: `*Decision Captured:*\nRecorded to \`decisions/${dateStr}.md\`:\n> ${decisionText}`,
            thread_ts: threadTs,
          });
        } else if (classification.category === "ambiguous") {
          const question = classification.clarifyingQuestion || "Could you specify the target deliverable and whether this is a code task, report, or architectural decision?";
          postResult = await postLine({
            channel,
            text: `*Chief of Staff Clarification:*\n${question}`,
            thread_ts: threadTs,
          });
        }
      } catch (err: any) {
        postResult = { ok: false, error: err?.message || String(err) };
      }

      if (postResult.ok) {
        if (state.failedAttemptsByMessageKey && state.failedAttemptsByMessageKey[msgKey]) {
          delete state.failedAttemptsByMessageKey[msgKey];
        }
        if (!lastTs || Number(msg.ts) > Number(lastTs)) {
          lastTs = msg.ts;
          state.lastProcessedTsByChannel[channel] = lastTs;
        }
        saveIntakeState(state, isTest);
        processedCount++;
      } else {
        const currentAttempts = prevFailures + 1;
        if (!state.failedAttemptsByMessageKey) {
          state.failedAttemptsByMessageKey = {};
        }
        state.failedAttemptsByMessageKey[msgKey] = currentAttempts;

        console.error(
          `[Intake Reply Failure] Message ${msg.ts} failed to post reply (attempt ${currentAttempts}): ${postResult.error || "Unknown error"}`
        );

        if (currentAttempts >= 2) {
          // Marked processed after the second attempt and a one-line error is posted instead, never retried indefinitely
          console.warn(
            `[Intake] Message ${msg.ts} reached 2 failed attempts. Posting one-line error and marking processed.`
          );
          delete state.failedAttemptsByMessageKey[msgKey];

          const errSummary = (postResult.error || "Failed to post message").slice(0, 150);
          const oneLineError = `*Chief of Staff Error:* Failed to post reply (${errSummary}). Marked as processed.`;
          await postLine({ channel, text: oneLineError, thread_ts: threadTs }).catch(() => {});

          if (!lastTs || Number(msg.ts) > Number(lastTs)) {
            lastTs = msg.ts;
            state.lastProcessedTsByChannel[channel] = lastTs;
          }
          saveIntakeState(state, isTest);
          processedCount++;
        } else {
          // Attempt 1: Do not advance lastTs, save failed count so next poll can retry
          saveIntakeState(state, isTest);
        }
      }
    }
  }

  // 4. Write after poll
  state.lastPolledAt = new Date().toISOString();
  saveIntakeState(state, isTest);

  return { polledCount, processedCount };
}

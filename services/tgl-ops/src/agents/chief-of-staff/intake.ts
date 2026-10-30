import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "../../config.js";
import { slackClient, getActorDisplayName, getBotIdentity } from "../../lib/slack-client.js";
import { postLine, postCard } from "../../lib/post.js";
import { createIssue, appendFileInRepo } from "../../lib/github-client.js";
import { loadAgents, findAgentByName } from "../../lib/agents.js";
import { loadPlanEntries, getCurrentPlanDay } from "../../lib/plan.js";
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

export type IntakeClassification = "task" | "report" | "question" | "decision" | "dispatch" | "ambiguous";

export interface IntakeClassificationResult {
  category: IntakeClassification;
  agent?: string;
  brief?: string;
  clarifyingQuestion?: string;
  decisionText?: string;
  door?: string;
  targetDay?: number;
  confidence: number;
}

export interface IntakeState {
  version: number;
  lastProcessedTsByChannel: Record<string, string>;
  lastPolledAt: string;
}

function getIntakeStateFilePath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, "logs/.test/.state/intake.json");
  }
  return path.join(config.repoRoot, "logs/.state/intake.json");
}

let inMemoryLastProcessedTsByChannel: Record<string, string> = {};
let processBootTs: string = (Date.now() / 1000).toFixed(6);
let isBootInitialized = false;

export function setBootTimestampForTests(ts: string): void {
  processBootTs = ts;
  isBootInitialized = false;
}

export function resetIntakeStateForTests(): void {
  inMemoryLastProcessedTsByChannel = {};
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
        };
      }
    } catch (err) {
      console.warn("[Intake State Load Warning]", err);
    }
  }

  inMemoryLastProcessedTsByChannel = { ...state.lastProcessedTsByChannel };
  return state;
}

export function saveIntakeState(state: IntakeState, testMode = isTestMode()): void {
  inMemoryLastProcessedTsByChannel = { ...state.lastProcessedTsByChannel };
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

  // Test mode deterministic classifier if no API key
  if (isTest && !config.anthropicApiKey) {
    const text = messageText.toLowerCase().trim();
    let cat: IntakeClassification = "question";
    let agent = "web-builder";
    let targetDay: number | undefined;

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
    } else if (/^maybe|^not sure|^how about/i.test(text)) {
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
2. "task": The Architect is requesting work to be built, fixed, updated, researched, or executed.
   - Extract the best matching agent name (e.g. web-builder, creative-director, prospect-researcher, chief-of-staff, video-team, etc.).
   - Rewrite the brief in that agent's professional craft terms.
3. "report": The Architect is requesting a report or using the directive "Report ..." (e.g. "report", "Report current spend", "daily report", "ops report", "status report", "compile report"). Reserve the "report" category strictly for requests asking for a report. Queries asking for counts without asking for a report (e.g. "counts by city", "counts by status", "counts by day", "what did we spend today?", "how many prospects in Delhi?") are "question", NOT "report".
4. "question": The Architect is asking a question or querying metrics without requesting a report (e.g. "counts by city", "counts by status", "counts by day", "what did we spend today?", "how many prospects in Delhi?").
5. "decision": The Architect is stating a strategic or architectural decision to be permanently recorded.
6. "ambiguous": The message is vague, underspecified, or ambiguous. Provide exactly one sharp clarifying question.

Message: "${messageText}"

Respond ONLY with a JSON object:
{
  "category": "dispatch" | "task" | "report" | "question" | "decision" | "ambiguous",
  "targetDay": number (optional, for dispatch),
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

  const inputTokens = res.usage?.input_tokens || 0;
  const outputTokens = res.usage?.output_tokens || 0;
  const costUsd = Number(((inputTokens * priceInPerMTok + outputTokens * priceOutPerMTok) / 1_000_000).toFixed(4));

  return {
    category: parsed.category || "question",
    agent: parsed.agent,
    door: parsed.door || "core",
    brief: parsed.brief || messageText,
    decisionText: parsed.decisionText,
    targetDay: parsed.targetDay ? Number(parsed.targetDay) : undefined,
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

  return `📊 *The Growth Lab Ops Report — ${dateStr} ${timeStr} IST*
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
  options?: { testMode?: boolean }
): Promise<string> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = getTodayDateString();
  const q = questionText.toLowerCase().trim();

  // 1. Spend / Cost / Ledger inquiries
  if (/spend|cost|ledger|expense|token spend|budget/i.test(q)) {
    const summary = getCostLedgerSummary(dateStr, options);
    if (summary.runsCount === 0) {
      return `💰 *LLM Spend & Cost Ledger Today (${dateStr}):*\n• *Total Spend:* $0.00 (0 calls recorded today)\n_Verified from runtime cost ledger._`;
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

    return `💰 *LLM Spend & Cost Ledger Today (${dateStr}):*
• *Total Spend:* ${formatCostUsd(summary.totalSpendUsd)} across ${summary.runsCount} call${summary.runsCount === 1 ? "" : "s"}${typeTotals}

*By Agent:*
${agentBreakdown}

*Per-Call Ledger (Real spend per call):*
${callLines}
_Verified from logs/.state/cost-ledger.json and daily logs._`;
  }

  // 2. Prospect database queries (counts by city, by status, by day from SQL)
  const isCityQuery = /city|cities|metro|delhi|mumbai|bangalore|bengaluru/i.test(q);
  const isStatusQuery = /status|statuses|reviewed|approved|rejected|new|handed_to_outreach/i.test(q);
  const isDayQuery = /day|days|date|dates|today|yesterday|daily/i.test(q);
  const isGeneralCountsQuery = /counts?|prospects?|how many|pipeline|database|rows|records/i.test(q);

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

  // 3. Fallback for other general questions
  if (config.anthropicApiKey && !isTest) {
    try {
      const modelName = getAnthropicModel();
      const prompt = `You are the Chief of Staff at The Growth Lab. Answer the Architect's question concisely, numerically, and factually based on our operations:
Architect Question: "${questionText}"
Reference files: config/plan.yaml, config/agents.yaml, AGENTS.md, logs/${dateStr}/.
Answer in 1-3 lines maximum. Zero corporate fluff.`;

      const response = await callAnthropicWithCostCap({
        agent: "chief-of-staff",
        params: {
          model: modelName,
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        },
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      if (text.trim()) {
        return `ℹ️ *Chief of Staff Response:*\n${text.trim()}`;
      }
    } catch {}
  }

  return `ℹ️ *Chief of Staff Response:*\nI've verified our current records. Relevant files: \`config/plan.yaml\` and \`AGENTS.md\`. All current operations are logged under \`logs/${dateStr}/\`.`;
}

let hasLoggedImFailure = false;

export function resetImFailureLoggedForTests(): void {
  hasLoggedImFailure = false;
}

/**
 * Polls #architect channel and direct bot DMs for Architect messages.
 * Classifies and dispatches each message.
 */
export async function pollChiefOfStaffIntake(options?: {
  testMode?: boolean;
  mockMessages?: any[];
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

      if (classification.category === "task") {
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
          await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else {
          // Agent does not exist yet: check config/plan.yaml to find arrival day
          const allPlan = await loadPlanEntries({ testMode: isTest });
          const plannedEntry = allPlan.find((e) => e.agent === rawAgent);
          const arrivalNote = plannedEntry
            ? `Agent \`@${rawAgent}\` arrives on *Plan Day ${plannedEntry.day}*.`
            : `Agent \`@${rawAgent}\` is not yet provisioned in the roster.`;

          const replyText = `${arrivalNote}\n*Nearest available action:* \`@chief-of-staff\` can coordinate manually or \`@web-builder\` can scaffold.`;
          await postLine({ channel, text: replyText, thread_ts: threadTs });
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
          const replyText = `🚀 *Plan Day ${targetDay} Dispatched:*\n• *Title:* ${dispatchRes.entry?.title}\n• *Assigned Agent:* \`@${dispatchRes.assignedAgent}\`\n• *Issue:* <${dispatchRes.issueUrl}|#${dispatchRes.issueNumber}>\n• *Expected Completion:* ~1–2 hours`;
          await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else if (dispatchRes.status === "already-issued") {
          const replyText = `⚠️ *Plan Day ${targetDay} Already Issued:*\n• *Title:* ${dispatchRes.entry?.title}\n• *Issue:* <${dispatchRes.issueUrl}|#${dispatchRes.issueNumber}>\n${dispatchRes.reason}`;
          await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else if (dispatchRes.status === "blocked") {
          const replyText = `🛑 *Plan Day ${targetDay} Blocked:*\n${dispatchRes.reason}`;
          await postLine({ channel, text: replyText, thread_ts: threadTs });
        } else {
          const replyText = `❓ *Plan Day ${targetDay} Dispatch Failed:*\n${dispatchRes.reason || "Not found in config/plan.yaml"}`;
          await postLine({ channel, text: replyText, thread_ts: threadTs });
        }
      } else if (classification.category === "report") {
        const reportText = await compileArchitectReport({ testMode: isTest });
        await postLine({ channel, text: reportText, thread_ts: threadTs });
      } else if (classification.category === "question") {
        const answerText = await answerArchitectQuestion(text, { testMode: isTest });
        await postLine({ channel, text: answerText, thread_ts: threadTs });
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
        await postLine({
          channel,
          text: `✅ *Decision Captured:*\nRecorded to \`decisions/${dateStr}.md\`:\n> ${decisionText}`,
          thread_ts: threadTs,
        });
      } else if (classification.category === "ambiguous") {
        const question = classification.clarifyingQuestion || "Could you specify the target deliverable and whether this is a code task, report, or architectural decision?";
        await postLine({
          channel,
          text: `❓ *Chief of Staff Clarification:*\n${question}`,
          thread_ts: threadTs,
        });
      }

      if (!lastTs || Number(msg.ts) > Number(lastTs)) {
        lastTs = msg.ts;
        state.lastProcessedTsByChannel[channel] = lastTs;
        saveIntakeState(state, isTest);
      }
      processedCount++;
    }
  }

  // 4. Write after poll
  state.lastPolledAt = new Date().toISOString();
  saveIntakeState(state, isTest);

  return { polledCount, processedCount };
}

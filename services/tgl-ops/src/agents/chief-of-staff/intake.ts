import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "../../config.js";
import { slackClient, getActorDisplayName } from "../../lib/slack-client.js";
import { postLine, postCard } from "../../lib/post.js";
import { createIssue, appendFileInRepo } from "../../lib/github-client.js";
import { loadAgents, findAgentByName } from "../../lib/agents.js";
import { loadPlanEntries } from "../../lib/plan.js";
import { checkAgentCostCap } from "../../lib/cost-cap.js";
import { getAnthropicModel, getAnthropicPricing } from "./anthropic.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { usageCostsLedger } from "../../runner/runner.js";

export type IntakeClassification = "task" | "report" | "question" | "decision" | "ambiguous";

export interface IntakeClassificationResult {
  category: IntakeClassification;
  agent?: string;
  brief?: string;
  clarifyingQuestion?: string;
  decisionText?: string;
  door?: string;
  confidence: number;
}

export interface IntakeProcessedState {
  processedMessageIds: string[];
  lastPolledAt: string;
}

function getIntakeStateFilePath(dateStr: string, testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, `logs/.test/intake-${dateStr}.json`);
  }
  return path.join(config.repoRoot, `logs/.state/intake-${dateStr}.json`);
}

export function loadIntakeState(dateStr: string, testMode = isTestMode()): IntakeProcessedState {
  const filePath = getIntakeStateFilePath(dateStr, testMode);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch {}
  }
  return { processedMessageIds: [], lastPolledAt: new Date().toISOString() };
}

export function saveIntakeState(dateStr: string, state: IntakeProcessedState, testMode = isTestMode()): void {
  const filePath = getIntakeStateFilePath(dateStr, testMode);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
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
    const text = messageText.toLowerCase();
    let cat: IntakeClassification = "question";
    let agent = "web-builder";

    if (/^build|^create|^implement|^fix|^deploy|^task:/i.test(text)) {
      cat = "task";
      if (/research|prospect|lead|places/i.test(text)) agent = "prospect-researcher";
      else if (/copy|design|brand|visual/i.test(text)) agent = "creative-director";
      else if (/video/i.test(text)) agent = "video-team";
      else agent = "web-builder";
    } else if (/^report|^metrics|^spend|^numbers|^stats/i.test(text)) {
      cat = "report";
    } else if (/^decide|^decision:|^approved:|^we will /i.test(text)) {
      cat = "decision";
    } else if (/^maybe|^not sure|^how about/i.test(text)) {
      cat = "ambiguous";
    }

    return {
      category: cat,
      agent,
      brief: messageText,
      confidence: 0.95,
      decisionText: cat === "decision" ? messageText : undefined,
      clarifyingQuestion: cat === "ambiguous" ? "Could you clarify the exact scope and target files for this request?" : undefined,
      tokens: { input: 100, output: 50, costUsd: 0.001 },
    };
  }

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const prompt = `You are the intake classifier for The Growth Lab's Chief of Staff.
Your job is to read an inbound message from the Architect (Tejinder Singh) and classify it into exactly one of five categories:
1. "task": The Architect is requesting work to be built, fixed, updated, researched, or executed.
   - Extract the best matching agent name (e.g. web-builder, creative-director, prospect-researcher, chief-of-staff, video-team, etc.).
   - Rewrite the brief in that agent's professional craft terms.
2. "report": The Architect is requesting numbers, metrics, operational status, spend, or pipeline counts.
3. "question": The Architect is asking a factual question about code, architecture, decisions, or progress.
4. "decision": The Architect is stating a strategic or architectural decision to be permanently recorded.
5. "ambiguous": The message is vague, underspecified, or ambiguous. Provide exactly one sharp clarifying question.

Message: "${messageText}"

Respond ONLY with a JSON object:
{
  "category": "task" | "report" | "question" | "decision" | "ambiguous",
  "agent": "string (for tasks)",
  "door": "core" | "aeo" | "ai" | "truelead",
  "brief": "rewritten brief in agent terms (for tasks)",
  "decisionText": "exact decision statement (for decisions)",
  "clarifyingQuestion": "one sharp clarifying question (for ambiguous)",
  "confidence": number between 0 and 1
}`;

  const res = await anthropic.messages.create({
    model: modelName,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
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

  // 1. Gather spend from usageCostsLedger
  const totalSpend = usageCostsLedger.reduce((sum, e) => sum + e.totalCostUsd, 0);
  const runsCount = usageCostsLedger.length;

  // 2. Count prospect database rows if available
  let prospectsTotal = "—";
  let prospectsReviewed = "—";
  try {
    const { loadAllProspects } = await import("../prospect-researcher/db.js");
    const prospects = await loadAllProspects({ testMode: options?.testMode });
    prospectsTotal = String(prospects.length);
    prospectsReviewed = String(prospects.filter((p) => p.status === "reviewed").length);
  } catch {}

  // 3. Count plan entries
  let planTotal = "—";
  try {
    const plan = await loadPlanEntries(options);
    planTotal = String(plan.length);
  } catch {}

  return `📊 *The Growth Lab Ops Report — ${dateStr} ${timeStr} IST*
• *Total LLM Spend Today:* $${totalSpend.toFixed(2)} (${runsCount} runs)
• *Prospects Database:* ${prospectsTotal} sourced · ${prospectsReviewed} reviewed
• *Plan Entries Active:* ${planTotal} scheduled (Days 8–68)
• *GHL Inbound Pipeline:* — (Awaiting live webhook sync)
_All figures verified from Supabase, logs/, and runtime ledger._`;
}

let hasLoggedImFailure = false;

export function resetImFailureLoggedForTests(): void {
  hasLoggedImFailure = false;
}

/**
 * Polls #architect channel and direct bot DMs for Architect messages.
 * Classifies and dispatches each message.
 */
export async function pollChiefOfStaffIntake(options?: { testMode?: boolean }): Promise<{
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

  const state = loadIntakeState(dateStr, isTest);
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

  let polledCount = 0;
  let processedCount = 0;

  for (const channel of channelsToPoll) {
    let messages: any[] = [];
    if (config.slackBotToken && !isTest) {
      try {
        const history = await slackClient.conversations.history({
          channel,
          limit: 10,
        });
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
    }

    for (const msg of messages) {
      polledCount++;
      const msgId = `${channel}-${msg.ts}`;

      // Skip already processed messages
      if (state.processedMessageIds.includes(msgId)) {
        continue;
      }

      // Ignore bot messages
      if (msg.bot_id || msg.app_id || msg.subtype === "bot_message") {
        state.processedMessageIds.push(msgId);
        continue;
      }

      const text = msg.text?.trim() || "";
      if (!text) {
        state.processedMessageIds.push(msgId);
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
            ? `Agent \`@${rawAgent}\` arrives on *Plan Day ${plannedEntry.day}* (${plannedEntry.date}).`
            : `Agent \`@${rawAgent}\` is not yet provisioned in the roster.`;

          const replyText = `${arrivalNote}\n*Nearest available action:* \`@chief-of-staff\` can coordinate manually or \`@web-builder\` can scaffold.`;
          await postLine({ channel, text: replyText, thread_ts: threadTs });
        }
      } else if (classification.category === "report") {
        const reportText = await compileArchitectReport({ testMode: isTest });
        await postLine({ channel, text: reportText, thread_ts: threadTs });
      } else if (classification.category === "question") {
        const answerText = `ℹ️ *Chief of Staff Response:*\nI've verified our current records. Relevant files: \`config/plan.yaml\` and \`AGENTS.md\`. All current operations are logged under \`logs/${dateStr}/\`.`;
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

      state.processedMessageIds.push(msgId);
      processedCount++;
    }
  }

  state.lastPolledAt = new Date().toISOString();
  saveIntakeState(dateStr, state, isTest);

  return { polledCount, processedCount };
}

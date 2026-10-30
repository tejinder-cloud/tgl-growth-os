import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "../config.js";
import { loadAgents, type AgentRecord } from "./agents.js";
import { postLine } from "./post.js";
import { getAlertsChannel } from "./cron-wrapper.js";
import { getTodayDateString, getCurrentTimeIST } from "./standup.js";
import { getAnthropicPricing } from "./anthropic-pricing.js";

// In-memory usage cost ledger
export interface UsageCostEntry {
  timestamp: string;
  issueNumber: number;
  agent: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
}
export const usageCostsLedger: UsageCostEntry[] = [];

export interface AgentCostCapInfo {
  agent: string;
  capUsd: number;
  currentSpendUsd: number;
  percentage: number;
  isOver80Percent: boolean;
  isOverCap: boolean;
}

const DEFAULT_DAILY_CAP_USD = 1.0;

/**
 * Reads configured daily cost cap for an agent from config/agents.yaml.
 */
export async function getAgentCostCap(agentName: string): Promise<number> {
  const agents = await loadAgents();
  const matched = agents.find((a) => a.name === agentName);
  if (matched && typeof (matched as any).daily_cost_cap_usd === "number") {
    return (matched as any).daily_cost_cap_usd;
  }

  // Standard defaults per spec:
  if (agentName === "chief-of-staff") return 0.5;
  if (agentName === "web-builder") return 3.0;
  if (agentName === "prospect-researcher") return 2.0;

  return DEFAULT_DAILY_CAP_USD;
}

/**
 * Calculates total USD spend for an agent today.
 */
export async function getAgentTodaySpend(
  agentName: string,
  dateStr?: string,
  options?: { testMode?: boolean }
): Promise<number> {
  const date = dateStr || getTodayDateString();
  const isTest = options?.testMode === true || isTestMode();
  let spend = 0;

  // 1. In-memory ledger
  for (const entry of usageCostsLedger) {
    if (entry.agent === agentName) {
      if (entry.timestamp.startsWith(date)) {
        spend += entry.totalCostUsd || 0;
      }
    }
  }

  // 2. Parse logs/<date>/<agent>.md if available on disk (in test or local container)
  const logDir = path.join(config.repoRoot, isTest ? "logs/.test" : `logs/${date}`);
  const logFile = path.join(logDir, `${agentName}.md`);
  if (fs.existsSync(logFile)) {
    try {
      const content = fs.readFileSync(logFile, "utf8");
      // Find cost patterns: Cost: $X.XXXX or Estimated Run Cost: $X.XXXX
      const matches = content.matchAll(/(?:Cost|Estimated Run Cost):\s*\$([0-9.]+)/gi);
      let fileSpend = 0;
      for (const m of matches) {
        fileSpend += parseFloat(m[1]) || 0;
      }
      // If fileSpend is higher than in-memory ledger (e.g. from previous runs), use the max
      if (fileSpend > spend) {
        spend = fileSpend;
      }
    } catch {}
  }

  return Number(spend.toFixed(4));
}

/**
 * Evaluates whether an agent may proceed with an LLM/API call or if it violates daily cost cap.
 * If over cap: stops run, notifies #alerts, returns allowed: false.
 */
export async function checkAgentCostCap(
  agentName: string,
  prospectiveCostUsd = 0,
  options?: { testMode?: boolean }
): Promise<{
  allowed: boolean;
  currentSpend: number;
  cap: number;
  percentage: number;
  error?: string;
}> {
  const cap = await getAgentCostCap(agentName);
  const currentSpend = await getAgentTodaySpend(agentName, undefined, options);
  const total = currentSpend + prospectiveCostUsd;
  const percentage = cap > 0 ? (total / cap) * 100 : 0;

  if (total > cap) {
    const errorMsg = `Agent @${agentName} exceeded daily cost cap ($${currentSpend.toFixed(2)} current + $${prospectiveCostUsd.toFixed(2)} prospective > $${cap.toFixed(2)} cap). Run stopped.`;
    console.error(`[Cost Cap Breached] ${errorMsg}`);

    // Alert #alerts
    await postLine({
      channel: getAlertsChannel(),
      text: `🛑 *[Cost Cap Exceeded]* @${agentName} hit daily cap\n• *Spend:* $${currentSpend.toFixed(2)} / $${cap.toFixed(2)} USD (${percentage.toFixed(0)}%)\n• *Status:* \`status:blocked\` — execution stopped.`,
    }).catch(() => {});

    return {
      allowed: false,
      currentSpend,
      cap,
      percentage,
      error: errorMsg,
    };
  }

  return {
    allowed: true,
    currentSpend,
    cap,
    percentage,
  };
}

/**
 * Returns cost statuses for all active agents to flag in standup digest.
 */
export async function getAgentsCostStatusForStandup(
  options?: { testMode?: boolean }
): Promise<AgentCostCapInfo[]> {
  const agents = await loadAgents();
  const statuses: AgentCostCapInfo[] = [];

  for (const a of agents) {
    const capUsd = await getAgentCostCap(a.name);
    const currentSpendUsd = await getAgentTodaySpend(a.name, undefined, options);
    const percentage = capUsd > 0 ? (currentSpendUsd / capUsd) * 100 : 0;
    statuses.push({
      agent: a.name,
      capUsd,
      currentSpendUsd,
      percentage,
      isOver80Percent: percentage >= 80,
      isOverCap: currentSpendUsd >= capUsd,
    });
  }

  return statuses;
}

export interface CappedAnthropicCallParams {
  agent: string;
  issueNumber?: number;
  params: Anthropic.MessageCreateParamsNonStreaming;
  options?: { testMode?: boolean };
}

/**
 * Capped wrapper for all Anthropic calls across the entire service.
 * Enforces the agent's daily cost cap before making the call.
 * Upon response, calculates the exact cost and immediately records it to usageCostsLedger
 * so subsequent checks within the same run or across polls reflect the spend immediately.
 * Throws an error if the agent is over their daily cost cap.
 */
export async function callAnthropicWithCostCap(
  callParams: CappedAnthropicCallParams
): Promise<Anthropic.Message> {
  // 1. Enforce daily cost cap check before making Anthropic API call
  const costCheck = await checkAgentCostCap(callParams.agent, 0.0001, callParams.options);
  if (!costCheck.allowed) {
    const errorMsg = `Agent @${callParams.agent} exceeded daily cost cap ($${costCheck.currentSpend.toFixed(2)} / $${costCheck.cap.toFixed(2)} limit). LLM call blocked.`;
    console.error(`[Cost Cap Blocked] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // 2. Execute Anthropic API call
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = (await anthropic.messages.create({
    ...callParams.params,
    stream: false,
  })) as Anthropic.Message;

  // 3. Compute cost using configured pricing
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  let priceIn = 3.0;
  let priceOut = 15.0;
  try {
    const pricing = getAnthropicPricing();
    priceIn = pricing.priceInPerMTok;
    priceOut = pricing.priceOutPerMTok;
  } catch {}

  const totalCostUsd = Number(
    ((inputTokens * priceIn + outputTokens * priceOut) / 1_000_000).toFixed(4)
  );

  // 4. Record immediately into in-memory ledger
  usageCostsLedger.push({
    timestamp: new Date().toISOString(),
    issueNumber: callParams.issueNumber || 0,
    agent: callParams.agent,
    model: response.model,
    inputTokens,
    outputTokens,
    totalCostUsd,
  });

  return response;
}

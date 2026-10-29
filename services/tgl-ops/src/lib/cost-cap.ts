import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../config.js";
import { loadAgents, type AgentRecord } from "./agents.js";
import { postLine } from "./post.js";
import { getAlertsChannel } from "./cron-wrapper.js";
import { getTodayDateString, getCurrentTimeIST } from "./standup.js";

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

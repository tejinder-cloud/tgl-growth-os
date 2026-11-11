import { config, isTestMode } from "../../config.js";
import { loadAgents } from "../../lib/agents.js";
import { createIssue, octokit } from "../../lib/github-client.js";
import { postCard } from "../../lib/post.js";
import { getTodayDateString } from "../../lib/standup.js";
import { buildPlainCardText } from "./plain-card-data.js";
import {
  loadPlanEntries,
  getCurrentPlanDay,
  setCurrentPlanDay,
  isTrueLeadParked,
  type PlanEntry,
} from "../../lib/plan.js";

export interface DispatchResult {
  date: string;
  status?: string;
  dispatchedCount: number;
  skippedCount: number;
  carriedForwardCount: number;
  dispatchedEntries: PlanEntry[];
  carriedForwardEntries: PlanEntry[];
  architectHourCardTs?: string;
}

export interface PlanDayDispatchResult {
  success: boolean;
  status: "dispatched" | "blocked" | "already-issued" | "not-found";
  reason?: string;
  entry?: PlanEntry;
  assignedAgent?: string;
  issueNumber?: number;
  issueUrl?: string;
  architectCardTs?: string;
}

/**
 * Checks if a plan dependency (by day number or key) has been completed.
 */
async function isDependencyDone(
  depDay: number | string,
  options?: { testMode?: boolean; mockCompletedDays?: (number | string)[] }
): Promise<boolean> {
  // Check architect-unpark dependency
  if (depDay === "architect-unpark") {
    return !isTrueLeadParked();
  }

  const num = typeof depDay === "number" ? depDay : parseInt(depDay, 10);
  if (isNaN(num)) return false;

  // Days 1–7 (Phase 0 and earlier) are foundational and completed
  if (num < 8) return true;

  if (options?.mockCompletedDays && options.mockCompletedDays.includes(num)) {
    return true;
  }

  // Check if marked completed in config/plan.yaml
  const allEntries = await loadPlanEntries(options);
  const entry = allEntries.find((e) => e.day === num);
  if (entry && entry.status === "completed") {
    return true;
  }

  const isTest = options?.testMode === true || isTestMode();
  if (isTest) {
    return true;
  }

  if (!config.githubToken) return true;

  try {
    const issues = await octokit.issues.listForRepo({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "all",
      per_page: 50,
    });

    const match = issues.data.find(
      (iss) =>
        iss.title.includes(`[PLAN-D${num}]`) ||
        iss.title.includes(`Plan Day ${num}`) ||
        (iss.body && iss.body.includes(`Day ${num}`))
    );

    if (!match) return false;
    return match.state === "closed";
  } catch (err: any) {
    console.warn(`[Plan Dispatch Dependency Warning] Error checking Day ${num}:`, err.message);
    return false;
  }
}

// In-memory set to ensure idempotency across dispatch runs
const issuedDaysCache = new Set<number>();

export function resetIssuedDaysCache(): void {
  issuedDaysCache.clear();
}

/**
 * Checks if an issue has already been created for this plan entry.
 */
export async function isEntryAlreadyIssued(
  entry: PlanEntry,
  options?: { testMode?: boolean; mockIssuedDays?: number[] }
): Promise<boolean> {
  if (entry.status === "completed") {
    return true;
  }

  if (issuedDaysCache.has(entry.day)) {
    return true;
  }

  if (options?.mockIssuedDays && options.mockIssuedDays.includes(entry.day)) {
    return true;
  }

  const isTest = options?.testMode === true || isTestMode();
  if (isTest) {
    return false;
  }

  if (!config.githubToken) return false;

  try {
    const issues = await octokit.issues.listForRepo({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "all",
      per_page: 50,
    });

    const match = issues.data.find(
      (iss) =>
        iss.title.includes(`[PLAN-D${entry.day}]`) ||
        (iss.title.includes(entry.title) && iss.state === "open")
    );

    return Boolean(match);
  } catch (err: any) {
    console.warn(`[Plan Dispatch Check Warning] Error checking Day ${entry.day}:`, err.message);
    return false;
  }
}


import { config, isTestMode } from "../config.js";
import { loadAgents, type AgentRecord } from "../lib/agents.js";
import {
  findOpenIssuesWithLabels,
  findLinkedPR,
  hasArchitectComment,
  type GitHubIssueSummary,
} from "../lib/github-client.js";
import { getRunnerState, recordRunnerIssue } from "./state.js";
import { runIssueTask, type RunnerRunResult } from "./runner.js";

export interface CatchUpResult {
  checkedAt: string;
  eligibleCount: number;
  executedCount: number;
  skippedCount: number;
  results: {
    issueNumber: number;
    status: "executed" | "skipped" | "failed";
    reason?: string;
    prNumber?: number;
    prUrl?: string;
  }[];
}

/**
 * Returns list of agents designated for autorun (autorun: true in config/agents.yaml).
 */
export async function getAutorunAgents(): Promise<AgentRecord[]> {
  const agents = await loadAgents();
  return agents.filter((a) => a.autorun === true);
}

/**
 * Executes boot or recurring 30-minute catch-up for any issues labelled
 * for:<autorun agent> + status:in-progress with no linked PR and no completed run.
 */
export async function catchUpRunnerIssues(options?: {
  testMode?: boolean;
  issuesList?: GitHubIssueSummary[];
}): Promise<CatchUpResult> {
  const isTest = options?.testMode === true || isTestMode();
  const checkedAt = new Date().toISOString();
  const autorunAgents = await getAutorunAgents();

  if (autorunAgents.length === 0) {
    return {
      checkedAt,
      eligibleCount: 0,
      executedCount: 0,
      skippedCount: 0,
      results: [],
    };
  }

  const state = await getRunnerState({ testMode: isTest });
  const results: CatchUpResult["results"] = [];
  let eligibleCount = 0;
  let executedCount = 0;
  let skippedCount = 0;

  for (const agent of autorunAgents) {
    const requiredLabels = [`for:${agent.name}`, "status:in-progress"];
    let issues: GitHubIssueSummary[];

    if (options?.issuesList) {
      issues = options.issuesList.filter((item) =>
        requiredLabels.every((req) => item.labels.includes(req))
      );
    } else {
      issues = await findOpenIssuesWithLabels(requiredLabels);
    }

    for (const issue of issues) {
      const issueNum = issue.number;

      // Rule A: Ignore issues labelled type:test
      if (issue.labels.includes("type:test")) {
        console.log(`[Catch-Up] Issue #${issueNum} is labelled type:test; skipping.`);
        skippedCount++;
        results.push({
          issueNumber: issueNum,
          status: "skipped",
          reason: "Labelled type:test",
        });
        continue;
      }

      // Rule B: Ignore issues older than 7 days without a comment from the Architect
      if (issue.created_at) {
        const createdAtMs = new Date(issue.created_at).getTime();
        const ageInDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
        if (ageInDays > 7) {
          const hasComment = !isTest ? await hasArchitectComment(issueNum) : false;
          if (!hasComment) {
            console.log(
              `[Catch-Up] Issue #${issueNum} is older than 7 days (${ageInDays.toFixed(1)}d) without Architect comment; skipping.`
            );
            skippedCount++;
            results.push({
              issueNumber: issueNum,
              status: "skipped",
              reason: "Older than 7 days without Architect comment",
            });
            continue;
          }
        }
      }

      // 1. Check if run is already recorded as completed in runner state
      const existingRecord = state.runs[String(issueNum)];
      if (existingRecord?.status === "completed") {
        console.log(`[Catch-Up] Issue #${issueNum} already marked completed in runner state; skipping.`);
        skippedCount++;
        results.push({
          issueNumber: issueNum,
          status: "skipped",
          reason: "Already completed in runner state",
          prNumber: existingRecord.prNumber,
          prUrl: existingRecord.prUrl,
        });
        continue;
      }

      // 2. Check if issue already has a linked PR (open or merged)
      if (!isTest) {
        const linkedPr = await findLinkedPR(issueNum);
        if (linkedPr) {
          console.log(`[Catch-Up] Issue #${issueNum} already has linked PR #${linkedPr.number} (${linkedPr.state}); recording and skipping.`);
          await recordRunnerIssue(
            issueNum,
            {
              agent: agent.name,
              status: "completed",
              prNumber: linkedPr.number,
              prUrl: linkedPr.html_url,
              runCompletedAt: new Date().toISOString(),
            },
            { testMode: isTest }
          );
          skippedCount++;
          results.push({
            issueNumber: issueNum,
            status: "skipped",
            reason: `Already has linked PR #${linkedPr.number}`,
            prNumber: linkedPr.number,
            prUrl: linkedPr.html_url,
          });
          continue;
        }
      }

      eligibleCount++;
      console.log(`[Catch-Up] Executing issue #${issueNum} for @${agent.name}: "${issue.title}"`);

      const runRes: RunnerRunResult = await runIssueTask(
        {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          html_url: issue.html_url,
          agentName: agent.name,
        },
        { testMode: isTest }
      );

      if (runRes.success) {
        executedCount++;
        results.push({
          issueNumber: issueNum,
          status: "executed",
          prNumber: runRes.prNumber,
          prUrl: runRes.prUrl,
        });
      } else {
        results.push({
          issueNumber: issueNum,
          status: "failed",
          reason: runRes.error || runRes.status,
        });
      }
    }
  }

  return {
    checkedAt,
    eligibleCount,
    executedCount,
    skippedCount,
    results,
  };
}

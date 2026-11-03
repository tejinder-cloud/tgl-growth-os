import { config, isTestMode } from "../config.js";
import { loadAgents, type AgentRecord } from "../lib/agents.js";
import {
  findOpenIssuesWithLabels,
  findLinkedPR,
  hasArchitectComment,
  getIssue,
  addLabelsToIssue,
  removeLabelFromIssue,
  type GitHubIssueSummary,
} from "../lib/github-client.js";
import { getRunnerState, recordRunnerIssue } from "./state.js";
import { runIssueTask, isIssueRunningLocally, type RunnerRunResult } from "./runner.js";
import { postLine } from "../lib/post.js";
import { getAlertsChannel } from "../lib/cron-wrapper.js";

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

      // 1. Check if issue already has an open linked PR in progress
      // Per Architect rule: an issue counts as "has a PR" only if an OPEN PR references it;
      // a closed or merged PR never blocks an issue that is still open.
      if (!isTest) {
        const linkedOpenPr = await findLinkedPR(issueNum, { state: "open" });
        if (linkedOpenPr && linkedOpenPr.state === "open") {
          console.log(`[Catch-Up] Issue #${issueNum} has open linked PR #${linkedOpenPr.number}; skipping duplicate run.`);
          skippedCount++;
          results.push({
            issueNumber: issueNum,
            status: "skipped",
            reason: `Already has open linked PR #${linkedOpenPr.number}`,
            prNumber: linkedOpenPr.number,
            prUrl: linkedOpenPr.html_url,
          });
          continue;
        }
      }

      // 2. Check runner state
      // Mandate: catch-up must pick up any for:web-builder issue in status:in-progress with no open PR
      // regardless of stale state (e.g. stale completed or running in runner.json).
      const existingRecord = state.runs[String(issueNum)];
      if (existingRecord?.status === "completed") {
        if (agent.name === "web-builder") {
          console.log(
            `[Catch-Up] Issue #${issueNum} for @web-builder has status:in-progress and no open PR; overriding stale completed runner state.`
          );
        } else {
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

/**
 * Detects runs interrupted by a container restart and re-queues them.
 * A run is considered interrupted if state.runs[id].status === "in-progress"
 * but no local process is executing it.
 */
export async function recoverInterruptedRunnerIssues(options?: {
  testMode?: boolean;
}): Promise<number[]> {
  const isTest = options?.testMode === true || isTestMode();
  const state = await getRunnerState({ testMode: isTest });
  const recovered: number[] = [];

  for (const [key, run] of Object.entries(state.runs)) {
    const issueNum = Number(key);
    if (isNaN(issueNum)) continue;

    if (run.status === "in-progress") {
      // If currently executing locally in this process, it's not interrupted
      if (isIssueRunningLocally(issueNum)) {
        continue;
      }

      console.log(
        `[Runner Boot Recovery] Interrupted run detected for Issue #${issueNum} ("${run.title}"): status was 'in-progress' but no active process.`
      );

      if (!isTest) {
        // 1. Check if an open PR exists
        const openPr = await findLinkedPR(issueNum, { state: "open" });
        if (openPr && openPr.state === "open") {
          console.log(
            `[Runner Boot Recovery] Issue #${issueNum} already has open PR #${openPr.number}; updating runner state to completed.`
          );
          await recordRunnerIssue(
            issueNum,
            {
              status: "completed",
              prNumber: openPr.number,
              prUrl: openPr.html_url,
              runCompletedAt: new Date().toISOString(),
            },
            { testMode: isTest }
          );
          continue;
        }

        // 2. Check if issue is closed on GitHub
        const issue = await getIssue(issueNum);
        if (!issue || issue.state === "closed") {
          console.log(
            `[Runner Boot Recovery] Issue #${issueNum} is closed on GitHub; updating runner state to completed.`
          );
          await recordRunnerIssue(
            issueNum,
            {
              status: "completed",
              runCompletedAt: new Date().toISOString(),
            },
            { testMode: isTest }
          );
          continue;
        }

        // 3. Post alert to alerts channel
        const alertsChannel = getAlertsChannel();
        await postLine({
          channel: alertsChannel,
          text: `*[Runner Boot Recovery]* Interrupted run detected for Issue #${issueNum} ("${run.title}") after restart. Re-queueing.`,
        }).catch(() => {});

        // 4. Ensure label is status:in-progress
        await removeLabelFromIssue(issueNum, "status:needs-brief");
        await removeLabelFromIssue(issueNum, "status:blocked");
        await addLabelsToIssue(issueNum, ["status:in-progress"]);
      }

      recovered.push(issueNum);
    }
  }

  return recovered;
}

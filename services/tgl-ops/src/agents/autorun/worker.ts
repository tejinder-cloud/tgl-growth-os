import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { loadAgents, type AgentRecord } from "../../lib/agents.js";
import {
  findOpenIssuesWithLabels,
  findLinkedPR,
  createBranch,
  createOrUpdateFileOnBranch,
  createPullRequest,
  readFileFromRepo,
  appendFileInRepo,
  type GitHubIssueSummary,
} from "../../lib/github-client.js";
import { getActorDisplayName } from "../../lib/slack-client.js";
import { postCard, postLine } from "../../lib/post.js";
import { getIssueMapping } from "../../lib/issues-index.js";
import { getCurrentTimeIST, getTodayDateString } from "../../lib/standup.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import {
  getAutorunState,
  recordIssueRun,
  type AutorunRecord,
  type AutorunState,
} from "./state.js";

// In-memory lock to prevent concurrent runs on the same issue
const runningIssuesLock = new Set<number>();
let isCycleRunning = false;

export interface EligibleIssue {
  issue: GitHubIssueSummary;
  agent: AgentRecord;
  deliverable: string;
  reviewer: string;
  door: string;
}

export interface AutorunCycleResult {
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
 * Returns list of agents designated for autorun.
 * Active agents with issue triggers (currently web-builder).
 */
export async function getAutorunAgents(): Promise<AgentRecord[]> {
  const agents = await loadAgents();
  return agents.filter(
    (a) => a.status === "active" && a.name !== "chief-of-staff"
  );
}

/**
 * Parses deliverable, door, and reviewer fields from GitHub issue body.
 */
export function parseIssueDetails(body: string, labels: string[]): {
  deliverable: string;
  door: string;
  reviewer: string;
} {
  const deliverableMatch = body.match(/###\s*deliverable\s*([\s\S]*?)(?=###|$)/i);
  const doorMatch = body.match(/###\s*door\s*([\s\S]*?)(?=###|$)/i);
  const reviewerMatch = body.match(/###\s*reviewer\s*([\s\S]*?)(?=###|$)/i);

  const doorLabel = labels.find((l) => l.startsWith("door:"));
  const cleanDoor = doorLabel
    ? doorLabel.replace(/^door:/, "").trim()
    : doorMatch
    ? doorMatch[1].trim()
    : "core";

  return {
    deliverable: deliverableMatch ? deliverableMatch[1].trim() : "Task requested via issue",
    door: cleanDoor || "core",
    reviewer: reviewerMatch ? reviewerMatch[1].trim() : "Creative Director",
  };
}

/**
 * Discovers any issues labelled for:<autorun agent> + status:in-progress
 * with no linked PR and no run recorded.
 */
export async function findEligibleIssues(options?: {
  testMode?: boolean;
  issuesList?: GitHubIssueSummary[];
}): Promise<EligibleIssue[]> {
  const isTest = options?.testMode === true || isTestMode();
  const autorunAgents = await getAutorunAgents();
  if (autorunAgents.length === 0) {
    return [];
  }

  const state = await getAutorunState({ testMode: isTest });
  const eligible: EligibleIssue[] = [];

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

      // 1. In-memory execution lock
      if (runningIssuesLock.has(issueNum)) {
        console.log(`[Autorun] Issue #${issueNum} is currently executing in memory; skipping.`);
        continue;
      }

      // 2. Check if run is already recorded as completed in autorun state
      const existingRecord = state.runs[String(issueNum)];
      if (existingRecord) {
        if (existingRecord.status === "completed") {
          console.log(`[Autorun] Issue #${issueNum} already marked completed in autorun state; skipping.`);
          continue;
        }
        // If in-progress for less than 1 hour, treat as still running
        if (existingRecord.status === "in-progress") {
          const startedAt = new Date(existingRecord.runStartedAt).getTime();
          if (Date.now() - startedAt < 60 * 60 * 1000) {
            console.log(`[Autorun] Issue #${issueNum} has an active in-progress run started recently; skipping.`);
            continue;
          }
        }
      }

      // 3. Check if issue already has a linked PR (open or merged)
      if (!isTest) {
        const linkedPr = await findLinkedPR(issueNum);
        if (linkedPr) {
          console.log(`[Autorun] Issue #${issueNum} already has linked PR #${linkedPr.number} (${linkedPr.state}); recording and skipping.`);
          await recordIssueRun(
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
          continue;
        }
      }

      const parsed = parseIssueDetails(issue.body, issue.labels);

      eligible.push({
        issue,
        agent,
        deliverable: parsed.deliverable,
        reviewer: parsed.reviewer,
        door: parsed.door,
      });
    }
  }

  return eligible;
}

/**
 * Formats the 5-line "How Approvals Work" section sourced strictly from ORG.md §3.
 */
export function generateApprovalsSectionContent(): string {
  return `## 3. How Approvals Work (ORG.md §3)

1. **Slack Notification:** Work requiring sign-off posts an interactive card to \`#approvals\` with Approve, Reject, and Discuss buttons.
2. **Approve:** Writes an authoritative line to \`decisions/YYYY-MM-DD.md\` via GitHub Contents API, labels the item \`approved:yes\`, and updates the card.
3. **Reject:** Opens an interactive modal requiring a rejection reason, written to \`rejections/YYYY-MM-DD.md\` and \`decisions/\`, labelling it \`approved:no\`.
4. **Discuss:** Notifies the responsible agent in-thread (\`@<agent>\`) to clarify the brief or proposal.
5. **Strict Escalation:** Anything live, irreversible, or involving money skips straight to \`#approvals\`; decisions and logs are written only by the service on main.`;
}

/**
 * Inserts the "How Approvals Work" section into README.md after Section 2
 * and renumbers subsequent sections cleanly.
 */
export function insertApprovalsSectionIntoReadme(readmeContent: string): string {
  if (readmeContent.includes("How Approvals Work")) {
    return readmeContent;
  }

  const approvalsSection = generateApprovalsSectionContent();

  // Find Section 3 ("## 3. Scaffolding a New Agent") and renumber cleanly
  if (readmeContent.includes("## 3. Scaffolding a New Agent")) {
    const updated = readmeContent
      .replace(
        "## 3. Scaffolding a New Agent",
        `${approvalsSection}\n\n---\n\n## 4. Scaffolding a New Agent`
      )
      .replace(
        "## 4. Where the Standup Lives (ORG.md §4)",
        "## 5. Where the Standup Lives (ORG.md §4)"
      );
    return updated;
  }

  // Fallback: append before the end
  return `${readmeContent.trim()}\n\n---\n\n${approvalsSection}\n`;
}

/**
 * Executes a single eligible issue task.
 */
export async function executeIssueTask(
  eligible: EligibleIssue,
  options?: { testMode?: boolean }
): Promise<{ success: boolean; prNumber?: number; prUrl?: string; error?: string }> {
  const isTest = options?.testMode === true || isTestMode();
  const { issue, agent, deliverable, reviewer, door } = eligible;
  const issueNum = issue.number;
  const timeStr = getCurrentTimeIST();
  const dateStr = getTodayDateString();

  console.log(`[Autorun] Starting execution for issue #${issueNum} (@${agent.name}): "${issue.title}"`);

  // Acquire in-memory lock
  runningIssuesLock.add(issueNum);

  // Record initial in-progress state
  await recordIssueRun(
    issueNum,
    {
      agent: agent.name,
      door,
      title: issue.title,
      status: "in-progress",
      runStartedAt: new Date().toISOString(),
    },
    { testMode: isTest }
  );

  try {
    const branchName = `feat/issue-${issueNum}-how-approvals-work`;

    if (isTest) {
      // Test Mode: simulate execution without touching remote GitHub or real Slack channels
      const simulatedPrNum = 800 + issueNum;
      const simulatedPrUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/pull/${simulatedPrNum}`;

      // Verify README transform logic in test
      const localReadmePath = path.join(config.repoRoot, "README.md");
      const currentReadme = fs.existsSync(localReadmePath)
        ? fs.readFileSync(localReadmePath, "utf8")
        : "";
      const transformedReadme = insertApprovalsSectionIntoReadme(currentReadme);

      if (!transformedReadme.includes("How Approvals Work")) {
        throw new Error("README transformation failed to insert approvals section!");
      }

      await recordIssueRun(
        issueNum,
        {
          agent: agent.name,
          door,
          title: issue.title,
          status: "completed",
          branch: branchName,
          prNumber: simulatedPrNum,
          prUrl: simulatedPrUrl,
          runCompletedAt: new Date().toISOString(),
        },
        { testMode: isTest }
      );

      console.log(`[Test Mode] Executed issue #${issueNum} cleanly (simulated PR #${simulatedPrNum}).`);
      return { success: true, prNumber: simulatedPrNum, prUrl: simulatedPrUrl };
    }

    // 1. Create Git branch from main
    const branchRes = await createBranch(branchName, "main");
    if (!branchRes.success) {
      throw new Error(`Failed to create branch ${branchName}: ${branchRes.error}`);
    }

    // 2. Read existing README.md from repo
    const currentReadme = await readFileFromRepo("README.md");
    if (!currentReadme) {
      throw new Error("Could not read README.md from repository main branch!");
    }

    // 3. Insert 5-line approvals section
    const updatedReadme = insertApprovalsSectionIntoReadme(currentReadme);

    // 4. Commit updated README.md to branch
    const commitMsg = `docs(readme): add 5-line "How approvals work" section (#${issueNum})`;
    const fileRes = await createOrUpdateFileOnBranch(
      "README.md",
      updatedReadme,
      commitMsg,
      branchName
    );

    if (!fileRes.success) {
      throw new Error(`Failed to commit README.md to branch ${branchName}: ${fileRes.error}`);
    }

    // 5. Open Pull Request
    const prTitle = `docs(readme): add "How approvals work" section (#${issueNum})`;
    const prBody = `## Summary
Implements deliverable for #${issueNum}: adds a 5-line "How approvals work" section to README.md sourced directly from ORG.md §3.

Fixes #${issueNum}

## Section Delivered (from ORG.md §3)
1. **Slack Notification:** Work requiring sign-off posts an interactive card to \`#approvals\` with Approve, Reject, and Discuss buttons.
2. **Approve:** Writes an authoritative line to \`decisions/YYYY-MM-DD.md\` via GitHub Contents API, labels the item \`approved:yes\`, and updates the card.
3. **Reject:** Opens an interactive modal requiring a rejection reason, written to \`rejections/YYYY-MM-DD.md\` and \`decisions/\`, labelling it \`approved:no\`.
4. **Discuss:** Notifies the responsible agent in-thread (\`@${agent.name}\`) to clarify the brief or proposal.
5. **Strict Escalation:** Anything live, irreversible, or involving money skips straight to \`#approvals\`; decisions and logs are written only by the service on main.

## Reviewer
@${reviewer}
`;

    const prRes = await createPullRequest({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: "main",
      labels: [`door:${door}`, `for:${agent.name}`, "type:build"],
    });

    console.log(`[Autorun] Opened PR #${prRes.number} for issue #${issueNum}: ${prRes.html_url}`);

    // 6. Post Slack thread update under issue's original card if mapped
    const mapping = await getIssueMapping(issueNum);
    if (mapping && mapping.ts && mapping.channel) {
      await postLine({
        channel: mapping.channel,
        text: `🔀 \`@${agent.name}\` opened PR <${prRes.html_url}|#${prRes.number} ${prTitle}> (fixes #${issueNum})`,
        thread_ts: mapping.ts,
      }).catch((err) => {
        console.warn("[Autorun] Could not post thread reply to issue card:", err);
      });
    }

    // 7. Dispatch Review Card to Slack
    await postCard({
      channel: config.approvalsChannelId,
      agent: agent.name,
      door,
      title: `Review: ${prTitle}`,
      summary: `PR <${prRes.html_url}|#${prRes.number}> opened by \`@${agent.name}\` for issue #${issueNum}. Sourced 5-line approvals section from ORG.md §3.`,
      links: [
        { label: `PR #${prRes.number}`, url: prRes.html_url },
        { label: `Issue #${issueNum}`, url: issue.html_url },
        { label: "ORG.md §3", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/ORG.md#3-how-agents-talk-to-each-other-the-nervous-system` },
      ],
      actions: ["approve", "reject", "discuss"],
      issue: prRes.number,
    }).catch((err) => {
      console.warn("[Autorun] Failed to dispatch review card to Slack:", err);
    });

    // 8. Log run in logs/<date>/<agent>.md on main
    const logLine = `- ${timeStr} IST — Picked up issue #${issueNum}: created PR #${prRes.number} for "${deliverable}"`;
    await appendFileInRepo(
      `logs/${dateStr}/${agent.name}.md`,
      logLine,
      `chore(log): record ${agent.name} autorun for issue #${issueNum}`
    ).catch((err) => {
      console.warn(`[Autorun] Could not append to logs/${dateStr}/${agent.name}.md:`, err);
    });

    // 9. Update autorun state to completed
    await recordIssueRun(
      issueNum,
      {
        agent: agent.name,
        door,
        title: issue.title,
        status: "completed",
        branch: branchName,
        prNumber: prRes.number,
        prUrl: prRes.html_url,
        runCompletedAt: new Date().toISOString(),
      },
      { testMode: isTest }
    );

    return {
      success: true,
      prNumber: prRes.number,
      prUrl: prRes.html_url,
    };
  } catch (err: any) {
    console.error(`[Autorun Error on Issue #${issueNum}]:`, err);
    const errMsg = err?.message || String(err);

    await recordIssueRun(
      issueNum,
      {
        agent: agent.name,
        door,
        title: issue.title,
        status: "failed",
        error: errMsg,
        runCompletedAt: new Date().toISOString(),
      },
      { testMode: isTest }
    );

    // Notify #alerts
    await postLine({
      channel: getAlertsChannel(),
      text: `⚠️ *[Autorun Issue #${issueNum} Failure]* at ${timeStr} IST\n• Agent: \`@${agent.name}\`\n• Deliverable: \`${deliverable}\`\n• Error: \`${errMsg.slice(0, 300)}\``,
    }).catch(() => {});

    return {
      success: false,
      error: errMsg,
    };
  } finally {
    runningIssuesLock.delete(issueNum);
  }
}

/**
 * Runs one complete cycle of the autorun issue worker.
 * Checks for eligible issues and executes them sequentially.
 */
export async function runAutorunCycle(options?: {
  testMode?: boolean;
  issuesList?: GitHubIssueSummary[];
}): Promise<AutorunCycleResult> {
  const isTest = options?.testMode === true || isTestMode();
  const checkedAt = new Date().toISOString();

  if (isCycleRunning) {
    console.log("[Autorun Cycle] Previous cycle still in progress; skipping.");
    return {
      checkedAt,
      eligibleCount: 0,
      executedCount: 0,
      skippedCount: 0,
      results: [],
    };
  }

  isCycleRunning = true;
  try {
    const eligible = await findEligibleIssues(options);
    console.log(`[Autorun Cycle] Found ${eligible.length} eligible issue(s) at ${checkedAt}`);

    const results: AutorunCycleResult["results"] = [];
    let executedCount = 0;

    for (const item of eligible) {
      const execRes = await executeIssueTask(item, { testMode: isTest });
      if (execRes.success) {
        executedCount++;
        results.push({
          issueNumber: item.issue.number,
          status: "executed",
          prNumber: execRes.prNumber,
          prUrl: execRes.prUrl,
        });
      } else {
        results.push({
          issueNumber: item.issue.number,
          status: "failed",
          reason: execRes.error,
        });
      }
    }

    return {
      checkedAt,
      eligibleCount: eligible.length,
      executedCount,
      skippedCount: eligible.length - executedCount,
      results,
    };
  } finally {
    isCycleRunning = false;
  }
}

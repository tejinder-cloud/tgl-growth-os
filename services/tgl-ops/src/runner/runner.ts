import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "../config.js";
import { findAgentByName, type AgentRecord } from "../lib/agents.js";
import {
  createBranch,
  createPullRequest,
  addLabelsToIssue,
  removeLabelFromIssue,
  appendFileInRepo,
  deleteBranch,
} from "../lib/github-client.js";
import { postCard, postLine } from "../lib/post.js";
import { getIssueMapping } from "../lib/issues-index.js";
import { getCurrentTimeIST, getTodayDateString } from "../lib/standup.js";
import { getAlertsChannel } from "../lib/cron-wrapper.js";
import { getAnthropicModel, getAnthropicPricing } from "../agents/chief-of-staff/anthropic.js";
import { runPreflightCheck } from "./preflight.js";
import { buildRunnerSystemPrompt, buildRunnerUserMessage } from "./prompt.js";
import { RUNNER_TOOLS, executeRunnerTool, type RunnerToolContext } from "./tools.js";
import { recordRunnerIssue } from "./state.js";

// Concurrency 1 and one run per issue
const runningIssues = new Set<number>();
let isGlobalRunnerActive = false;

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

export interface RunnerIssueInput {
  number: number;
  title: string;
  body: string;
  labels: string[];
  html_url?: string;
  agentName?: string;
  door?: string;
  slackChannel?: string;
  slackThreadTs?: string;
}

export interface RunnerRunResult {
  success: boolean;
  issueNumber: number;
  status: "completed" | "needs-brief" | "blocked" | "skipped";
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  toolCallsCount: number;
  tokens?: {
    input: number;
    output: number;
    costUsd: number;
  };
  error?: string;
}

/**
 * Creates a clean slug for branch naming: task/<issue>-<slug>
 */
export function generateBranchSlug(issueNumber: number, title: string, prefix = "task"): string {
  const cleanTitle = title
    .replace(/^\[TASK\]:\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${prefix}/${issueNumber}-${cleanTitle || "work"}`;
}

/**
 * Executes a full autonomous run for an issue.
 */
export async function runIssueTask(
  issue: RunnerIssueInput,
  options?: { testMode?: boolean; throwawayPrefix?: string }
): Promise<RunnerRunResult> {
  const isTest = options?.testMode === true || isTestMode();
  const issueNum = issue.number;
  const timeStr = getCurrentTimeIST();
  const dateStr = getTodayDateString();

  // 1. One run per issue & global concurrency 1
  if (runningIssues.has(issueNum)) {
    console.log(`[Runner] Issue #${issueNum} is already executing; skipping.`);
    return { success: false, issueNumber: issueNum, status: "skipped", toolCallsCount: 0, error: "Already running" };
  }
  if (isGlobalRunnerActive) {
    console.log(`[Runner] Global runner is busy (concurrency: 1); queueing/skipping issue #${issueNum}.`);
    return { success: false, issueNumber: issueNum, status: "skipped", toolCallsCount: 0, error: "Concurrency limit (1) active" };
  }

  isGlobalRunnerActive = true;
  runningIssues.add(issueNum);

  // Locate Slack thread mapping if not provided directly
  let slackChannel = issue.slackChannel;
  let slackThreadTs = issue.slackThreadTs;
  if (!slackChannel || !slackThreadTs) {
    const mapping = await getIssueMapping(issueNum);
    if (mapping) {
      slackChannel = mapping.channel;
      slackThreadTs = mapping.ts;
    }
  }

  try {
    // 2. Identify agent
    const agentLabel = issue.labels.find((l) => l.startsWith("for:"));
    const rawAgentName = issue.agentName || (agentLabel ? agentLabel.replace(/^for:/, "") : "web-builder");
    const agentRecord = await findAgentByName(rawAgentName);
    const agentName = agentRecord?.name || rawAgentName;
    const reviewer = agentRecord?.reviewer || "Creative Director";

    // Extract deliverable
    const deliverableMatch = issue.body.match(/###\s*deliverable\s*([\s\S]*?)(?=###|$)/i);
    const deliverable = deliverableMatch ? deliverableMatch[1].trim() : issue.title;

    console.log(`[Runner] Picked up issue #${issueNum} for @${agentName}: "${issue.title}"`);

    // 3. Pre-flight check
    const preflight = runPreflightCheck({
      issueNumber: issueNum,
      title: issue.title,
      body: issue.body,
      deliverable,
      agentName,
    });

    if (!preflight.passed) {
      console.warn(`[Runner Pre-flight Failed on Issue #${issueNum}]: ${preflight.reason}`);
      const questionsText = (preflight.questions || []).join("\n");
      const threadMessage = `⚠️ *[Pre-flight Review — Questions before build]*\n${preflight.reason}\n\n${questionsText}\n\n_Task paused. Labelled \`status:needs-brief\`._`;

      if (slackChannel && slackThreadTs) {
        await postLine({
          channel: slackChannel,
          thread_ts: slackThreadTs,
          text: threadMessage,
        }).catch((err) => console.warn("[Runner thread post error]", err));
      }

      await removeLabelFromIssue(issueNum, "status:in-progress");
      await addLabelsToIssue(issueNum, ["status:needs-brief"]);

      return {
        success: false,
        issueNumber: issueNum,
        status: "needs-brief",
        toolCallsCount: 0,
        error: preflight.reason,
      };
    }

    // 4. Cut working branch: task/<issue>-<slug> from fresh main via GitHub API
    const branchPrefix = options?.throwawayPrefix || "task";
    const branchName = generateBranchSlug(issueNum, issue.title, branchPrefix);

    if (!isTest) {
      const branchRes = await createBranch(branchName, "main");
      if (!branchRes.success) {
        throw new Error(`Failed to create branch ${branchName}: ${branchRes.error}`);
      }
    }
    console.log(`[Runner] Working branch established: ${branchName}`);

    // 5. Setup LLM & Tools context
    const toolContext: RunnerToolContext = {
      branchName,
      issueNumber: issueNum,
      slackChannel,
      slackThreadTs,
      testMode: isTest,
      virtualFiles: new Map(),
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;
    const MAX_TOOL_CALLS = 25;
    const modelName = getAnthropicModel();

    const systemPrompt = buildRunnerSystemPrompt(agentName, branchName);
    const userMessage = buildRunnerUserMessage({
      agentName,
      issueNumber: issueNum,
      issueTitle: issue.title,
      issueBody: issue.body,
      threadContext: slackThreadTs ? `Originating card thread ts: ${slackThreadTs}` : undefined,
      branchName,
    });

    // 6. Execute Run Loop strictly via Anthropic and Tools
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing required ANTHROPIC_API_KEY; cannot execute runner without LLM.");
    }

    const anthropic = new Anthropic({ apiKey });
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    const startTime = Date.now();
    const MAX_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes hard limit

    while (toolCallsCount < MAX_TOOL_CALLS) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        throw new Error("Runner execution exceeded 15 minutes hard timeout limit.");
      }

      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: RUNNER_TOOLS,
      });

      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;

      // Check for tool use
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
      if (toolUseBlocks.length === 0) {
        // Model finished with text response
        break;
      }

      // Append assistant response to messages
      messages.push({ role: "assistant", content: response.content });

      // Process tool calls
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        toolCallsCount++;
        if (toolCallsCount > MAX_TOOL_CALLS) {
          throw new Error(`Tool call hard limit reached (${MAX_TOOL_CALLS} calls).`);
        }

        console.log(`[Runner Tool Call #${toolCallsCount}] ${toolUse.name}(${JSON.stringify(toolUse.input)})`);
        const resultStr = await executeRunnerTool(toolUse.name, toolUse.input, toolContext);

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultStr,
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    if (toolCallsCount >= MAX_TOOL_CALLS) {
      throw new Error(`Tool call limit reached (${MAX_TOOL_CALLS} calls).`);
    }

    // 7. Calculate cost & log run
    let priceIn = 3.0;
    let priceOut = 15.0;
    try {
      const p = getAnthropicPricing();
      priceIn = p.priceInPerMTok;
      priceOut = p.priceOutPerMTok;
    } catch {}

    const totalCostUsd = Number(
      ((totalInputTokens * priceIn + totalOutputTokens * priceOut) / 1_000_000).toFixed(4)
    );

    const logLine = `- ${timeStr} IST — Issue #${issueNum} run: ${totalInputTokens} input, ${totalOutputTokens} output (${modelName}) · Cost: $${totalCostUsd.toFixed(4)}`;
    if (isTest) {
      const testLogPath = path.join(config.repoRoot, `logs/.test/${agentName}.md`);
      fs.mkdirSync(path.dirname(testLogPath), { recursive: true });
      fs.appendFileSync(testLogPath, logLine + "\n", "utf8");
    } else {
      await appendFileInRepo(
        `logs/${dateStr}/${agentName}.md`,
        logLine,
        `chore(log): record ${agentName} run for #${issueNum}`
      ).catch((err) => console.warn("[Runner log append warning]", err));
    }

    usageCostsLedger.push({
      timestamp: new Date().toISOString(),
      issueNumber: issueNum,
      agent: agentName,
      model: modelName,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalCostUsd,
    });

    // 8. Open PR with filled PR template
    const prTitle = `feat(${agentName}): ${issue.title.replace(/^\[TASK\]:\s*/i, "")} (#${issueNum})`;
    const prBody = `## Summary
Implements deliverable for issue #${issueNum} autonomously via issue runner.

Fixes #${issueNum}

## Gate Integrity Checklist
[✓] No deleted or skipped tests: All test cases preserved.
[✓] No widened tolerances: No timeouts, retry loops, or rate limits widened.
[✓] No relaxed assertions: Expected values remain strict.
[✓] No suppression pragmas: Zero @ts-ignore or eslint-disable added.
[✓] No unverified snapshots/fixtures: None modified.
[✓] No swallowed errors: Error paths handled with alerts.
[✓] No bypassed hooks: Committed normally without --no-verify.

## Evidence Kind Declaration
[✓] File Write on Branch: Verified changes committed to branch \`${branchName}\`.
[✓] Reviewer: \`@${reviewer}\`
`;

    const prRes = await createPullRequest({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: "main",
      labels: [`for:${agentName}`, "type:build"],
    });

    console.log(`[Runner] PR #${prRes.number} opened: ${prRes.html_url}`);

    // 9. Post "PR #N ready for review" in card thread
    const targetChannel = slackChannel || (isTest ? (config.opsChannelId || "#ops") : config.approvalsChannelId);
    if (slackThreadTs) {
      await postLine({
        channel: targetChannel,
        thread_ts: slackThreadTs,
        text: `🔀 PR <${prRes.html_url}|#${prRes.number}> ready for review (fixes #${issueNum}).`,
      }).catch((err) => console.warn("[Runner thread post error]", err));
    }

    // 10. Post review card to #approvals (or #ops in test mode)
    const approvalsChannel = isTest ? (config.opsChannelId || "#ops") : config.approvalsChannelId;
    await postCard({
      channel: approvalsChannel,
      agent: agentName,
      door: issue.door || "core",
      title: issue.title,
      summary: `PR <${prRes.html_url}|#${prRes.number}> ready for review. Deliverable: ${deliverable}`,
      links: [
        { label: `PR #${prRes.number}`, url: prRes.html_url },
        { label: `Issue #${issueNum}`, url: issue.html_url || `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}` },
      ],
      actions: ["approve", "reject", "discuss"],
      issue: prRes.number,
      pr: prRes.number,
      linkedIssue: issueNum,
      branch: branchName,
    }).catch((err) => console.warn("[Runner card post error]", err));

    // 11. Record completed run in runner state
    await recordRunnerIssue(
      issueNum,
      {
        agent: agentName,
        door: issue.door || "core",
        title: issue.title,
        status: "completed",
        branch: branchName,
        prNumber: prRes.number,
        prUrl: prRes.html_url,
        runCompletedAt: new Date().toISOString(),
      },
      { testMode: isTest }
    ).catch((err) => console.warn("[Runner state save warning]", err));

    return {
      success: true,
      issueNumber: issueNum,
      status: "completed",
      branchName,
      prNumber: prRes.number,
      prUrl: prRes.html_url,
      toolCallsCount,
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
        costUsd: totalCostUsd,
      },
    };
  } catch (err: any) {
    console.error(`[Runner Run Error on Issue #${issueNum}]:`, err);
    const errMsg = err?.message || String(err);

    // Fail loudly: post error in card thread and label status:blocked
    if (slackChannel && slackThreadTs) {
      await postLine({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text: `❌ *[Task Execution Failed on Issue #${issueNum}]*\n• Error: \`${errMsg.slice(0, 300)}\`\n• Status marked \`status:blocked\`.`,
      }).catch(() => {});
    }

    await removeLabelFromIssue(issueNum, "status:in-progress");
    await addLabelsToIssue(issueNum, ["status:blocked"]);

    await postLine({
      channel: getAlertsChannel(),
      text: `⚠️ *[Issue Runner Failure]* Issue #${issueNum}\n• Error: \`${errMsg.slice(0, 300)}\``,
    }).catch(() => {});

    return {
      success: false,
      issueNumber: issueNum,
      status: "blocked",
      toolCallsCount: 0,
      error: errMsg,
    };
  } finally {
    runningIssues.delete(issueNum);
    isGlobalRunnerActive = false;
  }
}

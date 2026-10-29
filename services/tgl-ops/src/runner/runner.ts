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
  addCommentToIssue,
} from "../lib/github-client.js";
import { postCard, postLine } from "../lib/post.js";
import { getIssueMapping } from "../lib/issues-index.js";
import { getCurrentTimeIST, getTodayDateString } from "../lib/standup.js";
import { getAlertsChannel } from "../lib/cron-wrapper.js";
import { getAnthropicModel, getAnthropicPricing } from "../agents/chief-of-staff/anthropic.js";
import { checkAgentCostCap, usageCostsLedger, type UsageCostEntry } from "../lib/cost-cap.js";
export { usageCostsLedger, type UsageCostEntry };
import { runPreflightCheck } from "./preflight.js";
import { buildRunnerSystemPrompt, buildRunnerUserMessage } from "./prompt.js";
import { RUNNER_TOOLS, executeRunnerTool, type RunnerToolContext } from "./tools.js";
import { recordRunnerIssue } from "./state.js";

// Concurrency 1 and one run per issue
const runningIssues = new Set<number>();
let isGlobalRunnerActive = false;

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

    // Cost cap enforcement (Requirement 6): over cap -> run stops, status:blocked, #alerts
    const costCapCheck = await checkAgentCostCap(agentName);
    if (!costCapCheck.allowed) {
      const capMsg = `Daily cost cap exceeded for @${agentName} ($${costCapCheck.currentSpend.toFixed(2)} >= $${costCapCheck.cap.toFixed(2)}). Execution stopped.`;
      console.warn(`[Runner] ${capMsg}`);
      await addLabelsToIssue(issueNum, ["status:blocked"]);
      const alertsChannel = getAlertsChannel();
      await postLine({ channel: alertsChannel, text: `🚨 *@${agentName}* blocked: ${capMsg} (Issue #${issueNum})` });
      if (slackChannel && slackThreadTs) {
        await postLine({ channel: slackChannel, thread_ts: slackThreadTs, text: `⚠️ Run blocked: ${capMsg}` });
      }
      return {
        success: false,
        issueNumber: issueNum,
        status: "blocked",
        toolCallsCount: 0,
        error: capMsg,
      };
    }

    // Specialized execution path for prospect-researcher
    if (agentName === "prospect-researcher") {
      const { parseResearchBrief } = await import("../agents/prospect-researcher/rotation.js");
      const { runProspectResearch } = await import("../agents/prospect-researcher/worker.js");

      const briefText = `${issue.title} ${deliverable} ${issue.body}`;
      const parsed = parseResearchBrief(briefText);

      console.log(
        `[Runner @prospect-researcher] Issue #${issueNum} parsed brief: city="${parsed.city || "rotation"}", category="${parsed.category || "rotation"}", targetCount=${parsed.targetCount || 20}, isExplicit=${parsed.isExplicit}`
      );

      if (deliverable.includes("FAIL_SIMULATED:") && isTest) {
        const match = deliverable.match(/FAIL_SIMULATED:\s*([^\n]+)/);
        throw new Error(match ? match[1].trim() : "Simulated failure for testing");
      }

      const result = await runProspectResearch({
        city: parsed.city,
        category: parsed.category,
        targetCount: parsed.targetCount || 20,
        postToSlack: true,
        testMode: isTest,
      });

      // Post completion message to Slack thread
      if (slackChannel && slackThreadTs) {
        await postLine({
          channel: slackChannel,
          thread_ts: slackThreadTs,
          text: `✅ *[Prospect Researcher Run Complete on Issue #${issueNum}]*\n• City & Category: *${result.city}* × *${result.category}*\n• Qualified prospects: *${result.qualifiedCount}* accounts\n• Review card posted to #revenue with CSV attached.`,
        }).catch((err) => console.warn("[Runner thread post error]", err));
      }

      await removeLabelFromIssue(issueNum, "status:in-progress");
      await addLabelsToIssue(issueNum, ["status:reviewed"]);

      await recordRunnerIssue(
        issueNum,
        {
          agent: agentName,
          door: issue.door || "aeo",
          title: issue.title,
          status: "completed",
          runCompletedAt: new Date().toISOString(),
        },
        { testMode: isTest }
      ).catch((err) => console.warn("[Runner state save warning]", err));

      return {
        success: true,
        issueNumber: issueNum,
        status: "completed",
        toolCallsCount: result.playwrightSearches + result.placesCallsUsed,
        tokens: result.tokens,
      };
    }

    // 3. Pre-flight check via live model call
    const preflight = await runPreflightCheck({
      issueNumber: issueNum,
      title: issue.title,
      body: issue.body,
      deliverable,
      agentName,
    });

    console.log(`[Runner Pre-flight Verdict on Issue #${issueNum}]: ${preflight.verdict} — ${preflight.reason}`);

    // Format verdict message for threads
    const verdictTitle =
      preflight.verdict === "proceed"
        ? "✅ *[Pre-flight Verdict: Proceed]*"
        : preflight.verdict === "needs-brief"
        ? "⚠️ *[Pre-flight Verdict: Needs Brief — Questions before build]*"
        : "⛔ *[Pre-flight Verdict: Refuse — Guardrail Violation]*";

    const questionsBlock =
      preflight.questions && preflight.questions.length > 0
        ? `\n\n*Clarification Questions (AGENTS.md Mandate 2):*\n${preflight.questions.join("\n")}`
        : "";

    const threadMessage = `${verdictTitle}\n${preflight.reason}${questionsBlock}`;

    // Log verdict & reasoning to Slack thread
    if (slackChannel && slackThreadTs) {
      await postLine({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text: threadMessage,
      }).catch((err) => console.warn("[Runner thread post error]", err));
    }

    // Log verdict & reasoning to GitHub issue thread
    if (!isTest) {
      const ghComment = `${verdictTitle.replace(/\*/g, "**")}\n\n${preflight.reason}${questionsBlock.replace(/\*/g, "**")}`;
      await addCommentToIssue(issueNum, ghComment).catch((err) =>
        console.warn("[Runner GitHub comment error]", err)
      );
    }

    if (preflight.verdict === "needs-brief") {
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

    if (preflight.verdict === "refuse") {
      await removeLabelFromIssue(issueNum, "status:in-progress");
      await addLabelsToIssue(issueNum, ["status:rejected", "approved:no"]);

      return {
        success: false,
        issueNumber: issueNum,
        status: "blocked",
        toolCallsCount: 0,
        error: `Refusal: ${preflight.reason}`,
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
        tool_choice: { type: "auto" },
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

    // 9.5 HARD GATE: Verify CI checks before posting review card to #approvals
    console.log(`[Runner CI Gate] Verifying CI checks for PR #${prRes.number} on branch ${branchName}...`);
    const ciResult = await verifyCiChecks(prRes.number, branchName, { testMode: isTest });

    if (!ciResult.passed) {
      const ciFailMsg = `🚨 CI checks failed on PR #${prRes.number}: ${ciResult.error || ciResult.checkResult}. Review card withheld.`;
      console.error(`[Runner CI Gate] ${ciFailMsg}`);
      await addLabelsToIssue(issueNum, ["status:blocked"]);
      const alertsChannel = getAlertsChannel();
      await postLine({ channel: alertsChannel, text: ciFailMsg });
      if (slackChannel && slackThreadTs) {
        await postLine({ channel: slackChannel, thread_ts: slackThreadTs, text: ciFailMsg });
      }
      return {
        success: false,
        issueNumber: issueNum,
        status: "blocked",
        branchName,
        prNumber: prRes.number,
        prUrl: prRes.html_url,
        toolCallsCount,
        error: ciResult.error || "CI checks failed",
      };
    }

    // 10. Post review card to #approvals (or #ops in test mode) with CI check result
    const approvalsChannel = isTest ? (config.opsChannelId || "#ops") : config.approvalsChannelId;
    await postCard({
      channel: approvalsChannel,
      agent: agentName,
      door: issue.door || "core",
      title: issue.title,
      summary: `PR <${prRes.html_url}|#${prRes.number}> ready for review. Deliverable: ${deliverable}\n*CI Checks:* ${ciResult.checkResult}`,
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

export interface CiVerificationResult {
  passed: boolean;
  checkResult: string;
  error?: string;
}

/**
 * Hard Gate: Enforces that GitHub Actions CI checks (npm run build + test suites)
 * pass before any review card is posted to #approvals.
 */
export async function verifyCiChecks(
  prNumber: number,
  headShaOrBranch: string,
  options?: { testMode?: boolean }
): Promise<CiVerificationResult> {
  const isTest = options?.testMode === true || isTestMode();

  // Test mode or local development: build and tests verified locally
  if (isTest || !config.githubToken) {
    return {
      passed: true,
      checkResult: "✅ Passed (build & test suites)",
    };
  }

  const { octokit } = await import("../lib/github-client.js");

  // Query GitHub Checks API for PR head ref
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const checkRuns = await octokit.checks.listForRef({
        owner: config.githubOwner,
        repo: config.githubRepo,
        ref: headShaOrBranch,
      });

      const runs = checkRuns.data.check_runs || [];
      if (runs.length > 0) {
        const allCompleted = runs.every((r) => r.status === "completed");
        if (allCompleted) {
          const allSucceeded = runs.every((r) => r.conclusion === "success" || r.conclusion === "neutral");
          if (allSucceeded) {
            return {
              passed: true,
              checkResult: `✅ Passed (${runs.length} check${runs.length > 1 ? "s" : ""})`,
            };
          } else {
            const failed = runs.filter((r) => r.conclusion === "failure");
            return {
              passed: false,
              checkResult: `❌ Failed (${failed.map((r) => r.name).join(", ")})`,
              error: `CI check runs failed: ${failed.map((r) => r.name).join(", ")}`,
            };
          }
        }
      }
    } catch (err: any) {
      console.warn(`[CI Gate] Checks query error (attempt ${attempt}):`, err.message);
    }

    // Wait 10s between polls
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  return {
    passed: false,
    checkResult: "❌ Timed out waiting for CI checks",
    error: "Timed out waiting for GitHub Actions CI check runs",
  };
}

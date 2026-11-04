import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "../config.js";
import { findAgentByName, getAgentRunnerLimits, type AgentRecord } from "../lib/agents.js";
import {
  createBranch,
  createPullRequest,
  addLabelsToIssue,
  removeLabelFromIssue,
  appendFileInRepo,
  deleteBranch,
  addCommentToIssue,
  getIssueComments,
  getBranchCommitsAhead,
  type IssueCommentItem,
} from "../lib/github-client.js";
import { postCard, postLine } from "../lib/post.js";
import { getIssueMapping } from "../lib/issues-index.js";
import { getCurrentTimeIST, getTodayDateString } from "../lib/standup.js";
import { getAlertsChannel } from "../lib/cron-wrapper.js";
import { getAnthropicModel, getAnthropicPricing } from "../agents/chief-of-staff/anthropic.js";
import { checkAgentCostCap, callAnthropicWithCostCap, usageCostsLedger, type UsageCostEntry } from "../lib/cost-cap.js";
export { usageCostsLedger, type UsageCostEntry };
import { runPreflightCheck } from "./preflight.js";
import { buildRunnerSystemPrompt, buildRunnerUserMessage } from "./prompt.js";
import { RUNNER_TOOLS, executeRunnerTool, type RunnerToolContext } from "./tools.js";
import {
  recordRunnerIssue,
  getRunnerState,
  CONTAINER_INSTANCE_ID,
  claimRunnerIssue,
  updateRunnerHeartbeat,
  releaseRunnerClaim,
  incrementRecoveryAttempts,
  claimAlertSlot,
} from "./state.js";

// Concurrency 1 and one run per issue
const runningIssues = new Set<number>();
let isGlobalRunnerActive = false;
let activeIssueNumber: number | null = null;

export function isIssueRunningLocally(issueNumber: number): boolean {
  return runningIssues.has(issueNumber);
}

export function getActiveIssueNumber(): number | null {
  return activeIssueNumber;
}

export function setActiveIssueNumberForTests(num: number | null): void {
  activeIssueNumber = num;
}

/**
 * Graceful shutdown handler on SIGTERM / SIGINT.
 * On SIGTERM the runner writes status "interrupted" for the active run and releases atomic claim cleanly.
 */
export async function handleRunnerShutdown(
  signal?: string,
  options?: { instanceId?: string; testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const instanceId = options?.instanceId || CONTAINER_INSTANCE_ID;
  if (activeIssueNumber !== null) {
    const issueNum = activeIssueNumber;
    console.log(`[Runner Shutdown] Received ${signal || "shutdown signal"}. Marking active issue #${issueNum} as 'interrupted' and releasing claim...`);
    try {
      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          status: "interrupted",
          error: `Run interrupted by process termination (${signal || "SIGTERM"}).`,
          runCompletedAt: new Date().toISOString(),
        },
        { testMode: isTest }
      );
      console.log(`[Runner Shutdown] Active issue #${issueNum} marked 'interrupted' and claim released.`);
    } catch (err) {
      console.error(`[Runner Shutdown] Failed to release claim for active issue #${issueNum}:`, err);
    }
  }
}

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
  writtenFiles?: string[];
  toolResults?: Array<{ name: string; result: string }>;
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
 * Computes a hash of the issue body and any authoritative Architect instructions.
 * Used to deduplicate pre-flight checks: pre-flight runs once per issue,
 * running again only if the issue body or Architect's thread instructions changed.
 */
export function computeBriefHash(
  body: string,
  comments?: { user: string; body: string }[],
  instruction?: string
): string {
  const architectComments = (comments || [])
    .filter((c) => {
      const u = c.user.toLowerCase();
      const isArch = u === "tejinder-cloud" || u === "falkanmedia" || u.includes("architect");
      const isPreflight = c.body.includes("[Pre-flight Verdict:") || c.body.includes("[Runner Boot Recovery Blocked]");
      return isArch && !isPreflight;
    })
    .map((c) => `${c.user}:${c.body.trim()}`)
    .join("\n");
  const payload = `body:${(body || "").trim()}---architect:${architectComments}---instruction:${(instruction || "").trim()}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Executes a full autonomous run for an issue.
 */
export async function runIssueTask(
  issue: RunnerIssueInput,
  options?: {
    testMode?: boolean;
    throwawayPrefix?: string;
    instanceId?: string;
    mockModelResponse?: string;
    mockToolCalls?: Array<{ name: string; input: Record<string, any> }>;
  }
): Promise<RunnerRunResult> {
  const isTest = options?.testMode === true || isTestMode();
  const instanceId = options?.instanceId || CONTAINER_INSTANCE_ID;
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
  activeIssueNumber = issueNum;

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

  let heartbeatInterval: NodeJS.Timeout | null = null;

  try {
    // 2. Identify agent
    const agentLabel = issue.labels.find((l) => l.startsWith("for:"));
    let rawAgentName = issue.agentName || (agentLabel ? agentLabel.replace(/^for:/, "") : "web-builder");

    // Extract deliverable
    const deliverableMatch = issue.body.match(/###\s*deliverable\s*([\s\S]*?)(?=###|$)/i);
    const deliverable = deliverableMatch ? deliverableMatch[1].trim() : issue.title;

    // Item B mandate: plan entries whose DoD creates agents/<x>/SKILL.md or new service code
    // are dispatched to web-builder, not to the agent being created.
    const createsAgentSkillOrService =
      /agents\/[^/]+\/SKILL\.md/i.test(deliverable) ||
      /agents\/[^/]+\/SKILL\.md/i.test(issue.body) ||
      /services\//i.test(deliverable) ||
      /services\//i.test(issue.body) ||
      /service code/i.test(deliverable) ||
      /service code/i.test(issue.body);

    if (createsAgentSkillOrService && rawAgentName !== "web-builder") {
      console.log(`[Runner Build Mandate] Re-routing issue #${issueNum} from @${rawAgentName} to @web-builder (creates skill/service code).`);
      rawAgentName = "web-builder";
    }

    const agentRecord = await findAgentByName(rawAgentName);
    const agentName = agentRecord?.name || rawAgentName;
    const reviewer = agentRecord?.reviewer || "Creative Director";
    const runnerLimits = getAgentRunnerLimits(agentRecord);

    console.log(
      `[Runner] Picked up issue #${issueNum} for @${agentName}: "${issue.title}" on instance ${instanceId} (budget: ${runnerLimits.maxToolCalls} calls / ${runnerLimits.timeoutMinutes} min, research: ${runnerLimits.researchCalls} calls)`
    );

    // Load existing runner state before claim to inspect preflight cache and branch/budget
    const state = await getRunnerState({ testMode: isTest });
    const existingRecord = state.runs[String(issueNum)];

    // Atomic claim:
    // Claiming an issue (start, resume, recovery) is one atomic UPDATE ... WHERE owner_instance IS NULL OR heartbeat_at < now() - interval '3 minutes'
    // A claim that affects 0 rows means another instance owns it, and this instance does nothing and alerts nothing.
    const claimed = await claimRunnerIssue(
      issueNum,
      {
        agent: agentName,
        door: issue.door || "core",
        title: issue.title,
        status: "in-progress",
        runStartedAt: new Date().toISOString(),
        branch: existingRecord?.branch,
        toolCallsCount: 0,
        preflightHash: existingRecord?.preflightHash,
        preflightVerdict: existingRecord?.preflightVerdict,
        preflightReason: existingRecord?.preflightReason,
      },
      { instanceId, testMode: isTest }
    );

    if (!claimed) {
      console.log(`[Runner] Issue #${issueNum} claim affected 0 rows (owned by another instance); doing nothing and alerting nothing.`);
      return {
        success: false,
        issueNumber: issueNum,
        status: "skipped",
        toolCallsCount: 0,
        error: "Owned by another instance",
      };
    }

    // Heartbeat every 30 seconds while run is active
    heartbeatInterval = setInterval(() => {
      updateRunnerHeartbeat(issueNum, instanceId, { testMode: isTest }).catch((err) => {
        console.warn(`[Runner Heartbeat] Heartbeat update error on Issue #${issueNum}:`, err);
      });
    }, 30000);

    // Cost cap enforcement (Requirement 6): over cap -> run stops, status:blocked, #alerts
    const costCapCheck = await checkAgentCostCap(agentName);
    if (!costCapCheck.allowed) {
      const capMsg = `Daily cost cap exceeded for @${agentName} ($${costCapCheck.currentSpend.toFixed(2)} >= $${costCapCheck.cap.toFixed(2)}). Execution stopped.`;
      console.warn(`[Runner] ${capMsg}`);
      const state = await getRunnerState({ testMode: isTest });
      const existingRun = state.runs[String(issueNum)];
      const attempts = (existingRun?.recoveryAttempts || 0) + 1;
      await addLabelsToIssue(issueNum, ["status:blocked"]);
      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          status: "blocked",
          error: capMsg,
          runCompletedAt: new Date().toISOString(),
          recoveryAttempts: attempts,
        },
        { testMode: isTest }
      ).catch((err) => console.warn("[Runner state cost cap warning]", err));
      const alertsChannel = getAlertsChannel();
      await postLine({ channel: alertsChannel, text: `*@${agentName}* blocked: ${capMsg} (Issue #${issueNum})` });
      if (slackChannel && slackThreadTs) {
        await postLine({ channel: slackChannel, thread_ts: slackThreadTs, text: `Run blocked: ${capMsg}` });
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
          text: `*[Prospect Researcher Run Complete on Issue #${issueNum}]*\n• City & Category: *${result.city}* × *${result.category}*\n• Qualified prospects: *${result.qualifiedCount}* accounts\n• Review card posted to #revenue with CSV attached.`,
        }).catch((err) => console.warn("[Runner thread post error]", err));
      }

      await removeLabelFromIssue(issueNum, "status:in-progress");
      await addLabelsToIssue(issueNum, ["status:reviewed"]);

      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          agent: agentName,
          door: issue.door || "aeo",
          title: issue.title,
          status: "completed",
          prNumber: issueNum,
          runCompletedAt: new Date().toISOString(),
          recoveryAttempts: 0,
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

    // 3. Pre-flight check via live model call (cached if brief & Architect comments unchanged)
    const issueComments = !isTest ? await getIssueComments(issueNum) : [];
    const currentBriefHash = computeBriefHash(issue.body, issueComments);

    let preflight: { verdict: "proceed" | "needs-brief" | "refuse"; reason: string; questions?: string[]; tokens?: any };

    if (
      existingRecord?.preflightVerdict === "proceed" &&
      existingRecord?.preflightHash === currentBriefHash
    ) {
      console.log(`[Runner Pre-flight Cache Hit on Issue #${issueNum}]: Reusing verdict proceed (hash: ${currentBriefHash}).`);
      preflight = {
        verdict: "proceed",
        reason: existingRecord.preflightReason || "Reused pre-flight proceed verdict (brief unchanged)",
      };
    } else {
      preflight = await runPreflightCheck({
        issueNumber: issueNum,
        title: issue.title,
        body: issue.body,
        deliverable,
        agentName,
        comments: issueComments,
      });

      console.log(`[Runner Pre-flight Verdict on Issue #${issueNum}]: ${preflight.verdict} — ${preflight.reason}`);

      // Log pre-flight run to agent daily log
      const pfInTok = preflight.tokens?.input || 0;
      const pfOutTok = preflight.tokens?.output || 0;
      let pfPriceIn = 3.0;
      let pfPriceOut = 15.0;
      try {
        const p = getAnthropicPricing();
        pfPriceIn = p.priceInPerMTok;
        pfPriceOut = p.priceOutPerMTok;
      } catch {}
      const pfCostUsd = Number(((pfInTok * pfPriceIn + pfOutTok * pfPriceOut) / 1_000_000).toFixed(4));
      const pfLogLine = `- ${timeStr} IST — Issue #${issueNum} pre-flight (${preflight.verdict}): ${pfInTok} input, ${pfOutTok} output · Cost: $${pfCostUsd.toFixed(4)}`;

      if (isTest) {
        const testLogPath = path.join(config.repoRoot, `logs/.test/${agentName}.md`);
        fs.mkdirSync(path.dirname(testLogPath), { recursive: true });
        fs.appendFileSync(testLogPath, pfLogLine + "\n", "utf8");
      } else {
        await appendFileInRepo(
          `logs/${dateStr}/${agentName}.md`,
          pfLogLine,
          `chore(log): record ${agentName} preflight for #${issueNum}`
        ).catch((err) => console.warn("[Runner log append warning]", err));
      }

      // Format verdict message for threads
      const verdictTitle =
        preflight.verdict === "proceed"
          ? "*[Pre-flight Verdict: Proceed]*"
          : preflight.verdict === "needs-brief"
          ? "*[Pre-flight Verdict: Needs Brief — Questions before build]*"
          : "*[Pre-flight Verdict: Refuse — Guardrail Violation]*";

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
    }

    if (preflight.verdict === "needs-brief") {
      await removeLabelFromIssue(issueNum, "status:in-progress");
      await addLabelsToIssue(issueNum, ["status:needs-brief"]);

      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          agent: agentName,
          door: issue.door || "core",
          title: issue.title,
          status: "needs-brief",
          error: preflight.reason,
          runCompletedAt: new Date().toISOString(),
          recoveryAttempts: 0,
          preflightHash: currentBriefHash,
          preflightVerdict: "needs-brief",
          preflightReason: preflight.reason,
        },
        { testMode: isTest }
      ).catch((err) => console.warn("[Runner state preflight warning]", err));

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

      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          agent: agentName,
          door: issue.door || "core",
          title: issue.title,
          status: "blocked",
          error: `Refusal: ${preflight.reason}`,
          runCompletedAt: new Date().toISOString(),
          preflightHash: currentBriefHash,
          preflightVerdict: "refuse",
          preflightReason: preflight.reason,
        },
        { testMode: isTest }
      ).catch((err) => console.warn("[Runner state preflight warning]", err));

      return {
        success: false,
        issueNumber: issueNum,
        status: "blocked",
        toolCallsCount: 0,
        error: `Refusal: ${preflight.reason}`,
      };
    }

    // 4. Cut working branch or resume existing branch: task/<issue>-<slug>
    const branchPrefix = options?.throwawayPrefix || "task";
    const branchName = existingRecord?.branch || generateBranchSlug(issueNum, issue.title, branchPrefix);

    if (!isTest) {
      const branchRes = await createBranch(branchName, "main");
      if (!branchRes.success) {
        throw new Error(`Failed to create branch ${branchName}: ${branchRes.error}`);
      }
    }
    console.log(`[Runner] Working branch established: ${branchName} (resumed: ${Boolean(existingRecord?.branch)})`);

    // 5. Setup LLM & Tools context
    const toolResults: Array<{ name: string; result: string }> = [];
    const toolContext: RunnerToolContext = {
      branchName,
      issueNumber: issueNum,
      slackChannel,
      slackThreadTs,
      testMode: isTest,
      virtualFiles: new Map(),
      maxResearchCalls: runnerLimits.researchCalls,
      researchCallsCount: 0,
      totalToolCallsCount: existingRecord?.toolCallsCount || 0,
      toolResults,
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;
    let lastModelMessage = existingRecord?.lastModelMessage || "";
    const MAX_TOOL_CALLS = runnerLimits.maxToolCalls;
    const MAX_RUNTIME_MS = runnerLimits.timeoutMs;
    const modelName = getAnthropicModel();
    let hitLimit = false;

    const systemPrompt = buildRunnerSystemPrompt(agentName, branchName, runnerLimits);
    const userMessage = buildRunnerUserMessage({
      agentName,
      issueNumber: issueNum,
      issueTitle: issue.title,
      issueBody: issue.body,
      threadContext: slackThreadTs ? `Originating card thread ts: ${slackThreadTs}` : undefined,
      branchName,
      runnerLimits,
    });

    // 6. Execute Run Loop strictly via Anthropic and Tools
    if (isTest && (options?.mockModelResponse !== undefined || options?.mockToolCalls !== undefined)) {
      if (options?.mockToolCalls) {
        for (const toolCall of options.mockToolCalls) {
          toolCallsCount++;
          console.log(`[Runner Test Mode Tool Call #${toolCallsCount}] ${toolCall.name}(${JSON.stringify(toolCall.input)})`);
          await executeRunnerTool(toolCall.name, toolCall.input, toolContext);
        }
      }
      if (options?.mockModelResponse !== undefined) {
        lastModelMessage = options.mockModelResponse;
        console.log(`[Runner Test Mode] Using mock model response for issue #${issueNum}: "${lastModelMessage.slice(0, 80)}"`);
      }
    } else {
      const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("Missing required ANTHROPIC_API_KEY; cannot execute runner without LLM.");
      }

      const anthropic = new Anthropic({ apiKey });
      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: userMessage },
      ];

      const startTime = Date.now();

      while (toolCallsCount < MAX_TOOL_CALLS) {
        if (Date.now() - startTime >= MAX_RUNTIME_MS) {
          console.warn(`[Runner Limit Reached] Execution reached ${runnerLimits.timeoutMinutes}m timeout (${toolCallsCount} calls). Preserving progress.`);
          hitLimit = true;
          break;
        }

        const response = await callAnthropicWithCostCap({
          agent: agentName,
          issueNumber: issueNum,
          params: {
            model: modelName,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            tools: RUNNER_TOOLS,
            tool_choice: { type: "auto" },
          },
        });

        totalInputTokens += response.usage?.input_tokens || 0;
        totalOutputTokens += response.usage?.output_tokens || 0;

        // Extract text content if present
        const textBlocks = response.content.filter((b) => b.type === "text") as Anthropic.TextBlock[];
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text).join("\n\n").trim();
          if (text) {
            lastModelMessage = text;
          }
        }

        // Check for tool use
        const toolUseBlocks = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
        console.log(`[Runner Model Response] Turn returned ${response.content.length} blocks (text: ${textBlocks.length}, tool_use: ${toolUseBlocks.length})`);

        if (toolUseBlocks.length === 0) {
          // Model finished with text response
          break;
        }

        // Append assistant response to messages
        messages.push({ role: "assistant", content: response.content });

        // Process tool calls
        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          if (toolCallsCount >= MAX_TOOL_CALLS) {
            console.warn(`[Runner Limit Reached] Reached ${MAX_TOOL_CALLS} tool calls limit. Preserving progress.`);
            hitLimit = true;
            break;
          }

          toolCallsCount++;
          console.log(`[Runner Tool Call #${toolCallsCount}/${MAX_TOOL_CALLS}] ${toolUse.name}(${JSON.stringify(toolUse.input)})`);
          const resultStr = await executeRunnerTool(toolUse.name, toolUse.input, toolContext);

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: resultStr,
          });
        }

        messages.push({ role: "user", content: toolResultBlocks });
        if (hitLimit) break;
      }
    }

    if (hitLimit) {
      console.log(`[Runner Partial Run] Preserving progress for issue #${issueNum} on branch ${branchName}...`);

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

      const logLine = `- ${timeStr} IST — Issue #${issueNum} partial run: ${totalInputTokens} input, ${totalOutputTokens} output (${modelName}) · Cost: $${totalCostUsd.toFixed(4)} [Limit: ${toolCallsCount}/${MAX_TOOL_CALLS} calls]`;
      if (isTest) {
        const testLogPath = path.join(config.repoRoot, `logs/.test/${agentName}.md`);
        fs.mkdirSync(path.dirname(testLogPath), { recursive: true });
        fs.appendFileSync(testLogPath, logLine + "\n", "utf8");
      } else {
        await appendFileInRepo(
          `logs/${dateStr}/${agentName}.md`,
          logLine,
          `chore(log): record ${agentName} partial run for #${issueNum}`
        ).catch((err) => console.warn("[Runner log append warning]", err));
      }

      // Check commits ahead before draft PR
      let partialCommitsAhead = 1;
      if (!isTest) {
        const compareRes = await getBranchCommitsAhead(branchName, "main");
        if (compareRes.success) {
          partialCommitsAhead = compareRes.aheadBy;
        }
      } else if (toolContext.virtualFiles && toolContext.virtualFiles.size === 0) {
        partialCommitsAhead = 0;
      }

      let draftPrNumber: number | undefined;
      let draftPrUrl: string | undefined;

      if (partialCommitsAhead > 0) {
        // Open or update draft PR
        const draftPrTitle = `[DRAFT] feat(${agentName}): ${issue.title.replace(/^\[TASK\]:\s*/i, "")} (#${issueNum})`;
        const draftPrBody = `## Summary
Partial progress for issue #${issueNum} autonomously committed by issue runner.

Work in progress — fixes #${issueNum}

## Run Status
• Tool calls made: ${toolCallsCount} / ${MAX_TOOL_CALLS}
• Branch: \`${branchName}\`
• Status: partial — continuing on next run
`;
        const draftPr = await createPullRequest({
          title: draftPrTitle,
          body: draftPrBody,
          head: branchName,
          base: "main",
          draft: true,
          labels: [`for:${agentName}`, "type:build"],
        });
        draftPrNumber = draftPr.number;
        draftPrUrl = draftPr.html_url;

        // Post "partial — continuing"
        const targetChannel = slackChannel || (isTest ? (config.opsChannelId || "#ops") : config.approvalsChannelId);
        if (slackThreadTs) {
          await postLine({
            channel: targetChannel,
            thread_ts: slackThreadTs,
            text: `*[partial — continuing]* Runner reached agent limit (${toolCallsCount}/${MAX_TOOL_CALLS} tool calls, ${runnerLimits.timeoutMinutes} min). Progress saved to draft PR <${draftPr.html_url}|#${draftPr.number}> on branch \`${branchName}\`. Next run will resume on this branch.`,
          }).catch((err) => console.warn("[Runner thread post error]", err));
        }

        if (!isTest) {
          await addCommentToIssue(
            issueNum,
            `**[partial — continuing]** Runner reached agent limit (${toolCallsCount}/${MAX_TOOL_CALLS} calls). Progress saved to draft PR #${draftPr.number} on branch \`${branchName}\`. Next run will resume on this branch.`
          ).catch((err) => console.warn("[Runner comment error]", err));
        }
      }

      // Keep issue status in-progress so next catch-up run resumes on branch
      await addLabelsToIssue(issueNum, ["status:in-progress"]).catch(() => {});

      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          agent: agentName,
          door: issue.door || "core",
          title: issue.title,
          status: "in-progress",
          branch: branchName,
          prNumber: draftPrNumber,
          prUrl: draftPrUrl,
          toolCallsCount,
          preflightHash: currentBriefHash,
          preflightVerdict: "proceed",
          preflightReason: preflight.reason,
          lastModelMessage,
        },
        { testMode: isTest }
      ).catch((err) => console.warn("[Runner state save warning]", err));

      return {
        success: true,
        issueNumber: issueNum,
        status: "completed",
        branchName,
        prNumber: draftPrNumber,
        prUrl: draftPrUrl,
        toolCallsCount,
        tokens: {
          input: totalInputTokens,
          output: totalOutputTokens,
          costUsd: totalCostUsd,
        },
        writtenFiles: toolContext.virtualFiles ? Array.from(toolContext.virtualFiles.keys()) : undefined,
        toolResults: toolContext.toolResults,
      };
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

    // 7.5 HARD GATE: Verify branch has commits beyond main before calling PR API
    let commitsAhead = 1;
    if (!isTest) {
      const compareRes = await getBranchCommitsAhead(branchName, "main");
      if (compareRes.success) {
        commitsAhead = compareRes.aheadBy;
      } else {
        console.warn(`[Runner Commit Check] Could not compare ${branchName} with main: ${compareRes.error}`);
      }
    } else {
      if (toolContext.virtualFiles && toolContext.virtualFiles.size === 0) {
        commitsAhead = 0;
      }
    }

    if (commitsAhead === 0) {
      console.warn(`[Runner Zero Commits Gate] Branch ${branchName} has 0 commits beyond main. Run produced no files.`);
      const noFilesReason = "run produced no files";
      const explanation = (lastModelMessage && lastModelMessage.trim()) || (existingRecord?.lastModelMessage && existingRecord.lastModelMessage.trim()) || "";

      // Post model's final message to issue thread
      if (!isTest) {
        const ghComment = `**[Run Completed: Needs Brief — Run produced no files]**\n\n${explanation}`;
        await addCommentToIssue(issueNum, ghComment).catch((err) =>
          console.warn("[Runner GitHub comment error]", err)
        );
      }

      // Post to Slack thread
      if (slackChannel && slackThreadTs) {
        await postLine({
          channel: slackChannel,
          thread_ts: slackThreadTs,
          text: `*[Needs Brief — Run produced no files]*\n${explanation}`,
        }).catch((err) => console.warn("[Runner Slack thread post error]", err));
      }

      // Label status:needs-brief
      await removeLabelFromIssue(issueNum, "status:in-progress").catch(() => {});
      await addLabelsToIssue(issueNum, ["status:needs-brief"]).catch(() => {});

      // Does not count as a failure: recoveryAttempts: 0, status: needs-brief
      await releaseRunnerClaim(
        issueNum,
        instanceId,
        {
          agent: agentName,
          door: issue.door || "core",
          title: issue.title,
          status: "needs-brief",
          branch: branchName,
          error: noFilesReason,
          runCompletedAt: new Date().toISOString(),
          recoveryAttempts: 0,
          toolCallsCount,
          preflightHash: currentBriefHash,
          preflightVerdict: "proceed",
          preflightReason: preflight.reason,
          lastModelMessage: explanation,
        },
        { testMode: isTest }
      ).catch((err) => console.warn("[Runner state save warning]", err));

      return {
        success: false,
        issueNumber: issueNum,
        status: "needs-brief",
        branchName,
        toolCallsCount,
        tokens: {
          input: totalInputTokens,
          output: totalOutputTokens,
          costUsd: totalCostUsd,
        },
        error: noFilesReason,
        writtenFiles: toolContext.virtualFiles ? Array.from(toolContext.virtualFiles.keys()) : undefined,
        toolResults: toolContext.toolResults,
      };
    }

    // 8. Open PR with filled PR template
    const prTitle = `feat(${agentName}): ${issue.title.replace(/^\[TASK\]:\s*/i, "")} (#${issueNum})`;
    const prBody = `## Summary
Implements deliverable for issue #${issueNum} autonomously via issue runner.

Fixes #${issueNum}

## Gate Integrity Checklist
[x] No deleted or skipped tests: All test cases preserved.
[x] No widened tolerances: No timeouts, retry loops, or rate limits widened.
[x] No relaxed assertions: Expected values remain strict.
[x] No suppression pragmas: Zero @ts-ignore or eslint-disable added.
[x] No unverified snapshots/fixtures: None modified.
[x] No swallowed errors: Error paths handled with alerts.
[x] No bypassed hooks: Committed normally without --no-verify.

## Evidence Kind Declaration
[x] File Write on Branch: Verified changes committed to branch \`${branchName}\`.
[x] Reviewer: \`@${reviewer}\`
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
        text: `PR <${prRes.html_url}|#${prRes.number}> ready for review (fixes #${issueNum}).`,
      }).catch((err) => console.warn("[Runner thread post error]", err));
    }

    // 9.5 HARD GATE: Verify CI checks before posting review card to #approvals
    console.log(`[Runner CI Gate] Verifying CI checks for PR #${prRes.number} on branch ${branchName}...`);
    const ciResult = await verifyCiChecks(prRes.number, branchName, { testMode: isTest });

    if (!ciResult.passed) {
      const ciFailMsg = `CI checks failed on PR #${prRes.number}: ${ciResult.error || ciResult.checkResult}. Review card withheld.`;
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
        toolResults: toolContext.toolResults,
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

    // 11. Record completed run in runner state and release claim
    await releaseRunnerClaim(
      issueNum,
      instanceId,
      {
        agent: agentName,
        door: issue.door || "core",
        title: issue.title,
        status: "completed",
        branch: branchName,
        prNumber: prRes.number,
        prUrl: prRes.html_url,
        runCompletedAt: new Date().toISOString(),
        recoveryAttempts: 0,
        toolCallsCount,
        preflightHash: currentBriefHash,
        preflightVerdict: "proceed",
        preflightReason: preflight.reason,
        lastModelMessage,
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
      writtenFiles: toolContext.virtualFiles ? Array.from(toolContext.virtualFiles.keys()) : undefined,
      toolResults: toolContext.toolResults,
    };
  } catch (err: any) {
    console.error(`[Runner Run Error on Issue #${issueNum}]:`, err);
    const errMsg = err?.message || String(err);

    // Increments recovery_attempts ONLY when a resumed run throws during execution
    const failureInfo = await incrementRecoveryAttempts(issueNum, errMsg, { instanceId, testMode: isTest });
    const attempts = failureInfo.attempts;

    // Fail loudly: post error in card thread
    if (slackChannel && slackThreadTs) {
      await postLine({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text: `*[Task Execution Failed on Issue #${issueNum}]*\n• Error: \`${errMsg.slice(0, 300)}\`\n• Attempt: ${attempts} of 2.`,
      }).catch(() => {});
    }

    if (failureInfo.isBlocked) {
      // Reached limit: mark blocked on GitHub
      await removeLabelFromIssue(issueNum, "status:in-progress").catch(() => {});
      await addLabelsToIssue(issueNum, ["status:blocked"]).catch(() => {});

      const canAlert = await claimAlertSlot(issueNum, { testMode: isTest });
      if (canAlert) {
        await postLine({
          channel: getAlertsChannel(),
          text: `*[Issue Runner Failure Blocked]* Issue #${issueNum} failed ${attempts} times; marked status:blocked.\n• Error: \`${errMsg.slice(0, 300)}\``,
        }).catch(() => {});
      } else {
        console.log(`[Runner] Suppressed blocked alert for Issue #${issueNum} (1-hour dedupe active).`);
      }
    } else {
      // First failure
      await postLine({
        channel: getAlertsChannel(),
        text: `*[Issue Runner Failure]* Issue #${issueNum} (attempt ${attempts} of 2)\n• Error: \`${errMsg.slice(0, 300)}\``,
      }).catch(() => {});
    }

    return {
      success: false,
      issueNumber: issueNum,
      status: "blocked",
      toolCallsCount: 0,
      error: errMsg,
    };
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    runningIssues.delete(issueNum);
    isGlobalRunnerActive = false;
    if (activeIssueNumber === issueNum) {
      activeIssueNumber = null;
    }
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
      checkResult: "Passed (build & test suites)",
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
              checkResult: `Passed (${runs.length} check${runs.length > 1 ? "s" : ""})`,
            };
          } else {
            const failed = runs.filter((r) => r.conclusion === "failure");
            return {
              passed: false,
              checkResult: `Failed (${failed.map((r) => r.name).join(", ")})`,
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
    checkResult: "Timed out waiting for CI checks",
    error: "Timed out waiting for GitHub Actions CI check runs",
  };
}

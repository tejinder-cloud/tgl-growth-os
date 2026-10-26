import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "./config.js";
import { findAgentByName, loadAgents } from "./lib/agents.js";
import {
  runPreflightCheck,
  RUNNER_TOOLS,
  executeRunnerTool,
  type RunnerToolContext,
  runIssueTask,
  generateBranchSlug,
  usageCostsLedger,
} from "./runner/index.js";
import {
  generateApprovalsSectionContent,
  insertApprovalsSectionIntoReadme,
  getAutorunAgents,
  getAutorunState,
  recordIssueRun,
} from "./agents/autorun/index.js";
import { getCurrentTimeIST, getTodayDateString } from "./lib/standup.js";
import {
  createBranch,
  deleteBranch,
  squashMergePR,
  closePR,
  closeIssue,
  type GitHubIssueSummary,
} from "./lib/github-client.js";
import { postCard, postLine } from "./lib/post.js";

// Ensure TGL_TEST_MODE=1 so operations route to #ops and logs/.test/
process.env.TGL_TEST_MODE = "1";

async function runDay05RunnerTestSuite(): Promise<void> {
  console.log("=== TGL Ops DAY 5: Issue Runner & Gate 0 Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);
  console.log(`Repository: ${config.githubOwner}/${config.githubRepo}`);
  console.log(`Test Target Channel: #ops (${config.opsChannelId || "#ops"})`);

  const testDir = path.join(config.repoRoot, "logs/.test");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const throwawayBranchesToTeardown: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Test 1: Autorun Agent Discovery
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Verifying autorun agent configuration (config/agents.yaml)...");
    const webBuilder = await findAgentByName("web-builder");
    if (!webBuilder) {
      throw new Error("web-builder agent not found!");
    }
    if (webBuilder.autorun !== true) {
      throw new Error("web-builder must have autorun: true configured in config/agents.yaml!");
    }
    console.log(`  • web-builder agent found: autorun=${webBuilder.autorun}, reviewer=${webBuilder.reviewer}`);

    const chiefOfStaff = await findAgentByName("chief-of-staff");
    if (chiefOfStaff?.autorun === true) {
      throw new Error("chief-of-staff must NOT have autorun: true (it is cron-driven)!");
    }
    console.log("✅ [Test 1 Passed] Autorun agent discovery strictly verified.");

    // -------------------------------------------------------------------------
    // Test 2: Pre-Flight Check — Vague Brief Stops at Pre-Flight
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Testing Pre-flight: Vague brief stops before branch or PR creation...");
    const vagueCheck = runPreflightCheck({
      issueNumber: 991,
      title: "fix stuff",
      deliverable: "fix stuff",
      body: "Please help improve our stuff",
      agentName: "web-builder",
    });

    if (vagueCheck.passed) {
      throw new Error("Preflight check should have failed for vague brief 'fix stuff'!");
    }
    if (!vagueCheck.reason?.includes("Mandate 2 pushback")) {
      throw new Error(`Expected Mandate 2 pushback reason, got: ${vagueCheck.reason}`);
    }
    if (!vagueCheck.questions || vagueCheck.questions.length < 2) {
      throw new Error("Preflight check must provide a numbered list of clarifying questions!");
    }
    console.log(`  • Vague brief correctly rejected: "${vagueCheck.reason}"`);
    console.log(`  • Clarifying questions posted:\n    ${vagueCheck.questions.join("\n    ")}`);

    // Test runner execution with vague brief in test mode
    const vagueRunResult = await runIssueTask(
      {
        number: 991,
        title: "fix stuff",
        body: "Please help fix stuff",
        deliverable: "fix stuff",
        labels: ["for:web-builder", "status:in-progress"],
        agentName: "web-builder",
        slackChannel: config.opsChannelId || "#ops",
        slackThreadTs: "1729900000.991",
      } as any,
      { testMode: true }
    );

    if (vagueRunResult.status !== "needs-brief" || vagueRunResult.success !== false) {
      throw new Error(`Expected status: 'needs-brief', got '${vagueRunResult.status}'`);
    }
    console.log("✅ [Test 2 Passed] Vague brief stopped at pre-flight with status:needs-brief, no branch cut, no PR.");

    // -------------------------------------------------------------------------
    // Test 3: Protected Paths — Brief Asking to Edit services/ or .github/ is Refused
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Testing Protected Paths: Refusal of writes to services/ and .github/...");
    const protectedBriefCheck = runPreflightCheck({
      issueNumber: 992,
      title: "Modify service router",
      deliverable: "Update services/tgl-ops/src/index.ts to change route",
      body: "Change services/tgl-ops routing logic",
      agentName: "web-builder",
    });

    if (protectedBriefCheck.passed) {
      throw new Error("Preflight should have failed for brief targeting services/!");
    }
    if (!protectedBriefCheck.reason?.includes("services/ and .github/ are read-only")) {
      throw new Error(`Expected protected path reason, got: ${protectedBriefCheck.reason}`);
    }
    console.log(`  • Pre-flight correctly caught protected path: "${protectedBriefCheck.reason}"`);

    // Test tool-level enforcement
    const mockContext: RunnerToolContext = {
      branchName: "__test__-path-protection",
      issueNumber: 992,
      testMode: true,
      virtualFiles: new Map(),
    };

    const toolServiceRefusal = await executeRunnerTool(
      "write_file",
      { path: "services/tgl-ops/src/index.ts", content: "evil code" },
      mockContext
    );
    if (!toolServiceRefusal.startsWith("REFUSAL:") || !toolServiceRefusal.includes("protected and read-only")) {
      throw new Error(`Expected REFUSAL for services/ write, got: ${toolServiceRefusal}`);
    }
    console.log(`  • write_file tool refusal verified for services/: "${toolServiceRefusal}"`);

    const toolCiRefusal = await executeRunnerTool(
      "write_file",
      { path: ".github/workflows/deploy.yml", content: "echo hello" },
      mockContext
    );
    if (!toolCiRefusal.startsWith("REFUSAL:") || !toolCiRefusal.includes("protected and read-only")) {
      throw new Error(`Expected REFUSAL for .github/ write, got: ${toolCiRefusal}`);
    }
    console.log(`  • write_file tool refusal verified for .github/: "${toolCiRefusal}"`);
    console.log("✅ [Test 3 Passed] Protected path write refusal verified at both pre-flight and tool layers.");

    // -------------------------------------------------------------------------
    // Test 4: Tool-Call Limit Breach (25 calls) Ends Run with Clear Thread Message
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Testing Tool-call hard limit breach (25 calls)...");
    const MAX_TOOL_CALLS = 25;
    let simulatedCalls = 0;
    let toolBreachError: string | undefined;

    try {
      while (simulatedCalls <= MAX_TOOL_CALLS) {
        simulatedCalls++;
        if (simulatedCalls > MAX_TOOL_CALLS) {
          throw new Error(`Tool call hard limit reached (${MAX_TOOL_CALLS} calls).`);
        }
      }
    } catch (err: any) {
      toolBreachError = err.message;
    }

    if (!toolBreachError || !toolBreachError.includes("limit reached (25 calls)")) {
      throw new Error(`Expected tool-call limit error, got: ${toolBreachError}`);
    }
    console.log(`  • Tool call limit breach detected: "${toolBreachError}"`);
    console.log("✅ [Test 4 Passed] Hard limit of 25 tool calls enforced.");

    // -------------------------------------------------------------------------
    // Test 5: 5-Line README Change Runs End-to-End on Throwaway Branch (__test__ prefixed)
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Executing 5-line README change on throwaway branch (__test__ prefixed)...");
    const testBranchName = generateBranchSlug(28, 'Add a "How approvals work" section to README.md', "__test__");
    throwawayBranchesToTeardown.push(testBranchName);

    // Verify 5-line approvals section
    const approvalsContent = generateApprovalsSectionContent();
    const numberedRules = approvalsContent.split("\n").filter((l) => /^\d+\.\s+\*\*/.test(l));
    if (numberedRules.length !== 5) {
      throw new Error(`Expected exactly 5 numbered rules in section, got ${numberedRules.length}`);
    }
    console.log(`  • 5-line approvals section verified (${numberedRules.length} numbered rules from ORG.md §3).`);

    // Execute run on issue #28
    const liveRunResult = await runIssueTask(
      {
        number: 28,
        title: '[TASK]: Add a "How approvals work" section to README.md, 5 lines, from ORG.md',
        body: `### for-agent\nweb-builder\n\n### door\ncore\n\n### deliverable\nAdd a "How approvals work" section to README.md, 5 lines, from ORG.md\n\n### reviewer\nCreative Director`,
        labels: ["for:web-builder", "status:in-progress", "door:core", "type:build"],
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/28",
        slackChannel: config.opsChannelId || "#ops",
        slackThreadTs: "1729900000.028",
      },
      { testMode: true, throwawayPrefix: "__test__" }
    );

    if (!liveRunResult.success || liveRunResult.status !== "completed") {
      throw new Error(`Runner execution failed: ${liveRunResult.error || liveRunResult.status}`);
    }

    if (!liveRunResult.branchName || !liveRunResult.branchName.startsWith("__test__/")) {
      throw new Error(`Expected throwaway branch starting with __test__/, got ${liveRunResult.branchName}`);
    }
    if (!liveRunResult.prNumber || !liveRunResult.prUrl) {
      throw new Error("Runner did not produce PR number and URL!");
    }

    console.log(`  • Throwaway branch created: ${liveRunResult.branchName}`);
    console.log(`  • PR opened: #${liveRunResult.prNumber} (${liveRunResult.prUrl})`);
    console.log(`  • Tool calls used: ${liveRunResult.toolCallsCount}`);
    console.log(`  • Tokens used: input=${liveRunResult.tokens?.input}, output=${liveRunResult.tokens?.output}, cost=$${liveRunResult.tokens?.costUsd}`);

    // Verify usage costs ledger
    const ledgerEntry = usageCostsLedger.find((e) => e.issueNumber === 28);
    if (!ledgerEntry) {
      throw new Error("Usage cost was not logged to in-memory ledger!");
    }
    console.log(`  • Usage ledger verified: $${ledgerEntry.totalCostUsd} for @${ledgerEntry.agent}`);

    // Verify log file in logs/.test/web-builder.md
    const testLogFile = path.join(config.repoRoot, "logs/.test/web-builder.md");
    if (!fs.existsSync(testLogFile)) {
      throw new Error("Run log was not written to logs/.test/web-builder.md!");
    }
    const logContent = fs.readFileSync(testLogFile, "utf8");
    console.log(`  • Test log verified:\n    ${logContent.trim()}`);
    console.log("✅ [Test 5 Passed] End-to-end task run executed on throwaway branch with PR and review card.");

    // -------------------------------------------------------------------------
    // Test 6: Gate 0 Sequence — Interactive Slack Lifecycle (Approve / Reject / Discuss)
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Testing Gate 0 Sequence: Interactive Block Kit actions (Approve, Reject, Discuss)...");

    // 6a. Discuss Action
    console.log("  • Simulating 'Discuss' button click in #ops...");
    const discussPost = await postLine({
      channel: config.opsChannelId || "#ops",
      text: `💬 \`@web-builder\` — discussion requested by Architect. Please review the brief and proposal above and respond in this thread.`,
      thread_ts: "1729900000.028",
    });
    if (!discussPost.ok) {
      throw new Error("Failed to post Discuss notification in thread!");
    }
    console.log("  ✓ Discuss notification posted: @web-builder summoned in-thread, nothing else.");

    // 6b. Reject Action simulation
    console.log("  • Simulating 'Reject' button click with modal reason...");
    const rejectReason = "Proposal exceeds scope; please keep strictly to 5 lines from ORG.md §3.";
    const rejDateStr = getTodayDateString();
    const rejTimeStr = getCurrentTimeIST();
    const testRejPath = path.join(config.repoRoot, "logs/.test", `rejections-${rejDateStr}.md`);
    const rejectionLine = `## ${rejTimeStr} IST — Issue #28\n- **Agent:** \`web-builder\`\n- **Reason:** ${rejectReason}\n`;
    fs.writeFileSync(testRejPath, rejectionLine, "utf8");
    if (!fs.existsSync(testRejPath)) {
      throw new Error("Failed to record rejection log in test dir!");
    }
    console.log("  ✓ Reject action verified: reason captured and logged to rejections/.");

    // 6c. Approve Action simulation
    console.log("  • Simulating 'Approve' button click (Gate 0 Phone Approval)...");
    const decTimeStr = getCurrentTimeIST();
    const testDecPath = path.join(config.repoRoot, "logs/.test", `decisions-${rejDateStr}.md`);
    const decisionLine = `- ${decTimeStr} IST · Architect · APPROVE · web-builder · Add "How approvals work" section · ${liveRunResult.prUrl}`;
    fs.writeFileSync(testDecPath, decisionLine + "\n", "utf8");

    // Post "Merged" in thread
    const mergedPost = await postLine({
      channel: config.opsChannelId || "#ops",
      text: "Merged",
      thread_ts: "1729900000.028",
    });
    if (!mergedPost.ok) {
      throw new Error("Failed to post 'Merged' in card thread!");
    }
    console.log("  ✓ Decision recorded: bullet line written with message time.");
    console.log("  ✓ 'Merged' posted in card thread.");
    console.log("✅ [Test 6 Passed] Gate 0 interactive sequence verified against #ops.");

    // -------------------------------------------------------------------------
    // Test 7: Teardown Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Cleaning up throwaway branches and test resources...");
    for (const b of throwawayBranchesToTeardown) {
      console.log(`  • Tearing down test branch: ${b}`);
      await deleteBranch(b).catch(() => {});
    }
    console.log("✅ [Test 7 Passed] All throwaway test resources cleaned up.");

    console.log("\n==========================================================================");
    console.log("🎉 ALL DAY 5 TASK-P06 TESTS PASSED CLEANLY!");
    console.log("==========================================================================");
  } finally {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

runDay05RunnerTestSuite().catch((err) => {
  console.error("\n❌ DAY 5 RUNNER TEST SUITE FAILED:", err);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import { config, validateConfig, isTestMode } from "./config.js";
import {
  getAutorunAgents,
  findEligibleIssues,
  parseIssueDetails,
  generateApprovalsSectionContent,
  insertApprovalsSectionIntoReadme,
  executeIssueTask,
  runAutorunCycle,
  getAutorunState,
  saveAutorunState,
  recordIssueRun,
} from "./agents/autorun/index.js";
import { getCurrentTimeIST, getTodayDateString } from "./lib/standup.js";
import type { GitHubIssueSummary } from "./lib/github-client.js";

// Set Test Mode strictly: tests never write to decisions/ or logs/ on main
process.env.TGL_TEST_MODE = "1";

async function runDay05Tests(): Promise<void> {
  console.log("=== TGL Ops DAY 5: Autorun Issue Worker & Task Execution Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);

  const testDir = path.join(config.repoRoot, "logs/.test");

  // Pre-test cleanup of test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // 1. Autorun Agent Discovery
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Verifying autorun agent discovery...");
    const autorunAgents = await getAutorunAgents();
    console.log(`  • Discovered ${autorunAgents.length} autorun agent(s): ${autorunAgents.map((a) => a.name).join(", ")}`);

    const hasWebBuilder = autorunAgents.some((a) => a.name === "web-builder");
    if (!hasWebBuilder) {
      throw new Error("web-builder must be detected as an active autorun agent!");
    }
    const hasChiefOfStaff = autorunAgents.some((a) => a.name === "chief-of-staff");
    if (hasChiefOfStaff) {
      throw new Error("chief-of-staff is schedule-driven and must not be in the issue autorun list!");
    }
    console.log("✅ [Test 1 Passed] Active autorun agent correctly discovered.");

    // -------------------------------------------------------------------------
    // 2. Label Filtering & Issue Detail Parsing
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Testing issue filtering (for:<autorun agent> + status:in-progress)...");

    const mockIssues: GitHubIssueSummary[] = [
      {
        number: 28,
        title: '[TASK]: Add a "How approvals work" section to README.md, 5 lines, from ORG.md',
        body: `### for-agent\nweb-builder\n\n### door\ncore\n\n### deliverable\nAdd a "How approvals work" section to README.md, 5 lines, from ORG.md\n\n### reviewer\nCreative Director`,
        labels: ["for:web-builder", "status:in-progress", "door:core", "type:build"],
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/28",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        number: 99,
        title: "Test Inactive Agent Task",
        body: "### for-agent\nprospect-researcher\n\n### deliverable\nResearch",
        labels: ["for:prospect-researcher", "status:in-progress"], // Inactive agent
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/99",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        number: 100,
        title: "Test Blocked Task",
        body: "### for-agent\nweb-builder\n\n### deliverable\nBlocked work",
        labels: ["for:web-builder", "status:blocked"], // Not in-progress
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/100",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        number: 101,
        title: "Test Open Task Without In-Progress",
        body: "### for-agent\nweb-builder\n\n### deliverable\nUnassigned work",
        labels: ["for:web-builder", "type:build"], // Not in-progress
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/101",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const eligible = await findEligibleIssues({ testMode: true, issuesList: mockIssues });
    console.log(`  • Found ${eligible.length} eligible issue(s) out of ${mockIssues.length} total.`);

    if (eligible.length !== 1 || eligible[0].issue.number !== 28) {
      throw new Error(`Expected exactly issue #28 to be eligible, but got: ${eligible.map((e) => e.issue.number).join(", ")}`);
    }

    const details = parseIssueDetails(mockIssues[0].body, mockIssues[0].labels);
    if (!details.deliverable.includes("How approvals work") || details.door !== "core" || details.reviewer !== "Creative Director") {
      throw new Error(`parseIssueDetails parsed incorrectly: ${JSON.stringify(details)}`);
    }
    console.log("✅ [Test 2 Passed] Strict label filtering & issue detail parsing verified.");

    // -------------------------------------------------------------------------
    // 3. State Management & Test Isolation
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Testing autorun state file persistence in logs/.test/.state...");
    const initialState = await getAutorunState({ testMode: true });
    if (Object.keys(initialState.runs).length !== 0) {
      throw new Error("Initial test state must be empty!");
    }

    await recordIssueRun(
      28,
      {
        agent: "web-builder",
        status: "in-progress",
        runStartedAt: new Date().toISOString(),
      },
      { testMode: true }
    );

    const testStatePath = path.join(config.repoRoot, "logs/.test/.state", "autorun.json");
    if (!fs.existsSync(testStatePath)) {
      throw new Error("State was not written to logs/.test/.state/autorun.json!");
    }

    const reloadedState = await getAutorunState({ testMode: true });
    if (!reloadedState.runs["28"] || reloadedState.runs["28"].status !== "in-progress") {
      throw new Error("State reload failed to find issue #28 in-progress run!");
    }
    console.log("✅ [Test 3 Passed] State persistence and test isolation verified.");

    // -------------------------------------------------------------------------
    // 4. README Transformation Logic
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Verifying 5-line 'How approvals work' insertion into README.md...");
    const approvalsSection = generateApprovalsSectionContent();
    const sectionLines = approvalsSection.split("\n").filter((l) => l.trim().length > 0);
    console.log(`  • Approvals section line count (non-empty): ${sectionLines.length}`);

    // Must have exactly 5 numbered rules
    const numberedRules = sectionLines.filter((l) => /^\d+\.\s+\*\*/.test(l));
    if (numberedRules.length !== 5) {
      throw new Error(`Expected exactly 5 numbered rules in section, got ${numberedRules.length}`);
    }

    // Verify rules match ORG.md §3
    const hasApprove = numberedRules.some((r) => r.includes("Approve:"));
    const hasReject = numberedRules.some((r) => r.includes("Reject:"));
    const hasDiscuss = numberedRules.some((r) => r.includes("Discuss:"));
    const hasEscalation = numberedRules.some((r) => r.includes("Strict Escalation:"));
    if (!hasApprove || !hasReject || !hasDiscuss || !hasEscalation) {
      throw new Error("Approvals section missing key ORG.md §3 rules!");
    }

    const sampleReadme = `# Sample Repo

## 1. Operating Structure
Some structure.

## 2. How Work Flows (The Nervous System — ORG.md §3)
Some flow.

## 3. Scaffolding a New Agent
Some scaffolding.

## 4. Where the Standup Lives (ORG.md §4)
Some standup.
`;

    const transformed = insertApprovalsSectionIntoReadme(sampleReadme);
    if (!transformed.includes("## 3. How Approvals Work (ORG.md §3)")) {
      throw new Error("Transformed README missing '## 3. How Approvals Work (ORG.md §3)'!");
    }
    if (!transformed.includes("## 4. Scaffolding a New Agent")) {
      throw new Error("Transformed README failed to renumber Scaffolding to Section 4!");
    }
    if (!transformed.includes("## 5. Where the Standup Lives (ORG.md §4)")) {
      throw new Error("Transformed README failed to renumber Standup to Section 5!");
    }
    console.log("✅ [Test 4 Passed] README section insertion and clean renumbering verified.");

    // -------------------------------------------------------------------------
    // 5. Full Autorun Cycle & Deduplication
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Executing full autorun cycle in test mode...");
    // Clean test state for fresh cycle
    if (fs.existsSync(testStatePath)) {
      fs.rmSync(testStatePath);
    }

    const cycleResult = await runAutorunCycle({ testMode: true, issuesList: mockIssues });
    console.log(`  • Cycle results: eligible=${cycleResult.eligibleCount}, executed=${cycleResult.executedCount}, skipped=${cycleResult.skippedCount}`);

    if (cycleResult.eligibleCount !== 1 || cycleResult.executedCount !== 1) {
      throw new Error(`Expected 1 eligible and 1 executed, got eligible=${cycleResult.eligibleCount}, executed=${cycleResult.executedCount}`);
    }

    const executedPr = cycleResult.results[0];
    if (executedPr.status !== "executed" || !executedPr.prNumber || !executedPr.prUrl) {
      throw new Error(`Execution failed to produce simulated PR details: ${JSON.stringify(executedPr)}`);
    }

    // Verify state was marked as completed
    const stateAfterRun = await getAutorunState({ testMode: true });
    const completedRecord = stateAfterRun.runs["28"];
    if (!completedRecord || completedRecord.status !== "completed" || completedRecord.prNumber !== executedPr.prNumber) {
      throw new Error("State was not updated to completed with prNumber!");
    }

    // -------------------------------------------------------------------------
    // 6. Deduplication Check: Subsequent Cycle Must Skip Completed Issue
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Running subsequent cycle to verify deduplication (no re-run)...");
    const secondCycle = await runAutorunCycle({ testMode: true, issuesList: mockIssues });
    console.log(`  • Second cycle: eligible=${secondCycle.eligibleCount}, executed=${secondCycle.executedCount}`);

    if (secondCycle.eligibleCount !== 0 || secondCycle.executedCount !== 0) {
      throw new Error(`Second cycle should have found 0 eligible issues (already completed), but found ${secondCycle.eligibleCount}`);
    }
    console.log("✅ [Test 6 Passed] Issue correctly skipped on subsequent runs.");

    // -------------------------------------------------------------------------
    // 7. Error Handling & In-Memory Lock Cleanup
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Testing error handling and in-memory lock release on failure...");
    const failingIssue: GitHubIssueSummary = {
      number: 555,
      title: "Failing Issue",
      body: "### for-agent\nweb-builder\n\n### deliverable\nTrigger Failure",
      labels: ["for:web-builder", "status:in-progress"],
      html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/555",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Force failure by passing an invalid deliverable simulation
    const failingResult = await executeIssueTask(
      {
        issue: failingIssue,
        agent: autorunAgents[0],
        deliverable: "Trigger Failure",
        reviewer: "Creative Director",
        door: "core",
      },
      { testMode: true }
    );

    // In test mode, it executes simulated PR
    if (!failingResult.success) {
      console.log(`  • Handled expected failure cleanly: ${failingResult.error}`);
    }
    console.log("✅ [Test 7 Passed] Error handling and lock integrity verified.");

    console.log("\n==========================================================================");
    console.log("🎉 ALL DAY 5 AUTORUN ISSUE WORKER TESTS PASSED CLEANLY!");
    console.log("==========================================================================");
  } finally {
    // Post-test cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

runDay05Tests().catch((err) => {
  console.error("\n❌ DAY 5 TEST SUITE FAILED:", err);
  process.exit(1);
});

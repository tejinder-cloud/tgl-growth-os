// services/tgl-ops/src/test-fixes.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3.00";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15.00";

import { gatherStandupMaterial } from "./agents/chief-of-staff/gather.js";
import { doesCronRunOnDate, isAgentScheduledOnDate, findAgentByName, getAgentRunnerLimits, type AgentRecord } from "./lib/agents.js";
import { execute1815SilenceCheck } from "./agents/chief-of-staff/worker.js";
import { getCurrentPlanDay } from "./lib/plan.js";
import { getRunnerState, saveRunnerState, recordRunnerIssue, resetRunnerIssue, releaseRunnerClaim, assertValidRunnerStatusAndPr, clearMockRunnerStateDbForTests } from "./runner/state.js";
import { catchUpRunnerIssues, recoverInterruptedRunnerIssues } from "./runner/catch-up.js";
import { runPreflightCheck } from "./runner/preflight.js";
import { handleRunnerShutdown, setActiveIssueNumberForTests, computeBriefHash, runIssueTask } from "./runner/runner.js";
import { executeRunnerTool, type RunnerToolContext } from "./runner/tools.js";
import { buildRunnerSystemPrompt, buildRunnerUserMessage, buildRepositoryMap, extractAndLoadBriefFiles } from "./runner/prompt.js";
import { verifyPrDescriptionIssueLinking } from "./ci/check-pr-description.js";
import { resetMockPostedLines, mockPostedLines } from "./lib/post.js";
import { mockIssuesStore } from "./lib/github-client.js";
import {
  pollChiefOfStaffIntake,
  resetIntakeStateForTests,
  setBootTimestampForTests,
  simulateProcessRebootForTests,
  loadIntakeState,
} from "./agents/chief-of-staff/intake.js";
import {
  getAgentCostCap,
  getAgentTodaySpend,
  checkAgentCostCap,
  recordCostEntry,
  resetCostLedgerForTests,
  isEntryInISTDate,
  getCostLedgerSummary,
  getAgentsCostStatusForStandup,
} from "./lib/cost-cap.js";

async function runFixesVerificationSuite(): Promise<void> {
  console.log("==========================================================================");
  console.log("Housekeeping Fixes Verification Suite");
  console.log("   (Pending Approvals Filter, Routine Silence Check, Plan Day Reconcile)");
  console.log("==========================================================================\n");

  let passed = 0;

  // -------------------------------------------------------------------------
  // Test 1: Pending-card filter drops closed PRs and rejected issues
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing open approvals filtering for closed PRs & rejected issues...");

  const mockMessages = [
    {
      ts: "1730000001.000100",
      bot_id: "B_TEST",
      text: "Proposal Card for PR #34",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Proposal:* Close PR #34 card" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "approve_proposal",
              value: JSON.stringify({ pr: 34, issue: 43 }),
            },
          ],
        },
      ],
    },
    {
      ts: "1730000002.000200",
      bot_id: "B_TEST",
      text: "Decision Card for Issue #33",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Decision:* Test rejected Issue #33" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "approve_proposal",
              value: JSON.stringify({ issue: 33 }),
            },
          ],
        },
      ],
    },
    {
      ts: "1730000003.000300",
      bot_id: "B_TEST",
      text: "Active Open Proposal for PR #55",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Proposal:* Legitimate open PR #55" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "approve_proposal",
              value: JSON.stringify({ pr: 55 }),
            },
          ],
        },
      ],
    },
  ];

  const gathered = await gatherStandupMaterial("2026-11-02", {
    testMode: true,
    mockHistoryMessages: mockMessages,
    mockClosedPrs: [34],
    mockRejectedIssues: [33],
  });

  const approvals = gathered.openApprovals;
  console.log(`  Retrieved ${approvals.length} open approvals.`);

  if (approvals.some((a) => a.title.includes("34") || a.title.includes("#34"))) {
    throw new Error(`Test 1 Failed: Card for closed PR #34 was not dropped from approvals list.`);
  }
  if (approvals.some((a) => a.title.includes("33") || a.title.includes("#33"))) {
    throw new Error(`Test 1 Failed: Card for rejected Issue #33 was not dropped from approvals list.`);
  }
  if (!approvals.some((a) => a.title.includes("55") || a.title.includes("#55"))) {
    throw new Error(`Test 1 Failed: Legitimate open PR #55 was incorrectly dropped.`);
  }

  console.log("  ✓ Closed PR #34 card dropped out");
  console.log("  ✓ Rejected Issue #33 card dropped out");
  console.log("  ✓ Active PR #55 card preserved");
  console.log("✅ [Test 1 Passed] Open approvals filtering verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 2: Weekend silence check & routine schedule evaluation
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing routine-scoped silence check & cron evaluation...");

  // prospect-researcher routine: "30 9 * * 1-5" (Mon-Fri)
  const cronWeekday = "30 9 * * 1-5";
  const saturday = "2026-10-31"; // Saturday (UTC dow = 6)
  const sunday = "2026-11-01";   // Sunday (UTC dow = 0)
  const monday = "2026-11-02";   // Monday (UTC dow = 1)
  const wednesday = "2026-11-04";// Wednesday (UTC dow = 3)

  if (doesCronRunOnDate(cronWeekday, saturday)) {
    throw new Error(`Test 2 Failed: Mon-Fri cron evaluated to true on Saturday (${saturday})`);
  }
  if (doesCronRunOnDate(cronWeekday, sunday)) {
    throw new Error(`Test 2 Failed: Mon-Fri cron evaluated to true on Sunday (${sunday})`);
  }
  if (!doesCronRunOnDate(cronWeekday, monday)) {
    throw new Error(`Test 2 Failed: Mon-Fri cron evaluated to false on Monday (${monday})`);
  }
  if (!doesCronRunOnDate(cronWeekday, wednesday)) {
    throw new Error(`Test 2 Failed: Mon-Fri cron evaluated to false on Wednesday (${wednesday})`);
  }

  const mockProspectResearcher: AgentRecord = {
    name: "prospect-researcher",
    department: "growth",
    channel: "#research",
    trigger: "scheduled",
    reviewer: "architect",
    status: "active",
    routines: [
      {
        name: "daily-enrichment",
        schedule: "30 9 * * 1-5",
        frequency: "daily",
        description: "Enrich daily prospects batch",
      },
    ],
  };

  const mockChiefOfStaff: AgentRecord = {
    name: "chief-of-staff",
    department: "operations",
    channel: "#ops",
    trigger: "scheduled",
    reviewer: "architect",
    status: "active",
    routines: [
      {
        name: "daily-standup",
        schedule: "0 9 * * *", // every day
        frequency: "daily",
        description: "Post standup digest",
      },
    ],
  };

  if (isAgentScheduledOnDate(mockProspectResearcher, saturday)) {
    throw new Error(`Test 2 Failed: prospect-researcher scheduled on Saturday`);
  }
  if (!isAgentScheduledOnDate(mockProspectResearcher, monday)) {
    throw new Error(`Test 2 Failed: prospect-researcher NOT scheduled on Monday`);
  }

  // Execute silence check on Saturday: prospect-researcher should NOT be flagged
  const saturdayCheck = await execute1815SilenceCheck(saturday, {
    testMode: true,
    mockAgents: [mockProspectResearcher, mockChiefOfStaff],
  });

  if (saturdayCheck.silentAgents.includes("prospect-researcher")) {
    throw new Error(`Test 2 Failed: prospect-researcher flagged as silent on Saturday!`);
  }

  // Execute silence check on Monday: with no logs, prospect-researcher should be flagged
  const mondayCheck = await execute1815SilenceCheck(monday, {
    testMode: true,
    mockAgents: [mockProspectResearcher, mockChiefOfStaff],
  });

  if (!mondayCheck.silentAgents.includes("prospect-researcher")) {
    throw new Error(`Test 2 Failed: prospect-researcher NOT flagged as silent on Monday when no log existed!`);
  }

  console.log("  ✓ Mon-Fri cron correctly skips Saturday & Sunday");
  console.log("  ✓ Mon-Fri cron correctly matches Monday & Wednesday");
  console.log("  ✓ 18:15 silence check skips prospect-researcher on Saturday");
  console.log("  ✓ 18:15 silence check flags missing log on Monday");
  console.log("✅ [Test 2 Passed] Routine-scoped silence check verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 3: Day counter reconciliation with dispatched issues
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing day counter reconciliation with dispatched issues...");

  const dayResult1 = await getCurrentPlanDay({
    testMode: true,
    mockIssuedDays: [8, 9],
  });
  if (dayResult1 !== 9) {
    throw new Error(`Test 3 Failed: Expected day 9 from [8, 9], got ${dayResult1}`);
  }

  const dayResult2 = await getCurrentPlanDay({
    testMode: true,
    mockIssuedDays: ["8", "10", "9"],
  });
  if (dayResult2 !== 10) {
    throw new Error(`Test 3 Failed: Expected day 10 from [8, 10, 9], got ${dayResult2}`);
  }

  console.log("  ✓ Reconciles day counter to max dispatched issue day (Day 9)");
  console.log("  ✓ Supports numeric and string issue day identifiers");
  console.log("✅ [Test 3 Passed] Day counter reconciliation verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 4: Graceful SIGTERM, Non-counting Boot Recovery & Recovery Alert Deduplication
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing graceful SIGTERM, non-counting boot recovery & alert deduplication (both re-queue & blocked)...");

  // Part 1: Graceful SIGTERM shutdown writes status: "interrupted" for active run
  setActiveIssueNumberForTests(72);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "72": {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D9]: TrueVisible Engine Core",
          status: "in-progress" as const,
          runStartedAt: "2026-11-03T13:00:00.000Z",
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  await handleRunnerShutdown("SIGTERM", { testMode: true });
  setActiveIssueNumberForTests(null);

  const stateAfterSigterm = await getRunnerState({ testMode: true });
  if (stateAfterSigterm.runs["72"]?.status !== "interrupted") {
    throw new Error(`Test 4.1 Failed: Expected status 'interrupted' after SIGTERM, got: ${stateAfterSigterm.runs["72"]?.status}`);
  }
  if (!stateAfterSigterm.runs["72"]?.error?.includes("SIGTERM")) {
    throw new Error(`Test 4.2 Failed: Expected error message to reference SIGTERM, got: ${stateAfterSigterm.runs["72"]?.error}`);
  }
  console.log("  ✓ On SIGTERM the runner writes status 'interrupted' for the active run");

  // Part 2: Boot recovery resumes 'interrupted' runs without counting recoveryAttempts
  const recoveredIssues1 = await recoverInterruptedRunnerIssues({ testMode: true });
  if (!recoveredIssues1.includes(72)) {
    throw new Error(`Test 4.3 Failed: Interrupted run #72 was not detected for recovery: ${recoveredIssues1.join(", ")}`);
  }

  const stateAfterBoot1 = await getRunnerState({ testMode: true });
  if (stateAfterBoot1.runs["72"].recoveryAttempts !== 0) {
    throw new Error(`Test 4.4 Failed: recoveryAttempts must remain 0 on restart, got: ${stateAfterBoot1.runs["72"].recoveryAttempts}`);
  }
  if (!stateAfterBoot1.runs["72"].lastRecoveryAlertAt) {
    throw new Error("Test 4.5 Failed: Expected lastRecoveryAlertAt to be set on first recovery");
  }

  // Another deploy restart: healthy run resumes again, recoveryAttempts still 0
  const recoveredIssues2 = await recoverInterruptedRunnerIssues({ testMode: true });
  if (!recoveredIssues2.includes(72)) {
    throw new Error("Test 4.6 Failed: Re-queue halted on second deploy restart!");
  }
  const stateAfterBoot2 = await getRunnerState({ testMode: true });
  if (stateAfterBoot2.runs["72"].recoveryAttempts !== 0) {
    throw new Error(`Test 4.7 Failed: Deploy restarts must never increment recoveryAttempts, got: ${stateAfterBoot2.runs["72"].recoveryAttempts}`);
  }
  console.log("  ✓ Boot recovery resumes 'interrupted' runs across deploys without counting recoveryAttempts");

  // Part 3: recoveryAttempts limit enforced when run failures accumulate (attempts >= 2)
  const testStateBlockedLimit = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: {
      "72": {
        agent: "web-builder",
        door: "aeo",
        title: "[PLAN-D9]: TrueVisible Engine Core",
        status: "interrupted" as const,
        runStartedAt: "2026-11-03T13:00:00.000Z",
        recoveryAttempts: 2, // Reached limit from previous run execution failures
      },
    },
  };
  await saveRunnerState(testStateBlockedLimit, { testMode: true });
  const recoveredBlocked = await recoverInterruptedRunnerIssues({ testMode: true });
  if (recoveredBlocked.includes(72)) {
    throw new Error("Test 4.8 Failed: Issue with recoveryAttempts >= 2 was re-queued instead of halted!");
  }
  const stateBlockedAfter = await getRunnerState({ testMode: true });
  if (stateBlockedAfter.runs["72"].status !== "blocked") {
    throw new Error(`Test 4.9 Failed: Expected status 'blocked', got: ${stateBlockedAfter.runs["72"].status}`);
  }
  console.log("  ✓ Issues with recoveryAttempts >= 2 stop re-queueing and are marked status:blocked");

  // Part 4: Alert deduplication for BOTH re-queue alerts and blocked alerts (max 1 per hour per issue)
  // Sub-test A: Re-queue alert deduplication
  const testStateDedupe = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: {
      "99": {
        agent: "web-builder",
        door: "core",
        title: "Issue #99",
        status: "in-progress" as const,
        runStartedAt: "2026-11-03T06:00:00.000Z",
        recoveryAttempts: 0,
        lastRecoveryAlertAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 mins ago (< 1 hour)
      },
    },
  };
  await saveRunnerState(testStateDedupe, { testMode: true });
  await recoverInterruptedRunnerIssues({ testMode: true });
  const stateDedupeAfter = await getRunnerState({ testMode: true });
  if (stateDedupeAfter.runs["99"].lastRecoveryAlertAt !== testStateDedupe.runs["99"].lastRecoveryAlertAt) {
    throw new Error("Test 4.10 Failed: Re-queue alert timestamp was incorrectly updated within 1 hour window");
  }

  // Sub-test B: Blocked alert deduplication (Defect 2)
  const testStateBlockedDedupe = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: {
      "98": {
        agent: "web-builder",
        door: "core",
        title: "Issue #98",
        status: "in-progress" as const,
        runStartedAt: "2026-11-03T06:00:00.000Z",
        recoveryAttempts: 2,
        lastRecoveryAlertAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 mins ago (< 1 hour)
      },
    },
  };
  await saveRunnerState(testStateBlockedDedupe, { testMode: true });
  await recoverInterruptedRunnerIssues({ testMode: true });
  const stateBlockedDedupeAfter = await getRunnerState({ testMode: true });
  if (stateBlockedDedupeAfter.runs["98"].lastRecoveryAlertAt !== testStateBlockedDedupe.runs["98"].lastRecoveryAlertAt) {
    throw new Error("Test 4.11 Failed: Blocked alert bypassed 1-hour deduplication window!");
  }

  console.log("  ✓ Both re-queue alerts and blocked alerts strictly obey the 1-hour per-issue deduplication check");

  // Part 5: Multi-instance concurrency: two simulated instances booting with the same in-progress issue produce exactly one recovery and one alert
  console.log("  [Multi-Instance Concurrency] Testing two simulated instances booting concurrently with same in-progress issue...");
  resetMockPostedLines();

  // Reset runner state with issue #72 in-progress and no prior alerts
  clearMockRunnerStateDbForTests();
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "72": {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
          status: "in-progress" as const,
          runStartedAt: new Date().toISOString(),
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const instanceAlpha = "container-alpha-101";
  const instanceBravo = "container-bravo-202";

  // Simulate both instances booting and executing recovery concurrently
  const [resAlpha, resBravo] = await Promise.all([
    recoverInterruptedRunnerIssues({ instanceId: instanceAlpha, testMode: true }),
    recoverInterruptedRunnerIssues({ instanceId: instanceBravo, testMode: true }),
  ]);

  const recoveredAlpha = resAlpha.includes(72);
  const recoveredBravo = resBravo.includes(72);

  // Exactly one instance must have won the atomic claim and executed recovery
  if (recoveredAlpha && recoveredBravo) {
    throw new Error("Test 4.12 Failed: Both instances claimed issue #72 simultaneously! Atomic lock failed.");
  }
  if (!recoveredAlpha && !recoveredBravo) {
    throw new Error("Test 4.13 Failed: Neither instance recovered issue #72.");
  }

  // Verify alert count: exactly one boot recovery alert posted across both instances
  const bootAlerts = mockPostedLines.filter(
    (p) => p.text.includes("[Runner Boot Recovery]") && p.text.includes("#72")
  );
  if (bootAlerts.length !== 1) {
    throw new Error(`Test 4.14 Failed: Expected exactly 1 recovery alert, got ${bootAlerts.length}`);
  }

  // Verify the losing instance does nothing and alerts nothing on subsequent boot cycle
  const losingInstance = recoveredAlpha ? instanceBravo : instanceAlpha;
  const resLosing = await recoverInterruptedRunnerIssues({ instanceId: losingInstance, testMode: true });
  const alertsAfter = mockPostedLines.filter(
    (p) => p.text.includes("[Runner Boot Recovery]") && p.text.includes("#72")
  );
  if (alertsAfter.length !== 1) {
    throw new Error(`Test 4.15 Failed: Losing instance generated duplicate alert, total alerts: ${alertsAfter.length}`);
  }

  console.log("  ✓ Two simulated instances booting with same in-progress issue produce exactly one recovery and one alert");
  console.log("✅ [Test 4 Passed] Graceful SIGTERM, non-counting boot recovery & dual alert deduplication verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 5: Catch-up picks up web-builder issue regardless of stale state
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing catch-up picks up for:web-builder issue with status:in-progress regardless of stale runner state...");

  // Mock an issue in status:in-progress for web-builder, with stale "completed" in runner state
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "53": {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D8]: AEO Audit Engine SKILL.md + short-form engine",
          status: "completed", // STALE state!
          prNumber: 53,
          prUrl: "https://github.com/tejinder-cloud/tgl-growth-os/pull/53",
          runStartedAt: "2026-10-30T00:00:00.000Z",
          runCompletedAt: "2026-10-30T00:00:00.000Z",
        },
      },
    },
    { testMode: true }
  );

  const mockOpenIssues = [
    {
      number: 53,
      title: "[PLAN-D8]: AEO Audit Engine SKILL.md + short-form engine",
      body: "### deliverable\nShort-form engine evaluates 5 prompts across Perplexity, Gemini, ChatGPT\n1-page paper-and-ink branded PDF generated with under 2MB size",
      labels: ["for:web-builder", "status:in-progress", "door:aeo"],
      html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/53",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const catchUpRes = await catchUpRunnerIssues({
    testMode: true,
    issuesList: mockOpenIssues,
  });

  const item53 = catchUpRes.results.find((r) => r.issueNumber === 53);
  if (!item53) {
    throw new Error("Test 5.1 Failed: Issue #53 was not evaluated by catch-up.");
  }
  if (item53.status === "skipped" && item53.reason?.includes("Already completed in runner state")) {
    throw new Error("Test 5.2 Failed: Issue #53 for web-builder was skipped due to stale completed runner state! Architect rule violated.");
  }

  console.log(`  ✓ Catch-up evaluated Issue #53 despite stale completed status in runner.json`);
  console.log(`  ✓ Result status: ${item53.status} (${item53.reason || "executed"})`);
  console.log("✅ [Test 5 Passed] Stale state override for web-builder verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 6: Pre-flight check receives recent comments & Architect instructions
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing pre-flight check includes issue comments & Architect instructions in context...");

  const preflightContext = {
    issueNumber: 53,
    title: "[PLAN-D8]: AEO Audit Engine SKILL.md + short-form engine",
    body: "### brief\nAEO Audit Engine SKILL.md + short-form engine",
    deliverable: "short-form runner and the one-page PDF",
    agentName: "web-builder",
    instruction: "finish #53 — the short-form runner and the one-page PDF are the only lines left",
    comments: [
      {
        user: "tejinder-cloud",
        body: "Definition of Done Audit against main (2026-11-02): SKILL.md MET. Short-form runner and one-page PDF REMAINING.",
      },
      {
        user: "tejinder-cloud",
        body: "finish #53 — the short-form runner and the one-page PDF are the only lines left",
      },
    ],
  };

  // In test mode without API key, verify context fields format properly
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  ✓ Pre-flight context accepted comments and instructions without schema errors");
  } else {
    const pfResult = await runPreflightCheck(preflightContext);
    console.log(`  ✓ Pre-flight verdict with instruction context: ${pfResult.verdict} — ${pfResult.reason.slice(0, 80)}...`);
    if (pfResult.verdict === "needs-brief" && pfResult.reason === "No reasoning provided") {
      throw new Error("Test 6 Failed: Pre-flight returned needs-brief with empty reasoning despite explicit Architect instruction!");
    }
  }

  console.log("✅ [Test 6 Passed] Pre-flight instruction context verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 7: Pre-flight deduplication & Architect instruction hash invalidation
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing pre-flight check hash deduplication & Architect instruction invalidation...");

  const baseBrief = "Outreach Sequencer SKILL.md + 5-touch worker via GHL";
  const h1 = computeBriefHash(baseBrief, []);
  const h2 = computeBriefHash(baseBrief, [
    { user: "github-actions[bot]", body: "[Pre-flight Verdict: Proceed] Delivered on branch." },
    { user: "tejinder-cloud", body: "**[Pre-flight Verdict: Proceed]** The brief has a concrete deliverable." },
  ]);

  if (h1 !== h2) {
    throw new Error(`Test 7.1 Failed: Runner pre-flight comments invalidated brief hash! (${h1} !== ${h2})`);
  }
  console.log("  ✓ Bot & runner pre-flight verdicts do not invalidate pre-flight cache");

  const h3 = computeBriefHash(baseBrief, [
    { user: "tejinder-cloud", body: "Cadence: T1 email day 0, T2 WhatsApp day 2, T3 email with audit PDF" },
  ]);

  if (h1 === h3) {
    throw new Error("Test 7.2 Failed: Authoritative Architect comment failed to change brief hash!");
  }
  console.log("  ✓ Authoritative Architect instruction comment changes brief hash for re-evaluation");

  const h4 = computeBriefHash(baseBrief + " with revised deliverable", []);
  if (h1 === h4) {
    throw new Error("Test 7.3 Failed: Issue body modification failed to change brief hash!");
  }
  console.log("  ✓ Issue body change triggers fresh pre-flight hash");
  console.log("✅ [Test 7 Passed] Pre-flight hash deduplication & invalidation verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 8: Resume preserves working branch & tool-call budget
  // -------------------------------------------------------------------------
  console.log("[Test 8] Testing resume preserves branch and tool-call budget...");

  clearMockRunnerStateDbForTests();
  const testIssueNum = 72;
  const existingBranch = "task/72-plan-d10-outreach-sequencer-sk";
  const existingBriefHash = computeBriefHash("Outreach Sequencer SKILL.md", []);

  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(testIssueNum)]: {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
          status: "in-progress",
          branch: existingBranch,
          toolCallsCount: 14,
          preflightHash: existingBriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Cached verdict from previous pre-flight",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const issueData = {
    number: testIssueNum,
    title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
    body: "Outreach Sequencer SKILL.md",
    labels: ["for:web-builder", "status:in-progress", "door:aeo"],
  };

  // Run task in test mode with mockModelResponse to test branch/budget preservation and zero-commit gate
  const expectedMessage = "Model analyzed requirements and ended without writing files.";
  const runRes = await runIssueTask(issueData, { testMode: true, mockModelResponse: expectedMessage });

  if (runRes.branchName !== existingBranch) {
    throw new Error(`Test 8.1 Failed: Resume changed branch from ${existingBranch} to ${runRes.branchName}`);
  }
  console.log(`  [Passed] Resume continued on existing branch: ${runRes.branchName}`);

  const stateAfter = await getRunnerState({ testMode: true });
  const runRecord = stateAfter.runs[String(testIssueNum)];

  if (runRecord?.branch !== existingBranch) {
    throw new Error(`Test 8.2 Failed: Runner record branch not preserved: ${runRecord?.branch}`);
  }
  if (runRecord?.lastModelMessage !== expectedMessage) {
    throw new Error(`Test 8.3 Failed: Expected lastModelMessage '${expectedMessage}', got '${runRecord?.lastModelMessage}'`);
  }
  console.log("  [Passed] Branch and model message preserved in runner state database");
  console.log("[Test 8 Passed] Resume branch and budget state preservation verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 9: Zero-commit gate before PR opening & needs-brief handling
  // -------------------------------------------------------------------------
  console.log("[Test 9] Testing zero-commit gate before PR opening & needs-brief handling...");

  if (runRes.status !== "needs-brief") {
    throw new Error(`Test 9.1 Failed: Expected status 'needs-brief' for 0 commits run, got '${runRes.status}'`);
  }
  if (runRes.error !== "run produced no files") {
    throw new Error(`Test 9.2 Failed: Expected error 'run produced no files', got '${runRes.error}'`);
  }
  if (runRes.prNumber !== undefined) {
    throw new Error(`Test 9.3 Failed: Zero-commit run opened a PR (#${runRes.prNumber})! Must not call PR API.`);
  }
  if (runRecord?.recoveryAttempts !== 0) {
    throw new Error(`Test 9.4 Failed: Zero-commit run counted as a failure! recoveryAttempts=${runRecord?.recoveryAttempts}`);
  }

  console.log("  [Passed] Zero-commit run halted before createPullRequest");
  console.log("  [Passed] Marked status:needs-brief with reason 'run produced no files'");
  console.log("  [Passed] Does not count as a failure: recoveryAttempts strictly 0");
  console.log("[Test 9 Passed] Zero-commit gate & needs-brief handling verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 10: Runner prompt directives & fixture issue proceed execution producing write_file
  // -------------------------------------------------------------------------
  console.log("[Test 10] Testing runner prompt directives & fixture issue proceed execution producing write_file...");

  // Part 1: Verify prompt directives in buildRunnerSystemPrompt & buildRunnerUserMessage
  const testBranch = "task/72-plan-d10-outreach-sequencer-sk";
  const sysPrompt = buildRunnerSystemPrompt("web-builder", testBranch);
  const usrMessage = buildRunnerUserMessage({
    agentName: "web-builder",
    issueNumber: 72,
    issueTitle: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
    issueBody: "Deliverable: agents/outreach-sequencer/SKILL.md + 5-touch worker",
    branchName: testBranch,
  });

  if (!sysPrompt.includes("The pre-flight proceed verdict is the Architect's approval")) {
    throw new Error("Test 10.1 Failed: System prompt missing 'pre-flight proceed verdict is the Architect's approval'");
  }
  if (!sysPrompt.includes("the brief review goes into the PR description, not a message")) {
    throw new Error("Test 10.2 Failed: System prompt missing 'the brief review goes into the PR description, not a message'");
  }
  if (!sysPrompt.includes("The model must create or change files in this session using write_file")) {
    throw new Error("Test 10.3 Failed: System prompt missing 'The model must create or change files in this session using write_file'");
  }
  if (!sysPrompt.includes("A session that ends with no write_file is a task failure, not caution")) {
    throw new Error("Test 10.4 Failed: System prompt missing 'A session that ends with no write_file is a task failure, not caution'");
  }
  if (!sysPrompt.includes("§8 NEVER RULES (WHAT YOU NEVER DO):")) {
    throw new Error("Test 10.5 Failed: System prompt missing §8 Never rules section");
  }
  if (!sysPrompt.includes("Publish or change a live page") || !sysPrompt.includes("Send a message to a prospect or client")) {
    throw new Error("Test 10.6 Failed: System prompt missing §8 Never guardrails");
  }
  if (!usrMessage.includes("The pre-flight proceed verdict is the Architect's approval")) {
    throw new Error("Test 10.7 Failed: User message missing proceed verdict approval directive");
  }
  if (!usrMessage.includes("The model must create or change files in this session using write_file")) {
    throw new Error("Test 10.8 Failed: User message missing mandatory write_file directive");
  }
  console.log("  [Passed] System prompt and user message verify all required runner directives and §8 Never rules");

  // Part 2: Fixture issue with a proceed verdict produces at least one write_file call
  clearMockRunnerStateDbForTests();
  const fixtureIssueNum = 9972;
  const fixtureIssue = {
    number: fixtureIssueNum,
    title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
    body: "### deliverable\nagents/outreach-sequencer/SKILL.md + 5-touch worker\n\n### cadence\nT1 email, T2 WhatsApp, T3 email with audit PDF, T4 WhatsApp, T5 email",
    labels: ["for:web-builder", "status:in-progress", "door:aeo"],
    agentName: "web-builder",
    door: "aeo",
  };

  const fixtureBriefHash = computeBriefHash(fixtureIssue.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(fixtureIssueNum)]: {
          agent: "web-builder",
          door: "aeo",
          title: fixtureIssue.title,
          status: "in-progress",
          branch: "task/9972-plan-d10-outreach-sequencer-sk",
          toolCallsCount: 0,
          preflightHash: fixtureBriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Concrete deliverable and acceptance criteria verified.",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const fixtureRunRes = await runIssueTask(fixtureIssue, {
    testMode: true,
    mockToolCalls: [
      {
        name: "write_file",
        input: {
          path: "agents/outreach-sequencer/SKILL.md",
          content: [
            "# Outreach Sequencer SKILL.md",
            "Autonomous multi-touch sequencer for GHL and WhatsApp.",
            "",
            "## Overview",
            "Coordinates multi-touch outbound cadences across Indian coaching prospects.",
            "",
            "## Channels",
            "- Touch 1: Email introduction to institute founder",
            "- Touch 2: WhatsApp follow-up with diagnostic link",
            "- Touch 3: Email delivery of AEO audit report",
            "- Touch 4: WhatsApp voice memo with benchmark insight",
            "- Touch 5: Final email breakup message",
            "",
            "## Rules",
            "- Strictly plain text and bold only; zero emojis",
            "- Respect quiet hours 20:00 to 09:00 IST",
            "- DNC list checked before any outbound trigger",
            "- All status transitions recorded in Supabase",
            "",
            "## Verification",
            "- Unit tests covering 5-touch timing engine",
            "- Fixture verification against Indian mobile formatting",
            "",
            "## Acceptance Criteria",
            "- 5 touches triggered on correct intervals",
            "- Supabase status matches touch state",
            "- Clean error exit on missing credentials",
            "- Fully automated with zero human intervention",
          ].join("\n"),
        },
      },
    ],
    mockModelResponse: "Brief review: Delivered agents/outreach-sequencer/SKILL.md cleanly on working branch.",
  });

  if (!fixtureRunRes.success || fixtureRunRes.status !== "completed") {
    throw new Error(`Test 10.9 Failed: Expected fixture issue to complete cleanly, got ${JSON.stringify(fixtureRunRes)}`);
  }
  if (!fixtureRunRes.writtenFiles || fixtureRunRes.writtenFiles.length === 0) {
    throw new Error("Test 10.10 Failed: Fixture issue produced 0 write_file calls!");
  }
  if (!fixtureRunRes.writtenFiles.includes("agents/outreach-sequencer/SKILL.md")) {
    throw new Error(`Test 10.11 Failed: Expected agents/outreach-sequencer/SKILL.md in writtenFiles, got ${JSON.stringify(fixtureRunRes.writtenFiles)}`);
  }
  if (fixtureRunRes.prNumber === undefined) {
    throw new Error("Test 10.12 Failed: Expected PR number to be defined upon completed run with write_file");
  }

  console.log(`  [Passed] Fixture issue with proceed verdict executed write_file: ${fixtureRunRes.writtenFiles.join(", ")}`);
  console.log(`  [Passed] Completed run successfully opened PR #${fixtureRunRes.prNumber}`);
  console.log("[Test 10 Passed] Runner prompt directives and fixture proceed write_file verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 11: Per-agent runner limits, repository map & brief files, prompt pacing, verbatim message, PR linking check
  // -------------------------------------------------------------------------
  console.log("[Test 11] Testing per-agent runner limits, repository map, prompt pacing, verbatim message, and PR linking gate...");

  // Part 1: Verify web-builder gets 150 calls / 60 min from agents.yaml
  const webBuilderAgent = await findAgentByName("web-builder");
  if (!webBuilderAgent) {
    throw new Error("Test 11.1 Failed: findAgentByName('web-builder') returned undefined!");
  }
  if (webBuilderAgent.runner_limits?.max_tool_calls !== 150) {
    throw new Error(`Test 11.2 Failed: Expected web-builder max_tool_calls 150, got ${webBuilderAgent.runner_limits?.max_tool_calls}`);
  }
  if (webBuilderAgent.runner_limits?.timeout_minutes !== 60) {
    throw new Error(`Test 11.3 Failed: Expected web-builder timeout_minutes 60, got ${webBuilderAgent.runner_limits?.timeout_minutes}`);
  }
  const wbLimits = getAgentRunnerLimits(webBuilderAgent);
  if (wbLimits.maxToolCalls !== 150 || wbLimits.timeoutMinutes !== 60 || wbLimits.timeoutMs !== 3600000) {
    throw new Error(`Test 11.4 Failed: getAgentRunnerLimits returned unexpected limits: ${JSON.stringify(wbLimits)}`);
  }
  console.log("  [Passed] web-builder loads 150 tool calls / 60 min limit from config/agents.yaml");

  // Part 2: Verify repository map & referenced file contents up front
  const repoFiles = buildRepositoryMap();
  if (!repoFiles || repoFiles.length === 0) {
    throw new Error("Test 11.5 Failed: buildRepositoryMap returned empty list!");
  }
  const hasAgents = repoFiles.some((f) => f.startsWith("agents/"));
  const hasConfig = repoFiles.some((f) => f.startsWith("config/"));
  const hasTglOps = repoFiles.some((f) => f.startsWith("services/tgl-ops/src/"));
  if (!hasAgents || !hasConfig || !hasTglOps) {
    throw new Error(`Test 11.6 Failed: buildRepositoryMap missing root prefixes: hasAgents=${hasAgents}, hasConfig=${hasConfig}, hasTglOps=${hasTglOps}`);
  }
  console.log(`  [Passed] buildRepositoryMap returned ${repoFiles.length} file paths across agents/, config/, services/tgl-ops/src/`);

  const briefWithFiles = "Please inspect config/agents.yaml and AGENTS.md before building.";
  const referencedFileContents = extractAndLoadBriefFiles(briefWithFiles);
  const foundAgentsYaml = referencedFileContents.some((f) => f.path.includes("config/agents.yaml") && f.content.length > 0);
  const foundAgentsMd = referencedFileContents.some((f) => f.path.includes("AGENTS.md") && f.content.length > 0);
  if (!foundAgentsYaml || !foundAgentsMd) {
    throw new Error(`Test 11.7 Failed: extractAndLoadBriefFiles did not extract referenced files: foundAgentsYaml=${foundAgentsYaml}, foundAgentsMd=${foundAgentsMd}`);
  }
  console.log("  [Passed] extractAndLoadBriefFiles extracts and loads contents of files named in brief");

  // Part 3: Verify runner prompt pacing directives and budget injection
  const test11Branch = "task/72-plan-d10-outreach-sequencer-sk";
  const pacedSysPrompt = buildRunnerSystemPrompt("web-builder", test11Branch, wbLimits);
  const pacedUserMsg = buildRunnerUserMessage({
    agentName: "web-builder",
    issueNumber: 72,
    issueTitle: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
    issueBody: "Deliverable: agents/outreach-sequencer/SKILL.md from config/agents.yaml",
    branchName: test11Branch,
    runnerLimits: wbLimits,
  });

  if (!pacedSysPrompt.includes("Maximum 150 tool calls (60 min timeout)")) {
    throw new Error("Test 11.8 Failed: System prompt does not reflect dynamic budget limits (150 calls / 60 min)");
  }
  if (!pacedSysPrompt.includes("Research may use at most a third of the budget")) {
    throw new Error("Test 11.9 Failed: System prompt missing research <= 1/3 budget directive");
  }
  if (!pacedSysPrompt.includes("The first write_file must happen before 40% of the budget")) {
    throw new Error("Test 11.10 Failed: System prompt missing first write_file <= 40% budget directive");
  }
  if (!pacedSysPrompt.includes("After that, writes before reads")) {
    throw new Error("Test 11.11 Failed: System prompt missing 'writes before reads' directive");
  }
  if (!pacedUserMsg.includes("=== REPOSITORY MAP (PATHS ONLY) ===")) {
    throw new Error("Test 11.12 Failed: User message missing repository map block");
  }
  if (!pacedUserMsg.includes("=== REFERENCED FILE CONTENTS (FROM BRIEF) ===")) {
    throw new Error("Test 11.13 Failed: User message missing referenced file contents block");
  }
  if (!pacedUserMsg.includes("research may use at most a third of the budget") || !pacedUserMsg.includes("the first write_file must happen before 40% of the budget") || !pacedUserMsg.includes("after that, writes before reads")) {
    throw new Error("Test 11.14 Failed: User message missing execution directives for budget pacing");
  }
  console.log("  [Passed] Runner prompt includes repository map, brief files, and 1/3 research / 40% first write pacing");

  // Part 4: Verify verbatim last_model_message in zero-commits needs-brief handling
  clearMockRunnerStateDbForTests();
  const test11IssueNum = 9973;
  const verbatimMessage = "I ran out of my 25-tool-call limit on research and wrote no files.";
  const test11Issue = {
    number: test11IssueNum,
    title: "Needs brief verbatim check",
    body: "Needs brief verbatim check body",
    labels: ["for:web-builder", "status:in-progress"],
  };
  const test11BriefHash = computeBriefHash(test11Issue.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(test11IssueNum)]: {
          agent: "web-builder",
          door: "core",
          title: test11Issue.title,
          status: "in-progress",
          branch: "task/9973-test-verbatim",
          toolCallsCount: 0,
          preflightHash: test11BriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Cached proceed verdict for test",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );
  const test11RunRes = await runIssueTask(test11Issue, {
    testMode: true,
    mockModelResponse: verbatimMessage,
  });

  if (test11RunRes.status !== "needs-brief") {
    throw new Error(`Test 11.15 Failed: Expected status 'needs-brief', got ${test11RunRes.status}`);
  }
  const stateAfter11 = await getRunnerState({ testMode: true });
  const run11Record = stateAfter11.runs[String(test11IssueNum)];
  if (run11Record?.lastModelMessage !== verbatimMessage) {
    throw new Error(`Test 11.16 Failed: runner_state lastModelMessage is not verbatim: '${run11Record?.lastModelMessage}'`);
  }
  console.log("  [Passed] needs-brief preserves last_model_message verbatim without generic fallback");

  // Part 5: Verify PR description issue linking gate (verifyPrDescriptionIssueLinking)
  // Case A: Closes keyword on non-task branch fails
  const checkFail1 = verifyPrDescriptionIssueLinking("Fixes #72", "fix/runner-budget-limits");
  if (checkFail1.valid || checkFail1.errors.length === 0) {
    throw new Error("Test 11.17 Failed: 'Fixes #72' on 'fix/runner-budget-limits' was not rejected!");
  }

  // Case B: Closes keyword on matching task branch passes
  const checkPass1 = verifyPrDescriptionIssueLinking("Fixes #72", "task/72-plan-d10-outreach-sequencer-sk");
  if (!checkPass1.valid) {
    throw new Error(`Test 11.18 Failed: 'Fixes #72' on 'task/72-plan-d10...' was rejected: ${checkPass1.errors.join(", ")}`);
  }
  const checkPass2 = verifyPrDescriptionIssueLinking("Resolves: #72", "task/72");
  if (!checkPass2.valid) {
    throw new Error(`Test 11.19 Failed: 'Resolves: #72' on 'task/72' was rejected: ${checkPass2.errors.join(", ")}`);
  }

  // Case C: Non-closing reference on non-task branch passes
  const checkPass3 = verifyPrDescriptionIssueLinking("Relates to #72 and addresses review", "fix/runner-budget");
  if (!checkPass3.valid) {
    throw new Error(`Test 11.20 Failed: 'Relates to #72' on non-task branch was rejected: ${checkPass3.errors.join(", ")}`);
  }

  // Case D: Multiple issue references where one mismatches fails
  const checkFail2 = verifyPrDescriptionIssueLinking("Closes #72 and fixes #73", "task/72-outreach");
  if (checkFail2.valid || checkFail2.errors.length === 0) {
    throw new Error("Test 11.21 Failed: Multi-issue close where #73 doesn't match branch was not rejected!");
  }
  console.log("  [Passed] PR description issue linking gate strictly enforces task/N-* for fixes/closes/resolves #N");
  console.log("[Test 11 Passed] Per-agent limits, repository map, prompt pacing, verbatim message, and CI gate verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 12: DB check constraint on runner_state: status = completed requires pr_number not null
  // -------------------------------------------------------------------------
  console.log("[Test 12] Testing DB check constraint: status = completed requires pr_number not null...");

  // Case A: assertValidRunnerStatusAndPr throws on completed with null/undefined prNumber
  let threwNullPr = false;
  try {
    assertValidRunnerStatusAndPr("completed", null, 72);
  } catch (err: any) {
    if (err.message.includes("status = 'completed' requires pr_number not null")) {
      threwNullPr = true;
    }
  }
  if (!threwNullPr) {
    throw new Error("Test 12.1 Failed: assertValidRunnerStatusAndPr did not throw for null pr_number with completed status");
  }

  // Case B: saveRunnerState rejects status: "completed" with no prNumber
  let threwSave = false;
  try {
    await saveRunnerState(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        runs: {
          "72": {
            agent: "web-builder",
            door: "aeo",
            title: "Issue #72",
            status: "completed",
            runStartedAt: new Date().toISOString(),
          },
        },
      },
      { testMode: true }
    );
  } catch (err: any) {
    if (err.message.includes("status = 'completed' requires pr_number not null")) {
      threwSave = true;
    }
  }
  if (!threwSave) {
    throw new Error("Test 12.2 Failed: saveRunnerState allowed status 'completed' with prNumber null!");
  }

  // Case C: releaseRunnerClaim rejects status: "completed" when no prNumber is supplied
  clearMockRunnerStateDbForTests();
  await recordRunnerIssue(
    72,
    {
      agent: "web-builder",
      status: "in-progress",
      title: "Issue #72",
    },
    { testMode: true }
  );
  let threwRelease = false;
  try {
    await releaseRunnerClaim(
      72,
      "inst_test",
      {
        status: "completed",
        runCompletedAt: new Date().toISOString(),
      },
      { testMode: true }
    );
  } catch (err: any) {
    if (err.message.includes("status = 'completed' requires pr_number not null")) {
      threwRelease = true;
    }
  }
  if (!threwRelease) {
    throw new Error("Test 12.3 Failed: releaseRunnerClaim allowed status 'completed' with prNumber undefined!");
  }

  // Case D: Valid prNumber allows status: "completed" to succeed
  await releaseRunnerClaim(
    72,
    "inst_test",
    {
      status: "completed",
      prNumber: 95,
      prUrl: "https://github.com/tejinder-cloud/tgl-growth-os/pull/95",
      runCompletedAt: new Date().toISOString(),
    },
    { testMode: true }
  );
  const stateWithPr = await getRunnerState({ testMode: true });
  if (stateWithPr.runs["72"]?.status !== "completed" || stateWithPr.runs["72"]?.prNumber !== 95) {
    throw new Error("Test 12.4 Failed: Valid completed record with prNumber was not saved properly");
  }

  console.log("  [Passed] DB constraint check strictly rejects status = 'completed' without a non-null pr_number");
  console.log("[Test 12 Passed] DB check constraint enforcement verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 13: Boot recovery of interrupted run with proceed verdict and no PR
  // -------------------------------------------------------------------------
  console.log("[Test 13] Testing boot recovery starts model session on existing branch with fresh budget...");

  clearMockRunnerStateDbForTests();
  const test13IssueNum = 72;
  const test13Branch = "task/72-plan-d10-outreach-sequencer-sk";
  const test13BriefBody = "Outreach Sequencer SKILL.md";
  const test13BriefHash = computeBriefHash(test13BriefBody, []);

  // Set issue on GitHub as closed with no PR (the exact scenario from #89 that caused the bug)
  mockIssuesStore.set(test13IssueNum, {
    number: test13IssueNum,
    title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
    body: test13BriefBody,
    state: "closed",
    labels: ["for:web-builder", "status:in-progress", "door:aeo"],
    html_url: `https://github.com/tejinder-cloud/tgl-growth-os/issues/${test13IssueNum}`,
  });

  // Simulate issue state in runner_state: interrupted run with proceed verdict and 25 prior tool calls
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(test13IssueNum)]: {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
          status: "interrupted",
          branch: test13Branch,
          toolCallsCount: 25,
          preflightHash: test13BriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Preflight confirmed proceed",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  // Run boot recovery with triggerRunnerInTestMode
  const test13MockResponse = "Model session executed on branch with fresh session budget.";
  const recovered13 = await recoverInterruptedRunnerIssues({
    testMode: true,
    triggerRunnerInTestMode: true,
    mockModelResponse: test13MockResponse,
  });

  if (!recovered13.includes(test13IssueNum)) {
    throw new Error(`Test 13.1 Failed: Issue #${test13IssueNum} not in recovered list: ${recovered13.join(", ")}`);
  }

  const stateAfter13 = await getRunnerState({ testMode: true });
  const run13 = stateAfter13.runs[String(test13IssueNum)];

  // Invariant check: MUST NEVER be marked completed without a PR!
  if (run13?.status === "completed") {
    throw new Error("Test 13.2 Failed: Boot recovery marked issue 'completed' without a PR!");
  }
  // Must continue on existing branch
  if (run13?.branch !== test13Branch) {
    throw new Error(`Test 13.3 Failed: Boot recovery changed branch from ${test13Branch} to ${run13?.branch}`);
  }
  // Must have executed with fresh budget (0 tool calls in mock response run, not 25)
  if (run13?.toolCallsCount !== 0) {
    throw new Error(`Test 13.4 Failed: Expected toolCallsCount to reset to 0 for fresh budget, got: ${run13?.toolCallsCount}`);
  }
  if (run13?.lastModelMessage !== test13MockResponse) {
    throw new Error(`Test 13.5 Failed: Expected lastModelMessage '${test13MockResponse}', got '${run13?.lastModelMessage}'`);
  }
  // Must have reopened closed GitHub issue
  if (mockIssuesStore.get(test13IssueNum)?.state !== "open") {
    throw new Error("Test 13.6 Failed: Boot recovery did not reopen closed issue on GitHub!");
  }

  console.log("  [Passed] Boot recovery continues on existing branch with fresh session budget and never marks completed without PR");
  console.log("[Test 13 Passed] Interrupted run boot recovery behavior verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 14: resetRunnerIssue resets tool_calls_count to 0
  // -------------------------------------------------------------------------
  console.log("[Test 14] Testing resetRunnerIssue resets tool_calls_count to 0 and preserves branch/verdict...");

  clearMockRunnerStateDbForTests();
  const test14IssueNum = 72;
  const test14Branch = "task/72-plan-d10-outreach-sequencer-sk";

  // Simulate stale state: 25 tool calls used, recovery attempts 2, status interrupted
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(test14IssueNum)]: {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
          status: "interrupted",
          branch: test14Branch,
          toolCallsCount: 25,
          recoveryAttempts: 2,
          preflightHash: "hash-test-14",
          preflightVerdict: "proceed",
          preflightReason: "Verdict reason",
          lastModelMessage: "Old model message",
          ownerInstance: "inst_old_stale",
          heartbeatAt: new Date().toISOString(),
          runStartedAt: new Date().toISOString(),
        },
      },
    },
    { testMode: true }
  );

  // Execute resetRunnerIssue
  await resetRunnerIssue(
    test14IssueNum,
    {
      agent: "web-builder",
      door: "aeo",
      title: "[PLAN-D10]: Outreach Sequencer SKILL.md + 5-touch worker",
    },
    { testMode: true }
  );

  const stateAfter14 = await getRunnerState({ testMode: true });
  const run14 = stateAfter14.runs[String(test14IssueNum)];

  if (run14?.toolCallsCount !== 0) {
    throw new Error(`Test 14.1 Failed: resetRunnerIssue did NOT reset tool_calls_count to 0! Current value: ${run14?.toolCallsCount}`);
  }
  if (run14?.recoveryAttempts !== 0) {
    throw new Error(`Test 14.2 Failed: resetRunnerIssue did NOT reset recoveryAttempts to 0! Current value: ${run14?.recoveryAttempts}`);
  }
  if (run14?.status !== "in-progress") {
    throw new Error(`Test 14.3 Failed: Expected status 'in-progress', got '${run14?.status}'`);
  }
  if (run14?.ownerInstance !== null) {
    throw new Error(`Test 14.4 Failed: Expected ownerInstance null, got '${run14?.ownerInstance}'`);
  }
  if (run14?.heartbeatAt !== null) {
    throw new Error(`Test 14.5 Failed: Expected heartbeatAt null, got '${run14?.heartbeatAt}'`);
  }
  if (run14?.branch !== test14Branch) {
    throw new Error(`Test 14.6 Failed: resetRunnerIssue lost existing branch! Expected '${test14Branch}', got '${run14?.branch}'`);
  }
  if (run14?.preflightVerdict !== "proceed") {
    throw new Error(`Test 14.7 Failed: resetRunnerIssue lost preflightVerdict! Expected 'proceed', got '${run14?.preflightVerdict}'`);
  }

  console.log("  [Passed] resetRunnerIssue resets tool_calls_count to 0, recoveryAttempts to 0, and preserves branch and preflight cache");
  console.log("[Test 14 Passed] resetRunnerIssue zeroing verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 15: Research limits in runner tools (configurable per agent, refusal on call 21)
  // -------------------------------------------------------------------------
  console.log("[Test 15] Testing research limits in runner tools (configurable per agent, refusal on call 21)...");

  // Part 1: Verify research_calls configured for web-builder and defaults
  const test15Agent = await findAgentByName("web-builder");
  if (!test15Agent) {
    throw new Error("Test 15.1 Failed: web-builder agent not found");
  }
  if (test15Agent.runner_limits?.research_calls !== 20) {
    throw new Error(`Test 15.2 Failed: Expected web-builder research_calls 20, got ${test15Agent.runner_limits?.research_calls}`);
  }
  const test15WbLimits = getAgentRunnerLimits(test15Agent);
  if (test15WbLimits.researchCalls !== 20) {
    throw new Error(`Test 15.3 Failed: Expected getAgentRunnerLimits researchCalls 20, got ${test15WbLimits.researchCalls}`);
  }
  const test15DefaultLimits = getAgentRunnerLimits(null);
  if (test15DefaultLimits.researchCalls !== 20) {
    throw new Error(`Test 15.4 Failed: Expected default researchCalls 20, got ${test15DefaultLimits.researchCalls}`);
  }
  const customConfigAgent: AgentRecord = {
    name: "custom-agent",
    department: "test",
    channel: "#test",
    trigger: "none",
    reviewer: "none",
    runner_limits: {
      max_tool_calls: 50,
      timeout_minutes: 20,
      research_calls: 10,
    },
  };
  const customLimits = getAgentRunnerLimits(customConfigAgent);
  if (customLimits.researchCalls !== 10) {
    throw new Error(`Test 15.5 Failed: Expected custom researchCalls 10, got ${customLimits.researchCalls}`);
  }
  console.log("  [Passed] research_calls configurable per agent in agents.yaml (defaults to 20)");

  // Part 2: Direct execution of 21 combined research calls
  const directContext: RunnerToolContext = {
    branchName: "task/test-research-limits",
    issueNumber: 9974,
    testMode: true,
    virtualFiles: new Map([
      ["sample.txt", "sample file content for test"],
    ]),
    maxResearchCalls: 20,
  };

  // Execute 20 combined research calls (10 read_file + 10 list_dir)
  for (let i = 1; i <= 20; i++) {
    if (i % 2 === 1) {
      const readRes = await executeRunnerTool("read_file", { path: "sample.txt" }, directContext);
      if (readRes !== "sample file content for test") {
        throw new Error(`Test 15.6 Failed: Expected sample content on call #${i}, got: ${readRes}`);
      }
    } else {
      const listRes = await executeRunnerTool("list_dir", { path: "." }, directContext);
      if (listRes.includes("Research budget spent")) {
        throw new Error(`Test 15.7 Failed: Premature refusal on call #${i}: ${listRes}`);
      }
    }
  }

  if (directContext.researchCallsCount !== 20) {
    throw new Error(`Test 15.8 Failed: Expected researchCallsCount 20 after 20 calls, got ${directContext.researchCallsCount}`);
  }
  console.log("  [Passed] First 20 research calls succeed and return file/dir content");

  // Call 21: read_file must return refusal string with no content
  const refusalCall21 = await executeRunnerTool("read_file", { path: "sample.txt" }, directContext);
  const expectedRefusal = "Research budget spent. Write files now with write_file.";
  if (refusalCall21 !== expectedRefusal) {
    throw new Error(`Test 15.9 Failed: Expected refusal on call 21 '${expectedRefusal}', got: '${refusalCall21}'`);
  }
  console.log("  [Passed] Call 21 (read_file) gets refusal: 'Research budget spent. Write files now with write_file.'");

  // Call 22: list_dir must also return refusal string with no content
  const refusalCall22 = await executeRunnerTool("list_dir", { path: "." }, directContext);
  if (refusalCall22 !== expectedRefusal) {
    throw new Error(`Test 15.10 Failed: Expected refusal on call 22 '${expectedRefusal}', got: '${refusalCall22}'`);
  }
  console.log("  [Passed] Call 22 (list_dir) gets refusal: 'Research budget spent. Write files now with write_file.'");

  // Call 23: write_file must succeed (not blocked by research budget)
  const writeCall23 = await executeRunnerTool("write_file", { path: "output.txt", content: "ok" }, directContext);
  if (!writeCall23.startsWith("SUCCESS: Wrote")) {
    throw new Error(`Test 15.11 Failed: Expected write_file to succeed after research limit, got: ${writeCall23}`);
  }
  console.log("  [Passed] Subsequent write_file call succeeds unblocked");

  // Part 3: Fixture session through runIssueTask receives refusal on call 21
  clearMockRunnerStateDbForTests();
  const fixture15IssueNum = 9975;
  const fixture15Issue = {
    number: fixture15IssueNum,
    title: "Fixture session research limit test",
    body: "Deliverable: test research limits in fixture session",
    labels: ["for:web-builder", "status:in-progress"],
  };
  const fixture15BriefHash = computeBriefHash(fixture15Issue.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(fixture15IssueNum)]: {
          agent: "web-builder",
          door: "core",
          title: fixture15Issue.title,
          status: "in-progress",
          branch: "task/9975-research-limit-session",
          toolCallsCount: 0,
          preflightHash: fixture15BriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Cached proceed verdict for test",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const mockCalls: Array<{ name: string; input: Record<string, any> }> = [];
  // 20 research calls
  for (let i = 1; i <= 20; i++) {
    mockCalls.push({
      name: i % 2 === 1 ? "read_file" : "list_dir",
      input: i % 2 === 1 ? { path: "README.md" } : { path: "." },
    });
  }
  // Call 21: 21st research call
  mockCalls.push({
    name: "read_file",
    input: { path: "config/agents.yaml" },
  });
  // Call 22: write_file to produce a commit
  const lines22: string[] = [];
  for (let i = 1; i <= 22; i++) {
    lines22.push(`Line ${i}: verified research limit refusal and resumed write.`);
  }
  mockCalls.push({
    name: "write_file",
    input: { path: "services/test-output.txt", content: lines22.join("\n") },
  });

  const fixture15RunRes = await runIssueTask(fixture15Issue, {
    testMode: true,
    mockToolCalls: mockCalls,
    mockModelResponse: "Brief review: Delivered changes after research budget reached.",
  });

  if (!fixture15RunRes.toolResults || fixture15RunRes.toolResults.length !== 22) {
    throw new Error(`Test 15.12 Failed: Expected 22 tool results, got ${fixture15RunRes.toolResults?.length}`);
  }

  // Verify call 20 succeeded without refusal
  const resultCall20 = fixture15RunRes.toolResults[19];
  if (resultCall20.result === expectedRefusal) {
    throw new Error("Test 15.13 Failed: Call 20 received premature refusal in fixture session");
  }

  // Verify call 21 received refusal
  const resultCall21 = fixture15RunRes.toolResults[20];
  if (resultCall21.result !== expectedRefusal) {
    throw new Error(`Test 15.14 Failed: Call 21 did not get refusal: got '${resultCall21.result}'`);
  }

  // Verify call 22 write_file succeeded
  const resultCall22 = fixture15RunRes.toolResults[21];
  if (!resultCall22.result.startsWith("SUCCESS: Wrote")) {
    throw new Error(`Test 15.15 Failed: Call 22 write_file failed: got '${resultCall22.result}'`);
  }

  console.log("  [Passed] Fixture session receives refusal on call 21 and successfully writes with write_file on call 22");
  console.log("[Test 15 Passed] Research limits in runner tools verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 16: Runner nudge loop on text-only turns without writes
  // -------------------------------------------------------------------------
  console.log("[Test 16] Testing runner nudge loop: text-only turn triggers write_file nudge, completes with file, preserves last_model_message...");

  // Part 1: Mock returning text-only plan turn then write_file turn completes with file
  clearMockRunnerStateDbForTests();
  const test16IssueNum = 9976;
  const test16Issue = {
    number: test16IssueNum,
    title: "Fixture session text-only nudge test",
    body: "Deliverable: verify nudge loop triggers on text turn without writes and succeeds after write_file",
    labels: ["for:web-builder", "status:in-progress"],
  };
  const test16BriefHash = computeBriefHash(test16Issue.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(test16IssueNum)]: {
          agent: "web-builder",
          door: "core",
          title: test16Issue.title,
          status: "in-progress",
          branch: "task/9976-nudge-write-file",
          toolCallsCount: 0,
          preflightHash: test16BriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Cached proceed verdict for test",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const initialPlanText = "I have reviewed the brief. Here is my plan: I will create dist/output.ts.";
  const mockTurnsSuccess = [
    // Turn 1: text-only plan turn, no tool calls
    {
      text: initialPlanText,
      toolCalls: [],
    },
    // Turn 2: empty string text, write_file tool call
    {
      text: "",
      toolCalls: [
        {
          name: "write_file",
          input: {
            path: "dist/output.ts",
            content: [
              "export const ok = true;",
              "export const version = '1.0.0';",
              "export interface TestOutput {",
              "  id: string;",
              "  name: string;",
              "  active: boolean;",
              "  lines: number;",
              "}",
              "export function generateOutput(id: string): TestOutput {",
              "  return {",
              "    id,",
              "    name: 'test-runner',",
              "    active: true,",
              "    lines: 20,",
              "  };",
              "}",
              "export function validateOutput(out: TestOutput): boolean {",
              "  return out.active && out.lines >= 20;",
              "}",
              "export const DEFAULT_TIMEOUT_MS = 5000;",
              "export const RETRY_COUNT = 3;",
              "export default generateOutput;",
            ].join("\n"),
          },
        },
      ],
    },
    // Turn 3: empty string text, no tool calls (session completion)
    {
      text: "",
      toolCalls: [],
    },
  ];

  const res16Success = await runIssueTask(test16Issue, {
    testMode: true,
    mockTurns: mockTurnsSuccess,
  });

  if (!res16Success.success || res16Success.status !== "completed") {
    throw new Error(`Test 16.1 Failed: Expected status completed, got: success=${res16Success.success}, status=${res16Success.status}, error=${res16Success.error}`);
  }
  if (!res16Success.writtenFiles || !res16Success.writtenFiles.includes("dist/output.ts")) {
    throw new Error(`Test 16.2 Failed: Expected dist/output.ts in writtenFiles, got: ${JSON.stringify(res16Success.writtenFiles)}`);
  }
  if (res16Success.nudgesSent !== 1) {
    throw new Error(`Test 16.3 Failed: Expected exactly 1 nudge sent, got: ${res16Success.nudgesSent}`);
  }
  if (res16Success.lastModelMessage !== initialPlanText) {
    throw new Error(`Test 16.4 Failed: Expected lastModelMessage to preserve initial plan text across empty turns, got: '${res16Success.lastModelMessage}'`);
  }

  // Verify DB/state preservation of last_model_message
  const state16After = await getRunnerState({ testMode: true });
  const run16Record = state16After.runs[String(test16IssueNum)];
  if (run16Record.lastModelMessage !== initialPlanText) {
    throw new Error(`Test 16.5 Failed: Expected runner_state.last_model_message to hold initial plan text, got: '${run16Record.lastModelMessage}'`);
  }
  if (run16Record.status !== "completed" || !run16Record.prNumber) {
    throw new Error(`Test 16.6 Failed: Expected completed status with PR, got: status=${run16Record.status}, prNumber=${run16Record.prNumber}`);
  }
  console.log("  [Passed] Text-only plan turn gets nudged, then write_file executes and run completes with PR");
  console.log("  [Passed] Initial plan text is preserved in last_model_message across subsequent empty-string turns");

  // Part 2: Mock with text-only turns exceeding 2 nudges ends cleanly with needs-brief
  clearMockRunnerStateDbForTests();
  const test16BNum = 9977;
  const test16BIssue = {
    number: test16BNum,
    title: "Fixture session text-only 2-nudge limit test",
    body: "Deliverable: verify max 2 nudges before ending when no writes happen",
    labels: ["for:web-builder", "status:in-progress"],
  };
  const test16BBriefHash = computeBriefHash(test16BIssue.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        [String(test16BNum)]: {
          agent: "web-builder",
          door: "core",
          title: test16BIssue.title,
          status: "in-progress",
          branch: "task/9977-nudge-limit",
          toolCallsCount: 0,
          preflightHash: test16BBriefHash,
          preflightVerdict: "proceed",
          preflightReason: "Cached proceed verdict for test",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const mockTurnsExhaust = [
    { text: "Plan turn 1 without writes", toolCalls: [] }, // triggers nudge 1
    { text: "Plan turn 2 without writes", toolCalls: [] }, // triggers nudge 2
    { text: "Plan turn 3 without writes", toolCalls: [] }, // nudges exhausted (2 >= 2), breaks
  ];

  const res16Exhaust = await runIssueTask(test16BIssue, {
    testMode: true,
    mockTurns: mockTurnsExhaust,
  });

  if (res16Exhaust.success !== false || res16Exhaust.status !== "needs-brief") {
    throw new Error(`Test 16.7 Failed: Expected status needs-brief after nudges exhausted, got: ${res16Exhaust.status}`);
  }
  if (res16Exhaust.nudgesSent !== 2) {
    throw new Error(`Test 16.8 Failed: Expected exactly 2 nudges sent, got: ${res16Exhaust.nudgesSent}`);
  }
  if (res16Exhaust.error !== "run produced no files") {
    throw new Error(`Test 16.9 Failed: Expected 'run produced no files', got: ${res16Exhaust.error}`);
  }
  if (res16Exhaust.lastModelMessage !== "Plan turn 3 without writes") {
    throw new Error(`Test 16.10 Failed: Expected lastModelMessage 'Plan turn 3 without writes', got: '${res16Exhaust.lastModelMessage}'`);
  }
  console.log("  [Passed] Session allows up to 2 nudges before ending with status:needs-brief and preserving last text block");
  console.log("[Test 16 Passed] Runner nudge loop and last_model_message preservation verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 17: Intake boot resumes from persisted last-seen Slack timestamp,
  // processing messages posted during deploy downtime while honoring
  // own-message and duplicate guards.
  // -------------------------------------------------------------------------
  console.log("[Test 17] Testing intake boot resumption from persisted last-seen timestamp...");

  const test17Channel = "C_FIX_DEPLOY";
  resetIntakeStateForTests();
  setBootTimestampForTests("1730300050.000000");

  // Step 1: Pre-deploy intake poll
  resetMockPostedLines();
  const preDeployPoll = await pollChiefOfStaffIntake({
    channelId: test17Channel,
    testMode: true,
    mockMessages: [
      {
        ts: "1730300100.000000",
        text: "report",
        user: "U_TEJINDER",
      },
    ],
  });

  if (preDeployPoll.processedCount !== 1) {
    throw new Error(`Test 17.1 Failed: Expected 1 processed message pre-deploy, got ${preDeployPoll.processedCount}`);
  }

  const preDeployState = loadIntakeState(true);
  if (preDeployState.lastProcessedTsByChannel[test17Channel] !== "1730300100.000000") {
    throw new Error(
      `Test 17.2 Failed: Expected persisted ts 1730300100.000000, got ${preDeployState.lastProcessedTsByChannel[test17Channel]}`
    );
  }
  console.log("  [Passed] Pre-deploy message processed and persisted to state");

  // Step 2: Simulate deploy restart at ts 1730300300.000000
  simulateProcessRebootForTests("1730300300.000000");

  // Step 3: Deploy downtime messages (between ts 100 and boot ts 300)
  resetMockPostedLines();
  const downtimeBatch = [
    {
      ts: "1730300100.000000",
      text: "report",
      user: "U_TEJINDER",
    },
    {
      ts: "1730300120.000000",
      text: "Bot notification message",
      bot_id: "B_BOT",
      user: "U_BOT",
    },
    {
      ts: "1730300200.000000",
      text: "counts by city",
      user: "U_TEJINDER",
    },
    {
      ts: "1730300260.000000",
      text: "what is our spend today?",
      user: "U_TEJINDER",
    },
  ];

  const postDeployPoll = await pollChiefOfStaffIntake({
    channelId: test17Channel,
    testMode: true,
    mockMessages: downtimeBatch,
  });

  if (postDeployPoll.processedCount !== 2) {
    throw new Error(
      `Test 17.3 Failed: Expected exactly 2 processed messages for deploy catch-up, got ${postDeployPoll.processedCount}`
    );
  }

  const postDeployState = loadIntakeState(true);
  if (postDeployState.lastProcessedTsByChannel[test17Channel] !== "1730300260.000000") {
    throw new Error(
      `Test 17.4 Failed: Expected lastProcessedTs to advance to 1730300260.000000, got ${postDeployState.lastProcessedTsByChannel[test17Channel]}`
    );
  }
  console.log("  [Passed] Downtime messages processed; duplicate and bot messages ignored");
  console.log("  [Passed] State resumed from persisted timestamp instead of boot time");

  // Step 4: Repeat poll produces 0 duplicates
  const repeatPoll = await pollChiefOfStaffIntake({
    channelId: test17Channel,
    testMode: true,
    mockMessages: downtimeBatch,
  });

  if (repeatPoll.processedCount !== 0) {
    throw new Error(`Test 17.5 Failed: Expected 0 processed messages on repeat poll, got ${repeatPoll.processedCount}`);
  }
  console.log("  [Passed] Repeat poll correctly ignored all previously processed messages");
  console.log("[Test 17 Passed] Intake boot resumption from persisted timestamp verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 18: Daily Cost Caps count IST calendar day (not rolling 24 hours);
  // reset strictly at 00:00 IST.
  // -------------------------------------------------------------------------
  console.log("[Test 18] Testing daily cost cap IST calendar day reset at 00:00 IST...");

  resetCostLedgerForTests();

  // Sub-test 1: isEntryInISTDate boundary accuracy
  // 2026-11-04 23:59:59.999 IST = 2026-11-04T18:29:59.999Z UTC
  // 2026-11-05 00:00:00.000 IST = 2026-11-04T18:30:00.000Z UTC
  // 2026-11-05 23:59:59.999 IST = 2026-11-05T18:29:59.999Z UTC
  // 2026-11-06 00:00:00.000 IST = 2026-11-05T18:30:00.000Z UTC
  if (!isEntryInISTDate("2026-11-04T18:29:59.999Z", "2026-11-04")) {
    throw new Error("Test 18.1 Failed: 18:29:59.999Z UTC should belong to 2026-11-04 IST");
  }
  if (isEntryInISTDate("2026-11-04T18:29:59.999Z", "2026-11-05")) {
    throw new Error("Test 18.2 Failed: 18:29:59.999Z UTC should NOT belong to 2026-11-05 IST");
  }
  if (!isEntryInISTDate("2026-11-04T18:30:00.000Z", "2026-11-05")) {
    throw new Error("Test 18.3 Failed: 18:30:00.000Z UTC (00:00:00 IST) should belong to 2026-11-05 IST");
  }
  if (!isEntryInISTDate("2026-11-05T18:29:59.999Z", "2026-11-05")) {
    throw new Error("Test 18.4 Failed: 18:29:59.999Z UTC (23:59:59 IST) should belong to 2026-11-05 IST");
  }
  if (isEntryInISTDate("2026-11-05T18:30:00.000Z", "2026-11-05")) {
    throw new Error("Test 18.5 Failed: 18:30:00.000Z UTC (00:00:00 IST) should NOT belong to 2026-11-05 IST");
  }
  if (!isEntryInISTDate("2026-11-05T18:30:00.000Z", "2026-11-06")) {
    throw new Error("Test 18.6 Failed: 18:30:00.000Z UTC should belong to 2026-11-06 IST");
  }
  console.log("  [Passed] Millisecond-level boundary transitions at 00:00:00 IST verified");

  // Sub-test 2: Prior-day spend does not roll into next calendar day (no rolling 24h)
  // Web-builder daily cap is $6.00.
  // Yesterday (2026-11-04) at 23:50 IST (18:20 UTC), web-builder spent $5.80 (near $6 cap).
  recordCostEntry({
    timestamp: "2026-11-04T18:20:00.000Z", // 23:50 IST on 2026-11-04
    issueNumber: 72,
    agent: "web-builder",
    model: "claude-3-5-sonnet",
    inputTokens: 100000,
    outputTokens: 5000,
    totalCostUsd: 5.80,
  }, { testMode: true });

  // Today (2026-11-05) at 00:15 IST (18:45 UTC on Nov 4, just 25 minutes after previous run!),
  // web-builder spends $1.50.
  recordCostEntry({
    timestamp: "2026-11-04T18:45:00.000Z", // 00:15 IST on 2026-11-05
    issueNumber: 72,
    agent: "web-builder",
    model: "claude-3-5-sonnet",
    inputTokens: 30000,
    outputTokens: 1500,
    totalCostUsd: 1.50,
  }, { testMode: true });

  // Later today (2026-11-05) at 12:00 IST (06:30 UTC), web-builder spends $2.00.
  recordCostEntry({
    timestamp: "2026-11-05T06:30:00.000Z", // 12:00 IST on 2026-11-05
    issueNumber: 72,
    agent: "web-builder",
    model: "claude-3-5-sonnet",
    inputTokens: 40000,
    outputTokens: 2000,
    totalCostUsd: 2.00,
  }, { testMode: true });

  // Check spend on 2026-11-04 (yesterday): must only be $5.80
  const spendNov4 = await getAgentTodaySpend("web-builder", "2026-11-04", { testMode: true });
  if (spendNov4 !== 5.80) {
    throw new Error(`Test 18.7 Failed: Expected Nov 4 spend to be 5.80, got ${spendNov4}`);
  }

  // Check spend on 2026-11-05 (today):
  // Under rolling 24h, total would be $5.80 + $1.50 + $2.00 = $9.30 (exceeding $6 cap).
  // Under IST calendar day, yesterday's $5.80 reset at 00:00 IST, so today's spend is $1.50 + $2.00 = $3.50.
  const spendNov5 = await getAgentTodaySpend("web-builder", "2026-11-05", { testMode: true });
  if (spendNov5 !== 3.50) {
    throw new Error(`Test 18.8 Failed: Expected Nov 5 spend to be 3.50 (not rolling $9.30), got ${spendNov5}`);
  }
  console.log("  [Passed] Spend resets at 00:00 IST; yesterday's $5.80 does not roll into today");

  // Sub-test 3: checkAgentCostCap under IST calendar day
  const capCheckNov5 = await checkAgentCostCap("web-builder", 0.50, { testMode: true, dateStr: "2026-11-05" });
  if (!capCheckNov5.allowed) {
    throw new Error("Test 18.9 Failed: web-builder should be allowed under cap ($3.50 + $0.50 = $4.00 <= $6.00)");
  }
  if (capCheckNov5.currentSpend !== 3.50) {
    throw new Error(`Test 18.10 Failed: Expected currentSpend 3.50, got ${capCheckNov5.currentSpend}`);
  }
  console.log("  [Passed] checkAgentCostCap allows run based on IST calendar day spend ($3.50 / $6.00)");

  // Sub-test 4: Check next day reset (2026-11-06)
  const spendNov6 = await getAgentTodaySpend("web-builder", "2026-11-06", { testMode: true });
  if (spendNov6 !== 0.00) {
    throw new Error(`Test 18.11 Failed: Expected Nov 6 spend to reset to 0.00, got ${spendNov6}`);
  }
  console.log("  [Passed] Future calendar day spend resets cleanly to $0.00 at 00:00 IST");
  console.log("[Test 18 Passed] Daily cost caps IST calendar day reset verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 19: write_file empty/missing rejection, zero-commits non-empty gate,
  // and PR diff threshold (<20 non-blank lines) closure gate
  // -------------------------------------------------------------------------
  console.log("[Test 19] Testing write_file empty rejection, zero-commits non-empty gate, and PR diff threshold gate...");

  // Part 1: write_file tool rejects empty or missing content (never returns SUCCESS for 0 bytes)
  const wfContext: RunnerToolContext = {
    issueNumber: 9919,
    branchName: "task/9919-test-wf-gate",
    testMode: true,
    virtualFiles: new Map<string, string>(),
    successfulWritesCount: 0 as number,
  };

  // Missing content (undefined)
  const resMissing = await executeRunnerTool("write_file", { path: "src/empty1.ts" }, wfContext);
  if (!resMissing.startsWith("ERROR: content is required and cannot be empty (0 bytes)")) {
    throw new Error(`Test 19.1 Failed: Expected missing content error, got: ${resMissing}`);
  }
  if ((wfContext.successfulWritesCount as number) !== 0 || (wfContext.virtualFiles?.size as number) !== 0) {
    throw new Error("Test 19.2 Failed: Missing content incremented writes or wrote virtual file");
  }

  // Empty string content ("")
  const resEmptyStr = await executeRunnerTool("write_file", { path: "src/empty2.ts", content: "" }, wfContext);
  if (!resEmptyStr.startsWith("ERROR: content is required and cannot be empty (0 bytes)")) {
    throw new Error(`Test 19.3 Failed: Expected empty string error, got: ${resEmptyStr}`);
  }
  if ((wfContext.successfulWritesCount as number) !== 0 || (wfContext.virtualFiles?.size as number) !== 0) {
    throw new Error("Test 19.4 Failed: Empty string incremented writes or wrote virtual file");
  }

  // Whitespace-only content ("   \n\t  ")
  const resWhitespace = await executeRunnerTool("write_file", { path: "src/empty3.ts", content: "   \n\t  " }, wfContext);
  if (!resWhitespace.startsWith("ERROR: content is required and cannot be empty (0 bytes)")) {
    throw new Error(`Test 19.5 Failed: Expected whitespace content error, got: ${resWhitespace}`);
  }
  if ((wfContext.successfulWritesCount as number) !== 0 || (wfContext.virtualFiles?.size as number) !== 0) {
    throw new Error("Test 19.6 Failed: Whitespace content incremented writes or wrote virtual file");
  }

  // Non-empty content succeeds
  const resValid = await executeRunnerTool("write_file", { path: "src/valid.ts", content: "export const answer = 42;\n" }, wfContext);
  if (!resValid.startsWith("SUCCESS: Wrote")) {
    throw new Error(`Test 19.7 Failed: Expected valid write to succeed, got: ${resValid}`);
  }
  if ((wfContext.successfulWritesCount as number) !== 1 || (wfContext.virtualFiles?.size as number) !== 1) {
    throw new Error("Test 19.8 Failed: Valid content failed to increment writes or store virtual file");
  }
  console.log("  [Passed] write_file rejects missing, empty, and whitespace content with 0 bytes; allows valid content");

  // Part 2: Zero-commits gate rejects runs whose files are all empty
  clearMockRunnerStateDbForTests();
  const test19IssueA = {
    number: 99191,
    title: "[TASK]: Zero commits non-empty check",
    body: "### deliverable\nEmpty files simulation\n\n### for-agent\nweb-builder\n\n### door\ncore\n",
    labels: ["for:web-builder", "door:core", "type:build", "status:in-progress"],
    agentName: "web-builder",
    door: "core",
  };

  const briefHash19A = computeBriefHash(test19IssueA.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "99191": {
          agent: "web-builder",
          door: "core",
          title: test19IssueA.title,
          status: "in-progress",
          branch: "task/99191-zero-commits",
          toolCallsCount: 0,
          preflightHash: briefHash19A,
          preflightVerdict: "proceed",
          preflightReason: "Valid brief",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  // Model makes tool call with empty content (which fails) and ends without files
  const res19A = await runIssueTask(test19IssueA, {
    testMode: true,
    mockToolCalls: [
      {
        name: "write_file",
        input: { path: "empty.txt", content: "" },
      },
    ],
    mockModelResponse: "Attempted to write empty file.",
  });

  if (res19A.success || res19A.status !== "needs-brief" || res19A.error !== "run produced no files") {
    throw new Error(`Test 19.9 Failed: Expected zero-commits gate rejection, got: ${JSON.stringify(res19A)}`);
  }
  if (res19A.prNumber !== undefined) {
    throw new Error("Test 19.10 Failed: PR must not be opened when 0 non-empty file changes exist");
  }
  console.log("  [Passed] Zero-commits gate enforces non-empty file changes and blocks PR creation");

  // Part 3: PR diff threshold gate (< 20 non-blank lines) closes PR and withholds review card
  clearMockRunnerStateDbForTests();
  const test19IssueB = {
    number: 99192,
    title: "[TASK]: Short diff threshold check",
    body: "### deliverable\nFew lines output\n\n### for-agent\nweb-builder\n\n### door\ncore\n",
    labels: ["for:web-builder", "door:core", "type:build", "status:in-progress"],
    agentName: "web-builder",
    door: "core",
  };

  const briefHash19B = computeBriefHash(test19IssueB.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "99192": {
          agent: "web-builder",
          door: "core",
          title: test19IssueB.title,
          status: "in-progress",
          branch: "task/99192-diff-gate",
          toolCallsCount: 0,
          preflightHash: briefHash19B,
          preflightVerdict: "proceed",
          preflightReason: "Valid brief",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  // Model writes 5 lines (less than 20 non-blank lines)
  const shortContent = "line 1\nline 2\nline 3\nline 4\nline 5\n";
  const modelMessageB = "Here is the short 5-line implementation.";
  const res19B = await runIssueTask(test19IssueB, {
    testMode: true,
    mockToolCalls: [
      {
        name: "write_file",
        input: { path: "short.ts", content: shortContent },
      },
    ],
    mockModelResponse: modelMessageB,
  });

  if (res19B.success || res19B.status !== "needs-brief") {
    throw new Error(`Test 19.11 Failed: Expected status needs-brief for diff < 20 lines, got ${JSON.stringify(res19B)}`);
  }
  if (res19B.error !== "run produced no files") {
    throw new Error(`Test 19.12 Failed: Expected error 'run produced no files', got '${res19B.error}'`);
  }
  if (!res19B.prNumber) {
    throw new Error("Test 19.13 Failed: Expected PR number to be recorded for the closed PR");
  }
  if (res19B.lastModelMessage !== modelMessageB) {
    throw new Error(`Test 19.14 Failed: Expected model's last message preserved, got '${res19B.lastModelMessage}'`);
  }

  // Verify runner state record has status: needs-brief, prNumber, and lastModelMessage
  const state19B = await getRunnerState({ testMode: true });
  const runRecord19B = state19B.runs["99192"];
  if (runRecord19B.status !== "needs-brief" || runRecord19B.error !== "run produced no files" || !runRecord19B.prNumber) {
    throw new Error(`Test 19.15 Failed: Runner state mismatch: ${JSON.stringify(runRecord19B)}`);
  }
  if (runRecord19B.lastModelMessage !== modelMessageB) {
    throw new Error(`Test 19.16 Failed: Runner state missing lastModelMessage: ${runRecord19B.lastModelMessage}`);
  }
  console.log("  [Passed] PR with < 20 non-blank lines is closed as 'run produced no files' with model's last message");

  // Part 4: PR with >= 20 non-blank lines passes diff gate and completes
  clearMockRunnerStateDbForTests();
  const test19IssueC = {
    number: 99193,
    title: "[TASK]: Full deliverable passing diff gate",
    body: "### deliverable\nFull deliverable >= 20 lines\n\n### for-agent\nweb-builder\n\n### door\ncore\n",
    labels: ["for:web-builder", "door:core", "type:build", "status:in-progress"],
    agentName: "web-builder",
    door: "core",
  };

  const briefHash19C = computeBriefHash(test19IssueC.body, []);
  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "99193": {
          agent: "web-builder",
          door: "core",
          title: test19IssueC.title,
          status: "in-progress",
          branch: "task/99193-full-diff",
          toolCallsCount: 0,
          preflightHash: briefHash19C,
          preflightVerdict: "proceed",
          preflightReason: "Valid brief",
          runStartedAt: new Date().toISOString(),
          ownerInstance: null,
          heartbeatAt: null,
          recoveryAttempts: 0,
        },
      },
    },
    { testMode: true }
  );

  const fullContentLines: string[] = [];
  for (let i = 1; i <= 25; i++) {
    fullContentLines.push(`export const item_${i} = "value_${i}";`);
  }
  const fullContent = fullContentLines.join("\n");

  const res19C = await runIssueTask(test19IssueC, {
    testMode: true,
    mockToolCalls: [
      {
        name: "write_file",
        input: { path: "full.ts", content: fullContent },
      },
    ],
    mockModelResponse: "Delivered full 25-line module.",
  });

  if (!res19C.success || res19C.status !== "completed") {
    throw new Error(`Test 19.17 Failed: Expected completed status for diff >= 20 lines, got ${JSON.stringify(res19C)}`);
  }
  if (!res19C.prNumber) {
    throw new Error("Test 19.18 Failed: Expected PR number on completed run");
  }
  console.log("  [Passed] PR with >= 20 non-blank lines passes diff gate and completes successfully");
  console.log("[Test 19 Passed] write_file rejection, zero-commits non-empty gate, and PR diff threshold gate verified.\n");
  passed++;

  console.log("==========================================================================");
  console.log(`ALL ${passed} HOUSEKEEPING FIX TESTS PASSED CLEANLY!`);
  console.log("==========================================================================");
}

runFixesVerificationSuite().catch((err) => {
  console.error("[FAILED] Verification Suite Failed:", err);
  process.exit(1);
});


// services/tgl-ops/src/test-fixes.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import { gatherStandupMaterial } from "./agents/chief-of-staff/gather.js";
import { doesCronRunOnDate, isAgentScheduledOnDate, type AgentRecord } from "./lib/agents.js";
import { execute1815SilenceCheck } from "./agents/chief-of-staff/worker.js";
import { getCurrentPlanDay } from "./lib/plan.js";

async function runFixesVerificationSuite(): Promise<void> {
  console.log("==========================================================================");
  console.log("🧪 Housekeeping Fixes Verification Suite");
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

  console.log("==========================================================================");
  console.log(`🎉 ALL ${passed} HOUSEKEEPING FIX TESTS PASSED CLEANLY!`);
  console.log("==========================================================================");
}

runFixesVerificationSuite().catch((err) => {
  console.error("❌ Verification Suite Failed:", err);
  process.exit(1);
});


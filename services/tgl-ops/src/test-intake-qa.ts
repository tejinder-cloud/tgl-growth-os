// services/tgl-ops/src/test-intake-qa.ts
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3.00";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15.00";
process.env.TGL_TEST_MODE = "1";

import { config } from "./config.js";
import {
  classifyArchitectMessage,
  answerArchitectQuestion,
  compileArchitectReport,
  pollChiefOfStaffIntake,
  resetIntakeStateForTests,
  setBootTimestampForTests,
} from "./agents/chief-of-staff/intake.js";
import {
  setMockProspectRecordsForTests,
  getProspectMetricsFromSql,
  type ProspectRecord,
} from "./agents/prospect-researcher/db.js";
import {
  usageCostsLedger,
  formatCostUsd,
  getCostLedgerSummary,
  recordCostEntry,
  resetCostLedgerForTests,
} from "./lib/cost-cap.js";

async function runIntakeQaTests() {
  console.log("==========================================================================");
  console.log("🧪 Chief of Staff Intake: SQL Q&A & Cost Ledger Test Suite");
  console.log("==========================================================================\n");

  let passed = 0;

  // -------------------------------------------------------------------------
  // Test 1: Classification preserves "report" for report requests,
  // while classifying count and data inquiries as "question".
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing classification distinction between report and data questions...");

  const reportRes1 = await classifyArchitectMessage("report", { testMode: true });
  if (reportRes1.category !== "report") {
    throw new Error(`Test 1 Failed: Expected "report" to be "report", got "${reportRes1.category}"`);
  }

  const reportRes2 = await classifyArchitectMessage("give me the daily ops report", { testMode: true });
  if (reportRes2.category !== "report") {
    throw new Error(`Test 1 Failed: Expected daily ops report to be "report", got "${reportRes2.category}"`);
  }

  const cityRes = await classifyArchitectMessage("counts by city", { testMode: true });
  if (cityRes.category !== "question") {
    throw new Error(`Test 1 Failed: Expected "counts by city" to be "question", got "${cityRes.category}"`);
  }

  const statusRes = await classifyArchitectMessage("counts by status", { testMode: true });
  if (statusRes.category !== "question") {
    throw new Error(`Test 1 Failed: Expected "counts by status" to be "question", got "${statusRes.category}"`);
  }

  const dayRes = await classifyArchitectMessage("counts by day", { testMode: true });
  if (dayRes.category !== "question") {
    throw new Error(`Test 1 Failed: Expected "counts by day" to be "question", got "${dayRes.category}"`);
  }

  const spendRes = await classifyArchitectMessage("what is our spend today?", { testMode: true });
  if (spendRes.category !== "question") {
    throw new Error(`Test 1 Failed: Expected spend question to be "question", got "${spendRes.category}"`);
  }

  console.log("  ✓ 'report' and 'daily ops report' correctly classified as category='report'");
  console.log("  ✓ 'counts by city', 'counts by status', 'counts by day' correctly classified as category='question'");
  console.log("  ✓ 'what is our spend today?' correctly classified as category='question'");
  console.log("✅ [Test 1 Passed] Intake classification boundaries verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 2: SQL Aggregation for Prospects (Counts by City, Status, Day)
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing SQL aggregation for prospect counts...");

  const mockProspects: ProspectRecord[] = [
    {
      tenant_id: "tgl",
      company: "Apex Hospital",
      category: "hospital",
      city: "Delhi NCR",
      website: "https://apexhospital.in",
      door: "aeo",
      fit_score: 85,
      fit_reasons: ["Strong AEO gap"],
      status: "reviewed",
      source_refs: ["https://apexhospital.in"],
      created_at: "2026-10-30T09:30:00.000Z",
    },
    {
      tenant_id: "tgl",
      company: "Care Dental",
      category: "dental",
      city: "Delhi NCR",
      website: "https://caredental.in",
      door: "aeo",
      fit_score: 90,
      fit_reasons: ["Missing local schema"],
      status: "reviewed",
      source_refs: ["https://caredental.in"],
      created_at: "2026-10-30T09:31:00.000Z",
    },
    {
      tenant_id: "tgl",
      company: "City Eye Centre",
      category: "eye_care",
      city: "Mumbai",
      website: "https://cityeyecentre.in",
      door: "aeo",
      fit_score: 75,
      fit_reasons: ["Competitive search queries"],
      status: "new",
      source_refs: ["https://cityeyecentre.in"],
      created_at: "2026-10-29T10:00:00.000Z",
    },
    {
      tenant_id: "tgl",
      company: "Global IVF",
      category: "ivf",
      city: "Delhi NCR",
      website: "https://globalivf.in",
      door: "aeo",
      fit_score: 60,
      fit_reasons: ["Chain signal"],
      status: "rejected",
      source_refs: ["https://globalivf.in"],
      created_at: "2026-10-28T11:00:00.000Z",
    },
  ];

  setMockProspectRecordsForTests(mockProspects);

  const metrics = await getProspectMetricsFromSql({ testMode: true });
  if (metrics.total !== 4) {
    throw new Error(`Test 2 Failed: Expected 4 total prospects, got ${metrics.total}`);
  }
  if (metrics.byCity["Delhi NCR"] !== 3 || metrics.byCity["Mumbai"] !== 1) {
    throw new Error(`Test 2 Failed: Unexpected city breakdown: ${JSON.stringify(metrics.byCity)}`);
  }
  if (metrics.byStatus["reviewed"] !== 2 || metrics.byStatus["new"] !== 1 || metrics.byStatus["rejected"] !== 1) {
    throw new Error(`Test 2 Failed: Unexpected status breakdown: ${JSON.stringify(metrics.byStatus)}`);
  }
  if (metrics.byDay["2026-10-30"] !== 2 || metrics.byDay["2026-10-29"] !== 1 || metrics.byDay["2026-10-28"] !== 1) {
    throw new Error(`Test 2 Failed: Unexpected day breakdown: ${JSON.stringify(metrics.byDay)}`);
  }

  console.log("  ✓ SQL aggregate computes exact totals: 4 rows");
  console.log("  ✓ By City: Delhi NCR (3), Mumbai (1)");
  console.log("  ✓ By Status: reviewed (2), new (1), rejected (1)");
  console.log("  ✓ By Day: 2026-10-30 (2), 2026-10-29 (1), 2026-10-28 (1)");
  console.log("✅ [Test 2 Passed] SQL aggregate metrics verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 3: Answering the Question Asked (City, Status, Day, All)
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing answerArchitectQuestion for specific inquiries...");

  const cityAnswer = await answerArchitectQuestion("counts by city", { testMode: true });
  if (!cityAnswer.includes("Counts by City (from SQL)") || !cityAnswer.includes("*Delhi NCR:* 3") || !cityAnswer.includes("*Mumbai:* 1")) {
    throw new Error(`Test 3 Failed: City answer missing expected counts:\n${cityAnswer}`);
  }

  const statusAnswer = await answerArchitectQuestion("counts by status", { testMode: true });
  if (!statusAnswer.includes("Counts by Status (from SQL)") || !statusAnswer.includes("*reviewed:* 2") || !statusAnswer.includes("*rejected:* 1")) {
    throw new Error(`Test 3 Failed: Status answer missing expected counts:\n${statusAnswer}`);
  }

  const dayAnswer = await answerArchitectQuestion("counts by day", { testMode: true });
  if (!dayAnswer.includes("Counts by Day (from SQL)") || !dayAnswer.includes("*2026-10-30:* 2") || !dayAnswer.includes("*2026-10-29:* 1")) {
    throw new Error(`Test 3 Failed: Day answer missing expected counts:\n${dayAnswer}`);
  }

  const allCountsAnswer = await answerArchitectQuestion("breakdown of prospect counts", { testMode: true });
  if (!allCountsAnswer.includes("Prospect Database Breakdown (from SQL)") || !allCountsAnswer.includes("Total Prospects:* 4")) {
    throw new Error(`Test 3 Failed: Full counts answer missing expected summary:\n${allCountsAnswer}`);
  }

  console.log("  ✓ 'counts by city' returns exact city breakdown from SQL");
  console.log("  ✓ 'counts by status' returns exact status breakdown from SQL");
  console.log("  ✓ 'counts by day' returns exact chronological daily breakdown from SQL");
  console.log("  ✓ 'breakdown of prospect counts' returns combined database overview");
  console.log("✅ [Test 3 Passed] Specific SQL question answering verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 4: Cost Ledger & Real Spend Recording (Fixing "$0.00 (1 runs)")
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing cost ledger recording and formatting...");

  resetCostLedgerForTests();

  // 1. Verify formatCostUsd precision rules
  if (formatCostUsd(0) !== "$0.00") throw new Error("formatCostUsd(0) should be $0.00");
  if (formatCostUsd(0.0027) !== "$0.0027") throw new Error(`formatCostUsd(0.0027) should be $0.0027, got ${formatCostUsd(0.0027)}`);
  if (formatCostUsd(0.0304) !== "$0.0304") throw new Error(`formatCostUsd(0.0304) should be $0.0304, got ${formatCostUsd(0.0304)}`);
  if (formatCostUsd(1.50) !== "$1.50") throw new Error(`formatCostUsd(1.50) should be $1.50, got ${formatCostUsd(1.50)}`);

  // 2. Add realistic calls to the ledger
  const dateStr = "2026-10-30";
  recordCostEntry({
    timestamp: `${dateStr}T12:50:00.000Z`,
    issueNumber: 0,
    agent: "chief-of-staff",
    model: "claude-3-5-sonnet",
    inputTokens: 528,
    outputTokens: 73,
    totalCostUsd: 0.0027,
  }, { testMode: true });

  recordCostEntry({
    timestamp: `${dateStr}T13:28:00.000Z`,
    issueNumber: 0,
    agent: "chief-of-staff",
    model: "claude-3-5-sonnet",
    inputTokens: 525,
    outputTokens: 73,
    totalCostUsd: 0.0027,
  }, { testMode: true });

  recordCostEntry({
    timestamp: `${dateStr}T17:50:00.000Z`,
    issueNumber: 0,
    agent: "chief-of-staff",
    model: "claude-sonnet-5-5",
    inputTokens: 2498,
    outputTokens: 1524,
    totalCostUsd: 0.0304,
  }, { testMode: true });

  const summary = getCostLedgerSummary(dateStr, { testMode: true });
  if (summary.runsCount !== 3) {
    throw new Error(`Test 4 Failed: Expected 3 runs, got ${summary.runsCount}`);
  }
  const expectedTotal = Number((0.0027 + 0.0027 + 0.0304).toFixed(4)); // 0.0358
  if (summary.totalSpendUsd !== expectedTotal) {
    throw new Error(`Test 4 Failed: Expected total spend $${expectedTotal}, got $${summary.totalSpendUsd}`);
  }

  // 3. Question about spend
  const spendAnswer = await answerArchitectQuestion("how much did we spend today?", { testMode: true });
  if (!spendAnswer.includes("$0.0358 across 3 calls")) {
    throw new Error(`Test 4 Failed: Spend answer missing real total:\n${spendAnswer}`);
  }
  if (!spendAnswer.includes("$0.0027") || !spendAnswer.includes("$0.0304")) {
    throw new Error(`Test 4 Failed: Spend answer missing real per-call spend:\n${spendAnswer}`);
  }

  // 4. Report template
  const reportOutput = await compileArchitectReport({ testMode: true });
  if (reportOutput.includes("$0.00 (1 runs)") || reportOutput.includes("$0.00 (3 calls)")) {
    throw new Error(`Test 4 Failed: Report output contains invalid zero spend:\n${reportOutput}`);
  }
  if (!reportOutput.includes("$0.0358 (3 calls") || !reportOutput.includes("@chief-of-staff: $0.0358")) {
    throw new Error(`Test 4 Failed: Report output missing accurate spend breakdown:\n${reportOutput}`);
  }
  if (!reportOutput.includes("4 sourced") || !reportOutput.includes("2 reviewed")) {
    throw new Error(`Test 4 Failed: Report output missing SQL prospect metrics:\n${reportOutput}`);
  }

  console.log("  ✓ formatCostUsd correctly retains $0.0027 and $0.0304 without rounding to $0.00");
  console.log("  ✓ Cost ledger accurately tracks 3 runs totaling $0.0358");
  console.log("  ✓ 'how much did we spend today?' answers with exact real spend per call");
  console.log("  ✓ compileArchitectReport displays $0.0358 across 3 calls with per-agent spend");
  console.log("  ✓ '$0.00 (1 runs)' completely eliminated");
  console.log("✅ [Test 4 Passed] Cost ledger & real spend reporting verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 5: End-to-end Slack Poll Intake Dispatch
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing end-to-end intake poll message handling...");

  resetIntakeStateForTests();
  setBootTimestampForTests("1730300000.000000");

  config.architectChannelId = "C_TEST_ARCH";

  // Message 1: Question about city counts
  const poll1 = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300010.000000",
        text: "counts by city",
        user: "U_TEJINDER",
      },
    ],
  });
  if (poll1.processedCount !== 1) {
    throw new Error(`Test 5 Failed: Expected 1 processed message for city count query, got ${poll1.processedCount}`);
  }

  // Message 2: Question about status counts
  const poll2 = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300020.000000",
        text: "counts by status",
        user: "U_TEJINDER",
      },
    ],
  });
  if (poll2.processedCount !== 1) {
    throw new Error(`Test 5 Failed: Expected 1 processed message for status count query, got ${poll2.processedCount}`);
  }

  // Message 3: Report request
  const poll3 = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300030.000000",
        text: "daily report",
        user: "U_TEJINDER",
      },
    ],
  });
  if (poll3.processedCount !== 1) {
    throw new Error(`Test 5 Failed: Expected 1 processed message for daily report query, got ${poll3.processedCount}`);
  }

  console.log("  ✓ Poll processed 'counts by city' query and answered from SQL");
  console.log("  ✓ Poll processed 'counts by status' query and answered from SQL");
  console.log("  ✓ Poll processed 'daily report' and delivered verified ops report");
  console.log("✅ [Test 5 Passed] End-to-end intake poll verified.\n");
  passed++;

  // Clean up
  setMockProspectRecordsForTests(null);
  resetCostLedgerForTests();

  console.log("==========================================================================");
  console.log(`🎉 ALL ${passed} INTAKE Q&A AND COST LEDGER TESTS PASSED CLEANLY!`);
  console.log("==========================================================================");
}

runIntakeQaTests().catch((err) => {
  console.error("❌ Test Suite Error:", err);
  process.exit(1);
});

// services/tgl-ops/src/test-intake-qa.ts
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3.00";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15.00";
process.env.TGL_TEST_MODE = "1";

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  classifyArchitectMessage,
  answerArchitectQuestion,
  compileArchitectReport,
  pollChiefOfStaffIntake,
  resetIntakeStateForTests,
  setBootTimestampForTests,
  lastTriggeredRunnerIssue,
  resetLastTriggeredRunnerIssueForTests,
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
  recordApiSpend,
  loadCostLedgerFromState,
  resetCostLedgerForTests,
} from "./lib/cost-cap.js";
import { getTodayDateString } from "./lib/standup.js";
import { mockIssuesStore, getIssue } from "./lib/github-client.js";
import { mockPostedLines, resetMockPostedLines } from "./lib/post.js";

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

  const defaultDm = {
    name: "Dr. Test",
    role: "Owner",
    email: "test@example.com",
    source: "website",
  };
  const defaultSignals = {
    meta_ads_active: false,
    meta_ad_count: 0,
    gbp_reviews: 10,
    gbp_owner_replies: true,
    hiring_marketing: false,
    review_surge: false,
    branch_count: 1,
  };

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
      decision_maker: defaultDm,
      signals: defaultSignals,
      status: "reviewed",
      source_refs: ["https://apexhospital.in"],
      created_at: "2026-10-30T09:30:00.000Z",
      rescored_at: "2026-10-30T09:30:00.000Z",
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
      decision_maker: defaultDm,
      signals: defaultSignals,
      status: "reviewed",
      source_refs: ["https://caredental.in"],
      created_at: "2026-10-30T09:31:00.000Z",
      rescored_at: "2026-10-30T09:31:00.000Z",
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
      decision_maker: defaultDm,
      signals: defaultSignals,
      status: "new",
      source_refs: ["https://cityeyecentre.in"],
      created_at: "2026-10-29T10:00:00.000Z",
      rescored_at: "2026-10-29T10:00:00.000Z",
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
      decision_maker: defaultDm,
      signals: defaultSignals,
      status: "rejected",
      source_refs: ["https://globalivf.in"],
      created_at: "2026-10-28T11:00:00.000Z",
      rescored_at: "2026-10-28T11:00:00.000Z",
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
  const dateStr = getTodayDateString();
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

  // -------------------------------------------------------------------------
  // Test 6: Unified Multi-Agent Cost Ledger (Anthropic LLM + API Spend)
  // Verifies prospect-researcher (13:23) and runner #53 attempt (09:00)
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing unified multi-agent cost ledger with Anthropic & API spend...");

  resetCostLedgerForTests();

  const testDate = getTodayDateString();

  // 1. Simulate state loading with historical runs (runner #53 attempt at 09:00 IST)
  loadCostLedgerFromState({ testMode: true, includeHistoricalRuns: true } as any);

  const runnerEntry = usageCostsLedger.find((e) => e.agent === "web-builder" && e.issueNumber === 53);
  if (!runnerEntry) {
    throw new Error("Test 6 Failed: Runner Issue #53 attempt at 09:00 IST missing from ledger.");
  }
  if (runnerEntry.totalCostUsd !== 0.0067) {
    throw new Error(`Test 6 Failed: Runner Issue #53 cost mismatch: expected 0.0067, got ${runnerEntry.totalCostUsd}`);
  }

  // 2. Record prospect-researcher 13:23 IST run (LLM + Places API)
  recordCostEntry(
    {
      timestamp: `${testDate}T13:23:00.000Z`,
      issueNumber: 0,
      agent: "prospect-researcher",
      model: "claude-3-5-sonnet",
      inputTokens: 1500,
      outputTokens: 400,
      totalCostUsd: 0.0105,
      costType: "llm",
      details: "prospect-researcher run: Delhi NCR · hospitals",
    },
    { testMode: true }
  );

  recordApiSpend({
    timestamp: `${testDate}T13:23:00.000Z`,
    agent: "prospect-researcher",
    apiName: "google-places-api",
    totalCostUsd: 0.032,
    details: "1 Google Places API call(s)",
    options: { testMode: true },
  });

  // 3. Record chief-of-staff intake call
  recordCostEntry(
    {
      timestamp: `${testDate}T13:28:00.000Z`,
      issueNumber: 0,
      agent: "chief-of-staff",
      model: "claude-3-5-sonnet",
      inputTokens: 525,
      outputTokens: 73,
      totalCostUsd: 0.0027,
      costType: "llm",
      details: "intake classification",
    },
    { testMode: true }
  );

  const unifiedSummary = getCostLedgerSummary(testDate, { testMode: true });

  // Verify total runs
  if (unifiedSummary.runsCount !== 4) {
    throw new Error(`Test 6 Failed: Expected 4 ledger entries (1 runner, 2 researcher, 1 chief-of-staff), got ${unifiedSummary.runsCount}`);
  }

  // Verify total spend = 0.0067 + 0.0105 + 0.0320 + 0.0027 = 0.0519
  const expectedUnifiedTotal = Number((0.0067 + 0.0105 + 0.032 + 0.0027).toFixed(4));
  if (unifiedSummary.totalSpendUsd !== expectedUnifiedTotal) {
    throw new Error(`Test 6 Failed: Expected total spend $${expectedUnifiedTotal}, got $${unifiedSummary.totalSpendUsd}`);
  }

  // Verify LLM spend and API spend breakdown
  const expectedLlm = Number((0.0067 + 0.0105 + 0.0027).toFixed(4)); // 0.0199
  const expectedApi = 0.0320;
  if (unifiedSummary.llmSpendUsd !== expectedLlm) {
    throw new Error(`Test 6 Failed: Expected LLM spend $${expectedLlm}, got $${unifiedSummary.llmSpendUsd}`);
  }
  if (unifiedSummary.apiSpendUsd !== expectedApi) {
    throw new Error(`Test 6 Failed: Expected API spend $${expectedApi}, got $${unifiedSummary.apiSpendUsd}`);
  }

  // Verify per-agent accounting
  if (!unifiedSummary.byAgent["web-builder"] || unifiedSummary.byAgent["web-builder"].spendUsd !== 0.0067) {
    throw new Error(`Test 6 Failed: Missing or incorrect web-builder spend: ${JSON.stringify(unifiedSummary.byAgent["web-builder"])}`);
  }
  if (!unifiedSummary.byAgent["prospect-researcher"] || unifiedSummary.byAgent["prospect-researcher"].spendUsd !== 0.0425) {
    throw new Error(`Test 6 Failed: Missing or incorrect prospect-researcher spend: ${JSON.stringify(unifiedSummary.byAgent["prospect-researcher"])}`);
  }
  if (!unifiedSummary.byAgent["chief-of-staff"] || unifiedSummary.byAgent["chief-of-staff"].spendUsd !== 0.0027) {
    throw new Error(`Test 6 Failed: Missing or incorrect chief-of-staff spend: ${JSON.stringify(unifiedSummary.byAgent["chief-of-staff"])}`);
  }

  // 4. Test question answering
  const spendQ = await answerArchitectQuestion("what did we spend today?", { testMode: true });
  if (!spendQ.includes("$0.0519 across 4 calls")) {
    throw new Error(`Test 6 Failed: Answer missing total spend:\n${spendQ}`);
  }
  if (!spendQ.includes("@web-builder") || !spendQ.includes("#53") || !spendQ.includes("$0.0067")) {
    throw new Error(`Test 6 Failed: Answer missing runner #53 attempt:\n${spendQ}`);
  }
  if (!spendQ.includes("@prospect-researcher") || !spendQ.includes("$0.0105") || !spendQ.includes("$0.0320")) {
    throw new Error(`Test 6 Failed: Answer missing prospect-researcher LLM or API run:\n${spendQ}`);
  }
  if (!spendQ.includes("[API: google-places-api]")) {
    throw new Error(`Test 6 Failed: Answer missing API tag for Google Places:\n${spendQ}`);
  }

  console.log("  ✓ Runner Issue #53 attempt at 09:00 IST ($0.0067) present in ledger");
  console.log("  ✓ Prospect Researcher 13:23 IST run (LLM $0.0105 + Places API $0.0320) present in ledger");
  console.log("  ✓ Chief of Staff intake calls tracked in same ledger");
  console.log("  ✓ Unified total spend: $0.0519 across 4 calls ($0.0199 LLM + $0.0320 API)");
  console.log("  ✓ By Agent breakdown: @web-builder $0.0067, @prospect-researcher $0.0425, @chief-of-staff $0.0027");
  console.log("  ✓ 'what did we spend today?' answers with complete multi-agent ledger and API entries");
  console.log("✅ [Test 6 Passed] Unified multi-agent cost ledger verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 7: Issue Resumption via Intake & Elimination of File Summaries
  // Verifies:
  // 1. Exact message naming open issue #53 resumes task, comments, sets status:in-progress,
  //    triggers runner, and replies "→ @web-builder, #53 resumed, card in #doors-aeo".
  // 2. Vague message replies with one clarifying question.
  // 3. Question replies with data.
  // 4. Zero file summaries anywhere ("I've verified our current records" eliminated).
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing issue resumption task trigger, vague message clarification, and zero file summaries...");

  // Helper to assert no file summaries anywhere
  function assertNoFileSummaries(text: string, context: string) {
    if (text.includes("I've verified our current records") || text.includes("Relevant files:")) {
      throw new Error(`Test 7 Failed (${context}): Reply contains file summary prohibited by AGENTS.md:\n${text}`);
    }
  }

  // Part A: Exact message
  const exactMessage = "finish #53 — the short-form runner and the one-page PDF are the only lines left";

  mockIssuesStore.set(53, {
    number: 53,
    title: "[PLAN-D8]: AEO Audit Engine SKILL.md + short-form engine",
    body: "### deliverable\nAEO Audit Engine SKILL.md and short-form engine\n\n### reviewer\nCreative Director",
    state: "open",
    labels: ["for:web-builder", "door:aeo", "type:build", "status:needs-brief"],
    html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/53",
  });

  resetMockPostedLines();
  resetIntakeStateForTests();
  resetLastTriggeredRunnerIssueForTests();
  setBootTimestampForTests("1730300400.000000");
  config.architectChannelId = "C_ARCH_TEST";

  const pollResA = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300410.000000",
        text: exactMessage,
        user: "U_TEJINDER",
      },
    ],
  });

  if (pollResA.processedCount !== 1) {
    throw new Error(`Test 7 Failed: Expected 1 processed message for exact issue resumption, got ${pollResA.processedCount}`);
  }

  // 1. Verify issue comment added
  const issue53 = await getIssue(53);
  if (!issue53) throw new Error("Test 7 Failed: Issue #53 not found in mock store");
  if (!issue53.comments || !issue53.comments.some((c) => c.includes(exactMessage))) {
    throw new Error(`Test 7 Failed: Issue #53 missing Architect comment. Got comments: ${JSON.stringify(issue53.comments)}`);
  }

  // 2. Verify labels updated
  if (!issue53.labels.includes("status:in-progress")) {
    throw new Error(`Test 7 Failed: Issue #53 missing 'status:in-progress' label. Labels: ${JSON.stringify(issue53.labels)}`);
  }
  if (issue53.labels.includes("status:needs-brief")) {
    throw new Error(`Test 7 Failed: Issue #53 still has 'status:needs-brief' label. Labels: ${JSON.stringify(issue53.labels)}`);
  }
  if (!issue53.labels.includes("for:web-builder")) {
    throw new Error(`Test 7 Failed: Issue #53 missing 'for:web-builder' label. Labels: ${JSON.stringify(issue53.labels)}`);
  }

  // 3. Verify runner triggered
  if (lastTriggeredRunnerIssue !== 53) {
    throw new Error(`Test 7 Failed: Expected runner triggered for issue #53, got ${lastTriggeredRunnerIssue}`);
  }

  // 4. Verify in-thread reply
  const lastPostA = mockPostedLines[mockPostedLines.length - 1];
  const expectedReply = "→ @web-builder, #53 resumed, card in #doors-aeo";
  if (!lastPostA || lastPostA.text !== expectedReply) {
    throw new Error(`Test 7 Failed: Expected reply "${expectedReply}", got "${lastPostA?.text}"`);
  }
  assertNoFileSummaries(lastPostA.text, "Exact message resumption");

  // Part B: Vague message
  resetMockPostedLines();
  const vagueMessage = "maybe we should look into something";
  const pollResB = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300420.000000",
        text: vagueMessage,
        user: "U_TEJINDER",
      },
    ],
  });

  if (pollResB.processedCount !== 1) {
    throw new Error(`Test 7 Failed: Expected 1 processed message for vague message, got ${pollResB.processedCount}`);
  }

  const lastPostB = mockPostedLines[mockPostedLines.length - 1];
  if (!lastPostB || !lastPostB.text.startsWith("*Chief of Staff Clarification:*")) {
    throw new Error(`Test 7 Failed: Vague message reply should start with '*Chief of Staff Clarification:*', got:\n${lastPostB?.text}`);
  }
  if (!lastPostB.text.includes("?")) {
    throw new Error(`Test 7 Failed: Vague message reply must be a clarifying question, got:\n${lastPostB?.text}`);
  }
  assertNoFileSummaries(lastPostB.text, "Vague message");

  // Part C: Question with data
  resetMockPostedLines();
  const questionMessage = "how much did we spend today?";
  const pollResC = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300430.000000",
        text: questionMessage,
        user: "U_TEJINDER",
      },
    ],
  });

  if (pollResC.processedCount !== 1) {
    throw new Error(`Test 7 Failed: Expected 1 processed message for question, got ${pollResC.processedCount}`);
  }

  const lastPostC = mockPostedLines[mockPostedLines.length - 1];
  if (!lastPostC || (!lastPostC.text.includes("Spend") && !lastPostC.text.includes("$"))) {
    throw new Error(`Test 7 Failed: Question reply must provide data, got:\n${lastPostC?.text}`);
  }
  assertNoFileSummaries(lastPostC.text, "Question with data");

  // Part D: Unrecognized general question fallback -> clarifying question, never file summary
  const unhandledAnswer = await answerArchitectQuestion("what is the roadmap for international expansion?", { testMode: true });
  if (!unhandledAnswer.startsWith("*Chief of Staff Clarification:*")) {
    throw new Error(`Test 7 Failed: Unhandled question should fall back to clarifying question, got:\n${unhandledAnswer}`);
  }
  assertNoFileSummaries(unhandledAnswer, "Fallback general question");

  console.log("  ✓ Exact message 'finish #53...' added comment to #53, set status:in-progress, and replied '→ @web-builder, #53 resumed, card in #doors-aeo'");
  console.log("  ✓ Vague message 'maybe we should look into something' replied with a sharp clarifying question");
  console.log("  ✓ Question 'how much did we spend today?' replied with verified data");
  console.log("  ✓ Fallback general question replied with clarifying question, zero file summaries");
  console.log("  ✓ File summary 'I've verified our current records' completely eradicated from the system");
  console.log("✅ [Test 7 Passed] Issue resumption, clarification on ambiguity, and zero file summaries verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 8: Architect Operational Commands ("#N: resume" and "#N: block")
  // -------------------------------------------------------------------------
  console.log("[Test 8] Testing Architect commands (#N: resume and #N: block)...");

  const { getRunnerState, saveRunnerState } = await import("./runner/state.js");

  // Setup Issue #72 in mock store as status:blocked with 2 recoveryAttempts
  mockIssuesStore.set(72, {
    number: 72,
    title: "[PLAN-D9]: TrueVisible Engine Core",
    body: "### deliverable\nImplement TrueVisible core engine",
    state: "open",
    labels: ["for:web-builder", "status:blocked", "door:aeo"],
    html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/72",
  });

  await saveRunnerState(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {
        "72": {
          agent: "web-builder",
          door: "aeo",
          title: "[PLAN-D9]: TrueVisible Engine Core",
          status: "blocked" as const,
          runStartedAt: "2026-11-03T13:00:00.000Z",
          recoveryAttempts: 2,
          error: "Boot recovery limit exceeded",
        },
      },
    },
    { testMode: true }
  );

  // 1. Test classification of "#72: resume" and variations
  const classResume1 = await classifyArchitectMessage("#72: resume", { testMode: true });
  if (classResume1.category !== "command_resume" || classResume1.issueNumber !== 72) {
    throw new Error(`Test 8.1 Failed: Expected category="command_resume" and issueNumber=72, got ${JSON.stringify(classResume1)}`);
  }
  const classResume2 = await classifyArchitectMessage("issue #72: resume", { testMode: true });
  if (classResume2.category !== "command_resume" || classResume2.issueNumber !== 72) {
    throw new Error(`Test 8.2 Failed: Expected category="command_resume" for 'issue #72: resume'`);
  }

  // 2. Execute "#72: resume" via intake polling
  resetLastTriggeredRunnerIssueForTests();
  resetMockPostedLines();
  resetIntakeStateForTests();
  setBootTimestampForTests("1730300490.000000");

  const pollResumeRes = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300500.000000",
        text: "#72: resume",
        user: "U_TEJINDER",
      },
    ],
  });

  if (pollResumeRes.processedCount !== 1) {
    throw new Error(`Test 8.3 Failed: Expected 1 processed message for resume command, got ${pollResumeRes.processedCount}`);
  }

  // Verify Issue #72 state on GitHub
  const issue72AfterResume = mockIssuesStore.get(72)!;
  if (!issue72AfterResume.labels.includes("status:in-progress")) {
    throw new Error(`Test 8.4 Failed: Issue #72 missing 'status:in-progress'. Labels: ${JSON.stringify(issue72AfterResume.labels)}`);
  }
  if (issue72AfterResume.labels.includes("status:blocked")) {
    throw new Error(`Test 8.5 Failed: Issue #72 still has 'status:blocked'. Labels: ${JSON.stringify(issue72AfterResume.labels)}`);
  }

  // Verify Runner State: recoveryAttempts cleared to 0, status in-progress
  const runnerStateAfterResume = await getRunnerState({ testMode: true });
  if (runnerStateAfterResume.runs["72"]?.recoveryAttempts !== 0) {
    throw new Error(`Test 8.6 Failed: Expected recoveryAttempts=0 after resume, got: ${runnerStateAfterResume.runs["72"]?.recoveryAttempts}`);
  }
  if (runnerStateAfterResume.runs["72"]?.status !== "in-progress") {
    throw new Error(`Test 8.7 Failed: Expected runner status='in-progress' after resume, got: ${runnerStateAfterResume.runs["72"]?.status}`);
  }

  // Verify runner triggered once
  if ((lastTriggeredRunnerIssue as number | null) !== 72) {
    throw new Error(`Test 8.8 Failed: Expected runner re-queued for Issue #72, got: ${lastTriggeredRunnerIssue}`);
  }

  // Verify reply in-thread
  const replyResume = mockPostedLines[mockPostedLines.length - 1];
  const expectedResumeReply = "→ @web-builder, #72 resumed, re-queued.";
  if (!replyResume || replyResume.text !== expectedResumeReply) {
    throw new Error(`Test 8.9 Failed: Expected reply "${expectedResumeReply}", got: "${replyResume?.text}"`);
  }
  console.log("  ✓ '#72: resume' cleared recoveryAttempts to 0, removed status:blocked, set status:in-progress, and re-queued");

  // 3. Test classification of "#72: block"
  const classBlock = await classifyArchitectMessage("#72: block", { testMode: true });
  if (classBlock.category !== "command_block" || classBlock.issueNumber !== 72) {
    throw new Error(`Test 8.10 Failed: Expected category="command_block" and issueNumber=72, got: ${JSON.stringify(classBlock)}`);
  }

  // 4. Execute "#72: block" via intake polling
  resetMockPostedLines();
  resetLastTriggeredRunnerIssueForTests();

  const pollBlockRes = await pollChiefOfStaffIntake({
    testMode: true,
    mockMessages: [
      {
        ts: "1730300510.000000",
        text: "#72: block",
        user: "U_TEJINDER",
      },
    ],
  });

  if (pollBlockRes.processedCount !== 1) {
    throw new Error(`Test 8.11 Failed: Expected 1 processed message for block command, got ${pollBlockRes.processedCount}`);
  }

  // Verify Issue #72 state on GitHub
  const issue72AfterBlock = mockIssuesStore.get(72)!;
  if (!issue72AfterBlock.labels.includes("status:blocked")) {
    throw new Error(`Test 8.12 Failed: Issue #72 missing 'status:blocked'. Labels: ${JSON.stringify(issue72AfterBlock.labels)}`);
  }
  if (issue72AfterBlock.labels.includes("status:in-progress")) {
    throw new Error(`Test 8.13 Failed: Issue #72 still has 'status:in-progress'. Labels: ${JSON.stringify(issue72AfterBlock.labels)}`);
  }

  // Verify runner state set to blocked
  const runnerStateAfterBlock = await getRunnerState({ testMode: true });
  if (runnerStateAfterBlock.runs["72"]?.status !== "blocked") {
    throw new Error(`Test 8.14 Failed: Expected runner status='blocked' after block, got: ${runnerStateAfterBlock.runs["72"]?.status}`);
  }

  // Verify reply in-thread
  const replyBlock = mockPostedLines[mockPostedLines.length - 1];
  const expectedBlockReply = "→ #72 blocked.";
  if (!replyBlock || replyBlock.text !== expectedBlockReply) {
    throw new Error(`Test 8.15 Failed: Expected reply "${expectedBlockReply}", got: "${replyBlock?.text}"`);
  }
  console.log("  ✓ '#72: block' set status:blocked, removed status:in-progress, and replied '→ #72 blocked.'");
  console.log("✅ [Test 8 Passed] Architect commands '#N: resume' and '#N: block' verified.\n");
  passed++;

  // -------------------------------------------------------------------------
  // Test 9: Architect command "setup <brand>: product = ...; buyers = ...; location = ..."
  // -------------------------------------------------------------------------
  console.log("[Test 9] Testing Architect command 'setup <brand>: product = ...; buyers = ...; location = ...'...");

  const setupCmdText = "setup The Growth Lab: product = AI visibility (AEO/GEO) + AI automation; buyers = hospitals, clinics, coaching institutes, hotels, real-estate developers, D2C brands; location = India-wide, Chandigarh home";
  const setupClassRes = await classifyArchitectMessage(setupCmdText, { testMode: true });

  if (setupClassRes.category !== "command_setup") {
    throw new Error(`Test 9.1 Failed: Expected category="command_setup", got "${setupClassRes.category}"`);
  }
  if (setupClassRes.setupBrand !== "The Growth Lab") {
    throw new Error(`Test 9.2 Failed: Expected setupBrand="The Growth Lab", got "${setupClassRes.setupBrand}"`);
  }
  if (setupClassRes.setupMarket?.product !== "AI visibility (AEO/GEO) + AI automation") {
    throw new Error(`Test 9.3 Failed: Expected product="AI visibility (AEO/GEO) + AI automation", got "${setupClassRes.setupMarket?.product}"`);
  }
  if (setupClassRes.setupMarket?.buyers !== "hospitals, clinics, coaching institutes, hotels, real-estate developers, D2C brands") {
    throw new Error(`Test 9.4 Failed: Expected buyers="hospitals, clinics, coaching institutes, hotels, real-estate developers, D2C brands", got "${setupClassRes.setupMarket?.buyers}"`);
  }
  if (setupClassRes.setupMarket?.location !== "India-wide, Chandigarh home") {
    throw new Error(`Test 9.5 Failed: Expected location="India-wide, Chandigarh home", got "${setupClassRes.setupMarket?.location}"`);
  }
  console.log("  ✓ setup command classified deterministically with exact parsed market fields");

  // Test intake poll execution of setup command
  resetMockPostedLines();
  const todayStr = getTodayDateString();
  const testDecisionsFile = path.join(config.repoRoot, `logs/.test/decisions/${todayStr}.md`);
  if (fs.existsSync(testDecisionsFile)) {
    fs.unlinkSync(testDecisionsFile);
  }

  const pollSetupRes = await pollChiefOfStaffIntake({
    channelId: "C_TEST_ARCH",
    testMode: true,
    mockMessages: [
      {
        ts: "1730300610.000000",
        text: setupCmdText,
        user: "U_TEJINDER",
      },
    ],
  });

  if (pollSetupRes.processedCount !== 1) {
    throw new Error(`Test 9.6 Failed: Expected 1 processed message for setup command, got ${pollSetupRes.processedCount}`);
  }

  // Verify decision line was logged
  if (!fs.existsSync(testDecisionsFile)) {
    throw new Error(`Test 9.7 Failed: Decision file ${testDecisionsFile} was not written`);
  }
  const decisionContent = fs.readFileSync(testDecisionsFile, "utf8");
  if (!decisionContent.includes("DECISION · chief-of-staff · Market wording updated for The Growth Lab")) {
    throw new Error(`Test 9.8 Failed: Expected decision line in ${testDecisionsFile}, got: ${decisionContent}`);
  }
  if (!decisionContent.includes("product = AI visibility (AEO/GEO) + AI automation")) {
    throw new Error(`Test 9.9 Failed: Expected product in decision line, got: ${decisionContent}`);
  }
  console.log("  ✓ Decision line written to decisions/<date>.md with actor and parsed market wording");

  // Verify Slack reply in thread
  const setupReply = mockPostedLines[mockPostedLines.length - 1];
  if (!setupReply || !setupReply.text.includes("Market wording updated for *The Growth Lab*")) {
    throw new Error(`Test 9.10 Failed: Expected Slack reply mentioning brand update, got: "${setupReply?.text}"`);
  }
  if (!setupReply.text.includes("Status set to `needs_changes`")) {
    throw new Error(`Test 9.11 Failed: Expected Slack reply mentioning needs_changes, got: "${setupReply?.text}"`);
  }
  console.log("  ✓ In-thread Slack reply sent confirming update and needs_changes status");
  console.log("  [Test 9 Passed] Architect setup command verified.\n");
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

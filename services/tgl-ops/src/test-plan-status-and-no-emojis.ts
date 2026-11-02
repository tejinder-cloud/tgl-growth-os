// services/tgl-ops/src/test-plan-status-and-no-emojis.ts
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import {
  answerArchitectQuestion,
  compileArchitectReport,
  pollChiefOfStaffIntake,
  resetIntakeStateForTests,
  setBootTimestampForTests,
  loadIntakeState,
  saveIntakeState,
} from "./agents/chief-of-staff/intake.js";
import {
  getPlanStatusAnswer,
  getPlanStatusFullReport,
  computePlanStatusBreakdown,
  type PlanEntry,
} from "./lib/plan.js";
import {
  setMockProspectRecordsForTests,
  getProspectMetricsFromSql,
  formatProspectCityCounts,
  formatProspectStatusCounts,
  formatProspectDayCounts,
  formatAllProspectCounts,
  type ProspectRecord,
} from "./agents/prospect-researcher/db.js";
import { compileMondayScorecard } from "./agents/chief-of-staff/scorecard.js";
import { execute1815SilenceCheck } from "./agents/chief-of-staff/worker.js";
import {
  postCard,
  postLine,
  buildCardBlocks,
  splitTextIntoChunks,
  setSimulatedPostLineFailureForTests,
} from "./lib/post.js";

// Comprehensive unicode emoji regex: pictographs, symbols, dingbats, checkmarks, etc.
const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/u;

function assertNoEmojis(text: string, context: string) {
  if (EMOJI_REGEX.test(text)) {
    const match = text.match(EMOJI_REGEX);
    throw new Error(`Emoji detected in ${context}: "${match ? match[0] : 'unknown'}"\nFull text:\n${text}`);
  }
}

function assertNoEmojisInBlocks(blocks: any[], context: string) {
  const serialized = JSON.stringify(blocks);
  if (EMOJI_REGEX.test(serialized)) {
    const match = serialized.match(EMOJI_REGEX);
    throw new Error(`Emoji detected in ${context} blocks: "${match ? match[0] : 'unknown'}"\nBlocks:\n${serialized}`);
  }
}

async function runPlanStatusAndNoEmojisSuite(): Promise<void> {
  console.log("==========================================================================");
  console.log("Plan Status Intake Q&A & Zero-Emoji Verification Suite");
  console.log("==========================================================================\n");

  let passed = 0;

  // Mock plan entries for deterministic status tests
  const mockPlanEntries: PlanEntry[] = [
    {
      day: 8,
      agent: "chief-of-staff",
      door: "core",
      title: "Sprint Kickoff & Setup",
      brief: "Initialize ops harness",
      definition_of_done: ["Kickoff complete"],
      depends_on: [],
      architect_hour: "09:00",
    },
    {
      day: 9,
      agent: "architect-sprint",
      door: "truevisible",
      title: "truevisible-app setup",
      brief: "Repo & skeleton",
      definition_of_done: ["Skeleton app"],
      depends_on: [8],
      architect_hour: "09:00",
    },
    {
      day: 10,
      agent: "web-builder",
      door: "core",
      title: "Brand Brief Updates",
      brief: "Fix tokens",
      definition_of_done: ["Tokens verified"],
      depends_on: [9],
      architect_hour: "09:00",
    },
    {
      day: 11,
      agent: "ads-analyst",
      door: "aeo",
      title: "Rahul Meta Ads Launch",
      brief: "Launch /aeo audit campaign",
      definition_of_done: ["Campaign live"],
      depends_on: [10],
      architect_hour: "09:00",
    },
  ];

  const mockIssues = [
    {
      number: 100,
      title: "[PLAN-D8] Sprint Kickoff & Setup",
      state: "closed",
    },
    {
      number: 101,
      title: "[PLAN-D9] truevisible-app setup",
      state: "open",
    },
  ];

  // -------------------------------------------------------------------------
  // Test 1: Plan status question phrasing 1:
  // "which plan days are completed, open, and not started?"
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing phrasing 1: 'which plan days are completed, open, and not started?'...");

  const ans1 = await answerArchitectQuestion(
    "which plan days are completed, open, and not started?",
    {
      testMode: true,
      mockPlanEntries,
      mockIssues,
      mockCurrentDay: 9,
    }
  );

  console.log("Answer 1 Output:\n" + ans1 + "\n");

  if (!ans1.includes("*Plan Status (Current Day: Day 9)*")) {
    throw new Error(`Test 1 Failed: Missing header with current day in answer: ${ans1}`);
  }
  if (!ans1.includes("• *Completed:* 1 day (Day 8)")) {
    throw new Error(`Test 1 Failed: Expected Completed Day 8 summary, got: ${ans1}`);
  }
  if (!ans1.includes("• *Open:* 1 day (Day 9)")) {
    throw new Error(`Test 1 Failed: Expected Open Day 9 summary, got: ${ans1}`);
  }
  if (!ans1.includes("• *Not Started:* 2 days")) {
    throw new Error(`Test 1 Failed: Expected Not Started 2 days summary, got: ${ans1}`);
  }
  if (!ans1.includes("• *Day 9:* open (issue open) — truevisible-app setup (#101)")) {
    throw new Error(`Test 1 Failed: Expected Day 9 open line in Open Issues by Day, got: ${ans1}`);
  }
  if (!ans1.includes("• *Day 10:* not started (no issue) — Brand Brief Updates")) {
    throw new Error(`Test 1 Failed: Expected Day 10 in next not-started days, got: ${ans1}`);
  }
  if (!ans1.includes("• *Day 11:* not started (no issue) — Rahul Meta Ads Launch")) {
    throw new Error(`Test 1 Failed: Expected Day 11 in next not-started days, got: ${ans1}`);
  }
  if (ans1.includes("Fit Score") || ans1.includes("Prospect Database") || ans1.includes("reviewed")) {
    throw new Error(`Test 1 Failed: Intake routed to prospect database instead of plan status!`);
  }

  assertNoEmojis(ans1, "Test 1 answer text");
  passed++;
  console.log("  Passed: Plan status correctly answered with summary breakdown.\n");

  // -------------------------------------------------------------------------
  // Test 2: Plan status question phrasing 2:
  // "what's today's status"
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing phrasing 2: \"what's today's status\" and variants...");

  const ans2 = await answerArchitectQuestion(
    "what's today's status",
    {
      testMode: true,
      mockPlanEntries,
      mockIssues,
      mockCurrentDay: 9,
    }
  );

  console.log("Answer 2 Output:\n" + ans2 + "\n");

  if (!ans2.includes("*Plan Status (Current Day: Day 9)*")) {
    throw new Error(`Test 2 Failed: \"what's today's status\" did not return plan status header: ${ans2}`);
  }
  if (!ans2.includes("• *Completed:* 1 day (Day 8)")) {
    throw new Error(`Test 2 Failed: Missing completed day in \"what's today's status\": ${ans2}`);
  }

  // Also test variant "what is today's status"
  const ans2b = await answerArchitectQuestion(
    "what is today's status",
    {
      testMode: true,
      mockPlanEntries,
      mockIssues,
      mockCurrentDay: 9,
    }
  );
  if (!ans2b.includes("*Plan Status (Current Day: Day 9)*")) {
    throw new Error(`Test 2 Failed: \"what is today's status\" did not return plan status header: ${ans2b}`);
  }

  assertNoEmojis(ans2, "Test 2 answer text");
  assertNoEmojis(ans2b, "Test 2b answer text");
  passed++;
  console.log("  Passed: \"what's today's status\" routes to plan status data.\n");

  // -------------------------------------------------------------------------
  // Test 3: Plan routing keywords ("plan", "day N", "phase", "gate") vs prospects
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing routing keywords ('plan', 'day N', 'phase', 'gate') vs prospects routing...");

  // Setup mock prospects
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
      company: "Care Dental",
      category: "cosmetic_dental",
      city: "Delhi NCR",
      website: "https://caredental.in",
      door: "aeo",
      fit_score: 85,
      fit_reasons: ["Strong local presence"],
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
      fit_reasons: ["Competitive queries"],
      decision_maker: defaultDm,
      signals: defaultSignals,
      status: "new",
      source_refs: ["https://cityeyecentre.in"],
      created_at: "2026-10-29T10:00:00.000Z",
      rescored_at: "2026-10-29T10:00:00.000Z",
    },
  ];
  setMockProspectRecordsForTests(mockProspects);

  // Queries that MUST route to plan status
  const planQueries = [
    "what is the plan?",
    "show plan status",
    "what about day 10?",
    "day 8 status",
    "current phase",
    "what gate are we on?",
    "gate 2 progress",
  ];

  for (const pq of planQueries) {
    const res = await answerArchitectQuestion(pq, {
      testMode: true,
      mockPlanEntries,
      mockIssues,
      mockCurrentDay: 9,
    });
    if (!res.includes("*Plan Status") && !res.includes("• *Day")) {
      throw new Error(`Test 3 Failed: Query "${pq}" failed to route to plan status. Got:\n${res}`);
    }
    if (res.includes("Care Dental") || res.includes("Fit Score")) {
      throw new Error(`Test 3 Failed: Query "${pq}" incorrectly routed to prospect database!`);
    }
  }

  // Queries that MUST route to prospect database
  const prospectQueries = [
    "prospects count by city",
    "prospects by day",
    "counts by day",
    "how many prospects in Delhi NCR",
    "prospect status breakdown",
  ];

  for (const prq of prospectQueries) {
    const res = await answerArchitectQuestion(prq, { testMode: true });
    if (res.includes("*Plan Status")) {
      throw new Error(`Test 3 Failed: Prospect query "${prq}" incorrectly routed to plan status!`);
    }
    if (!res.includes("Prospect") && !res.includes("Accounts") && !res.includes("Delhi NCR") && !res.includes("reviewed")) {
      throw new Error(`Test 3 Failed: Prospect query "${prq}" did not return prospect metrics. Got:\n${res}`);
    }
  }

  passed++;
  console.log("  Passed: Routing correctly separates plan queries from prospect queries.\n");

  // -------------------------------------------------------------------------
  // Test 4: Real config/plan.yaml integration
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing plan status loading against real config/plan.yaml on disk...");

  const realPlanStatus = await getPlanStatusAnswer({ testMode: true });
  console.log("Real Plan Status Summary Preview:\n" + realPlanStatus.split("\n").slice(0, 10).join("\n") + "\n...\n");

  if (!realPlanStatus.includes("*Plan Status")) {
    throw new Error(`Test 4 Failed: getPlanStatusAnswer did not load real plan status`);
  }
  if (!realPlanStatus.includes("• *Day 8:*") || !realPlanStatus.includes("• *Day 9:*")) {
    throw new Error(`Test 4 Failed: Expected Day 8 and Day 9 in real plan status`);
  }

  assertNoEmojis(realPlanStatus, "Real plan status output");
  passed++;
  console.log("  Passed: Real config/plan.yaml verified.\n");

  // -------------------------------------------------------------------------
  // Test 5: Full 61-Day Plan Test with Summary & File Attachment
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing 61-day plan status answer (summary < 2900 chars + file attachment via postFile)...");

  // Construct a realistic 61-day plan
  const mock61DayPlan: PlanEntry[] = [];
  for (let d = 1; d <= 61; d++) {
    mock61DayPlan.push({
      day: d,
      agent: d % 2 === 0 ? "web-builder" : "chief-of-staff",
      door: "core",
      title: `Sprint Deliverable Milestone for Plan Day ${d}`,
      brief: `Detailed task execution specification for Day ${d}`,
      definition_of_done: [`Day ${d} task verified`],
      depends_on: d > 1 ? [d - 1] : [],
      architect_hour: "09:00",
    });
  }

  // Days 1–8: completed (closed issues)
  // Day 9: open (open issue)
  // Days 10–61: not started
  const mock61Issues: any[] = [];
  for (let d = 1; d <= 8; d++) {
    mock61Issues.push({
      number: 100 + d,
      title: `[PLAN-D${d}] Sprint Deliverable Milestone for Plan Day ${d}`,
      state: "closed",
    });
  }
  mock61Issues.push({
    number: 109,
    title: `[PLAN-D9] Sprint Deliverable Milestone for Plan Day 9`,
    state: "open",
  });

  const plan61Answer = await answerArchitectQuestion(
    "which plan days are completed, open, and not started?",
    {
      testMode: true,
      mockPlanEntries: mock61DayPlan,
      mockIssues: mock61Issues,
      mockCurrentDay: 9,
      channel: "C_ARCHITECT",
      thread_ts: "1730554680.000100",
    }
  );

  console.log("61-Day Plan Status Answer:\n" + plan61Answer + "\n");
  console.log(`Answer character length: ${plan61Answer.length} chars (must be << 2,900 chars)`);

  // Verify character length is strictly under 2,900 chars (and under 1,500 chars)
  if (plan61Answer.length >= 2900) {
    throw new Error(`Test 5 Failed: 61-day plan status answer is ${plan61Answer.length} chars, exceeds 2,900 cap!`);
  }
  if (!plan61Answer.includes("*Plan Status (Current Day: Day 9)*")) {
    throw new Error("Test 5 Failed: Missing current day in 61-day plan answer");
  }
  if (!plan61Answer.includes("• *Completed:* 8 days")) {
    throw new Error(`Test 5 Failed: Expected 8 completed days, got: ${plan61Answer}`);
  }
  if (!plan61Answer.includes("• *Open:* 1 day (Day 9)")) {
    throw new Error(`Test 5 Failed: Expected 1 open day (Day 9), got: ${plan61Answer}`);
  }
  if (!plan61Answer.includes("• *Not Started:* 52 days")) {
    throw new Error(`Test 5 Failed: Expected 52 not-started days, got: ${plan61Answer}`);
  }
  if (!plan61Answer.includes("• *Total Plan Days:* 61")) {
    throw new Error(`Test 5 Failed: Expected Total Plan Days 61, got: ${plan61Answer}`);
  }
  if (!plan61Answer.includes("• *Day 9:* open (issue open) — Sprint Deliverable Milestone for Plan Day 9 (#109)")) {
    throw new Error(`Test 5 Failed: Expected Day 9 in Open Issues by Day`);
  }
  // Next 5 not-started days
  for (let d = 10; d <= 14; d++) {
    if (!plan61Answer.includes(`• *Day ${d}:* not started (no issue) — Sprint Deliverable Milestone for Plan Day ${d}`)) {
      throw new Error(`Test 5 Failed: Missing Day ${d} in Next 5 Not-Started Days`);
    }
  }
  if (!plan61Answer.includes("_(+47 more not-started days in attached complete plan)_")) {
    throw new Error("Test 5 Failed: Missing remaining not-started days note");
  }

  // Verify full per-day report contains all 61 days
  const fullReport = await getPlanStatusFullReport({
    testMode: true,
    mockPlanEntries: mock61DayPlan,
    mockIssues: mock61Issues,
    mockCurrentDay: 9,
  });
  for (let d = 1; d <= 61; d++) {
    if (!fullReport.includes(`• *Day ${d}:*`)) {
      throw new Error(`Test 5 Failed: Full report missing Day ${d}`);
    }
  }

  assertNoEmojis(plan61Answer, "61-day plan summary answer");
  assertNoEmojis(fullReport, "61-day plan full report");
  passed++;
  console.log("  Passed: 61-day plan summary is well under cap and includes all required summary fields.\n");

  // -------------------------------------------------------------------------
  // Test 6: Text splitting over 2,900 chars in postLine and postCard
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing automatic text splitting over 2,900 chars for postLine and postCard...");

  const longText = Array.from({ length: 15 }, (_, i) => `Paragraph ${i + 1}: ` + "This is a long sentence ensuring we exceed the limit. ".repeat(15)).join("\n\n");
  console.log(`Generated sample longText: ${longText.length} characters`);

  const chunks = splitTextIntoChunks(longText, 2900);
  console.log(`Split into ${chunks.length} chunks.`);

  for (let idx = 0; idx < chunks.length; idx++) {
    const c = chunks[idx];
    if (c.length > 2900) {
      throw new Error(`Test 6 Failed: Chunk ${idx} exceeds 2900 chars: ${c.length} chars!`);
    }
  }

  // Test postLine with longText
  const postLineRes = await postLine({
    channel: "C_TEST",
    text: longText,
  });
  if (!postLineRes.ok) {
    throw new Error(`Test 6 Failed: postLine failed on longText: ${postLineRes.error}`);
  }

  // Test buildCardBlocks with long summary
  const longCardBlocks = buildCardBlocks({
    channel: "C_TEST",
    agent: "web-builder",
    title: "Card with Massive Summary",
    summary: longText,
  });

  for (const block of longCardBlocks) {
    if (block.type === "section" && block.text?.text) {
      if (block.text.text.length > 2900) {
        throw new Error(`Test 6 Failed: Section block text exceeds 2900 chars: ${block.text.text.length}`);
      }
    }
  }

  const postCardRes = await postCard({
    channel: "C_TEST",
    agent: "web-builder",
    title: "Card with Massive Summary",
    summary: longText,
  });
  if (!postCardRes.ok) {
    throw new Error(`Test 6 Failed: postCard failed on longText: ${postCardRes.error}`);
  }

  passed++;
  console.log("  Passed: postLine and postCard automatically split text over 2,900 chars into multiple blocks.\n");

  // -------------------------------------------------------------------------
  // Test 7: Intake Reply Failure Retry Limit & One-Line Error Fallback
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing intake reply failure retry limit (marked processed after 2nd attempt, one-line error posted)...");

  resetIntakeStateForTests();
  const testChannel = "C_ARCHITECT_TEST";
  const origArchitectChannel = config.architectChannelId;
  config.architectChannelId = testChannel;
  setBootTimestampForTests("1730554600.000000");

  const failingMsgTs = "1730554680.000100";
  const msgKey = `${testChannel}:${failingMsgTs}`;
  const mockIncomingMsg = {
    ts: failingMsgTs,
    user: "U_ARCHITECT",
    text: "what is the status of our marketing campaign?",
  };

  try {
    // Attempt 1: simulate postLine failure
    setSimulatedPostLineFailureForTests("Slack API invalid_blocks");

    const pollRes1 = await pollChiefOfStaffIntake({
      testMode: true,
      mockMessages: [mockIncomingMsg],
    });

    console.log(`Poll 1 result: processedCount=${pollRes1.processedCount}`);
    const stateAfterPoll1 = loadIntakeState(true);

    if (pollRes1.processedCount !== 0) {
      throw new Error(`Test 7 Failed: Attempt 1 should not increment processedCount, got ${pollRes1.processedCount}`);
    }
    if (stateAfterPoll1.failedAttemptsByMessageKey?.[msgKey] !== 1) {
      throw new Error(`Test 7 Failed: Expected failedAttempts=1 for ${msgKey}, got ${stateAfterPoll1.failedAttemptsByMessageKey?.[msgKey]}`);
    }
    if (stateAfterPoll1.lastProcessedTsByChannel[testChannel] === failingMsgTs) {
      throw new Error("Test 7 Failed: lastProcessedTsByChannel should not advance to failing message on attempt 1");
    }

    // Attempt 2: still failing postLine
    const pollRes2 = await pollChiefOfStaffIntake({
      testMode: true,
      mockMessages: [mockIncomingMsg],
    });

    console.log(`Poll 2 result: processedCount=${pollRes2.processedCount}`);
    const stateAfterPoll2 = loadIntakeState(true);

    if (pollRes2.processedCount !== 1) {
      throw new Error(`Test 7 Failed: Attempt 2 should mark processedCount=1, got ${pollRes2.processedCount}`);
    }
    if (stateAfterPoll2.lastProcessedTsByChannel[testChannel] !== failingMsgTs) {
      throw new Error(`Test 7 Failed: Message was not marked processed after reaching attempt 2 limit: ${stateAfterPoll2.lastProcessedTsByChannel[testChannel]}`);
    }
    if (stateAfterPoll2.failedAttemptsByMessageKey?.[msgKey] !== undefined) {
      throw new Error(`Test 7 Failed: failedAttemptsByMessageKey for ${msgKey} was not cleared after marking processed`);
    }

    // Attempt 3 (subsequent poll): clear simulated failure and poll again
    setSimulatedPostLineFailureForTests(null);

    const pollRes3 = await pollChiefOfStaffIntake({
      testMode: true,
      mockMessages: [mockIncomingMsg],
    });

    if (pollRes3.processedCount !== 0) {
      throw new Error(`Test 7 Failed: Processed count should be 0 on subsequent poll, got ${pollRes3.processedCount}`);
    }

    passed++;
    console.log("  Passed: Message marked processed after 2 attempts with one-line error fallback, never retried indefinitely.\n");
  } finally {
    setSimulatedPostLineFailureForTests(null);
    config.architectChannelId = origArchitectChannel;
  }

  // -------------------------------------------------------------------------
  // Test 8: Zero Emojis in Slack Payload Builders (Runtime)
  // -------------------------------------------------------------------------
  console.log("[Test 8] Scanning Slack payload builders for emoji characters at runtime...");

  // 1. buildCardBlocks builder
  const cardBlocks = buildCardBlocks({
    channel: "C_TEST",
    agent: "web-builder",
    door: "core",
    title: "Review Proposal for Day 10",
    summary: "Refactored token definitions across components.",
    actions: ["approve", "reject", "discuss"],
    issue: 102,
  });
  assertNoEmojisInBlocks(cardBlocks, "buildCardBlocks");

  // 2. postCard call
  const testCardRes = await postCard({
    channel: "C_TEST",
    agent: "web-builder",
    title: "Task Card Test",
    summary: "Summary of changes.",
  });
  if (!testCardRes.ok) {
    throw new Error("postCard dry run failed");
  }

  // 3. postLine call
  const lineText = "*The Growth Lab Ops Report:*\n• Total spend today: $0.12\n• Active tasks: 2";
  assertNoEmojis(lineText, "postLine input text");

  // 4. compileArchitectReport
  const archReport = await compileArchitectReport({ testMode: true });
  assertNoEmojis(archReport, "compileArchitectReport");

  // 5. compileMondayScorecard
  const scorecardDigest = await compileMondayScorecard();
  assertNoEmojis(scorecardDigest, "compileMondayScorecard");

  // 6. execute1815SilenceCheck
  const silenceCheck = await execute1815SilenceCheck("2026-11-02", { testMode: true });
  if (silenceCheck.silentAgents.length > 0) {
    for (const ag of silenceCheck.silentAgents) {
      assertNoEmojis(ag, "execute1815SilenceCheck agent name");
    }
  }

  // 7. Prospect count formatters
  const metrics = await getProspectMetricsFromSql({ testMode: true });
  assertNoEmojis(formatProspectCityCounts(metrics), "formatProspectCityCounts");
  assertNoEmojis(formatProspectStatusCounts(metrics), "formatProspectStatusCounts");
  assertNoEmojis(formatProspectDayCounts(metrics), "formatProspectDayCounts");
  assertNoEmojis(formatAllProspectCounts(metrics), "formatAllProspectCounts");

  passed++;
  console.log("  Passed: All Slack payload builders verified 100% emoji-free at runtime.\n");

  // -------------------------------------------------------------------------
  // Test 9: Zero Emojis in Source Code (Static Scan)
  // -------------------------------------------------------------------------
  console.log("[Test 9] Static scan of all TypeScript source files under services/tgl-ops/src...");

  function walkAndScan(dir: string): { file: string; line: number; text: string }[] {
    const hits: { file: string; line: number; text: string }[] = [];
    const entries = fs.readdirSync(dir);
    for (const ent of entries) {
      const full = path.join(dir, ent);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        hits.push(...walkAndScan(full));
      } else if (ent.endsWith(".ts") && !ent.startsWith("test-")) {
        const content = fs.readFileSync(full, "utf8");
        const lines = content.split("\n");
        lines.forEach((lineText, idx) => {
          if (EMOJI_REGEX.test(lineText)) {
            hits.push({ file: full, line: idx + 1, text: lineText });
          }
        });
      }
    }
    return hits;
  }

  const srcDir = path.join(config.repoRoot, "services/tgl-ops/src");
  const emojiHits = walkAndScan(srcDir);

  if (emojiHits.length > 0) {
    console.error(`Found ${emojiHits.length} emoji occurrences in source files:`);
    for (const h of emojiHits) {
      console.error(`  ${path.relative(config.repoRoot, h.file)}:${h.line}: ${h.text}`);
    }
    throw new Error(`Test 9 Failed: Source code contains ${emojiHits.length} emojis!`);
  }

  passed++;
  console.log(`  Passed: All source files in services/tgl-ops/src are 100% emoji-free.\n`);

  // -------------------------------------------------------------------------
  // Test 10: AGENTS.md Standard Check
  // -------------------------------------------------------------------------
  console.log("[Test 10] Checking AGENTS.md standards and 'What you never do'...");

  const agentsMdPath = path.join(config.repoRoot, "AGENTS.md");
  const agentsMdContent = fs.readFileSync(agentsMdPath, "utf8");

  if (!agentsMdContent.includes("- **No emojis:** no emojis anywhere the service writes — Slack messages, cards, digests, scorecards, intake replies, issue comments, decision lines. Plain text and bold only.")) {
    throw new Error("Test 10 Failed: AGENTS.md missing '- **No emojis:**' standard rule!");
  }
  if (!agentsMdContent.includes("Use emojis anywhere the service writes.")) {
    throw new Error("Test 10 Failed: AGENTS.md 'What you never do' missing 'Use emojis anywhere the service writes.'!");
  }

  passed++;
  console.log("  Passed: AGENTS.md contains explicit No Emojis standard and never-do rule.\n");

  console.log("==========================================================================");
  console.log(`ALL ${passed} VERIFICATION SUITES PASSED CLEANLY!`);
  console.log("==========================================================================");
}

runPlanStatusAndNoEmojisSuite().catch((err) => {
  console.error("\nVerification Failed:", err);
  process.exit(1);
});

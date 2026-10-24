import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  execute1750Gather,
  execute1815SilenceCheck,
  handleArchitectStandupReply,
  pollStandupReplies,
} from "./agents/chief-of-staff/worker.js";
import { compileMondayScorecard } from "./agents/chief-of-staff/scorecard.js";
import { postLine } from "./lib/post.js";
import { getCurrentTimeIST, getTodayDateString } from "./lib/standup.js";

// Set Test Mode: Tests never write to decisions/ or logs/ on main
process.env.TGL_TEST_MODE = "1";

async function runDay04Tests(): Promise<void> {
  console.log("=== TGL Ops DAY 4 (TASK-P04: Chief of Staff) Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);

  const today = getTodayDateString();
  const testDir = path.join(config.repoRoot, "logs/.test");

  // Pre-test cleanup of test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // 1. Run 17:50 Gather + Anthropic Call against today's real logs -> post to #ops
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Running 17:50 Gather + Synthesis against today's real logs...");
    const targetChannel = config.opsChannelId || "#ops";

    const result = await execute1750Gather(today, targetChannel, { testMode: true });

    console.log("\n--- Generated Standup Digest (posted to #ops) ---");
    console.log(result.digestText);
    console.log("-------------------------------------------------");

    const lineCount = result.digestText.split("\n").length;
    console.log(`Line count: ${lineCount} lines (Hard cap: <= 25 lines)`);
    if (lineCount > 25) {
      throw new Error(`Digest exceeded 25-line hard cap! Got ${lineCount} lines.`);
    }

    console.log(`\nModel: ${result.synthesis.model}`);
    console.log(`Tokens: ${result.synthesis.inputTokens} input / ${result.synthesis.outputTokens} output`);
    console.log(`Total Token Cost: $${result.synthesis.totalCostUsd.toFixed(4)} USD`);
    console.log(`Cost logged locally to logs/.test/chief-of-staff.md: ${result.synthesis.loggedCost}`);

    if (!result.synthesis.model.includes("sonnet")) {
      throw new Error(`Expected Sonnet model, got: ${result.synthesis.model}`);
    }

    console.log(`✅ [Test 1 Passed] 17:50 gather + Anthropic synthesis executed with current Sonnet model (${result.synthesis.model}), logged locally to logs/.test/, and posted to ${targetChannel}.`);

    // -------------------------------------------------------------------------
    // 2. Test Monday 09:00 IST Scorecard Compilation
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Testing Monday 09:00 IST Scorecard compilation...");
    const scorecardText = await compileMondayScorecard();

    console.log("\n--- Monday Scorecard Preview ---");
    console.log(scorecardText);
    console.log("--------------------------------");

    if (!scorecardText.includes("—")) {
      throw new Error("Scorecard must represent unpopulated metrics strictly as '—' (dash).");
    }
    if (!scorecardText.includes("AEO") || !scorecardText.includes("AI") || !scorecardText.includes("TrueLead")) {
      throw new Error("Scorecard must cover all active doors (AEO, AI, TrueLead).");
    }

    // Post to #ops per test hygiene rule
    await postLine({
      channel: targetChannel,
      text: `[TEST type:test] Monday Scorecard Preview:\n${scorecardText}`,
    });
    console.log(`✅ [Test 2 Passed] Monday Scorecard formatted with blanks as '—' and verified.`);

    // -------------------------------------------------------------------------
    // 3. Test 18:15 IST Silence Check Logic (Active Agents Only)
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Testing 18:15 IST Silence check logic (flags active only)...");
    const silenceResult = await execute1815SilenceCheck(today, undefined, targetChannel);
    console.log(`Silent active agents identified: ${silenceResult.silentAgents.join(", ") || "none"}`);
    console.log(`Silence notices dispatched to ${targetChannel}: ${silenceResult.postedCount}`);

    // Since only chief-of-staff and web-builder are active, and both logged today, silentAgents should be empty
    if (silenceResult.silentAgents.includes("prospect-researcher") || silenceResult.silentAgents.includes("sales-desk")) {
      throw new Error("Planned agents must NOT be flagged by the silence check! Only status: active.");
    }
    console.log(`✅ [Test 3 Passed] 18:15 silence check executed; correctly restricted to active agents only.`);

    // -------------------------------------------------------------------------
    // 4. Test Architect In-Thread Reply Decision Capture & Deduplication (logs/.test/)
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Testing Architect in-thread reply capture & deduplication (mocked to logs/.test/)...");
    const testDecisionTs = `test-ts-${Date.now()}.001`;

    // 4a. Decision reply
    const decisionReplyResult = await handleArchitectStandupReply(
      {
        text: "Decision: Approved revised CTA copy for mobile",
        user: { name: "falkanmedia", username: "falkanmedia" },
        thread_ts: "1792835532.000100",
        ts: testDecisionTs,
        channel: config.standupChannelId,
      },
      { testMode: true }
    );

    if (!decisionReplyResult.handled || decisionReplyResult.action !== "decision") {
      throw new Error(`Expected decision reply to be captured as decision, got: ${JSON.stringify(decisionReplyResult)}`);
    }
    if (!decisionReplyResult.path?.includes("logs/.test/")) {
      throw new Error(`Test must write to logs/.test/, got: ${decisionReplyResult.path}`);
    }
    console.log(`✅ [Test 4a Passed] Architect 'Decision:' message captured to test path ${decisionReplyResult.path}`);

    // 4b. Deduplication: replay the same reply ts
    const duplicateReplyResult = await handleArchitectStandupReply(
      {
        text: "Decision: Approved revised CTA copy for mobile",
        user: { name: "falkanmedia", username: "falkanmedia" },
        thread_ts: "1792835532.000100",
        ts: testDecisionTs,
        channel: config.standupChannelId,
      },
      { testMode: true }
    );

    if (duplicateReplyResult.handled || !duplicateReplyResult.alreadyProcessed) {
      throw new Error(`Expected duplicate reply ts ${testDecisionTs} to be skipped, got: ${JSON.stringify(duplicateReplyResult)}`);
    }
    console.log(`✅ [Test 4b Passed] Duplicate Architect reply ${testDecisionTs} successfully deduplicated.`);

    // 4c. Non-decision comment reply
    const testCommentTs = `test-ts-${Date.now()}.002`;
    const commentReplyResult = await handleArchitectStandupReply(
      {
        text: "Great progress on the plumbing today. Keep moving forward.",
        user: { name: "falkanmedia", username: "falkanmedia" },
        thread_ts: "1792835532.000100",
        ts: testCommentTs,
        channel: config.standupChannelId,
      },
      { testMode: true }
    );

    if (!commentReplyResult.handled || commentReplyResult.action !== "log") {
      throw new Error(`Expected comment reply to be captured as log, got: ${JSON.stringify(commentReplyResult)}`);
    }
    if (!commentReplyResult.path?.includes("logs/.test/")) {
      throw new Error(`Test must write to logs/.test/, got: ${commentReplyResult.path}`);
    }
    console.log(`✅ [Test 4c Passed] Architect regular comment captured to test path ${commentReplyResult.path}`);

    // -------------------------------------------------------------------------
    // 5. Test Poll Standup Replies Function
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Testing pollStandupReplies execution...");
    const pollResult = await pollStandupReplies({
      channel: config.opsChannelId,
      standupTs: "1792835532.000100",
      testMode: true,
    });
    console.log(`Poll result: polled=${pollResult.polled}, repliesFound=${pollResult.repliesFound}, newProcessed=${pollResult.newProcessedCount}`);
    console.log(`✅ [Test 5 Passed] pollStandupReplies executed cleanly.`);

  } finally {
    // Teardown: Clean up logs/.test/ completely
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
      console.log(`\n🧹 [Teardown] Successfully purged logs/.test/ directory.`);
    }
  }

  console.log("\n=== All DAY 4 (TASK-P04: Chief of Staff) Tests Passed Cleanly ===");
}

runDay04Tests().catch((err) => {
  console.error("Day 4 Test Suite Failed:", err);
  process.exit(1);
});

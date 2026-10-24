import { config } from "./config.js";
import { execute1750Gather, execute1815SilenceCheck, handleArchitectStandupReply } from "./agents/chief-of-staff/worker.js";
import { compileMondayScorecard } from "./agents/chief-of-staff/scorecard.js";
import { postLine } from "./lib/post.js";
import { getCurrentTimeIST, getTodayDateString } from "./lib/standup.js";

async function runDay04Tests(): Promise<void> {
  console.log("=== TGL Ops DAY 4 (TASK-P04: Chief of Staff) Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);

  const today = getTodayDateString();

  // -------------------------------------------------------------------------
  // 1. Run 17:50 Gather + Anthropic Call against today's real logs -> post to #ops
  // -------------------------------------------------------------------------
  console.log("\n[Test 1] Running 17:50 Gather + Synthesis against today's real logs...");
  const targetChannel = config.opsChannelId || "#ops";

  const result = await execute1750Gather(today, targetChannel);

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
  console.log(`Cost logged to logs/${today}/chief-of-staff.md: ${result.synthesis.loggedCost}`);

  console.log(`✅ [Test 1 Passed] 17:50 gather + Anthropic synthesis executed, logged, and posted to ${targetChannel}.`);

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
  // 3. Test 18:15 IST Silence Check Logic
  // -------------------------------------------------------------------------
  console.log("\n[Test 3] Testing 18:15 IST Silence check logic...");
  const silenceResult = await execute1815SilenceCheck(today, undefined, targetChannel);
  console.log(`Silent agents identified: ${silenceResult.silentAgents.join(", ")}`);
  console.log(`Silence notices dispatched to ${targetChannel}: ${silenceResult.postedCount}`);

  if (silenceResult.silentAgents.length === 0) {
    console.log("Note: All active agents logged today or none marked silent.");
  }
  console.log(`✅ [Test 3 Passed] 18:15 silence check executed.`);

  // -------------------------------------------------------------------------
  // 4. Test Architect In-Thread Reply Decision Capture
  // -------------------------------------------------------------------------
  console.log("\n[Test 4] Testing Architect in-thread reply capture...");
  // 4a. Decision reply
  const decisionReplyResult = await handleArchitectStandupReply({
    text: "Decision: Approved revised CTA copy for mobile",
    user: { name: "falkanmedia", username: "falkanmedia" },
    thread_ts: "1792835532.000100",
    channel: config.standupChannelId,
  });

  if (!decisionReplyResult.handled || decisionReplyResult.action !== "decision") {
    throw new Error(`Expected decision reply to be captured as decision, got: ${JSON.stringify(decisionReplyResult)}`);
  }
  console.log(`✅ [Test 4a Passed] Architect 'Decision:' message captured to ${decisionReplyResult.path}`);

  // 4b. Non-decision comment reply
  const commentReplyResult = await handleArchitectStandupReply({
    text: "Great progress on the plumbing today. Keep moving forward.",
    user: { name: "falkanmedia", username: "falkanmedia" },
    thread_ts: "1792835532.000100",
    channel: config.standupChannelId,
  });

  if (!commentReplyResult.handled || commentReplyResult.action !== "log") {
    throw new Error(`Expected comment reply to be captured as log, got: ${JSON.stringify(commentReplyResult)}`);
  }
  console.log(`✅ [Test 4b Passed] Architect regular comment captured to ${commentReplyResult.path}`);

  console.log("\n=== All DAY 4 (TASK-P04: Chief of Staff) Tests Passed Cleanly ===");
}

runDay04Tests().catch((err) => {
  console.error("Day 4 Test Suite Failed:", err);
  process.exit(1);
});

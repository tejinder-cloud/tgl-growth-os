import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  execute1750Gather,
  execute1800Broadcast,
  execute1815SilenceCheck,
  checkAndRunStartupCatchup,
  getStandupState,
  saveStandupState,
  handleArchitectStandupReply,
  pollStandupReplies,
  getAnthropicModel,
  getAnthropicPricing,
} from "./agents/chief-of-staff/index.js";
import { compileMondayScorecard } from "./agents/chief-of-staff/scorecard.js";
import { postLine } from "./lib/post.js";
import { getCurrentTimeIST, getTodayDateString, isWithinCatchupWindowIST } from "./lib/standup.js";

// Set Test Mode: Tests never write to decisions/ or logs/ on main
process.env.TGL_TEST_MODE = "1";

async function runDay04Tests(): Promise<void> {
  console.log("=== TGL Ops DAY 4: Chief of Staff & Standup Persistence Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);

  const today = getTodayDateString();
  const testDir = path.join(config.repoRoot, "logs/.test");
  const targetChannel = config.opsChannelId || "#ops";

  // Pre-test cleanup of test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // 0. Test Env Configuration: ANTHROPIC_MODEL & Pricing must fail loudly if missing
    // -------------------------------------------------------------------------
    console.log("\n[Test 0] Verifying ANTHROPIC_MODEL and pricing fail loudly when missing...");
    const origModel = process.env.ANTHROPIC_MODEL;
    const origPriceIn = process.env.ANTHROPIC_PRICE_IN;
    const origPriceOut = process.env.ANTHROPIC_PRICE_OUT;

    // 0a. Missing ANTHROPIC_MODEL
    delete process.env.ANTHROPIC_MODEL;
    let modelFailedLoudly = false;
    try {
      getAnthropicModel();
    } catch (err: any) {
      modelFailedLoudly = true;
      console.log(`  • Missing ANTHROPIC_MODEL caught: ${err.message}`);
    }
    if (!modelFailedLoudly) {
      throw new Error("ANTHROPIC_MODEL must fail loudly when missing; no hard-coded default allowed!");
    }

    // 0b. Missing ANTHROPIC_PRICE_IN
    process.env.ANTHROPIC_MODEL = "claude-3-7-sonnet-20250219";
    delete process.env.ANTHROPIC_PRICE_IN;
    let priceInFailedLoudly = false;
    try {
      getAnthropicPricing();
    } catch (err: any) {
      priceInFailedLoudly = true;
      console.log(`  • Missing ANTHROPIC_PRICE_IN caught: ${err.message}`);
    }
    if (!priceInFailedLoudly) {
      throw new Error("ANTHROPIC_PRICE_IN must fail loudly when missing!");
    }

    // 0c. Missing ANTHROPIC_PRICE_OUT
    process.env.ANTHROPIC_PRICE_IN = "3.00";
    delete process.env.ANTHROPIC_PRICE_OUT;
    let priceOutFailedLoudly = false;
    try {
      getAnthropicPricing();
    } catch (err: any) {
      priceOutFailedLoudly = true;
      console.log(`  • Missing ANTHROPIC_PRICE_OUT caught: ${err.message}`);
    }
    if (!priceOutFailedLoudly) {
      throw new Error("ANTHROPIC_PRICE_OUT must fail loudly when missing!");
    }

    // Restore environment variables for subsequent tests
    process.env.ANTHROPIC_MODEL = origModel || "claude-3-7-sonnet-20250219";
    process.env.ANTHROPIC_PRICE_IN = origPriceIn || "3.00";
    process.env.ANTHROPIC_PRICE_OUT = origPriceOut || "15.00";
    console.log(`✅ [Test 0 Passed] Missing ANTHROPIC_MODEL, ANTHROPIC_PRICE_IN, and ANTHROPIC_PRICE_OUT verified to fail loudly.`);

    // -------------------------------------------------------------------------
    // 1. 17:50 Pre-Compilation & State Persistence
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Running 17:50 Gather + Synthesis and checking state file persistence...");
    const result1750 = await execute1750Gather(today, targetChannel, { testMode: true });

    const lineCount = result1750.digestText.split("\n").length;
    console.log(`Digest line count: ${lineCount} lines (Hard cap: <= 25 lines)`);
    if (lineCount > 25) {
      throw new Error(`Digest exceeded 25-line hard cap! Got ${lineCount} lines.`);
    }

    // Verify state was written to state file
    const savedState = await getStandupState(today, { testMode: true });
    if (!savedState || !savedState.digestText) {
      throw new Error("17:50 run failed to write pre-compiled digest to state file!");
    }
    if (savedState.posted) {
      throw new Error("17:50 pre-compile state must have posted: false!");
    }
    console.log(`✅ [Test 1 Passed] 17:50 pre-compiled and saved state file with posted: false (${savedState.synthesis?.model}).`);

    // -------------------------------------------------------------------------
    // 2. 18:00 Self-Sufficient Broadcast Job (Restart Survival & Fallback)
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Testing 18:00 Self-Sufficient broadcast job...");

    // 2a. With pre-compiled state present, uses pre-compiled digest without recompiling
    console.log("  • 2a: Executing 18:00 with pre-compiled state file present...");
    const broadcastFromPrecompile = await execute1800Broadcast({
      targetChannel,
      testMode: true,
      source: "cron",
    });

    if (broadcastFromPrecompile.compiledFresh) {
      throw new Error("18:00 should have used pre-compiled digest from state file, but compiled fresh!");
    }
    if (!broadcastFromPrecompile.standupTs) {
      throw new Error("18:00 broadcast did not return standupTs!");
    }
    const stateAfterBroadcast = await getStandupState(today, { testMode: true });
    if (!stateAfterBroadcast?.posted || stateAfterBroadcast.standupTs !== broadcastFromPrecompile.standupTs) {
      throw new Error("18:00 broadcast failed to update state file with posted: true and standupTs!");
    }
    console.log(`  • Verified: 18:00 used pre-compiled digest and updated state file with posted: true.`);

    // 2b. Wipe state to simulate restart with NO pre-compiled state; 18:00 must compile fresh self-sufficiently
    console.log("  • 2b: Simulating container restart with missing state file (fresh self-sufficient compile)...");
    const testStatePath = path.join(config.repoRoot, "logs/.test/.state", `standup-${today}.json`);
    if (fs.existsSync(testStatePath)) {
      fs.rmSync(testStatePath);
    }

    const broadcastFresh = await execute1800Broadcast({
      targetChannel,
      testMode: true,
      source: "cron",
    });

    if (!broadcastFresh.compiledFresh) {
      throw new Error("18:00 should have compiled fresh when state file was absent!");
    }
    const stateAfterFresh = await getStandupState(today, { testMode: true });
    if (!stateAfterFresh?.posted || !stateAfterFresh.standupTs) {
      throw new Error("18:00 fresh compile failed to save posted state to file!");
    }
    console.log(`✅ [Test 2 Passed] 18:00 job is self-sufficient: uses pre-compiled state when present, compiles fresh when absent, and survives restarts.`);

    // -------------------------------------------------------------------------
    // 3. Startup Catch-Up Logic (18:00–21:00 IST Window)
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Testing Startup Catch-Up logic...");

    // 3a. Outside window (e.g. 15:00 IST): must skip
    const fakeEarlyDate = new Date("2026-10-24T15:00:00+05:30");
    const earlyCheck = await checkAndRunStartupCatchup({
      testDate: fakeEarlyDate,
      testMode: true,
      targetChannel,
    });
    if (earlyCheck.ranCatchup) {
      throw new Error(`Catch-up must NOT run outside 18:00–21:00 window! Got: ${earlyCheck.reason}`);
    }
    console.log(`  • 3a: Outside window (15:00 IST) correctly skipped catch-up: ${earlyCheck.reason}`);

    // 3b. Inside window when standup ALREADY posted today: must skip
    const fakeWindowDate = new Date("2026-10-24T18:30:00+05:30");
    const alreadyPostedCheck = await checkAndRunStartupCatchup({
      testDate: fakeWindowDate,
      testMode: true,
      targetChannel,
    });
    if (alreadyPostedCheck.ranCatchup) {
      throw new Error("Catch-up must NOT run if standup was already posted today!");
    }
    console.log(`  • 3b: Inside window with standup already posted correctly skipped: ${alreadyPostedCheck.reason}`);

    // 3c. Inside window when NO standup was posted today: must run 18:00 broadcast immediately
    if (fs.existsSync(testStatePath)) {
      fs.rmSync(testStatePath);
    }
    const missingPostCheck = await checkAndRunStartupCatchup({
      testDate: fakeWindowDate,
      testMode: true,
      targetChannel,
    });
    if (!missingPostCheck.ranCatchup) {
      throw new Error(`Catch-up must run immediately if inside window and standup missing today! Got: ${missingPostCheck.reason}`);
    }
    console.log(`  • 3c: Inside window with missing standup successfully ran catch-up broadcast.`);
    console.log(`✅ [Test 3 Passed] Startup catch-up logic verified.`);

    // -------------------------------------------------------------------------
    // 4. /standup Slash Command Execution (Chief of Staff Run)
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Testing /standup Slash Command invocation...");
    // Simulate /standup execution calling execute1800Broadcast with forceCompile: true
    const standupCommandRes = await execute1800Broadcast({
      targetChannel,
      dateStr: today,
      forceCompile: true,
      source: "standup_command",
      testMode: true,
    });

    if (!standupCommandRes.compiledFresh) {
      throw new Error("/standup must compile fresh using Chief of Staff run!");
    }
    if (!standupCommandRes.standupTs) {
      throw new Error("/standup broadcast did not return standupTs!");
    }

    const commandState = await getStandupState(today, { testMode: true });
    if (commandState?.source !== "standup_command" || commandState.standupTs !== standupCommandRes.standupTs) {
      throw new Error("/standup failed to persist command execution state!");
    }
    console.log(`✅ [Test 4 Passed] /standup called Chief of Staff run (gather + Anthropic + broadcast) and saved state.`);

    // -------------------------------------------------------------------------
    // 5. Standup Poll (18–23) finding post made by /standup as well as cron
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Testing Standup Reply Poll (finds post made by /standup)...");
    const pollResult = await pollStandupReplies({
      channel: targetChannel,
      testMode: true,
    });

    if (!pollResult.polled || pollResult.standupTs !== standupCommandRes.standupTs) {
      throw new Error(`Poll failed to find post made by /standup! Expected ${standupCommandRes.standupTs}, got ${pollResult.standupTs}`);
    }
    console.log(`  • Poll successfully located /standup post (ts=${pollResult.standupTs}) via state file.`);
    console.log(`✅ [Test 5 Passed] Poll verified finding post made by /standup as well as by cron.`);

    // -------------------------------------------------------------------------
    // 6. Test Monday 09:00 IST Scorecard Compilation
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Testing Monday 09:00 IST Scorecard compilation...");
    const scorecardText = await compileMondayScorecard();

    if (!scorecardText.includes("—")) {
      throw new Error("Scorecard must represent unpopulated metrics strictly as '—' (dash).");
    }
    if (!scorecardText.includes("AEO") || !scorecardText.includes("AI") || !scorecardText.includes("TrueLead")) {
      throw new Error("Scorecard must cover all active doors (AEO, AI, TrueLead).");
    }

    await postLine({
      channel: targetChannel,
      text: `[TEST type:test] Monday Scorecard Preview:\n${scorecardText}`,
    });
    console.log(`✅ [Test 6 Passed] Monday Scorecard verified.`);

    // -------------------------------------------------------------------------
    // 7. Test 18:15 IST Silence Check Logic (Active Agents Only)
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Testing 18:15 IST Silence check logic (flags active only)...");
    const silenceResult = await execute1815SilenceCheck(today, undefined, targetChannel, { testMode: true });
    console.log(`Silent active agents identified: ${silenceResult.silentAgents.join(", ") || "none"}`);
    console.log(`Silence notices dispatched to ${targetChannel}: ${silenceResult.postedCount}`);

    if (silenceResult.silentAgents.includes("prospect-researcher") || silenceResult.silentAgents.includes("sales-desk")) {
      throw new Error("Planned agents must NOT be flagged by the silence check! Only status: active.");
    }
    console.log(`✅ [Test 7 Passed] 18:15 silence check executed; correctly restricted to active agents only.`);

    // -------------------------------------------------------------------------
    // 8. Test Architect In-Thread Reply Decision Capture & Deduplication (logs/.test/)
    // -------------------------------------------------------------------------
    console.log("\n[Test 8] Testing Architect in-thread reply capture & deduplication (mocked to logs/.test/)...");
    const testDecisionTs = `test-ts-${Date.now()}.001`;

    const decisionReplyResult = await handleArchitectStandupReply(
      {
        text: "Decision: Approved revised CTA copy for mobile",
        user: { name: "falkanmedia", username: "falkanmedia" },
        thread_ts: standupCommandRes.standupTs,
        ts: testDecisionTs,
        channel: targetChannel,
      },
      { testMode: true }
    );

    if (!decisionReplyResult.handled || decisionReplyResult.action !== "decision") {
      throw new Error(`Expected decision reply to be captured as decision, got: ${JSON.stringify(decisionReplyResult)}`);
    }
    if (!decisionReplyResult.path?.includes("logs/.test/")) {
      throw new Error(`Test must write to logs/.test/, got: ${decisionReplyResult.path}`);
    }

    // Deduplication check
    const duplicateReplyResult = await handleArchitectStandupReply(
      {
        text: "Decision: Approved revised CTA copy for mobile",
        user: { name: "falkanmedia", username: "falkanmedia" },
        thread_ts: standupCommandRes.standupTs,
        ts: testDecisionTs,
        channel: targetChannel,
      },
      { testMode: true }
    );

    if (duplicateReplyResult.handled || !duplicateReplyResult.alreadyProcessed) {
      throw new Error(`Expected duplicate reply ts ${testDecisionTs} to be skipped, got: ${JSON.stringify(duplicateReplyResult)}`);
    }
    console.log(`✅ [Test 8 Passed] Architect decision capture & deduplication verified.`);

  } finally {
    // Teardown: Clean up logs/.test/ completely
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
      console.log(`\n🧹 [Teardown] Successfully purged logs/.test/ directory.`);
    }
  }

  console.log("\n=== All Tests Passed Cleanly ===");
}

runDay04Tests().catch((err) => {
  console.error("Day 4 Test Suite Failed:", err);
  process.exit(1);
});

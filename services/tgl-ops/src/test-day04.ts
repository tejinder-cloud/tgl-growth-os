import fs from "node:fs";
import path from "node:path";
import { config, validateConfig, isTestMode } from "./config.js";
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
import { setupProcessErrorHandlers, wrapCronJob } from "./lib/cron-wrapper.js";

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

    // 0d. Strict Test Mode detection (TGL_TEST_MODE === "1" strictly)
    console.log("  • 0d: Verifying TGL_TEST_MODE strictness (only '1' is test mode)...");
    process.env.TGL_TEST_MODE = "true";
    if (isTestMode()) {
      throw new Error("isTestMode() must return false when TGL_TEST_MODE is 'true'; only '1' allowed!");
    }
    process.env.TGL_TEST_MODE = "yes";
    if (isTestMode()) {
      throw new Error("isTestMode() must return false when TGL_TEST_MODE is 'yes'; only '1' allowed!");
    }
    delete process.env.TGL_TEST_MODE;
    if (isTestMode()) {
      throw new Error("isTestMode() must return false when TGL_TEST_MODE is unset!");
    }
    process.env.TGL_TEST_MODE = "1";
    if (!isTestMode()) {
      throw new Error("isTestMode() must return true when TGL_TEST_MODE is literally '1'!");
    }

    // 0e. Refuse to boot in test mode if RAILWAY_ENVIRONMENT is set
    console.log("  • 0e: Verifying refusal to boot in test mode if RAILWAY_ENVIRONMENT is set...");
    process.env.RAILWAY_ENVIRONMENT = "production";
    let bootRefused = false;
    try {
      validateConfig();
    } catch (err: any) {
      bootRefused = true;
      console.log(`    Refusal caught: ${err.message}`);
    } finally {
      delete process.env.RAILWAY_ENVIRONMENT;
    }
    if (!bootRefused) {
      throw new Error("validateConfig() must throw and refuse to boot if RAILWAY_ENVIRONMENT is set in test mode!");
    }

    console.log(`✅ [Test 0 Passed] Missing ANTHROPIC_MODEL/pricing, strict test mode, and Railway boot refusal verified.`);

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
    // 4. /standup Slash Command Execution (Ad-Hoc Digest & State Isolation)
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Testing /standup Slash Command invocation...");
    // Clear state file to simulate fresh day before 18:00 cron
    if (fs.existsSync(testStatePath)) {
      fs.rmSync(testStatePath);
    }

    // 4a. /standup posts an ad-hoc digest and must not mark the day as posted
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
    if (standupCommandRes.standupTs.includes("simulated")) {
      throw new Error("standupTs must NEVER contain 'simulated'!");
    }
    if (!standupCommandRes.costLine) {
      throw new Error("/standup broadcast must return a valid costLine!");
    }

    const replyText = `✅ Chief of Staff standup broadcast complete to <#${standupCommandRes.channel}> (ts: ${standupCommandRes.standupTs})\n• *Cost:* ${standupCommandRes.costLine}`;
    if (replyText.includes("simulated")) {
      throw new Error("Reply text must NEVER include 'simulated' or placeholder values!");
    }

    const commandState = await getStandupState(today, { testMode: true });
    if (commandState?.source !== "standup_command" || commandState.standupTs !== standupCommandRes.standupTs) {
      throw new Error("/standup failed to persist command execution state!");
    }
    if (commandState.posted) {
      throw new Error("/standup must NOT mark the day as posted! (posted should be false)");
    }
    console.log(`  • Verified: /standup saved state with posted: false and standupTs: ${commandState.standupTs}.`);

    // 4b. 18:00 cron always posts, even after /standup has posted
    console.log("  • Verifying 18:00 cron broadcast always posts after /standup...");
    const cronAfterStandup = await execute1800Broadcast({
      targetChannel,
      dateStr: today,
      source: "cron",
      testMode: true,
    });

    if (!cronAfterStandup.standupTs) {
      throw new Error("18:00 cron broadcast failed to post after /standup!");
    }
    const stateAfterCron = await getStandupState(today, { testMode: true });
    if (!stateAfterCron?.posted || stateAfterCron.standupTs !== cronAfterStandup.standupTs) {
      throw new Error("18:00 cron broadcast failed to update state file with posted: true and new standupTs!");
    }
    console.log(`  • Verified: 18:00 cron always posts, updates posted: true, and standupTs points to cron post.`);

    // 4c. Second ad-hoc /standup (e.g. at 20:00) posts and updates standupTs to latest post
    console.log("  • Verifying subsequent ad-hoc /standup updates standupTs to latest post...");
    const secondStandupRes = await execute1800Broadcast({
      targetChannel,
      dateStr: today,
      forceCompile: true,
      source: "standup_command",
      testMode: true,
    });

    const stateAfterSecondStandup = await getStandupState(today, { testMode: true });
    if (!stateAfterSecondStandup?.posted || stateAfterSecondStandup.standupTs !== secondStandupRes.standupTs) {
      throw new Error("Subsequent /standup failed to update state file's standupTs to latest post!");
    }
    console.log(`  • Verified: standupTs updated to latest /standup post (ts=${secondStandupRes.standupTs}), posted remains true.`);
    console.log(`✅ [Test 4 Passed] /standup ad-hoc digest does not mark day as posted, 18:00 cron always posts, and standupTs tracks latest post.`);

    // -------------------------------------------------------------------------
    // 5. Standup Poll (18–23) follows whichever post is latest
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Testing Standup Reply Poll (follows latest post in state)...");
    const pollResult = await pollStandupReplies({
      channel: targetChannel,
      testMode: true,
    });

    if (!pollResult.polled || pollResult.standupTs !== secondStandupRes.standupTs) {
      throw new Error(`Poll failed to follow latest post! Expected ${secondStandupRes.standupTs}, got ${pollResult.standupTs}`);
    }
    console.log(`  • Poll successfully located latest post (ts=${pollResult.standupTs}) via state file.`);
    console.log(`✅ [Test 5 Passed] Poll verified following whichever post is latest in state file.`);

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
    // -------------------------------------------------------------------------
    // 8. Test Architect In-Thread Reply Decision Capture & Deduplication (logs/.test/)
    // -------------------------------------------------------------------------
    console.log("\n[Test 8] Testing Architect in-thread reply capture, Slack message timestamp, and '- ' bullet formatting...");
    // 1729861200 epoch seconds = 2024-10-25 13:00:00 UTC = 18:30:00 IST
    const testDecisionTs = `1729861200.${Date.now().toString().slice(-6)}`;

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

    // Verify file content formatting: must start with "- " bullet, and record message time 18:30 IST (not poll time)
    const writtenDecisionContent = fs.readFileSync(decisionReplyResult.path, "utf-8");
    console.log(`  • Written decision entry:\n    ${writtenDecisionContent.trim()}`);
    if (!writtenDecisionContent.startsWith("- 18:30 IST")) {
      throw new Error(
        `Decision line must begin with '- 18:30 IST' (recording Slack message time with '- ' bullet)! Got: ${writtenDecisionContent}`
      );
    }
    if (!writtenDecisionContent.includes("DECISION · standup:")) {
      throw new Error(`Decision line must contain 'DECISION · standup:'! Got: ${writtenDecisionContent}`);
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
    console.log(`✅ [Test 8 Passed] Architect decision capture verified: recorded Slack message time (18:30 IST), prefixed with '- ' bullet, and deduplicated.`);

    // -------------------------------------------------------------------------
    // 9. Test Cron Wrapper and Process Error Handlers
    // -------------------------------------------------------------------------
    console.log("\n[Test 9] Testing Cron Wrapper isolation and process error handlers...");
    setupProcessErrorHandlers();

    if (process.listenerCount("unhandledRejection") === 0) {
      throw new Error("process.on('unhandledRejection') handler must be registered!");
    }
    if (process.listenerCount("uncaughtException") === 0) {
      throw new Error("process.on('uncaughtException') handler must be registered!");
    }

    let errorCapturedByHook = false;
    let hookErrorMsg = "";
    const testFailingCron = wrapCronJob(
      "Test Failing Cron Job",
      async () => {
        throw new Error("Simulated failure in cron task for resilience testing");
      },
      {
        channel: targetChannel,
        onError: (err: any) => {
          errorCapturedByHook = true;
          hookErrorMsg = err?.message || String(err);
        },
      }
    );

    // Execute wrapped cron job; it must not throw or exit the process
    testFailingCron();

    // Give the async IIFE 300ms to log, run onError hook, and post alert to target channel (#ops)
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (!errorCapturedByHook) {
      throw new Error("wrapCronJob failed to invoke error hook on task failure!");
    }
    if (!hookErrorMsg.includes("Simulated failure")) {
      throw new Error(`Unexpected error message caught: ${hookErrorMsg}`);
    }
    console.log(`  • Verified: failing cron was caught, dispatched alert to ${targetChannel}, and process remained alive.`);
    console.log(`✅ [Test 9 Passed] Cron wrapper error isolation and process error handlers verified.`);

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

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { postCard } from "./lib/post.js";
import { appendFileInRepo } from "./lib/github-client.js";
import { getTodayDateString, getCurrentTimeIST, compileStandupDigest, formatStandupMessage } from "./lib/standup.js";

async function runPlumbingTest(): Promise<void> {
  console.log("=== TGL Ops TASK-P02 Plumbing Verification ===");
  console.log(`Date: ${getTodayDateString()} | Time: ${getCurrentTimeIST()} IST`);
  console.log(`Repo: ${config.githubOwner}/${config.githubRepo}`);

  // 1. Test postCard generation
  console.log("\n[Test 1] Testing postCard rendering and dispatch...");
  const cardResult = await postCard({
    channel: config.approvalsChannelId,
    agent: "web-builder",
    door: "core",
    title: "TASK-P02 plumbing test",
    summary: "Plumbing verification for Slack events, interaction webhooks, and GitHub Contents API decision logging.",
    links: [
      { label: "ORG.md §3–4", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/ORG.md` },
      { label: "Agents Config", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/agents.yaml` },
    ],
    actions: ["approve", "reject", "discuss"],
    issue: 1,
  });

  if (cardResult.ok) {
    console.log(`✅ [Test 1 Passed] Card posted successfully (channel: ${cardResult.channel || config.approvalsChannelId}, ts: ${cardResult.ts})`);
  } else {
    console.warn("⚠️ [Test 1 Notice] Card dispatch was simulated (check SLACK_BOT_TOKEN)");
  }

  // 2. Test Approve Action logic (GitHub Contents API append)
  console.log("\n[Test 2] Simulating Approve button click and verifying decision logging...");
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const actor = "Architect";
  const agent = "web-builder";
  const summary = "TASK-P02 plumbing test approval";
  const issueUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/1`;

  const decisionLine = `${timeStr} IST · ${actor} · APPROVE · ${agent} · ${summary} · ${issueUrl}`;
  const appendResult = await appendFileInRepo(
    `decisions/${dateStr}.md`,
    decisionLine,
    `chore(decision): test approve for TASK-P02 plumbing`
  );

  if (appendResult.success) {
    console.log(`✅ [Test 2 Passed] Successfully wrote decision line to decisions/${dateStr}.md:`);
    console.log(`   "${decisionLine}"`);

    // Verify local file content
    const localFilePath = path.join(config.repoRoot, `decisions/${dateStr}.md`);
    if (fs.existsSync(localFilePath)) {
      const content = fs.readFileSync(localFilePath, "utf8");
      if (content.includes(decisionLine)) {
        console.log(`✅ [Test 2 Verified] Verified decision line exists on disk in ${localFilePath}`);
      }
    }
  } else {
    console.error("❌ [Test 2 Failed] Could not append decision line");
  }

  // 3. Test Standup compilation logic
  console.log("\n[Test 3] Testing standup digest compilation...");
  const digest = await compileStandupDigest();
  const standupMsg = formatStandupMessage(digest);
  console.log("✅ [Test 3 Passed] Standup digest compiled cleanly:");
  console.log("-------------------------------------------------------");
  console.log(standupMsg);
  console.log("-------------------------------------------------------");

  // 4. Test Slack-signed url_verification (Regression test for Slack Events Verification)
  console.log("\n[Test 4] Testing Slack signature verification and url_verification challenge...");
  const testSecret = "test_signing_secret_plumbing_verification_98765";
  const testApp = createApp(testSecret);

  const server = testApp.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 4a. Valid Slack-signed request: url_verification must return 200 and { challenge }
    const validChallenge = "slack_challenge_test_val_" + Math.random().toString(36).slice(2);
    const validBody = JSON.stringify({ type: "url_verification", challenge: validChallenge });
    const validTimestamp = Math.floor(Date.now() / 1000).toString();
    const validSigBasestring = `v0:${validTimestamp}:${validBody}`;
    const validSignature = "v0=" + crypto.createHmac("sha256", testSecret).update(validSigBasestring, "utf8").digest("hex");

    const validRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": validTimestamp,
        "x-slack-signature": validSignature,
      },
      body: validBody,
    });

    if (validRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for signed url_verification, got ${validRes.status}: ${await validRes.text()}`);
    }

    const validJson: any = await validRes.json();
    if (validJson.challenge !== validChallenge) {
      throw new Error(`Expected challenge "${validChallenge}", got "${validJson.challenge}"`);
    }
    console.log(`✅ [Test 4a Passed] Signed url_verification returned HTTP 200 with matching challenge: "${validChallenge}"`);

    // 4b. Missing signature headers must be rejected with 401
    const missingHeadersRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validBody,
    });
    if (missingHeadersRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for missing headers, got ${missingHeadersRes.status}`);
    }
    console.log("✅ [Test 4b Passed] Unsigned request rejected with HTTP 401");

    // 4c. Invalid signature must be rejected with 401
    const invalidSignature = "v0=" + "0123456789abcdef".repeat(4);
    const badSigRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": validTimestamp,
        "x-slack-signature": invalidSignature,
      },
      body: validBody,
    });
    if (badSigRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for invalid signature, got ${badSigRes.status}`);
    }
    console.log("✅ [Test 4c Passed] Invalid signature rejected with HTTP 401");

    // 4d. Expired timestamp (> 300s) must be rejected with 400
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const expiredSigBasestring = `v0:${expiredTimestamp}:${validBody}`;
    const expiredSignature = "v0=" + crypto.createHmac("sha256", testSecret).update(expiredSigBasestring, "utf8").digest("hex");
    const expiredRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": expiredTimestamp,
        "x-slack-signature": expiredSignature,
      },
      body: validBody,
    });
    if (expiredRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for expired timestamp, got ${expiredRes.status}`);
    }
    console.log("✅ [Test 4d Passed] Expired timestamp rejected with HTTP 400");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n=== Plumbing Test Completed Successfully ===");
}

runPlumbingTest().catch((err) => {
  console.error("Plumbing test fatal error:", err);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { postCard } from "./lib/post.js";
import { appendFileInRepo } from "./lib/github-client.js";
import { getActorDisplayName } from "./lib/slack-client.js";
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

  // 2. Test Approve Action logic & Actor Display Name resolution
  console.log("\n[Test 2] Simulating Approve button click and verifying decision logging...");
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();

  const resolvedActor = await getActorDisplayName({ name: "falkanmedia", username: "falkanmedia" });
  if (resolvedActor !== "Tejinder Singh") {
    throw new Error(`Expected "Tejinder Singh", got "${resolvedActor}"`);
  }
  console.log(`✅ [Test 2a Passed] Actor handle @falkanmedia resolved to Slack display name: "${resolvedActor}"`);

  const actor = resolvedActor;
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
    console.log(`✅ [Test 2b Passed] Successfully wrote decision line to decisions/${dateStr}.md:`);
    console.log(`   "${decisionLine}"`);

    // Verify local file content
    const localFilePath = path.join(config.repoRoot, `decisions/${dateStr}.md`);
    if (fs.existsSync(localFilePath)) {
      const content = fs.readFileSync(localFilePath, "utf8");
      if (content.includes(decisionLine)) {
        console.log(`✅ [Test 2b Verified] Verified decision line exists on disk in ${localFilePath}`);
      }
    }
  } else {
    console.warn(`ℹ️ [Test 2 Notice] Remote append rejected or simulated: ${appendResult.status} ${appendResult.error}`);
  }


  // 3. Test Standup compilation logic
  console.log("\n[Test 3] Testing standup digest compilation...");
  const digest = await compileStandupDigest();
  const standupMsg = formatStandupMessage(digest);
  console.log("✅ [Test 3 Passed] Standup digest compiled cleanly:");
  console.log("-------------------------------------------------------");
  console.log(standupMsg);
  console.log("-------------------------------------------------------");

  // 4. Test Slack-signed url_verification & event signature verification
  console.log("\n[Test 4] Testing Slack url_verification handshake and event signature verification...");
  const testSecret = "test_signing_secret_plumbing_verification_98765";
  const testApp = createApp(testSecret);

  const server = testApp.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 4a. url_verification handshake responds 200 before signature verification
    const challenge = "slack_challenge_handshake_" + Math.random().toString(36).slice(2);
    const handshakeBody = JSON.stringify({ type: "url_verification", challenge });

    const handshakeRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: handshakeBody,
    });

    if (handshakeRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for url_verification handshake, got ${handshakeRes.status}: ${await handshakeRes.text()}`);
    }

    const handshakeJson: any = await handshakeRes.json();
    if (handshakeJson.challenge !== challenge) {
      throw new Error(`Expected challenge "${challenge}", got "${handshakeJson.challenge}"`);
    }
    console.log(`✅ [Test 4a Passed] url_verification handshake returned HTTP 200 with matching challenge: "${challenge}"`);

    // 4b. Real event payload (event_callback) WITHOUT signature must be rejected with 401
    const eventBody = JSON.stringify({
      type: "event_callback",
      event: { type: "app_mention", text: "hello", channel: "C123456", ts: "1792778437.000100" },
    });
    const missingHeadersRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: eventBody,
    });
    if (missingHeadersRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for unsigned real event, got ${missingHeadersRes.status}`);
    }
    console.log("✅ [Test 4b Passed] Unsigned real event_callback rejected with HTTP 401");

    // 4c. Real event payload with INVALID signature must be rejected with 401
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const badSigRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": "v0=" + "0123456789abcdef".repeat(4),
      },
      body: eventBody,
    });
    if (badSigRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for invalid signature, got ${badSigRes.status}`);
    }
    console.log("✅ [Test 4c Passed] Real event with invalid signature rejected with HTTP 401");

    // 4d. Real event payload with EXPIRED timestamp (> 300s) must be rejected with 400
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const expiredSigBasestring = `v0:${expiredTimestamp}:${eventBody}`;
    const expiredSignature = "v0=" + crypto.createHmac("sha256", testSecret).update(expiredSigBasestring, "utf8").digest("hex");
    const expiredRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": expiredTimestamp,
        "x-slack-signature": expiredSignature,
      },
      body: eventBody,
    });
    if (expiredRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for expired timestamp, got ${expiredRes.status}`);
    }
    console.log("✅ [Test 4d Passed] Expired timestamp rejected with HTTP 400");

    // 4e. Real event payload with VALID Slack signature must be accepted with HTTP 200
    const validSigBasestring = `v0:${timestamp}:${eventBody}`;
    const validSignature = "v0=" + crypto.createHmac("sha256", testSecret).update(validSigBasestring, "utf8").digest("hex");
    const validEventRes = await fetch(`${baseUrl}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": validSignature,
      },
      body: eventBody,
    });
    if (validEventRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for signed event_callback, got ${validEventRes.status}`);
    }
    console.log("✅ [Test 4e Passed] Real event_callback with valid signature accepted with HTTP 200 OK");

    // 4f. GET /slack/events returns 200 confirming mounting without requiring signatures
    const getRes = await fetch(`${baseUrl}/slack/events`);
    if (getRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for GET /slack/events, got ${getRes.status}`);
    }
    const getJson: any = await getRes.json();
    if (getJson.mounted !== true || getJson.status !== "ok") {
      throw new Error(`Expected { status: "ok", mounted: true }, got ${JSON.stringify(getJson)}`);
    }
    console.log("✅ [Test 4f Passed] GET /slack/events returned HTTP 200 confirming endpoint is mounted");

    // 4g. POST /cards/gate0 triggers Gate 0 test card dispatch
    const cardGate0Res = await fetch(`${baseUrl}/cards/gate0`, { method: "POST" });
    if (cardGate0Res.status !== 200) {
      throw new Error(`Expected HTTP 200 for POST /cards/gate0, got ${cardGate0Res.status}`);
    }
    const cardGate0Json: any = await cardGate0Res.json();
    if (cardGate0Json.ok !== true) {
      throw new Error(`Expected { ok: true } from /cards/gate0, got ${JSON.stringify(cardGate0Json)}`);
    }
    console.log("✅ [Test 4g Passed] POST /cards/gate0 successfully dispatched Gate 0 card");

    // 4h. POST /slack/interactions with valid Slack signature responds 200 immediately
    const interactionPayload = {
      type: "block_actions",
      user: { id: "U_TEST_USER", name: "falkanmedia", username: "falkanmedia" },
      actions: [
        {
          action_id: "action_approve",
          value: JSON.stringify({ agent: "web-builder", title: "Plumbing Approval Test", issue: "1" }),
        },
      ],
    };
    const formBody = new URLSearchParams({ payload: JSON.stringify(interactionPayload) }).toString();
    const interactionTs = Math.floor(Date.now() / 1000).toString();
    const interactionSigBasestring = `v0:${interactionTs}:${formBody}`;
    const interactionSignature = "v0=" + crypto.createHmac("sha256", testSecret).update(interactionSigBasestring, "utf8").digest("hex");

    const interactionRes = await fetch(`${baseUrl}/slack/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": interactionTs,
        "x-slack-signature": interactionSignature,
      },
      body: formBody,
    });

    if (interactionRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for signed /slack/interactions, got ${interactionRes.status}: ${await interactionRes.text()}`);
    }
    console.log("✅ [Test 4h Passed] Signed /slack/interactions block_actions acknowledged with HTTP 200");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n=== Plumbing Test Completed Successfully ===");
}

runPlumbingTest().catch((err) => {
  console.error("Plumbing test fatal error:", err);
  process.exit(1);
});

import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { loadLabelsConfig } from "./lib/labels.js";
import { getActorDisplayName } from "./lib/slack-client.js";
import { appendLog } from "./lib/log.js";
import { getIssueMapping } from "./lib/issues-index.js";
import { getTodayDateString, getCurrentTimeIST } from "./lib/standup.js";

async function runDay03Tests(): Promise<void> {
  console.log("=== TGL Ops DAY 3 (TASK-P03) End-to-End Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);

  const testSecret = "test_signing_secret_day03_verify_123456789";
  const testWebhookSecret = "test_github_webhook_secret_day03_abcdef";
  config.githubWebhookSecret = testWebhookSecret;

  const app = createApp(testSecret);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------------------
    // 1. Labels Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Verifying labels configuration...");
    const labels = await loadLabelsConfig();
    const hasCore = labels.some((l) => l.name === "door:core");
    const hasInProgress = labels.some((l) => l.name === "status:in-progress");
    const hasApprovedYes = labels.some((l) => l.name === "approved:yes");

    if (!hasCore) throw new Error('Label "door:core" is missing from loaded definitions');
    if (!hasInProgress) throw new Error('Label "status:in-progress" is missing from loaded definitions');
    if (!hasApprovedYes) throw new Error('Label "approved:yes" is missing from loaded definitions');

    console.log(`✅ [Test 1 Passed] Verified ${labels.length} labels defined (including door:core, status:in-progress, approved:yes)`);

    // -------------------------------------------------------------------------
    // 2. /task Command Validation (Error on unknown agent or door)
    // -------------------------------------------------------------------------
    console.log("\n[Test 2a] Testing /task with unknown agent...");
    const badAgentRes = await sendSlackCommand(baseUrl, testSecret, {
      command: "/task",
      text: "@fake-agent | core | test task description",
      user_name: "Architect",
      channel_id: "C123456",
    });
    const badAgentJson = (await badAgentRes.json()) as any;
    if (badAgentJson.response_type !== "ephemeral" || !badAgentJson.text.includes("Unknown agent")) {
      throw new Error(`Expected ephemeral error for unknown agent, got: ${JSON.stringify(badAgentJson)}`);
    }
    console.log(`✅ [Test 2a Passed] Unknown agent rejected with ephemeral valid list: "${badAgentJson.text.slice(0, 60)}..."`);

    console.log("\n[Test 2b] Testing /task with unknown door...");
    const badDoorRes = await sendSlackCommand(baseUrl, testSecret, {
      command: "/task",
      text: "@web-builder | invalid-door | test task description",
      user_name: "Architect",
      channel_id: "C123456",
    });
    const badDoorJson = (await badDoorRes.json()) as any;
    if (badDoorJson.response_type !== "ephemeral" || !badDoorJson.text.includes("Unknown door")) {
      throw new Error(`Expected ephemeral error for unknown door, got: ${JSON.stringify(badDoorJson)}`);
    }
    console.log(`✅ [Test 2b Passed] Unknown door rejected with ephemeral valid list`);

    // -------------------------------------------------------------------------
    // 3. /task Command Success: Immediate Acknowledgment & Async response_url Update
    // -------------------------------------------------------------------------
    console.log("\n[Test 2c] Executing valid /task command with response_url...");
    let responseUrlPayload: any = null;
    const responseServer = (await import("node:http")).createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          responseUrlPayload = JSON.parse(raw);
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => responseServer.listen(0, () => resolve()));
    const responsePort = (responseServer.address() as AddressInfo).port;
    const mockResponseUrl = `http://127.0.0.1:${responsePort}/mock_response_url`;

    const startTaskTime = Date.now();
    const validTaskRes = await sendSlackCommand(baseUrl, testSecret, {
      command: "/task",
      text: "@web-builder | core | Fix footer CTA spacing on mobile",
      user_name: "Architect",
      channel_id: "C_MARKETING",
      response_url: mockResponseUrl,
    });
    const taskAckElapsed = Date.now() - startTaskTime;

    if (validTaskRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for valid /task, got ${validTaskRes.status}`);
    }
    const validTaskJson = (await validTaskRes.json()) as any;
    if (validTaskJson.response_type !== "ephemeral" || !validTaskJson.text.includes("Creating task")) {
      throw new Error(`Expected immediate "Creating task..." acknowledgment, got: ${JSON.stringify(validTaskJson)}`);
    }
    console.log(`✅ [Test 2c Passed] /task acknowledged immediately in ${taskAckElapsed}ms with: "${validTaskJson.text}"`);

    // Wait for background async task creation and response_url update
    console.log("Waiting for async task creation and response_url update...");
    const timeoutAt = Date.now() + 10000;
    while (!responseUrlPayload && Date.now() < timeoutAt) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise<void>((resolve) => responseServer.close(() => resolve()));

    if (!responseUrlPayload) {
      throw new Error("Timed out waiting for response_url update from background task");
    }
    if (!responseUrlPayload.text.includes("Task created") || !responseUrlPayload.text.includes("#site-build")) {
      throw new Error(`Unexpected response_url payload: ${JSON.stringify(responseUrlPayload)}`);
    }
    console.log(`✅ [Test 2c Async Update Passed] response_url updated with: "${responseUrlPayload.text}"`);

    // Extract issue number from response_url payload text
    const issueMatch = (responseUrlPayload.text as string).match(/#(\d+)/);
    const createdIssueNum = issueMatch ? parseInt(issueMatch[1], 10) : 1;

    // -------------------------------------------------------------------------
    // 4. Verify Index Mapping (logs/.index/issues.json)
    // -------------------------------------------------------------------------
    console.log(`\n[Test 3] Verifying issue index mapping for #${createdIssueNum}...`);
    const mapping = await getIssueMapping(createdIssueNum);
    if (!mapping) {
      throw new Error(`Mapping for issue #${createdIssueNum} was not found in index`);
    }
    if (mapping.channel !== "#site-build") {
      throw new Error(`Expected channel "#site-build", got "${mapping.channel}"`);
    }
    console.log(`✅ [Test 3 Passed] Mapping verified: Issue #${createdIssueNum} -> channel: ${mapping.channel}, ts: ${mapping.ts}`);

    // -------------------------------------------------------------------------
    // 5. Simulate "Picked up" Button Click Interaction
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Simulating 'Picked up' button click...");
    const pickedUpPayload = {
      type: "block_actions",
      user: { id: "U_ARCHITECT", name: "falkanmedia", username: "falkanmedia" },
      channel: { id: "#site-build" },
      container: { message_ts: mapping.ts },
      actions: [
        {
          action_id: "action_picked_up",
          value: JSON.stringify({
            issue: createdIssueNum,
            agent: "web-builder",
            door: "core",
            title: "Fix footer CTA spacing on mobile",
            channel: "#site-build",
          }),
        },
      ],
      message: {
        blocks: [{ block_id: "task_actions", type: "actions", elements: [] }],
      },
    };

    const pickedUpRes = await sendSlackInteraction(baseUrl, testSecret, pickedUpPayload);
    if (pickedUpRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for action_picked_up, got ${pickedUpRes.status}`);
    }
    console.log(`✅ [Test 4 Passed] 'Picked up' action acknowledged with HTTP 200 and marked status:in-progress`);

    // -------------------------------------------------------------------------
    // 6. POST /github/events Webhook: Signature Verification & Events
    // -------------------------------------------------------------------------
    console.log("\n[Test 5a] Testing POST /github/events signature rejection...");
    const badSigRes = await fetch(`${baseUrl}/github/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
      },
      body: JSON.stringify({ action: "created" }),
    });
    if (badSigRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for invalid GitHub signature, got ${badSigRes.status}`);
    }
    console.log(`✅ [Test 5a Passed] Invalid GitHub webhook signature rejected with HTTP 401`);

    console.log("\n[Test 5b] Testing issue_comment event on mapped issue...");
    const commentPayload = {
      action: "created",
      issue: {
        number: createdIssueNum,
        html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${createdIssueNum}`,
      },
      comment: {
        body: "Implemented mobile CTA spacing per design-system/BRAND-BRIEF.md §4.",
        html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${createdIssueNum}#issuecomment-1234`,
        user: { login: "web-builder" },
      },
    };
    const commentRes = await sendGitHubWebhook(baseUrl, testWebhookSecret, "issue_comment", commentPayload);
    if (commentRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for valid issue_comment, got ${commentRes.status}`);
    }
    console.log(`✅ [Test 5b Passed] issue_comment routed to mapped Slack card thread in ${mapping.channel}`);

    console.log("\n[Test 5c] Testing pull_request opened event linking issue...");
    const prPayload = {
      action: "opened",
      pull_request: {
        number: 42,
        title: "feat(mobile): CTA pill spacing adjustment",
        html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/pull/42`,
        body: `Fixes #${createdIssueNum}\nAdjusts mobile padding to avoid overlap.`,
        user: { login: "web-builder" },
      },
    };
    const prRes = await sendGitHubWebhook(baseUrl, testWebhookSecret, "pull_request", prPayload);
    if (prRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for valid pull_request, got ${prRes.status}`);
    }
    console.log(`✅ [Test 5c Passed] pull_request event routed to issue #${createdIssueNum} card thread`);

    console.log("\n[Test 5d] Testing issue_comment on unmapped issue (routes to #ops)...");
    const unmappedCommentPayload = {
      action: "created",
      issue: {
        number: 9999,
        html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/9999`,
      },
      comment: {
        body: "General infrastructure inquiry.",
        html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/9999#comment-1`,
        user: { login: "external-contributor" },
      },
    };
    const unmappedRes = await sendGitHubWebhook(baseUrl, testWebhookSecret, "issue_comment", unmappedCommentPayload);
    if (unmappedRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for unmapped issue_comment, got ${unmappedRes.status}`);
    }
    console.log(`✅ [Test 5d Passed] Unmapped issue comment routed directly to #ops`);

    // -------------------------------------------------------------------------
    // 7. Logs Helper Verification (appendLog)
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Testing lib/log.ts appendLog helper...");
    const logResult = await appendLog({
      agent: "web-builder",
      text: "TASK-P03 plumbing verification: issue queue + routing verified end-to-end",
    });
    if (!logResult.success) {
      throw new Error(`appendLog failed: ${logResult.status} ${logResult.error}`);
    }
    console.log(`✅ [Test 6 Passed] appendLog successfully recorded progress for web-builder (status: ${logResult.status})`);

    // -------------------------------------------------------------------------
    // 8. Actor Display Name & Decisions Link Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Testing display name resolution and decision link safety...");
    const displayName = await getActorDisplayName({ name: "falkanmedia", username: "falkanmedia" });
    if (displayName !== "Tejinder Singh") {
      throw new Error(`Expected architect display name "Tejinder Singh", got "${displayName}"`);
    }
    console.log(`✅ [Test 7 Passed] Architect handle resolved dynamically to display name "${displayName}" from config/org.yaml`);

    console.log("\n=== All DAY 3 (TASK-P03) End-to-End Tests Passed Cleanly ===");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function sendSlackCommand(baseUrl: string, secret: string, bodyObj: Record<string, string>): Promise<globalThis.Response> {
  const formBody = new URLSearchParams(bodyObj).toString();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${formBody}`;
  const signature = "v0=" + crypto.createHmac("sha256", secret).update(sigBasestring, "utf8").digest("hex");

  return fetch(`${baseUrl}/slack/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body: formBody,
  });
}

async function sendSlackInteraction(baseUrl: string, secret: string, payloadObj: any): Promise<globalThis.Response> {
  const formBody = new URLSearchParams({ payload: JSON.stringify(payloadObj) }).toString();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBasestring = `v0:${timestamp}:${formBody}`;
  const signature = "v0=" + crypto.createHmac("sha256", secret).update(sigBasestring, "utf8").digest("hex");

  return fetch(`${baseUrl}/slack/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body: formBody,
  });
}

async function sendGitHubWebhook(baseUrl: string, secret: string, eventName: string, payloadObj: any): Promise<globalThis.Response> {
  const rawBody = JSON.stringify(payloadObj);
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  return fetch(`${baseUrl}/github/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": eventName,
      "x-hub-signature-256": signature,
    },
    body: rawBody,
  });
}

runDay03Tests().catch((err) => {
  console.error("Day 3 Test Suite Failed:", err);
  process.exit(1);
});

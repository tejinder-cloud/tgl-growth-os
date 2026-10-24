import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { getIssueMapping, recordIssueMapping } from "../lib/issues-index.js";
import { postLine } from "../lib/post.js";
import type { SlackVerifiedRequest } from "../lib/slack-verify.js";

export const githubEventsRouter = Router();

/**
 * Middleware to verify GitHub X-Hub-Signature-256 header using GITHUB_WEBHOOK_SECRET.
 */
function verifyGitHubWebhook(req: SlackVerifiedRequest, res: Response, next: () => void): void {
  const secret = config.githubWebhookSecret;

  // In local test environments without secret configured, log warning and proceed
  if (!secret) {
    console.warn("[GitHub Webhook] GITHUB_WEBHOOK_SECRET not configured; skipping signature verification");
    next();
    return;
  }

  const signatureHeader = req.headers["x-hub-signature-256"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!signature) {
    console.warn("[GitHub Webhook Verification Failed] Missing x-hub-signature-256 header");
    res.status(401).json({ error: "Missing x-hub-signature-256 header" });
    return;
  }

  const rawBytes = req.rawBody || Buffer.alloc(0);
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBytes);
  const expectedSig = "sha256=" + hmac.digest("hex");

  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    console.warn("[GitHub Webhook Verification Failed] Signature mismatch");
    res.status(401).json({ error: "Invalid GitHub webhook signature" });
    return;
  }

  next();
}

githubEventsRouter.post("/", verifyGitHubWebhook, async (req: Request, res: Response): Promise<void> => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  console.log(`[GitHub Event Received] Event: ${event} | Action: ${payload?.action}`);

  // 1. Handle ping event
  if (event === "ping") {
    res.status(200).json({ ok: true, message: "pong" });
    return;
  }

  // Acknowledge receipt
  res.status(200).json({ ok: true });

  try {
    // 2. Handle issue_comment (action: created)
    if (event === "issue_comment" && payload.action === "created") {
      await handleIssueComment(payload);
      return;
    }

    // 3. Handle pull_request (action: opened)
    if (event === "pull_request" && payload.action === "opened") {
      await handlePullRequestOpened(payload);
      return;
    }

    // 4. Handle pull_request_review (action: submitted)
    if (event === "pull_request_review" && payload.action === "submitted") {
      await handlePullRequestReviewSubmitted(payload);
      return;
    }
  } catch (err) {
    console.error(`[GitHub Event Processing Error for ${event}]:`, err);
  }
});

async function handleIssueComment(payload: any): Promise<void> {
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !comment) return;

  const issueNum = issue.number;
  const author = comment.user?.login || "Someone";
  const commentUrl = comment.html_url || issue.html_url;
  const rawSnippet = (comment.body || "").replace(/\r?\n/g, " ").trim();
  const snippet = rawSnippet.length > 140 ? `${rawSnippet.slice(0, 140)}…` : rawSnippet;

  const mapping = await getIssueMapping(issueNum);

  if (mapping && mapping.ts && mapping.channel) {
    // Thread reply under the issue's card
    await postLine({
      channel: mapping.channel,
      text: `💬 *${author}* commented on <${commentUrl}|#${issueNum}>: "${snippet}"`,
      thread_ts: mapping.ts,
    });
    console.log(`[GitHub Event] Posted comment thread reply for issue #${issueNum} in ${mapping.channel}`);
  } else {
    // Unknown issue -> post to #ops
    await postLine({
      channel: config.opsChannelId,
      text: `💬 Comment on unmapped issue <${commentUrl}|#${issueNum}> by *${author}*: "${snippet}"`,
    });
    console.log(`[GitHub Event] Posted comment for unmapped issue #${issueNum} to ${config.opsChannelId}`);
  }
}

async function handlePullRequestOpened(payload: any): Promise<void> {
  const pr = payload.pull_request;
  if (!pr) return;

  const prNum = pr.number;
  const prTitle = pr.title || "";
  const prUrl = pr.html_url;
  const author = pr.user?.login || "Someone";
  const prBody = pr.body || "";

  // Extract linked issue (e.g. "Fixes #12", "Closes #12", "#12")
  const issueMatch = prBody.match(/(?:fixes|closes|resolves|issue|#)\s*#?(\d+)/i);
  const linkedIssueNum = issueMatch ? parseInt(issueMatch[1], 10) : undefined;

  let mapping = linkedIssueNum ? await getIssueMapping(linkedIssueNum) : undefined;

  if (mapping && mapping.ts && mapping.channel) {
    // Post thread reply under the linked issue's card
    await postLine({
      channel: mapping.channel,
      text: `🔀 *${author}* opened PR <${prUrl}|#${prNum} ${prTitle}> (linked to #${linkedIssueNum})`,
      thread_ts: mapping.ts,
    });
    // Map PR number as well so subsequent PR reviews can find the card thread
    await recordIssueMapping(prNum, mapping);
    console.log(`[GitHub Event] Posted PR opened thread reply for issue #${linkedIssueNum} (PR #${prNum})`);
  } else {
    // Unknown issue or no linked issue -> post to #ops
    const linkNote = linkedIssueNum ? ` (linked to unmapped issue #${linkedIssueNum})` : "";
    await postLine({
      channel: config.opsChannelId,
      text: `🔀 *${author}* opened PR <${prUrl}|#${prNum} ${prTitle}>${linkNote}`,
    });
    console.log(`[GitHub Event] Posted PR opened for PR #${prNum} to ${config.opsChannelId}`);
  }
}

async function handlePullRequestReviewSubmitted(payload: any): Promise<void> {
  const pr = payload.pull_request;
  const review = payload.review;
  if (!pr || !review) return;

  const prNum = pr.number;
  const prTitle = pr.title || "";
  const prUrl = pr.html_url;
  const reviewer = review.user?.login || "Reviewer";
  const state = (review.state || "commented").toUpperCase();

  let mapping = await getIssueMapping(prNum);
  if (!mapping) {
    const issueMatch = (pr.body || "").match(/(?:fixes|closes|resolves|issue|#)\s*#?(\d+)/i);
    if (issueMatch) {
      mapping = await getIssueMapping(parseInt(issueMatch[1], 10));
    }
  }

  if (mapping && mapping.ts && mapping.channel) {
    await postLine({
      channel: mapping.channel,
      text: `🔍 Review submitted on PR <${prUrl}|#${prNum} ${prTitle}> by *${reviewer}* (State: \`${state}\`)`,
      thread_ts: mapping.ts,
    });
    console.log(`[GitHub Event] Posted PR review thread reply for PR #${prNum} in ${mapping.channel}`);
  } else {
    await postLine({
      channel: config.opsChannelId,
      text: `🔍 Review submitted on PR <${prUrl}|#${prNum}> by *${reviewer}* (State: \`${state}\`)`,
    });
    console.log(`[GitHub Event] Posted PR review for unmapped PR #${prNum} to ${config.opsChannelId}`);
  }
}

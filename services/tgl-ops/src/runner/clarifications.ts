import { findNeedsBriefIssueByThreadTs } from "../lib/issues-index.js";
import {
  getIssue,
  updateIssueBody,
  addCommentToIssue,
  removeLabelFromIssue,
  addLabelsToIssue,
} from "../lib/github-client.js";
import { runPreflightCheck, type PreflightResult } from "./preflight.js";
import { runIssueTask, type RunnerRunResult } from "./runner.js";
import { postLine } from "../lib/post.js";
import { getCurrentTimeIST } from "../lib/standup.js";

export interface ClarificationResult {
  handled: boolean;
  issueNumber?: number;
  verdict?: "proceed" | "needs-brief" | "refuse";
  reason?: string;
  runResult?: RunnerRunResult;
}

/**
 * When the Architect replies in the card thread of a needs-brief issue,
 * treat the reply as the answers — append it to the brief, re-run pre-flight,
 * and continue if it now proceeds.
 */
export async function handleNeedsBriefClarification(params: {
  channel: string;
  threadTs: string;
  replyText: string;
  actor: string;
  testMode?: boolean;
}): Promise<ClarificationResult> {
  const { channel, threadTs, replyText, actor, testMode } = params;
  const timeStr = getCurrentTimeIST();

  // 1. Look up mapped issue
  const mapping = await findNeedsBriefIssueByThreadTs(threadTs, { testMode });
  if (!mapping) {
    return { handled: false };
  }

  const issueNum = mapping.issueNumber;
  const ghIssue = await getIssue(issueNum);
  if (!ghIssue || ghIssue.state !== "open") {
    return { handled: false, issueNumber: issueNum };
  }

  // Verify issue is actually in status:needs-brief
  if (!ghIssue.labels.includes("status:needs-brief")) {
    return { handled: false, issueNumber: issueNum };
  }

  console.log(
    `[Clarifications] Architect ${actor} replied to needs-brief issue #${issueNum} in thread ${threadTs}: "${replyText.slice(0, 100)}"`
  );

  // 2. Treat the reply as the answers: append it to the brief
  const answerSection = `\n\n### Architect Clarification (${timeStr} IST by ${actor})\n${replyText.trim()}`;
  const updatedBody = `${ghIssue.body}${answerSection}`;

  await updateIssueBody(issueNum, updatedBody);
  await addCommentToIssue(
    issueNum,
    `💬 **Architect Clarification (via card thread):**\n\n${replyText.trim()}`
  ).catch(() => {});

  // 3. Re-run pre-flight check
  const agentName = mapping.entry.agent || "web-builder";
  const preflight = await runPreflightCheck({
    issueNumber: issueNum,
    title: ghIssue.title,
    body: updatedBody,
    deliverable: ghIssue.title,
    agentName,
  });

  console.log(
    `[Clarifications Pre-flight Verdict on #${issueNum}]: ${preflight.verdict} — ${preflight.reason}`
  );

  // 4. Continue if it now proceeds
  if (preflight.verdict === "proceed") {
    await removeLabelFromIssue(issueNum, "status:needs-brief");
    await addLabelsToIssue(issueNum, ["status:in-progress"]);

    await postLine({
      channel,
      thread_ts: threadTs,
      text: `✅ *[Pre-flight Passed with Clarifications]* The brief now satisfies all criteria:\n• ${preflight.reason}\n• Status updated to \`status:in-progress\`. Executing task...`,
    });

    // Run the issue task
    const runResult = await runIssueTask(
      {
        number: issueNum,
        title: ghIssue.title,
        body: updatedBody,
        labels: ghIssue.labels.filter((l) => l !== "status:needs-brief").concat("status:in-progress"),
        agentName,
        door: mapping.entry.door,
        slackChannel: channel,
        slackThreadTs: threadTs,
      },
      { testMode }
    );

    return {
      handled: true,
      issueNumber: issueNum,
      verdict: "proceed",
      reason: preflight.reason,
      runResult,
    };
  }

  if (preflight.verdict === "needs-brief") {
    const questionsBlock =
      preflight.questions && preflight.questions.length > 0
        ? `\n\n*Remaining Clarification Questions:*\n${preflight.questions.join("\n")}`
        : "";

    await postLine({
      channel,
      thread_ts: threadTs,
      text: `⚠️ *[Pre-flight: Still Needs Brief]*\n${preflight.reason}${questionsBlock}`,
    });

    return {
      handled: true,
      issueNumber: issueNum,
      verdict: "needs-brief",
      reason: preflight.reason,
    };
  }

  if (preflight.verdict === "refuse") {
    await removeLabelFromIssue(issueNum, "status:needs-brief");
    await addLabelsToIssue(issueNum, ["status:rejected", "approved:no"]);

    await postLine({
      channel,
      thread_ts: threadTs,
      text: `⛔ *[Pre-flight Refusal: Guardrail Violation]*\n${preflight.reason}`,
    });

    return {
      handled: true,
      issueNumber: issueNum,
      verdict: "refuse",
      reason: preflight.reason,
    };
  }

  return { handled: true, issueNumber: issueNum, verdict: preflight.verdict };
}

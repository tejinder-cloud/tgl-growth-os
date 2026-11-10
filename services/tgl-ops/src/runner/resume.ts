import { config, isTestMode } from "../config.js";
import {
  getIssue,
  reopenIssue,
  addCommentToIssue,
  updateIssueBody,
  removeLabelFromIssue,
  addLabelsToIssue,
  findLinkedPR,
} from "../lib/github-client.js";
import { getRunnerState, resetRunnerIssue } from "./state.js";
import { runIssueTask, type RunnerRunResult } from "./runner.js";
import { postLine } from "../lib/post.js";
import { getCurrentTimeIST } from "../lib/standup.js";

export interface ResumeIssueParams {
  issueNumber: number;
  instructionText: string;
  source: "intake" | "thread";
  actor?: string;
  slackChannel?: string;
  slackThreadTs?: string;
  testMode?: boolean;
  triggerRunnerInTestMode?: boolean;
}

export interface ResumeIssueResult {
  success: boolean;
  issueNumber: number;
  branchName?: string;
  agent: string;
  door: string;
  replyText: string;
  runResult?: RunnerRunResult;
}

/**
 * Resumes an issue given an Architect instruction (either from Slack intake "#N: ..."
 * or from a reply in a card thread after Discuss).
 *
 * Rules:
 * 1. Reopens the issue if closed on GitHub.
 * 2. Appends the instruction as a comment on GitHub.
 * 3. Removes status:completed, approved:yes, status:blocked, status:needs-brief.
 * 4. Adds status:in-progress and for:<agent>.
 * 5. If the issue has an existing branch (from runner state or open PR), preserves that branch.
 * 6. Resets runner state via resetRunnerIssue (clears recovery_attempts, tool_calls_count=0, status=in-progress).
 * 7. Triggers the runner session on that existing branch.
 * 8. Confirms in Slack thread: "→ @<agent>, #<issue> resumed, card in #doors-<door>".
 */
export async function resumeIssueWithInstruction(
  params: ResumeIssueParams
): Promise<ResumeIssueResult> {
  const {
    issueNumber,
    instructionText,
    source,
    actor = "Architect",
    slackChannel,
    slackThreadTs,
    testMode,
    triggerRunnerInTestMode,
  } = params;

  const isTest = testMode === true || isTestMode();
  const existingIssue = await getIssue(issueNumber);

  // 1. Reopen if closed
  if (existingIssue && existingIssue.state === "closed") {
    await reopenIssue(issueNumber);
  }

  // 2. Add Architect instruction comment and update issue body
  const sourceLabel = source === "thread" ? "card thread" : "Slack intake";
  await addCommentToIssue(
    issueNumber,
    `**Architect Instruction (via ${sourceLabel}):**\n\n${instructionText.trim()}`
  ).catch(() => {});

  const timeIST = getCurrentTimeIST();
  const instructionBlock = `\n\n### Architect Instruction (${timeIST} by ${actor} via ${sourceLabel})\n${instructionText.trim()}\n`;
  const effectiveBody = `${existingIssue?.body || ""}${instructionBlock}`;
  try {
    await updateIssueBody(issueNumber, effectiveBody);
  } catch (bodyErr: any) {
    console.warn(`[Resume Issue #${issueNumber}] updateIssueBody warning:`, bodyErr.message || bodyErr);
  }

  // 3. Resolve assigned agent: keep issue's assigned agent, or web-builder for build issues
  const isBuildIssue =
    existingIssue?.labels.some((l) => l === "type:build") ||
    /(?:runner|pdf|build|code|engine|script|app|short-form|worker|template)/i.test(instructionText) ||
    (existingIssue && /(?:runner|pdf|build|code|engine|script|app|short-form|worker|template)/i.test(existingIssue.title));

  let assignedAgent = "web-builder";
  if (existingIssue) {
    const forLabel = existingIssue.labels.find((l) => l.startsWith("for:"));
    if (forLabel) {
      assignedAgent = forLabel.replace(/^for:/, "");
    } else if (isBuildIssue) {
      assignedAgent = "web-builder";
    }
  }

  // 4. Resolve door and channel
  let door = "aeo";
  if (existingIssue) {
    const doorLabel = existingIssue.labels.find((l) => l.startsWith("door:"));
    if (doorLabel) {
      door = doorLabel.replace(/^door:/, "");
    }
  }
  const doorChannel = `#doors-${door}`;

  // 5. Update GitHub labels
  await removeLabelFromIssue(issueNumber, "status:completed").catch(() => {});
  await removeLabelFromIssue(issueNumber, "approved:yes").catch(() => {});
  await removeLabelFromIssue(issueNumber, "status:blocked").catch(() => {});
  await removeLabelFromIssue(issueNumber, "status:needs-brief").catch(() => {});
  await addLabelsToIssue(issueNumber, ["status:in-progress", `for:${assignedAgent}`]).catch(() => {});

  // 6. Resolve existing branch (from runner state or open PR)
  const runnerState = await getRunnerState({ testMode: isTest });
  const existingRecord = runnerState.runs[String(issueNumber)];
  let branchName = existingRecord?.branch;

  if (!branchName && !isTest) {
    try {
      const openPr = await findLinkedPR(issueNumber, { state: "open" });
      if (openPr?.headRefName) {
        branchName = openPr.headRefName;
      }
    } catch (prErr: any) {
      console.warn(`[Resume Issue #${issueNumber}] PR lookup warning:`, prErr.message);
    }
  }

  // 7. Reset runner issue state with fresh session budget on existing branch
  await resetRunnerIssue(
    issueNumber,
    {
      agent: assignedAgent,
      door,
      title: existingIssue?.title || `Issue #${issueNumber}`,
      branch: branchName,
      status: "in-progress",
    },
    { testMode: isTest }
  );

  // 8. Trigger runner session
  let runResult: RunnerRunResult | undefined;
  try {
    if (!isTest || triggerRunnerInTestMode) {
      const issueInput = {
        number: issueNumber,
        title: existingIssue?.title || `Issue #${issueNumber}`,
        body: effectiveBody,
        labels: existingIssue?.labels || ["status:in-progress", `for:${assignedAgent}`, `door:${door}`],
        html_url: existingIssue?.html_url,
        agentName: assignedAgent,
        door,
        slackChannel,
        slackThreadTs,
      };
      runResult = await runIssueTask(issueInput, { testMode: isTest });
    } else {
      console.log(`[Resume Test Mode] Runner re-queued for issue #${issueNumber} (@${assignedAgent}) on branch "${branchName || "new"}"`);
    }
  } catch (err: any) {
    console.warn(`[Resume] Could not trigger runner for issue #${issueNumber}:`, err?.message || String(err));
  }

  // 9. Post confirmation in Slack
  const replyText = `→ @${assignedAgent}, #${issueNumber} resumed, card in ${doorChannel}`;
  if (slackChannel) {
    await postLine({
      channel: slackChannel,
      text: replyText,
      thread_ts: slackThreadTs,
    }).catch(() => {});
  }

  return {
    success: true,
    issueNumber,
    branchName,
    agent: assignedAgent,
    door,
    replyText,
    runResult,
  };
}

import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { slackClient, openModal, getActorDisplayName } from "../lib/slack-client.js";
import {
  appendFileInRepo,
  addLabelsToIssue,
  removeLabelFromIssue,
  squashMergePR,
  closePR,
  closeIssue,
  deleteBranch,
} from "../lib/github-client.js";
import { postLine } from "../lib/post.js";
import { getTodayDateString, getCurrentTimeIST } from "../lib/standup.js";
import { findAgentByName } from "../lib/agents.js";
import { runIssueTask } from "../runner/runner.js";

export const interactionsRouter = Router();

interactionsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  let payload: any;
  try {
    payload = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body;
  } catch (err) {
    console.error("[Interactions Parse Error]", err);
    res.status(400).send("Invalid JSON payload");
    return;
  }

  // 1. Handle Block Actions (Approve, Reject, Discuss button clicks)
  if (payload.type === "block_actions") {
    res.status(200).send(""); // Acknowledge button click immediately within 3 seconds

    const action = payload.actions?.[0];
    if (!action) return;

    (async () => {
      try {
        if (action.action_id === "action_approve") {
          await handleApproveAction(payload, action);
        } else if (action.action_id === "action_discuss") {
          await handleDiscussAction(payload, action);
        } else if (action.action_id === "action_reject") {
          await handleRejectModalOpen(payload, action);
        } else if (action.action_id === "action_picked_up") {
          await handlePickedUpAction(payload, action);
        }
      } catch (err) {
        console.error("[Interaction Action Error]", err);
      }
    })();
    return;
  }

  // 2. Handle Modal Submissions (Reject Reason submission)
  if (payload.type === "view_submission") {
    if (payload.view?.callback_id === "modal_reject_reason") {
      res.json({ response_action: "clear" });
      (async () => {
        try {
          await handleRejectSubmission(payload);
        } catch (err) {
          console.error("[Modal Submission Error]", err);
        }
      })();
      return;
    }
  }

  res.status(200).send("OK");
});

/**
 * Converts Slack mrkdwn link format <URL|TEXT> to standard Markdown [TEXT](URL).
 */
export function formatSlackToMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1");
}

/**
 * Ensures target link is formatted as a markdown link [#N](url), never raw or Slack syntax.
 */
export function formatMarkdownRefLink(url: string, refNum?: number): string {
  if (!url) return "";
  const cleanUrl = url.replace(/^[<](https?:\/\/[^>|]+).*[>]$/, "$1");
  if (refNum) {
    return `[#${refNum}](${cleanUrl})`;
  }
  const match = cleanUrl.match(/\/(?:issues|pull)\/(\d+)/i);
  if (match) {
    return `[#${match[1]}](${cleanUrl})`;
  }
  return cleanUrl;
}

async function handleApproveAction(payload: any, action: any): Promise<void> {
  const meta = JSON.parse(action.value || "{}");
  const actor = await getActorDisplayName(payload.user);
  const agent = meta.agent || "web-builder";
  const summary = meta.summary || meta.title || "Task approval";

  // Extract PR and issue numbers
  const prNum = meta.pr ? parseInt(meta.pr, 10) : undefined;
  const linkedIssueNum = meta.linkedIssue
    ? parseInt(meta.linkedIssue, 10)
    : meta.issue && !prNum
    ? parseInt(meta.issue, 10)
    : undefined;
  const issueNum = linkedIssueNum || (meta.issue ? parseInt(meta.issue, 10) : undefined);

  let prUrl = meta.prUrl;
  let issueUrl = meta.issueUrl;
  if (!prUrl && prNum) {
    prUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/pull/${prNum}`;
  }
  if (!issueUrl && issueNum) {
    issueUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}`;
  }
  const targetUrl = prUrl || issueUrl || `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/1`;

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const channel = payload.channel?.id || meta.channel || config.approvalsChannelId;
  const messageTs = payload.container?.message_ts;

  console.log(`[Action Approve] Actor: ${actor} | Agent: ${agent} | PR: #${prNum} | Issue: #${issueNum}`);

  // Format with strict markdown link [#N](url), never Slack <url|text>
  const cleanSummary = formatSlackToMarkdown(summary);
  const targetLink = formatMarkdownRefLink(targetUrl, prNum || issueNum);
  const decisionLine = `- ${timeStr} IST · ${actor} · APPROVE · ${agent} · ${cleanSummary} · ${targetLink}`;

  // 1. If this is a PR approval, squash-merge the PR first
  let mergeSuccess = true;
  let mergeError: string | undefined;
  if (prNum) {
    console.log(`[Action Approve] Squash-merging PR #${prNum}...`);
    const mergeRes = await squashMergePR(
      prNum,
      meta.title || `Squash-merge PR #${prNum}`,
      `Merged autonomously upon Architect approval by ${actor}`
    );
    mergeSuccess = mergeRes.success;
    mergeError = mergeRes.error;
    if (!mergeSuccess) {
      console.error(`[Action Approve] Failed to squash-merge PR #${prNum}:`, mergeError);
    }
  }

  // 2. If PR merge succeeded (or not a PR), close linked issue with comment and update labels
  if (mergeSuccess) {
    if (linkedIssueNum) {
      await closeIssue(
        linkedIssueNum,
        prNum
          ? `Closed automatically upon Architect approval and squash-merge of PR #${prNum}.`
          : `Closed upon Architect approval by ${actor}.`
      );
      await removeLabelFromIssue(linkedIssueNum, "status:in-progress");
      await addLabelsToIssue(linkedIssueNum, ["approved:yes", "status:completed"]);
    } else if (issueNum) {
      await addLabelsToIssue(issueNum, ["approved:yes"]);
    }

    // 3. Append to decisions/YYYY-MM-DD.md
    const appendRes = await appendFileInRepo(
      `decisions/${dateStr}.md`,
      decisionLine,
      `chore(decision): approve ${agent} ${prNum ? `PR #${prNum}` : "task"} per ${actor}`
    );

    if (appendRes.success) {
      // Update card message
      if (messageTs && config.slackBotToken) {
        try {
          const originalBlocks = payload.message?.blocks || [];
          const updatedBlocks = originalBlocks
            .filter((b: any) => b.block_id !== "card_actions")
            .concat([
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: prNum
                    ? `✅ *Approved and Squash-Merged by ${actor} at ${timeStr} IST*\n_Recorded in \`decisions/${dateStr}.md\`._`
                    : `✅ *Approved by ${actor} at ${timeStr} IST*\n_Recorded in \`decisions/${dateStr}.md\`._`,
                },
              },
            ]);

          await slackClient.chat.update({
            channel,
            ts: messageTs,
            text: `✅ Approved: ${meta.title} by ${actor}`,
            blocks: updatedBlocks,
          });
        } catch (err) {
          console.warn("[Card Update Warning]", err);
        }
      }

      // Post "Merged" in thread per requirement:
      // "Approve → the service squash-merges the PR (admin token), closes the issue with a comment, writes the decisions/ line (bullet, Slack message time), posts "Merged" in the thread."
      if (prNum) {
        await postLine({
          channel,
          text: "Merged",
          thread_ts: messageTs,
        });
      } else {
        await postLine({
          channel,
          text: `✅ Decision recorded: Approved by ${actor} at ${timeStr} IST. Appended to \`decisions/${dateStr}.md\`.`,
          thread_ts: messageTs,
        });
      }
    } else {
      // Decisions write failed
      const failureMsg = `Decision captured in Slack but NOT written to repo — ${appendRes.status || 500} ${appendRes.error || "Unknown error"}`;
      if (messageTs) {
        await postLine({ channel, text: failureMsg, thread_ts: messageTs });
      }
      await postLine({ channel: config.alertsChannelId, text: failureMsg });
    }
  } else {
    // PR Merge failed
    const mergeFailMsg = `⚠️ Failed to squash-merge PR #${prNum} — ${mergeError || "Merge conflict or permission error"}`;
    if (messageTs) {
      await postLine({ channel, text: mergeFailMsg, thread_ts: messageTs });
    }
    await postLine({ channel: config.alertsChannelId, text: mergeFailMsg });
  }
}

async function handleDiscussAction(payload: any, action: any): Promise<void> {
  const meta = JSON.parse(action.value || "{}");
  const actor = await getActorDisplayName(payload.user);
  const agent = meta.agent || "web-builder";
  const channel = payload.channel?.id || meta.channel || config.approvalsChannelId;
  const messageTs = payload.container?.message_ts;

  await postLine({
    channel,
    text: `💬 \`@${agent}\` — discussion requested by ${actor}. Please review the brief and proposal above and respond in this thread.`,
    thread_ts: messageTs,
  });
}

async function handleRejectModalOpen(payload: any, action: any): Promise<void> {
  const triggerId = payload.trigger_id;
  const meta = JSON.parse(action.value || "{}");
  const messageTs = payload.container?.message_ts;

  const modalView = {
    type: "modal",
    callback_id: "modal_reject_reason",
    title: {
      type: "plain_text",
      text: "Reject Task Proposal",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "Confirm Rejection",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true,
    },
    private_metadata: JSON.stringify({
      ...meta,
      message_ts: messageTs,
      channel: payload.channel?.id || meta.channel,
    }),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Rejecting proposal for *\`${meta.agent}\`*: *${meta.title}*.\nPer AGENTS.md, rejections must include a rationale so the agent learns and never re-proposes.`,
        },
      },
      {
        type: "input",
        block_id: "reason_block",
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Explain why this proposal is rejected (e.g. brand violation, pricing rule, wrong fit)...",
          },
        },
        label: {
          type: "plain_text",
          text: "Rejection Reason (Required)",
        },
      },
    ],
  };

  await openModal(triggerId, modalView);
}

async function handleRejectSubmission(payload: any): Promise<void> {
  const meta = JSON.parse(payload.view?.private_metadata || "{}");
  const values = payload.view?.state?.values || {};
  const reason = values.reason_block?.reason_input?.value || "No reason specified";

  const actor = await getActorDisplayName(payload.user);
  const agent = meta.agent || "web-builder";
  const summary = meta.summary || meta.title || "Task rejected";

  const prNum = meta.pr ? parseInt(meta.pr, 10) : undefined;
  const linkedIssueNum = meta.linkedIssue
    ? parseInt(meta.linkedIssue, 10)
    : meta.issue && !prNum
    ? parseInt(meta.issue, 10)
    : undefined;
  const branchName = meta.branch;
  const issueNum = linkedIssueNum || (meta.issue ? parseInt(meta.issue, 10) : undefined);

  let targetUrl = meta.prUrl || meta.issueUrl;
  if (!targetUrl && prNum) {
    targetUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/pull/${prNum}`;
  } else if (!targetUrl && issueNum) {
    targetUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}`;
  } else if (!targetUrl) {
    targetUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/1`;
  }

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const channel = meta.channel || config.approvalsChannelId;
  const messageTs = meta.message_ts;

  console.log(`[Action Reject] Actor: ${actor} | Agent: ${agent} | PR: #${prNum} | Issue: #${issueNum} | Reason: "${reason}"`);

  const cleanSummary = formatSlackToMarkdown(summary);
  const cleanReason = formatSlackToMarkdown(reason);
  const targetLink = formatMarkdownRefLink(targetUrl, prNum || issueNum);

  // 1. Append to decisions/YYYY-MM-DD.md using strict markdown link [#N](url)
  const decisionLine = `- ${timeStr} IST · ${actor} · REJECT · ${agent} · ${cleanSummary} (Reason: ${cleanReason}) · ${targetLink}`;
  const decRes = await appendFileInRepo(
    `decisions/${dateStr}.md`,
    decisionLine,
    `chore(decision): reject ${agent} task per ${actor}`
  );

  // 2. Append to rejections/YYYY-MM-DD.md
  const rejectionBlock = `
## ${timeStr} IST — ${formatSlackToMarkdown(meta.title || summary)}
- **Agent:** \`${agent}\`
- **Reviewer / Actor:** ${actor}
- **Task / Reference:** ${targetLink}
- **Reason for Rejection:** ${cleanReason}
`;
  const rejRes = await appendFileInRepo(
    `rejections/${dateStr}.md`,
    rejectionBlock,
    `chore(rejections): log rejected proposal for ${agent}`
  );

  // 3. Close PR and delete branch if PR exists
  if (prNum) {
    console.log(`[Action Reject] Closing PR #${prNum}...`);
    await closePR(prNum);
  }
  if (branchName) {
    console.log(`[Action Reject] Deleting working branch ${branchName}...`);
    await deleteBranch(branchName);
  }

  // 4. Label issue status:rejected and approved:no
  if (issueNum) {
    await removeLabelFromIssue(issueNum, "status:in-progress");
    await addLabelsToIssue(issueNum, ["status:rejected", "approved:no"]);
  }

  // 5. Update Slack card or post alert
  if (decRes.success && rejRes.success) {
    if (messageTs && config.slackBotToken) {
      try {
        const rejectText = `❌ *Proposal Rejected by ${actor} at ${timeStr} IST*\n*Reason:* ${reason}\n_Recorded in \`rejections/${dateStr}.md\` and \`decisions/${dateStr}.md\`._`;
        await slackClient.chat.postMessage({
          channel,
          thread_ts: messageTs,
          text: rejectText,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: rejectText,
              },
            },
          ],
        });
      } catch (err) {
        console.warn("[Card Update Warning on Reject]", err);
      }
    }
  } else {
    const failedRes = !decRes.success ? decRes : rejRes;
    const failureMsg = `Decision captured in Slack but NOT written to the repo — ${failedRes.status || 500} ${failedRes.error || "Unknown error"}`;

    if (messageTs) {
      await postLine({
        channel,
        text: failureMsg,
        thread_ts: messageTs,
      });
    }

    await postLine({
      channel: config.alertsChannelId,
      text: failureMsg,
    });
  }
}

async function handlePickedUpAction(payload: any, action: any): Promise<void> {
  const meta = JSON.parse(action.value || "{}");
  const actor = await getActorDisplayName(payload.user);
  const issueNum = meta.issue ? parseInt(meta.issue, 10) : undefined;
  const timeStr = getCurrentTimeIST();
  const channel = payload.channel?.id || meta.channel;
  const messageTs = payload.container?.message_ts;

  console.log(`[Action Picked Up] Actor: ${actor} | Issue: #${issueNum} | Channel: ${channel}`);

  // 1. Add label status:in-progress to the GitHub issue
  if (issueNum) {
    await addLabelsToIssue(issueNum, ["status:in-progress"]);
  }

  // 2. Update card in Slack to remove "Picked up" button and show in-progress badge
  if (messageTs && config.slackBotToken) {
    try {
      const originalBlocks = payload.message?.blocks || [];
      const updatedBlocks = originalBlocks
        .filter((b: any) => b.block_id !== "task_actions" && b.block_id !== "card_actions")
        .concat([
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🚀 *Picked up by ${actor} at ${timeStr} IST*\n*Status:* \`status:in-progress\``,
            },
          },
        ]);

      await slackClient.chat.update({
        channel,
        ts: messageTs,
        text: `🚀 Picked up: #${issueNum} by ${actor}`,
        blocks: updatedBlocks,
      });
    } catch (err) {
      console.warn("[Card Update Warning on Picked Up]", err);
    }
  }

  // 3. Post confirmation in-thread
  if (channel && messageTs) {
    const issueLink = issueNum
      ? `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}`
      : meta.issueUrl;
    await postLine({
      channel,
      text: `🚀 Task <${issueLink}|#${issueNum}> picked up by *${actor}* at ${timeStr} IST (marked \`status:in-progress\`).`,
      thread_ts: messageTs,
    });
  }

  // 4. Trigger runner if agent has autorun: true
  if (issueNum) {
    const agentRecord = await findAgentByName(meta.agent || "web-builder");
    if (agentRecord?.autorun === true) {
      console.log(`[Action Picked Up] Agent @${agentRecord.name} has autorun: true; invoking runner for #${issueNum}...`);
      (async () => {
        try {
          await runIssueTask({
            number: issueNum,
            title: meta.title || `Issue #${issueNum}`,
            body: meta.summary || meta.body || "",
            labels: [`for:${agentRecord.name}`, "status:in-progress"],
            agentName: agentRecord.name,
            door: meta.door || "core",
            slackChannel: channel,
            slackThreadTs: messageTs,
          });
        } catch (err) {
          console.error(`[Action Picked Up Runner Error on #${issueNum}]:`, err);
        }
      })();
    }
  }
}



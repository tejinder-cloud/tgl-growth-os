import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { slackClient, openModal, getActorDisplayName } from "../lib/slack-client.js";
import { appendFileInRepo, addLabelsToIssue } from "../lib/github-client.js";
import { postLine } from "../lib/post.js";
import { getTodayDateString, getCurrentTimeIST } from "../lib/standup.js";

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

async function handleApproveAction(payload: any, action: any): Promise<void> {
  const meta = JSON.parse(action.value || "{}");
  const actor = await getActorDisplayName(payload.user);
  const agent = meta.agent || "web-builder";
  const summary = meta.summary || meta.title || "Task approval";
  const issueNum = meta.issue ? parseInt(meta.issue, 10) : undefined;
  let issueUrl: string;
  if (issueNum) {
    issueUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}`;
  } else if (meta.issueUrl) {
    issueUrl = meta.issueUrl;
  } else if (meta.prUrl) {
    issueUrl = meta.prUrl;
  } else {
    const foundLink = (meta.links || []).find((l: any) => l.url?.includes("/issues/") || l.url?.includes("/pull/"));
    issueUrl = foundLink ? foundLink.url : `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/1`;
  }

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const channel = payload.channel?.id || meta.channel || config.approvalsChannelId;
  const messageTs = payload.container?.message_ts;

  console.log(`[Action Approve] Actor: ${actor} | Agent: ${agent} | Issue: #${issueNum}`);

  // Format: "HH:MM IST · <actor> · <APPROVE|REJECT> · <agent> · <summary> · <issue/PR url>"
  const decisionLine = `${timeStr} IST · ${actor} · APPROVE · ${agent} · ${summary} · ${issueUrl}`;

  // Append to decisions/YYYY-MM-DD.md
  const appendRes = await appendFileInRepo(
    `decisions/${dateStr}.md`,
    decisionLine,
    `chore(decision): approve ${agent} task per ${actor}`
  );

  // Label issue approved:yes
  if (issueNum) {
    await addLabelsToIssue(issueNum, ["approved:yes"]);
  }

  if (appendRes.success) {
    // 200/201 Success: Update card message to show approved status with "Recorded"
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
                text: `✅ *Approved by ${actor} at ${timeStr} IST*\n_Recorded in \`decisions/${dateStr}.md\`._`,
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

    // Post confirmation in thread
    await postLine({
      channel,
      text: `✅ Decision recorded: Approved by ${actor} at ${timeStr} IST. Appended to \`decisions/${dateStr}.md\`.`,
      thread_ts: messageTs,
    });
  } else {
    // Failure (any status other than 200/201): Never report a write that didn't happen!
    const failureMsg = `Decision captured in Slack but NOT written to the repo — ${appendRes.status || 500} ${appendRes.error || "Unknown error"}`;

    // Update card to remove buttons without falsely claiming "Recorded"
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
                text: `⚠️ *Decision captured by ${actor} at ${timeStr} IST*\n${failureMsg}`,
              },
            },
          ]);

        await slackClient.chat.update({
          channel,
          ts: messageTs,
          text: `⚠️ Approved (Repo Write Failed): ${meta.title} by ${actor}`,
          blocks: updatedBlocks,
        });
      } catch (err) {
        console.warn("[Card Update Warning on Failure]", err);
      }
    }

    // Post failure notification in-thread
    await postLine({
      channel,
      text: failureMsg,
      thread_ts: messageTs,
    });

    // Post failure notification to #alerts
    await postLine({
      channel: config.alertsChannelId,
      text: failureMsg,
    });
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
  const issueNum = meta.issue ? parseInt(meta.issue, 10) : undefined;
  let issueUrl: string;
  if (issueNum) {
    issueUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}`;
  } else if (meta.issueUrl) {
    issueUrl = meta.issueUrl;
  } else if (meta.prUrl) {
    issueUrl = meta.prUrl;
  } else {
    const foundLink = (meta.links || []).find((l: any) => l.url?.includes("/issues/") || l.url?.includes("/pull/"));
    issueUrl = foundLink ? foundLink.url : `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/1`;
  }

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const channel = meta.channel || config.approvalsChannelId;
  const messageTs = meta.message_ts;

  console.log(`[Action Reject] Actor: ${actor} | Agent: ${agent} | Reason: "${reason}"`);

  // 1. Append to decisions/YYYY-MM-DD.md
  const decisionLine = `${timeStr} IST · ${actor} · REJECT · ${agent} · ${summary} (Reason: ${reason}) · ${issueUrl}`;
  const decRes = await appendFileInRepo(
    `decisions/${dateStr}.md`,
    decisionLine,
    `chore(decision): reject ${agent} task per ${actor}`
  );

  // 2. Append to rejections/YYYY-MM-DD.md
  const rejectionBlock = `
## ${timeStr} IST — ${meta.title || summary}
- **Agent:** \`${agent}\`
- **Reviewer / Actor:** ${actor}
- **Task / Reference:** ${issueUrl}
- **Reason for Rejection:** ${reason}
`;
  const rejRes = await appendFileInRepo(
    `rejections/${dateStr}.md`,
    rejectionBlock,
    `chore(rejections): log rejected proposal for ${agent}`
  );

  // 3. Label issue approved:no
  if (issueNum) {
    await addLabelsToIssue(issueNum, ["approved:no"]);
  }

  // 4. Update Slack card or post alert
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
}



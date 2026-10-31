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
  getPR,
} from "../lib/github-client.js";
import { postLine } from "../lib/post.js";
import { getTodayDateString, getCurrentTimeIST } from "../lib/standup.js";
import { findAgentByName } from "../lib/agents.js";
import { runIssueTask } from "../runner/runner.js";
import { handleSetupAction, handleSetupChangesSubmission } from "../agents/aeo-strategist/worker.js";

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
        if (typeof action.action_id === "string" && action.action_id.startsWith("setup_")) {
          await handleSetupAction(payload, action);
        } else if (action.action_id === "action_approve") {
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
    if (payload.view?.callback_id === "setup_changes_modal") {
      res.json({ response_action: "clear" });
      handleSetupChangesSubmission(payload).catch((err) => console.error("[Setup Changes Submission Error]", err));
      return;
    }
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

export interface ResolvedTargets {
  prNum?: number;
  linkedIssueNum?: number;
  issueNum?: number;
  branchName?: string;
  prUrl?: string;
  issueUrl?: string;
  targetUrl: string;
}

/**
 * Robustly resolves PR, issue, branch, and target URL from card action metadata.
 * Detects PRs even when meta.pr was omitted, inspecting URLs, links, titles, summaries,
 * and checking GitHub pulls API if an issue number actually represents a PR.
 */
export async function resolveActionTargets(meta: any): Promise<ResolvedTargets> {
  let prNum = meta.pr ? parseInt(meta.pr, 10) : undefined;
  let linkedIssueNum = meta.linkedIssue ? parseInt(meta.linkedIssue, 10) : undefined;
  const branchName = meta.branch;

  // 1. If prNum not explicitly set, search URLs, links, summary, and title
  if (!prNum && meta.prUrl) {
    const m = meta.prUrl.match(/\/pull\/(\d+)/i);
    if (m) prNum = parseInt(m[1], 10);
  }
  if (!prNum && meta.targetUrl) {
    const m = meta.targetUrl.match(/\/pull\/(\d+)/i);
    if (m) prNum = parseInt(m[1], 10);
  }
  if (!prNum && Array.isArray(meta.links)) {
    for (const l of meta.links) {
      const m = (l.url || "").match(/\/pull\/(\d+)/i);
      if (m) {
        prNum = parseInt(m[1], 10);
        break;
      }
    }
  }
  if (!prNum && meta.summary) {
    const m = meta.summary.match(/(?:pull\/|PR\s*(?:<[^>]+>)?#?)(\d+)/i);
    if (m) prNum = parseInt(m[1], 10);
  }
  if (!prNum && meta.title) {
    const m = meta.title.match(/(?:pull\/|PR\s*#?)(\d+)/i);
    if (m) prNum = parseInt(m[1], 10);
  }

  // 2. Extract linkedIssueNum from summary or title if not explicitly set
  if (!linkedIssueNum && meta.summary) {
    const m = meta.summary.match(/(?:for issue|fixes|closes|resolves|linked to)\s*(?:<[^>]+>)?#?(\d+)/i);
    if (m) linkedIssueNum = parseInt(m[1], 10);
  }
  if (!linkedIssueNum && meta.title) {
    const m = meta.title.match(/(?:for issue|fixes|closes|resolves|#)\s*#?(\d+)/i);
    if (m) linkedIssueNum = parseInt(m[1], 10);
  }

  // 3. What if meta.issue was provided?
  if (meta.issue) {
    const rawNum = parseInt(meta.issue, 10);
    if (!isNaN(rawNum)) {
      if (!prNum) {
        // Check if rawNum is actually a PR on GitHub
        const prCheck = await getPR(rawNum);
        if (prCheck.success && prCheck.data) {
          prNum = rawNum;
          if (!linkedIssueNum && prCheck.data.body) {
            const m = prCheck.data.body.match(/(?:fixes|closes|resolves)\s*#?(\d+)/i);
            if (m) linkedIssueNum = parseInt(m[1], 10);
          }
        } else if (!linkedIssueNum) {
          linkedIssueNum = rawNum;
        }
      } else if (rawNum !== prNum && !linkedIssueNum) {
        linkedIssueNum = rawNum;
      }
    }
  }

  // 4. If prNum is present, check if PR body mentions "Fixes #<num>" if linkedIssueNum still unknown
  if (prNum && !linkedIssueNum && config.githubToken) {
    const prDetails = await getPR(prNum);
    if (prDetails.success && prDetails.data?.body) {
      const m = prDetails.data.body.match(/(?:fixes|closes|resolves)\s*#?(\d+)/i);
      if (m) linkedIssueNum = parseInt(m[1], 10);
    }
  }

  // Ensure linkedIssueNum never equals prNum (a PR must never close itself as a linked issue)
  if (linkedIssueNum === prNum) {
    linkedIssueNum = undefined;
  }

  const issueNum = linkedIssueNum;

  let prUrl = meta.prUrl;
  let issueUrl = meta.issueUrl;
  if (!prUrl && prNum) {
    prUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/pull/${prNum}`;
  }
  if (!issueUrl && issueNum) {
    issueUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issueNum}`;
  }

  const targetUrl = prUrl || issueUrl || meta.targetUrl || `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/1`;

  return {
    prNum,
    linkedIssueNum,
    issueNum,
    branchName,
    prUrl,
    issueUrl,
    targetUrl,
  };
}

async function handleApproveAction(payload: any, action: any): Promise<void> {
  const meta = JSON.parse(action.value || "{}");
  const actor = await getActorDisplayName(payload.user);
  const agent = meta.agent || "web-builder";
  const summary = meta.summary || meta.title || "Task approval";

  // Robust target resolution
  const { prNum, linkedIssueNum, issueNum, targetUrl } = await resolveActionTargets(meta);

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const channel = payload.channel?.id || meta.channel || config.approvalsChannelId;
  const messageTs = payload.container?.message_ts;

  console.log(`[Action Approve] Actor: ${actor} | Agent: ${agent} | PR: #${prNum} | LinkedIssue: #${linkedIssueNum} | Issue: #${issueNum}`);

  // Format with strict markdown link [#N](url), never Slack <url|text>
  const cleanSummary = formatSlackToMarkdown(summary);
  const targetLink = formatMarkdownRefLink(targetUrl, prNum || issueNum);

  // 1. If this is a PR approval, squash-merge the PR first
  if (prNum) {
    console.log(`[Action Approve] Squash-merging PR #${prNum}...`);
    const mergeRes = await squashMergePR(
      prNum,
      meta.title || `Squash-merge PR #${prNum}`,
      `Merged autonomously upon Architect approval by ${actor}`
    );

    if (!mergeRes.success) {
      const failReason = mergeRes.error || "Merge conflict or branch protection error";
      console.error(`[Action Approve] Failed to squash-merge PR #${prNum}: ${failReason}`);

      // Record APPROVE-UNMERGED in decisions/YYYY-MM-DD.md
      const unmergedDecisionLine = `- ${timeStr} IST · ${actor} · APPROVE-UNMERGED · ${agent} · ${cleanSummary} · ${targetLink}`;
      const appendRes = await appendFileInRepo(
        `decisions/${dateStr}.md`,
        unmergedDecisionLine,
        `chore(decision): record unmerged approval for ${agent} PR #${prNum} per ${actor}`
      );

      if (!appendRes.success) {
        const failureMsg = `Decision captured in Slack but NOT written to repo — ${appendRes.status || 500} ${appendRes.error || "Unknown error"}`;
        if (messageTs) {
          await postLine({ channel, text: failureMsg, thread_ts: messageTs });
        }
        await postLine({ channel: config.alertsChannelId, text: failureMsg });
      }

      // Post "Approved but NOT merged — <reason>" to thread and #alerts
      const alertMsg = `Approved but NOT merged — ${failReason}`;
      if (messageTs) {
        await postLine({ channel, text: alertMsg, thread_ts: messageTs });
      }
      await postLine({ channel: config.alertsChannelId, text: alertMsg });

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
                  text: `⚠️ *Approved but NOT Merged by ${actor} at ${timeStr} IST*\n*Reason:* ${failReason}\n_Recorded as APPROVE-UNMERGED in \`decisions/${dateStr}.md\`._`,
                },
              },
            ]);

          await slackClient.chat.update({
            channel,
            ts: messageTs,
            text: `⚠️ Approved but NOT merged: ${meta.title || `PR #${prNum}`} by ${actor}`,
            blocks: updatedBlocks,
          });
        } catch (err) {
          console.warn("[Card Update Warning]", err);
        }
      }

      return;
    }
  }

  // 1b. If this is a proposal approval, convert it to a plan entry
  let proposalPlanEntry: any = null;
  if (meta.type === "proposal") {
    try {
      const { addProposalToPlan } = await import("../lib/plan.js");
      proposalPlanEntry = await addProposalToPlan({
        title: meta.title || cleanSummary,
        brief: meta.brief || cleanSummary,
        agent,
        door: meta.door || "core",
        architect_hour: meta.architect_hour || `Review deliverable: ${meta.title || cleanSummary}`,
      });
      console.log(`[Action Approve] Converted proposal to Plan Day ${proposalPlanEntry.day} (${proposalPlanEntry.date})`);
    } catch (err: any) {
      console.error("[Action Approve] Failed to convert proposal to plan:", err.message);
    }
  }

  // 2. PR merge succeeded (or not a PR)
  const decisionLine = proposalPlanEntry
    ? `- ${timeStr} IST · ${actor} · APPROVE · ${agent} · Proposal converted to Plan Day ${proposalPlanEntry.day} (${proposalPlanEntry.date}): ${cleanSummary} · ${targetLink}`
    : `- ${timeStr} IST · ${actor} · APPROVE · ${agent} · ${cleanSummary} · ${targetLink}`;

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
    if (meta.type === "proposal") {
      await closeIssue(issueNum, `Closed upon Architect approval by ${actor}. Scheduled for Plan Day ${proposalPlanEntry?.day || "scheduled"}.`);
      await removeLabelFromIssue(issueNum, "status:in-progress");
      await addLabelsToIssue(issueNum, ["approved:yes", "status:approved", "plan:scheduled"]);
    } else {
      await addLabelsToIssue(issueNum, ["approved:yes"]);
    }
  }

  // If this is a prospect research batch, update status of prospects to 'reviewed'
  if (agent === "prospect-researcher") {
    try {
      const { updateProspectStatus } = await import("../agents/prospect-researcher/db.js");
      await updateProspectStatus({ city: meta.city, category: meta.category }, "reviewed");
    } catch (err: any) {
      console.warn("[Prospects Status Update Error on Approve]:", err.message);
    }
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
        const statusNote =
          proposalPlanEntry
            ? `✅ *Proposal Approved by ${actor} at ${timeStr} IST*\nConverted to Plan Day ${proposalPlanEntry.day} (${proposalPlanEntry.date}). Recorded in \`decisions/${dateStr}.md\`.`
            : agent === "prospect-researcher"
            ? `✅ *Prospects Approved by ${actor} at ${timeStr} IST*\n_Status updated to \`reviewed\` for outreach handoff. Recorded in \`decisions/${dateStr}.md\`._`
            : prNum
            ? `✅ *Approved and Squash-Merged by ${actor} at ${timeStr} IST*\n_Recorded in \`decisions/${dateStr}.md\`._`
            : `✅ *Approved by ${actor} at ${timeStr} IST*\n_Recorded in \`decisions/${dateStr}.md\`._`;

        const updatedBlocks = originalBlocks
          .filter((b: any) => b.block_id !== "card_actions")
          .concat([
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: statusNote,
              },
            },
          ]);

        await slackClient.chat.update({
          channel,
          ts: messageTs,
          text: `✅ Approved: ${meta.title || (prNum ? `PR #${prNum}` : "Task")} by ${actor}`,
          blocks: updatedBlocks,
        });
      } catch (err) {
        console.warn("[Card Update Warning]", err);
      }
    }

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
      ...(meta.agent === "prospect-researcher"
        ? [
            {
              type: "input",
              block_id: "signal_block",
              element: {
                type: "plain_text_input",
                action_id: "signal_input",
                placeholder: {
                  type: "plain_text",
                  text: "The signal that should have caught it (e.g. active agency retainer, generic info@ email, franchise branch)...",
                },
              },
              label: {
                type: "plain_text",
                text: "Missed Signal (Required)",
              },
            },
          ]
        : []),
    ],
  };

  await openModal(triggerId, modalView);
}

async function handleRejectSubmission(payload: any): Promise<void> {
  const meta = JSON.parse(payload.view?.private_metadata || "{}");
  const values = payload.view?.state?.values || {};
  const reason = values.reason_block?.reason_input?.value || "No reason specified";
  const missedSignal = values.signal_block?.signal_input?.value || "";

  const actor = await getActorDisplayName(payload.user);
  const agent = meta.agent || "web-builder";
  const summary = meta.summary || meta.title || "Task rejected";

  const { prNum, linkedIssueNum, issueNum, branchName, targetUrl } = await resolveActionTargets(meta);
  const targetIssueNum = linkedIssueNum || issueNum;

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const channel = meta.channel || config.approvalsChannelId;
  const messageTs = meta.message_ts;

  console.log(`[Action Reject] Actor: ${actor} | Agent: ${agent} | PR: #${prNum} | Issue: #${issueNum} | Reason: "${reason}"`);

  const cleanSummary = formatSlackToMarkdown(summary);
  const cleanReason = formatSlackToMarkdown(reason);
  const cleanSignal = formatSlackToMarkdown(missedSignal);
  const targetLink = formatMarkdownRefLink(targetUrl, prNum || issueNum);

  // If this is a prospect research batch, update status of prospects to 'rejected'
  if (agent === "prospect-researcher") {
    try {
      const { updateProspectStatus } = await import("../agents/prospect-researcher/db.js");
      await updateProspectStatus({ city: meta.city, category: meta.category }, "rejected");
    } catch (err: any) {
      console.warn("[Prospects Status Update Error on Reject]:", err.message);
    }
  }

  // 1. Append to decisions/YYYY-MM-DD.md using strict markdown link [#N](url)
  const decisionLine = `- ${timeStr} IST · ${actor} · REJECT · ${agent} · ${cleanSummary} (Reason: ${cleanReason}${cleanSignal ? `; Missed Signal: ${cleanSignal}` : ""}) · ${targetLink}`;
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
- **Reason for Rejection:** ${cleanReason}${cleanSignal ? `\n- **Signal That Should Have Caught It:** ${cleanSignal}` : ""}
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
  if (targetIssueNum) {
    await removeLabelFromIssue(targetIssueNum, "status:in-progress");
    await addLabelsToIssue(targetIssueNum, ["status:rejected", "approved:no"]);
  }

  // 5. Update Slack card or post alert
  if (decRes.success && rejRes.success) {
    if (messageTs && config.slackBotToken) {
      try {
        const rejectText = `❌ *Proposal Rejected by ${actor} at ${timeStr} IST*\n*Reason:* ${reason}${missedSignal ? `\n*Missed Signal:* ${missedSignal}` : ""}\n_Recorded in \`rejections/${dateStr}.md\` and \`decisions/${dateStr}.md\`._`;
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



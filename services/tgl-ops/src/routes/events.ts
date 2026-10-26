import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { loadAgents } from "../lib/agents.js";
import { createIssue, addCommentToIssue, appendFileInRepo } from "../lib/github-client.js";
import { postLine } from "../lib/post.js";
import { getActorDisplayName } from "../lib/slack-client.js";
import { getTodayDateString, getCurrentTimeIST } from "../lib/standup.js";

export const eventsRouter = Router();

// GET /slack/events - health check / mounting confirmation
eventsRouter.get("/", (_req: Request, res: Response): void => {
  res.status(200).json({
    status: "ok",
    endpoint: "/slack/events",
    message: "Slack Events endpoint is mounted and active.",
  });
});

eventsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const { type, challenge, event } = req.body || {};

  // 1. URL Verification Challenge
  if (type === "url_verification") {
    console.log("[Slack Events] Responding 200 OK to url_verification challenge", {
      challengeLength: challenge ? String(challenge).length : 0,
    });
    res.status(200).json({ challenge });
    return;
  }

  // Acknowledge Slack request immediately
  res.status(200).send("OK");

  if (type !== "event_callback" || !event) {
    console.log("[Slack Events] Non-callback event type received:", type);
    return;
  }

  console.log(`[Slack Events] Processing event_callback: type=${event.type}, channel=${event.channel}`);

  try {
    // 2. Handle app_mention: "@TGL Ops @<agent> <text>"
    if (event.type === "app_mention") {
      await handleAppMention(event);
      return;
    }

    // 3. Handle thread replies in #standup and #approvals
    if (event.type === "message" && !event.bot_id && event.subtype !== "bot_message") {
      if (event.thread_ts) {
        if (event.channel === config.standupChannelId) {
          const { handleArchitectStandupReply } = await import("../agents/chief-of-staff/worker.js");
          await handleArchitectStandupReply(event);
          return;
        }
        if (event.channel === config.approvalsChannelId || event.channel.startsWith("C")) {
          await handleApprovalsThreadReply(event);
          return;
        }
      }
    }
  } catch (err) {
    console.error("[Events Route Error]", err);
  }
});

async function handleAppMention(event: any): Promise<void> {
  const rawText: string = event.text || "";
  const channel: string = event.channel;
  const thread_ts: string = event.thread_ts || event.ts;

  console.log(`[app_mention received in ${channel}]`, rawText);

  // Example: "<@U12345> @web-builder please fix mobile CTA spacing on /coaching"
  // Remove the bot mention itself
  const textWithoutBot = rawText.replace(/<@[A-Z0-9]+>/g, "").trim();

  // Look for target agent: either "@agent-name" or "<@UAGENTID>"
  const agentMatch = textWithoutBot.match(/@([a-zA-Z0-9_-]+)/);
  let targetAgent = agentMatch ? agentMatch[1].toLowerCase() : "";

  const registeredAgents = await loadAgents();
  const matchedAgent = registeredAgents.find(
    (a) => a.name.toLowerCase() === targetAgent || targetAgent.includes(a.name.toLowerCase())
  );

  const finalAgentName = matchedAgent ? matchedAgent.name : (targetAgent || "web-builder");

  // Extract clean instruction
  const taskText = textWithoutBot.replace(`@${targetAgent}`, "").trim() || "Task requested via Slack mention";
  const title = taskText.split("\n")[0].slice(0, 80);

  const cleanSlackLink = `https://${config.slackBotToken.slice(0, 5)}.slack.com/archives/${channel}/p${event.ts.replace(".", "")}`;
  const threadContext = event.thread_ts ? `\n\n*Thread Parent:* \`${event.thread_ts}\`` : "";

  const body = `### for-agent
${finalAgentName}

### door
core

### context
Created automatically from Slack mention in <#${channel}>:
> "${taskText}"

*Slack Reference:* ${cleanSlackLink}${threadContext}

### deliverable
Implement requested task per agent skill file specifications.

### reviewer
${matchedAgent?.reviewer || "Chief of Staff"}

### due
Immediate priority
`;

  const issue = await createIssue({
    title: `[TASK]: ${title}`,
    body,
    labels: [`for:${finalAgentName}`, "type:build"],
  });

  await postLine({
    channel,
    text: `⚡ Task assigned to \`@${finalAgentName}\`:\n• *Issue:* <${issue.html_url}|#${issue.number} ${title}>\n• *Reviewer:* ${matchedAgent?.reviewer || "Chief of Staff"}`,
    thread_ts,
  });
}

async function handleApprovalsThreadReply(event: any): Promise<void> {
  const actor = await getActorDisplayName(event.user || "architect");
  const text = event.text || "";
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const thread_ts = event.thread_ts;

  console.log(`[Approvals Thread Reply] User: ${actor} | Text: "${text}" | Thread: ${thread_ts}`);

  const line = `- ${timeStr} IST · ${actor} · COMMENT · thread:${thread_ts} · "${text.replace(/\n/g, " ")}"`;

  const appendRes = await appendFileInRepo(
    `decisions/${dateStr}.md`,
    line,
    `chore(decisions): record discussion comment from ${actor}`
  );

  if (!appendRes.success) {
    const failureMsg = `Decision captured in Slack but NOT written to the repo — ${appendRes.status || 500} ${appendRes.error || "Unknown error"}`;
    if (thread_ts) {
      await postLine({
        channel: event.channel,
        text: failureMsg,
        thread_ts,
      });
    }
    await postLine({
      channel: config.alertsChannelId,
      text: failureMsg,
    });
  }

  // Check if thread belongs to an issue in status:needs-brief; if so, treat reply as answers
  try {
    const { handleNeedsBriefClarification } = await import("../runner/clarifications.js");
    await handleNeedsBriefClarification({
      channel: event.channel,
      threadTs: thread_ts,
      replyText: text,
      actor,
    });
  } catch (clarifyErr: any) {
    console.error("[Clarifications Error in Approvals Thread]", clarifyErr);
  }
}


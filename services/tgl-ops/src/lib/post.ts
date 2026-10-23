import fs from "node:fs";
import { slackClient } from "./slack-client.js";
import { config } from "../config.js";

export interface PostCardLink {
  label: string;
  url: string;
}

export type ActionType = "approve" | "reject" | "discuss";

export interface PostCardOptions {
  channel: string;
  agent: string;
  door?: string;
  title: string;
  summary: string;
  links?: PostCardLink[];
  actions?: ActionType[];
  issue?: number | string;
  thread_ts?: string;
}

export interface PostLineOptions {
  channel: string;
  text: string;
  thread_ts?: string;
}

export interface PostFileOptions {
  channel: string;
  filePath?: string;
  fileBuffer?: Buffer;
  filename?: string;
  title?: string;
  thread_ts?: string;
}

/**
 * Renders and posts a standardized TGL Block Kit card.
 */
export async function postCard(options: PostCardOptions): Promise<{ ok: boolean; ts?: string; channel?: string }> {
  const {
    channel,
    agent,
    door = "core",
    title,
    summary,
    links = [],
    actions = ["approve", "reject", "discuss"],
    issue,
    thread_ts,
  } = options;

  const metadataPayload = JSON.stringify({
    agent,
    door,
    title,
    summary,
    issue: issue ? String(issue) : undefined,
    channel,
  });

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: title.length > 150 ? `${title.slice(0, 147)}...` : title,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Agent:* \`${agent}\`  |  *Door:* \`${door}\`${issue ? `  |  *Issue/PR:* <https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${issue}|#${issue}>` : ""}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: summary,
      },
    },
  ];

  if (links.length > 0) {
    const linkLines = links.map((l) => `• <${l.url}|${l.label}>`).join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reference Links:*\n${linkLines}`,
      },
    });
  }

  // Action buttons
  const actionElements: any[] = [];
  if (actions.includes("approve")) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Approve",
        emoji: true,
      },
      style: "primary",
      value: metadataPayload,
      action_id: "action_approve",
    });
  }

  if (actions.includes("reject")) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Reject",
        emoji: true,
      },
      style: "danger",
      value: metadataPayload,
      action_id: "action_reject",
    });
  }

  if (actions.includes("discuss")) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Discuss",
        emoji: true,
      },
      value: metadataPayload,
      action_id: "action_discuss",
    });
  }

  if (actionElements.length > 0) {
    blocks.push({
      type: "actions",
      block_id: "card_actions",
      elements: actionElements,
    });
  }

  if (!config.slackBotToken) {
    console.log(`[postCard Dry Run] Channel: ${channel} | Title: ${title}`);
    console.log(JSON.stringify(blocks, null, 2));
    return { ok: true, ts: `${Date.now() / 1000}`, channel };
  }

  try {
    const res = await slackClient.chat.postMessage({
      channel,
      text: `[TGL Task Card] ${title} (${agent})`,
      blocks,
      thread_ts,
    });
    return { ok: true, ts: res.ts, channel: res.channel };
  } catch (err) {
    console.error("[postCard Error]", err);
    return { ok: false };
  }
}

/**
 * Posts a single line or markdown update in a Slack channel or thread.
 */
export async function postLine(options: PostLineOptions): Promise<{ ok: boolean; ts?: string }> {
  const { channel, text, thread_ts } = options;

  if (!config.slackBotToken) {
    console.log(`[postLine Dry Run] [${channel}${thread_ts ? ` : thread ${thread_ts}` : ""}] ${text}`);
    return { ok: true, ts: `${Date.now() / 1000}` };
  }

  try {
    const res = await slackClient.chat.postMessage({
      channel,
      text,
      thread_ts,
    });
    return { ok: true, ts: res.ts };
  } catch (err) {
    console.error("[postLine Error]", err);
    return { ok: false };
  }
}

/**
 * Uploads a file or document to Slack.
 */
export async function postFile(options: PostFileOptions): Promise<{ ok: boolean; fileId?: string }> {
  const { channel, filePath, fileBuffer, filename, title, thread_ts } = options;

  if (!config.slackBotToken) {
    console.log(`[postFile Dry Run] Channel: ${channel} | File: ${filename || filePath}`);
    return { ok: true, fileId: "mock-file-id" };
  }

  try {
    let file = fileBuffer;
    if (!file && filePath && fs.existsSync(filePath)) {
      file = fs.readFileSync(filePath);
    }

    if (!file) {
      throw new Error("No file buffer or valid file path provided to postFile");
    }

    const uploadArgs: any = {
      channel_id: channel,
      file,
      filename: filename || (filePath ? filePath.split("/").pop() : "document"),
      title: title || filename,
    };
    if (thread_ts) {
      uploadArgs.thread_ts = thread_ts;
    }

    const res = await (slackClient.files as any).uploadV2(uploadArgs);

    return { ok: true, fileId: (res as any).file?.id };
  } catch (err) {
    console.error("[postFile Error]", err);
    return { ok: false };
  }
}

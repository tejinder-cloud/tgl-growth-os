import fs from "node:fs";
import { slackClient } from "./slack-client.js";
import { config, isTestMode, isRailwayEnvironment } from "../config.js";

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
  pr?: number | string;
  branch?: string;
  linkedIssue?: number | string;
  thread_ts?: string;
  extraMeta?: Record<string, any>;
}

export interface PostLineOptions {
  channel: string;
  text: string;
  thread_ts?: string;
}

export const mockPostedLines: PostLineOptions[] = [];
export function resetMockPostedLines(): void {
  mockPostedLines.length = 0;
}

export interface PostFileOptions {
  channel: string;
  filePath?: string;
  fileBuffer?: Buffer;
  filename?: string;
  title?: string;
  thread_ts?: string;
}

let simulatedPostLineFailure: string | null = null;

export function setSimulatedPostLineFailureForTests(errMsg: string | null): void {
  simulatedPostLineFailure = errMsg;
}

/**
 * Splits text into chunks of at most maxLen characters (default 2,900),
 * breaking cleanly on paragraph breaks, newlines, or whitespace when possible.
 */
export function splitTextIntoChunks(text: string, maxLen = 2900): string[] {
  if (!text || text.length <= maxLen) return [text || ""];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    const window = remaining.slice(0, maxLen);
    let splitIdx = window.lastIndexOf("\n\n");
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = window.lastIndexOf("\n");
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = window.lastIndexOf(" ");
    }
    if (splitIdx === -1 || splitIdx <= 0) {
      splitIdx = maxLen;
    }

    const chunk = remaining.slice(0, splitIdx).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}

/**
 * Builds the standardized TGL Block Kit blocks for a card.
 */
export function buildCardBlocks(options: PostCardOptions): any[] {
  const {
    channel,
    agent,
    door = "core",
    title,
    summary,
    links = [],
    actions = ["approve", "reject", "discuss"],
    issue,
    pr,
    branch,
    linkedIssue,
    extraMeta,
  } = options;

  const metadataPayload = JSON.stringify({
    agent,
    door,
    title,
    summary,
    issue: issue ? String(issue) : undefined,
    pr: pr !== undefined ? String(pr) : undefined,
    branch,
    linkedIssue: linkedIssue !== undefined ? String(linkedIssue) : undefined,
    channel,
    ...(extraMeta || {}),
  });

  const summaryChunks = splitTextIntoChunks(summary, 2900);
  const summaryBlocks = summaryChunks.map((sc) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: sc,
    },
  }));

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: title.length > 150 ? `${title.slice(0, 147)}...` : title,
        emoji: false,
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
    ...summaryBlocks,
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
        emoji: false,
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
        emoji: false,
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
        emoji: false,
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

  return blocks;
}

/**
 * Renders and posts a standardized TGL Block Kit card.
 * Automatically splits cards exceeding 50 blocks into multiple threaded messages.
 */
export async function postCard(options: PostCardOptions): Promise<{ ok: boolean; ts?: string; channel?: string; dryRun?: boolean; error?: string }> {
  const { channel, agent, title, thread_ts } = options;
  const blocks = buildCardBlocks(options);

  if (!config.slackBotToken) {
    if (isTestMode()) {
      console.log(`[postCard Dry Run] Channel: ${channel} | Title: ${title}`);
      console.log(JSON.stringify(blocks, null, 2));
      return { ok: true, ts: `${Date.now() / 1000}`, channel, dryRun: true };
    }
    console.log(`[postCard Local] Channel: ${channel} | Title: ${title} (DRY RUN — not posted)`);
    return { ok: false, channel, dryRun: true };
  }

  try {
    const MAX_BLOCKS = 50;
    if (blocks.length <= MAX_BLOCKS) {
      const res = await slackClient.chat.postMessage({
        channel,
        text: `[TGL Task Card] ${title} (${agent})`,
        blocks,
        thread_ts,
      });
      if (!res.ok || !res.ts) {
        throw new Error(`Slack postCard failed: ${res.error || "no ts returned"}`);
      }
      return { ok: true, ts: res.ts, channel: res.channel };
    } else {
      let mainTs: string | undefined;
      for (let i = 0; i < blocks.length; i += MAX_BLOCKS) {
        const batch = blocks.slice(i, i + MAX_BLOCKS);
        const res = await slackClient.chat.postMessage({
          channel,
          text: `[TGL Task Card] ${title} (${agent}) [Part ${Math.floor(i / MAX_BLOCKS) + 1}]`,
          blocks: batch,
          thread_ts: thread_ts || mainTs,
        });
        if (!res.ok || !res.ts) {
          throw new Error(`Slack postCard batch failed: ${res.error || "no ts returned"}`);
        }
        if (!mainTs) mainTs = res.ts;
      }
      return { ok: true, ts: mainTs, channel };
    }
  } catch (err: any) {
    console.error("[postCard Error]", err.message || err);
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Posts a single line or markdown update in a Slack channel or thread.
 * Automatically splits text over 2,900 chars into multiple blocks (and messages if > 50 blocks).
 */
export async function postLine(options: PostLineOptions): Promise<{ ok: boolean; ts?: string; error?: string }> {
  mockPostedLines.push(options);
  const { channel, text, thread_ts } = options;
  const safeText = (text && text.trim()) || " ";
  const chunks = splitTextIntoChunks(safeText, 2900);

  if (simulatedPostLineFailure && isTestMode()) {
    console.log(`[postLine Simulated Failure] [${channel}] ${simulatedPostLineFailure}`);
    return { ok: false, error: simulatedPostLineFailure };
  }

  if (!config.slackBotToken) {
    if (isTestMode()) {
      console.log(`[postLine Dry Run] [${channel}${thread_ts ? ` : thread ${thread_ts}` : ""}] ${chunks.length} block(s) (total ${safeText.length} chars)`);
      return { ok: true, ts: `${Date.now() / 1000}` };
    }
    throw new Error(`SLACK_BOT_TOKEN is not configured; cannot post to ${channel} in production.`);
  }

  try {
    const MAX_BLOCKS = 50;
    if (chunks.length <= MAX_BLOCKS) {
      const blocks = chunks.map((chunk) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: chunk,
        },
      }));

      const res = await slackClient.chat.postMessage({
        channel,
        text: chunks[0].slice(0, 150),
        blocks,
        thread_ts,
      });
      if (!res.ok || !res.ts) {
        throw new Error(`Slack postLine failed: ${res.error || "no ts returned"}`);
      }
      return { ok: true, ts: res.ts };
    } else {
      let mainTs: string | undefined;
      for (let i = 0; i < chunks.length; i += MAX_BLOCKS) {
        const batch = chunks.slice(i, i + MAX_BLOCKS);
        const blocks = batch.map((chunk) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: chunk,
          },
        }));

        const res = await slackClient.chat.postMessage({
          channel,
          text: batch[0].slice(0, 150),
          blocks,
          thread_ts: thread_ts || mainTs,
        });
        if (!res.ok || !res.ts) {
          throw new Error(`Slack postLine batch failed: ${res.error || "no ts returned"}`);
        }
        if (!mainTs) mainTs = res.ts;
      }
      return { ok: true, ts: mainTs };
    }
  } catch (err: any) {
    console.error("[postLine Error]", err.message || err);
    return { ok: false, error: err.message || String(err) };
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

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { loadAgents } from "../../lib/agents.js";
import { appendFileInRepo, octokit } from "../../lib/github-client.js";
import { slackClient, getActorDisplayName } from "../../lib/slack-client.js";
import { postLine } from "../../lib/post.js";
import { getCurrentTimeIST, getTodayDateString } from "../../lib/standup.js";
import { getArchitectConfig } from "../../lib/org.js";
import { gatherStandupMaterial } from "./gather.js";
import { synthesizeStandupDigest, type SynthesisResult } from "./anthropic.js";
import { broadcastMondayScorecard } from "./scorecard.js";

export interface StandupRunResult {
  date: string;
  digestText: string;
  synthesis: SynthesisResult;
  cardTs?: string;
  threadTemplateTs?: string;
}

export interface StandupRecord {
  date: string;
  channel: string;
  standupTs: string;
}

// In-memory record of the day's standup broadcast thread
let currentStandupRecord: StandupRecord | null = null;

export function getLastStandupRecord(): StandupRecord | null {
  return currentStandupRecord;
}

export function setLastStandupRecord(record: StandupRecord | null): void {
  currentStandupRecord = record;
}

/**
 * Step 3a / 17:50 IST: Gathers operational material, calls Anthropic to synthesize
 * the standup digest (<=25 lines), and logs token cost to logs/<today>/chief-of-staff.md.
 */
export async function execute1750Gather(
  dateStr?: string,
  testTargetChannel?: string,
  options?: { testMode?: boolean }
): Promise<StandupRunResult> {
  const isTest = options?.testMode || !!testTargetChannel || process.env.TGL_TEST_MODE === "1";
  const date = dateStr || getTodayDateString();
  console.log(`[Chief of Staff] Running 17:50 IST gather & synthesis for ${date}...`);

  const data = await gatherStandupMaterial(date);
  const synthesis = await synthesizeStandupDigest(data, { testMode: isTest });

  console.log(`[Chief of Staff] Synthesis complete (${synthesis.model}). Tokens: ${synthesis.inputTokens} in / ${synthesis.outputTokens} out ($${synthesis.totalCostUsd.toFixed(4)} USD)`);

  // If a test target channel is provided (e.g. #ops for Day 4 test), post there
  if (testTargetChannel) {
    console.log(`[Chief of Staff Test Dispatch] Posting 17:50 digest to test channel: ${testTargetChannel}`);
    await postLine({
      channel: testTargetChannel,
      text: synthesis.digestText,
    });
  }

  return {
    date,
    digestText: synthesis.digestText,
    synthesis,
  };
}

/**
 * Step 3b / 18:00 IST: Posts the synthesized digest to #standup and immediately
 * posts the thread prompt as the first reply:
 * "Each agent: Did · Blocked · Need from the Architect · Tomorrow."
 */
export async function execute1800Broadcast(
  digestText?: string,
  targetChannel?: string
): Promise<{ channel: string; standupTs?: string; threadTs?: string }> {
  const date = getTodayDateString();
  const channel = targetChannel || config.standupChannelId;

  let textToPost = digestText;
  if (!textToPost) {
    const res = await execute1750Gather(date);
    textToPost = res.digestText;
  }

  console.log(`[Chief of Staff] Broadcasting 18:00 IST standup digest to ${channel}...`);
  let standupTs: string | undefined;

  if (config.slackBotToken) {
    try {
      const postRes = await slackClient.chat.postMessage({
        channel,
        text: textToPost,
      });
      standupTs = postRes.ts;
    } catch (err: any) {
      console.warn(`[Chief of Staff] Failed to post standup to ${channel}:`, err.message);
    }
  } else {
    standupTs = `${(Date.now() / 1000).toFixed(6)}`;
    console.log(`[Chief of Staff Dry Run] [${channel}] Posted standup digest:\n${textToPost}`);
  }

  let threadTs: string | undefined;
  if (standupTs) {
    const threadPrompt = "Each agent: Did · Blocked · Need from the Architect · Tomorrow.";
    if (config.slackBotToken) {
      try {
        const replyRes = await slackClient.chat.postMessage({
          channel,
          thread_ts: standupTs,
          text: threadPrompt,
        });
        threadTs = replyRes.ts;
      } catch (err: any) {
        console.warn(`[Chief of Staff] Failed to post thread prompt to ${channel}:`, err.message);
      }
    } else {
      threadTs = `${(Date.now() / 1000).toFixed(6)}`;
      console.log(`[Chief of Staff Dry Run] [${channel} : thread ${standupTs}] ${threadPrompt}`);
    }

    currentStandupRecord = {
      date,
      channel,
      standupTs,
    };
  }

  return { channel, standupTs, threadTs };
}

/**
 * Step 3c / 18:15 IST: For every agent in config/agents.yaml with status: active
 * (and not on bench) with no logs/<today>/<agent>.md, post one line in the thread:
 * "No report from <agent> today."
 */
export async function execute1815SilenceCheck(
  dateStr?: string,
  threadTs?: string,
  targetChannel?: string
): Promise<{ silentAgents: string[]; postedCount: number }> {
  const date = dateStr || getTodayDateString();
  const channel = targetChannel || currentStandupRecord?.channel || config.standupChannelId;
  const parentTs = threadTs || currentStandupRecord?.standupTs;

  console.log(`[Chief of Staff] Running 18:15 IST silence check for ${date}...`);
  const allAgents = await loadAgents();

  // Active agents only (status: active in config/agents.yaml)
  const activeAgents = allAgents.filter((a) => a.status === "active");

  // Check logs locally and remotely
  const reportedAgents = new Set<string>();
  const localLogsDir = path.join(config.repoRoot, "logs", date);
  if (fs.existsSync(localLogsDir)) {
    try {
      const files = fs.readdirSync(localLogsDir).filter((f) => f.endsWith(".md"));
      for (const f of files) {
        reportedAgents.add(f.replace(/\.md$/, "").toLowerCase());
      }
    } catch {}
  }

  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `logs/${date}`,
        ref: "main",
      });
      if (Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.type === "file" && item.name.endsWith(".md")) {
            reportedAgents.add(item.name.replace(/\.md$/, "").toLowerCase());
          }
        }
      }
    } catch {}
  }

  const silentAgents: string[] = [];
  for (const agent of activeAgents) {
    if (!reportedAgents.has(agent.name.toLowerCase())) {
      silentAgents.push(agent.name);
    }
  }

  console.log(`[Chief of Staff] Silence check result: ${silentAgents.length} silent agents out of ${activeAgents.length} active.`);

  let postedCount = 0;
  for (const agent of silentAgents) {
    const text = `No report from ${agent} today.`;
    if (parentTs) {
      await postLine({
        channel,
        text,
        thread_ts: parentTs,
      });
    } else {
      await postLine({
        channel,
        text: `⚠️ [18:15 Silence Flag] ${text}`,
      });
    }
    postedCount++;
  }

  return { silentAgents, postedCount };
}

// Local cache for deduplicating processed replies by Slack message ts
const CACHE_DIR = path.join(config.repoRoot, ".tgl-cache");
const REPLIES_CACHE_FILE = path.join(CACHE_DIR, "processed_replies.json");

let processedRepliesSet: Set<string> | null = null;

export function getProcessedReplies(): Set<string> {
  if (processedRepliesSet) return processedRepliesSet;
  processedRepliesSet = new Set<string>();
  if (fs.existsSync(REPLIES_CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(REPLIES_CACHE_FILE, "utf8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === "string") processedRepliesSet.add(item);
        }
      }
    } catch {}
  }
  return processedRepliesSet;
}

export function markReplyProcessed(ts: string): void {
  const set = getProcessedReplies();
  set.add(ts);
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(REPLIES_CACHE_FILE, JSON.stringify(Array.from(set)), "utf8");
  } catch {}
}

export function isReplyProcessed(ts: string): boolean {
  return getProcessedReplies().has(ts);
}

/**
 * Step 3d: Architect replies in standup thread.
 * If message starts with "Decision:" -> write to decisions/<date>.md
 * Otherwise -> append to logs/<date>/architect.md
 * Deduplicates by message ts. Supports testMode (writes to logs/.test/).
 */
export async function handleArchitectStandupReply(
  event: {
    text: string;
    user?: any;
    thread_ts?: string;
    ts?: string;
    channel: string;
  },
  options?: {
    testMode?: boolean;
  }
): Promise<{ handled: boolean; action?: "decision" | "log"; path?: string; alreadyProcessed?: boolean }> {
  const isTest = options?.testMode || process.env.TGL_TEST_MODE === "1";

  // Deduplicate by message ts
  if (event.ts && isReplyProcessed(event.ts)) {
    console.log(`[Chief of Staff] Standup reply ${event.ts} already processed; skipping.`);
    return { handled: false, alreadyProcessed: true };
  }

  const actor = await getActorDisplayName(event.user || "falkanmedia");
  const architectConfig = await getArchitectConfig();
  const text = (event.text || "").trim();
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();

  // Verify actor is Architect
  const isArchitect =
    actor.toLowerCase() === architectConfig.display_name.toLowerCase() ||
    actor.toLowerCase() === "tejinder singh" ||
    event.user === "falkanmedia" ||
    event.user === "architect" ||
    (typeof event.user === "string" && architectConfig.slack_user_id && event.user === architectConfig.slack_user_id) ||
    (typeof event.user === "object" && (event.user?.name === "falkanmedia" || event.user?.username === "falkanmedia"));

  if (!isArchitect) {
    return { handled: false };
  }

  console.log(`[Chief of Staff] Processing Architect standup thread reply from ${actor}: "${text.slice(0, 50)}..."`);

  if (text.startsWith("Decision:") || text.startsWith("decision:")) {
    const decisionBody = text.replace(/^decision:\s*/i, "").trim();
    const line = `${timeStr} IST · ${actor} · DECISION · standup:${event.thread_ts || event.ts || "root"} · ${decisionBody}`;

    if (isTest) {
      // Test mode: write to logs/.test/ and clean it; never write to main
      const testDir = path.join(config.repoRoot, "logs/.test");
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, "decisions.md");
      fs.appendFileSync(testFile, line + "\n", "utf8");
      if (event.ts) markReplyProcessed(event.ts);
      console.log(`[Chief of Staff Test Mode] Recorded Architect decision in ${testFile}`);
      return { handled: true, action: "decision", path: testFile };
    }

    const filePath = `decisions/${dateStr}.md`;
    await appendFileInRepo(filePath, line, `chore(decision): record Architect decision from standup thread`);
    if (event.ts) markReplyProcessed(event.ts);
    console.log(`[Chief of Staff] Recorded Architect decision in ${filePath}`);

    return { handled: true, action: "decision", path: filePath };
  } else {
    const logLine = `- ${timeStr} IST — ${text}`;

    if (isTest) {
      // Test mode: write to logs/.test/ and clean it; never write to main
      const testDir = path.join(config.repoRoot, "logs/.test");
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, "architect.md");
      fs.appendFileSync(testFile, logLine + "\n", "utf8");
      if (event.ts) markReplyProcessed(event.ts);
      console.log(`[Chief of Staff Test Mode] Recorded Architect log in ${testFile}`);
      return { handled: true, action: "log", path: testFile };
    }

    const filePath = `logs/${dateStr}/architect.md`;
    await appendFileInRepo(filePath, logLine, `chore(log): record Architect standup comment`);
    if (event.ts) markReplyProcessed(event.ts);
    console.log(`[Chief of Staff] Recorded Architect log in ${filePath}`);

    return { handled: true, action: "log", path: filePath };
  }
}

/**
 * Step 3f: Poll standup thread replies every 10 minutes from 18:00 to 23:00 IST
 * and once at 08:30 IST.
 * Reads conversations.replies on today's (or most recent) standup post (bot token, channels:history).
 * Processes new replies from the Architect the same way the event handler does, deduped by ts.
 */
export async function pollStandupReplies(options?: {
  channel?: string;
  standupTs?: string;
  testMode?: boolean;
}): Promise<{
  polled: boolean;
  channel: string;
  standupTs?: string;
  repliesFound: number;
  newProcessedCount: number;
}> {
  const channel = options?.channel || currentStandupRecord?.channel || config.standupChannelId;
  let standupTs = options?.standupTs || currentStandupRecord?.standupTs;

  console.log(`[Chief of Staff Poll] Checking standup replies in ${channel}...`);

  // If no standupTs in memory, locate today's (or most recent) standup post via conversations.history
  if (!standupTs && config.slackBotToken) {
    try {
      const historyRes = await slackClient.conversations.history({
        channel,
        limit: 30,
      });
      if (historyRes.messages) {
        const digestMsg = historyRes.messages.find(
          (m: any) =>
            m.text?.includes("Daily Standup Digest") ||
            m.text?.includes("The Growth Lab — Daily Standup Digest") ||
            (m.bot_id && m.text?.includes("Standup"))
        );
        if (digestMsg?.ts) {
          standupTs = digestMsg.ts;
          currentStandupRecord = {
            date: getTodayDateString(),
            channel,
            standupTs,
          };
          console.log(`[Chief of Staff Poll] Located standup digest post at ts=${standupTs}`);
        }
      }
    } catch (err: any) {
      console.warn(`[Chief of Staff Poll] Failed to fetch channel history for ${channel}:`, err.message);
    }
  }

  if (!standupTs) {
    console.log(`[Chief of Staff Poll] No standup post found to poll in ${channel}; skipping.`);
    return { polled: false, channel, repliesFound: 0, newProcessedCount: 0 };
  }

  let replies: any[] = [];
  if (config.slackBotToken) {
    try {
      const repliesRes = await slackClient.conversations.replies({
        channel,
        ts: standupTs,
        limit: 100,
      });
      replies = repliesRes.messages || [];
    } catch (err: any) {
      console.error(`[Chief of Staff Poll] Error reading conversations.replies for ${standupTs}:`, err.message);
      return { polled: false, channel, standupTs, repliesFound: 0, newProcessedCount: 0 };
    }
  }

  // Filter out the parent standup message itself and bots
  const threadReplies = replies.filter((r) => r.ts !== standupTs && !r.bot_id && r.subtype !== "bot_message");
  let newProcessedCount = 0;

  for (const reply of threadReplies) {
    const replyTs = reply.ts;
    if (!replyTs || isReplyProcessed(replyTs)) {
      continue;
    }

    const handledRes = await handleArchitectStandupReply(
      {
        text: reply.text || "",
        user: reply.user,
        thread_ts: standupTs,
        ts: replyTs,
        channel,
      },
      { testMode: options?.testMode }
    );

    if (handledRes.handled) {
      newProcessedCount++;
    }
  }

  console.log(`[Chief of Staff Poll] Polled ${threadReplies.length} thread replies (${newProcessedCount} new processed from Architect).`);
  return {
    polled: true,
    channel,
    standupTs,
    repliesFound: threadReplies.length,
    newProcessedCount,
  };
}

/**
 * Step 3e / Monday 09:00 IST: Scorecard post to #architect.
 */
export async function executeMondayScorecard(targetChannel?: string): Promise<void> {
  await broadcastMondayScorecard(targetChannel);
}

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
export async function execute1750Gather(dateStr?: string, testTargetChannel?: string): Promise<StandupRunResult> {
  const date = dateStr || getTodayDateString();
  console.log(`[Chief of Staff] Running 17:50 IST gather & synthesis for ${date}...`);

  const data = await gatherStandupMaterial(date);
  const synthesis = await synthesizeStandupDigest(data);

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

  // Active agents (excluding bench or retired roles)
  const activeAgents = allAgents.filter((a: any) => a.status !== "bench" && a.status !== "retired");

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

  if (config.githubToken && reportedAgents.size === 0) {
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

/**
 * Step 3d: Architect replies in standup thread.
 * If message starts with "Decision:" -> write to decisions/<date>.md
 * Otherwise -> append to logs/<date>/architect.md
 */
export async function handleArchitectStandupReply(event: {
  text: string;
  user?: any;
  thread_ts?: string;
  channel: string;
}): Promise<{ handled: boolean; action?: "decision" | "log"; path?: string }> {
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
    const line = `${timeStr} IST · ${actor} · DECISION · standup:${event.thread_ts || "root"} · ${decisionBody}`;
    const filePath = `decisions/${dateStr}.md`;

    await appendFileInRepo(filePath, line, `chore(decision): record Architect decision from standup thread`);
    console.log(`[Chief of Staff] Recorded Architect decision in ${filePath}`);

    return { handled: true, action: "decision", path: filePath };
  } else {
    const logLine = `- ${timeStr} IST — ${text}`;
    const filePath = `logs/${dateStr}/architect.md`;

    await appendFileInRepo(filePath, logLine, `chore(log): record Architect standup comment`);
    console.log(`[Chief of Staff] Recorded Architect log in ${filePath}`);

    return { handled: true, action: "log", path: filePath };
  }
}

/**
 * Step 3e / Monday 09:00 IST: Scorecard post to #architect.
 */
export async function executeMondayScorecard(targetChannel?: string): Promise<void> {
  await broadcastMondayScorecard(targetChannel);
}

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { loadAgents } from "../../lib/agents.js";
import { appendFileInRepo, octokit, putFileInRepo, readFileFromRepo } from "../../lib/github-client.js";
import { slackClient, getActorDisplayName } from "../../lib/slack-client.js";
import { postLine } from "../../lib/post.js";
import { getCurrentTimeIST, getTodayDateString, isWithinCatchupWindowIST } from "../../lib/standup.js";
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

export interface StandupState {
  date: string;
  compiledAt?: string;
  digestText?: string;
  synthesis?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
  posted?: boolean;
  postedAt?: string;
  standupTs?: string;
  threadPromptTs?: string;
  channel?: string;
  source?: "cron" | "standup_command" | "startup_catchup";
  processedReplies?: string[];
}

/**
 * Reads standup state for a given date.
 * Production: reads logs/.state/standup-<date>.json via Contents API from main (never local disk).
 * Test mode: reads logs/.test/.state/standup-<date>.json from local test dir.
 */
export async function getStandupState(
  dateStr?: string,
  options?: { testMode?: boolean }
): Promise<StandupState | null> {
  const date = dateStr || getTodayDateString();
  const isTest = options?.testMode || process.env.TGL_TEST_MODE === "1";

  if (isTest) {
    const testStatePath = path.join(config.repoRoot, "logs/.test/.state", `standup-${date}.json`);
    if (fs.existsSync(testStatePath)) {
      try {
        return JSON.parse(fs.readFileSync(testStatePath, "utf8"));
      } catch {}
    }
    return null;
  }

  const filePath = `logs/.state/standup-${date}.json`;
  try {
    const content = await readFileFromRepo(filePath);
    if (content) {
      return JSON.parse(content);
    }
  } catch (err: any) {
    console.warn(`[Chief of Staff State] Error reading ${filePath}:`, err.message);
  }
  return null;
}

/**
 * Persists standup state for a given date.
 * Production: writes logs/.state/standup-<date>.json via Contents API to main.
 * Test mode: writes logs/.test/.state/standup-<date>.json locally.
 */
export async function saveStandupState(
  dateStr: string,
  state: StandupState,
  options?: { testMode?: boolean }
): Promise<void> {
  const date = dateStr || getTodayDateString();
  const isTest = options?.testMode || process.env.TGL_TEST_MODE === "1";
  const jsonContent = JSON.stringify(state, null, 2);

  if (isTest) {
    const testDir = path.join(config.repoRoot, "logs/.test/.state");
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    const testStatePath = path.join(testDir, `standup-${date}.json`);
    fs.writeFileSync(testStatePath, jsonContent, "utf8");
    console.log(`[Chief of Staff State Test Mode] Saved state to ${testStatePath}`);
    return;
  }

  const filePath = `logs/.state/standup-${date}.json`;
  const commitMsg = `chore(state): update standup state for ${date}`;
  const res = await putFileInRepo(filePath, jsonContent, commitMsg);
  if (!res.success) {
    console.error(`[Chief of Staff State] Failed to save state to ${filePath}: status ${res.status} error: ${res.error}`);
  } else {
    console.log(`[Chief of Staff State] Saved state to ${filePath} on main (status ${res.status})`);
  }
}

/**
 * Step 3a / 17:50 IST: Gathers operational material, calls Anthropic to synthesize
 * the standup digest (<=25 lines), logs token cost to logs/<today>/chief-of-staff.md,
 * and writes the pre-compiled state to logs/.state/standup-<date>.json via Contents API.
 */
export async function execute1750Gather(
  dateStr?: string,
  testTargetChannel?: string,
  options?: { testMode?: boolean }
): Promise<StandupRunResult> {
  const isTest = options?.testMode || !!testTargetChannel || process.env.TGL_TEST_MODE === "1";
  const date = dateStr || getTodayDateString();
  console.log(`[Chief of Staff] Running 17:50 IST gather & synthesis for ${date}...`);

  const data = await gatherStandupMaterial(date, { testMode: isTest });
  const synthesis = await synthesizeStandupDigest(data, { testMode: isTest });

  console.log(
    `[Chief of Staff] Synthesis complete (${synthesis.model}). Tokens: ${synthesis.inputTokens} in / ${synthesis.outputTokens} out ($${synthesis.totalCostUsd.toFixed(4)} USD)`
  );

  // Preserve existing state if any, updating compilation details
  const existingState = await getStandupState(date, { testMode: isTest });
  const newState: StandupState = {
    ...(existingState || { date }),
    date,
    compiledAt: new Date().toISOString(),
    digestText: synthesis.digestText,
    synthesis: {
      model: synthesis.model,
      inputTokens: synthesis.inputTokens,
      outputTokens: synthesis.outputTokens,
      totalCostUsd: synthesis.totalCostUsd,
    },
    posted: existingState?.posted || false,
  };

  await saveStandupState(date, newState, { testMode: isTest });

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

export interface BroadcastOptions {
  digestText?: string;
  targetChannel?: string;
  dateStr?: string;
  testMode?: boolean;
  forceCompile?: boolean;
  source?: "cron" | "standup_command" | "startup_catchup";
}

/**
 * Step 3b / 18:00 IST: Self-sufficient broadcast job.
 * Gathers + synthesizes + posts in one run.
 * Uses 17:50 pre-compiled digest from logs/.state/standup-<date>.json if present,
 * otherwise compiles fresh. Nothing that must survive a restart lives in memory.
 * Posts to #standup, posts thread reply prompt, and updates state file on main.
 */
export async function execute1800Broadcast(
  arg1?: string | BroadcastOptions,
  arg2?: string
): Promise<{
  channel: string;
  standupTs?: string;
  threadTs?: string;
  alreadyPosted?: boolean;
  compiledFresh?: boolean;
}> {
  const options: BroadcastOptions = typeof arg1 === "object" && arg1 !== null
    ? arg1
    : { digestText: typeof arg1 === "string" ? arg1 : undefined, targetChannel: arg2 };

  const isTest = options.testMode || !!options.targetChannel || process.env.TGL_TEST_MODE === "1";
  const date = options.dateStr || getTodayDateString();
  const channel = options.targetChannel || (isTest ? (config.opsChannelId || "#ops") : config.standupChannelId);

  // 1. Check existing state file from Contents API
  const existingState = await getStandupState(date, { testMode: isTest });

  // If already posted today and not forced, do not post duplicate standup
  if (existingState?.posted && existingState?.standupTs && !options.forceCompile) {
    console.log(`[Chief of Staff] Standup already posted for ${date} (ts=${existingState.standupTs} in ${existingState.channel || channel}); skipping duplicate broadcast.`);
    return {
      channel: existingState.channel || channel,
      standupTs: existingState.standupTs,
      threadTs: existingState.threadPromptTs,
      alreadyPosted: true,
      compiledFresh: false,
    };
  }

  let textToPost = options.digestText;
  let compiledFresh = false;

  // If digestText was not explicitly passed, check pre-compiled state file
  if (!textToPost) {
    if (!options.forceCompile && existingState?.digestText) {
      console.log(`[Chief of Staff] Found pre-compiled digest from 17:50 in state file for ${date}. Using it.`);
      textToPost = existingState.digestText;
    } else {
      console.log(`[Chief of Staff] No pre-compiled digest in state file (or forceCompile requested). Compiling fresh (gather + synthesize)...`);
      const runRes = await execute1750Gather(date, undefined, { testMode: isTest });
      textToPost = runRes.digestText;
      compiledFresh = true;
    }
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

    // Persist posted state to logs/.state/standup-<date>.json via Contents API immediately
    const updatedState: StandupState = {
      ...(existingState || { date }),
      date,
      digestText: textToPost,
      posted: true,
      postedAt: new Date().toISOString(),
      standupTs,
      threadPromptTs: threadTs,
      channel,
      source: options.source || "cron",
    };

    await saveStandupState(date, updatedState, { testMode: isTest });
  }

  return { channel, standupTs, threadTs, alreadyPosted: false, compiledFresh };
}

/**
 * Startup catch-up check:
 * On boot, if IST time is 18:00–21:00 and no standup was posted today
 * (check the state file / conversations.history for the bot's post),
 * run the 18:00 job immediately.
 */
export async function checkAndRunStartupCatchup(options?: {
  forceWindowCheck?: boolean;
  testMode?: boolean;
  targetChannel?: string;
  testDate?: Date;
}): Promise<{
  ranCatchup: boolean;
  reason: string;
  result?: any;
}> {
  const isTest = options?.testMode || process.env.TGL_TEST_MODE === "1";
  const date = getTodayDateString();
  const inWindow = options?.forceWindowCheck !== false
    ? isWithinCatchupWindowIST(options?.testDate)
    : true;

  if (!inWindow) {
    const timeIST = getCurrentTimeIST();
    console.log(`[Startup Catch-Up] Outside 18:00–21:00 IST window (${timeIST} IST); skipping catch-up.`);
    return { ranCatchup: false, reason: `Outside window (${timeIST} IST)` };
  }

  console.log(`[Startup Catch-Up] Boot detected inside 18:00–21:00 IST window. Checking if standup was posted today (${date})...`);

  // 1. Check state file from main via Contents API
  const state = await getStandupState(date, { testMode: isTest });
  if (state?.posted && state?.standupTs) {
    console.log(`[Startup Catch-Up] Standup already posted today according to state file (ts=${state.standupTs} at ${state.postedAt}). Catch-up not needed.`);
    return { ranCatchup: false, reason: "Already posted according to state file" };
  }

  // 2. Check Slack conversations.history for bot's standup post today
  const targetChannel = options?.targetChannel || (isTest ? (config.opsChannelId || "#ops") : config.standupChannelId);
  if (config.slackBotToken && targetChannel) {
    try {
      const history = await slackClient.conversations.history({
        channel: targetChannel,
        limit: 30,
      });
      const messages = history.messages || [];
      const botPost = messages.find(
        (m: any) =>
          (m.text?.includes("Daily Standup Digest") ||
           m.text?.includes("The Growth Lab — Daily Standup Digest") ||
           (m.bot_id && m.text?.includes("Standup")))
      );

      if (botPost?.ts) {
        console.log(`[Startup Catch-Up] Standup post found in ${targetChannel} history (ts=${botPost.ts}). Syncing state file.`);
        const syncedState: StandupState = {
          ...(state || { date }),
          date,
          posted: true,
          postedAt: new Date(Number(botPost.ts) * 1000).toISOString(),
          standupTs: botPost.ts,
          channel: targetChannel,
          source: "cron",
        };
        await saveStandupState(date, syncedState, { testMode: isTest });
        return { ranCatchup: false, reason: "Already posted according to Slack history" };
      }
    } catch (err: any) {
      console.warn(`[Startup Catch-Up] Warning checking channel history for ${targetChannel}:`, err.message);
    }
  }

  // 3. Neither state file nor conversations.history shows a post today -> run 18:00 broadcast immediately!
  console.log(`[Startup Catch-Up] No standup post found for today (${date}). Running 18:00 job immediately!`);
  const result = await execute1800Broadcast({
    targetChannel,
    testMode: isTest,
    source: "startup_catchup",
  });

  return {
    ranCatchup: true,
    reason: "Standup was missing; executed 18:00 broadcast",
    result,
  };
}

/**
 * Step 3c / 18:15 IST: For every agent in config/agents.yaml with status: active
 * (and not on bench) with no logs/<today>/<agent>.md, post one line in the thread:
 * "No report from <agent> today."
 * Logs are read strictly from main via Contents API, never local disk.
 */
export async function execute1815SilenceCheck(
  dateStr?: string,
  threadTs?: string,
  targetChannel?: string,
  options?: { testMode?: boolean }
): Promise<{ silentAgents: string[]; postedCount: number }> {
  const isTest = options?.testMode || !!targetChannel || process.env.TGL_TEST_MODE === "1";
  const date = dateStr || getTodayDateString();

  // Retrieve standup post info from state file first
  const state = await getStandupState(date, { testMode: isTest });
  const channel = targetChannel || state?.channel || (isTest ? (config.opsChannelId || "#ops") : config.standupChannelId);
  const parentTs = threadTs || state?.standupTs;

  console.log(`[Chief of Staff] Running 18:15 IST silence check for ${date}...`);
  const allAgents = await loadAgents();

  // Active agents only (status: active in config/agents.yaml)
  const activeAgents = allAgents.filter((a) => a.status === "active");

  // Check logs from main via Contents API, never local disk (except mock in test mode)
  const reportedAgents = new Set<string>();

  if (isTest) {
    const testLogsDir = path.join(config.repoRoot, "logs/.test/logs");
    if (fs.existsSync(testLogsDir)) {
      try {
        const files = fs.readdirSync(testLogsDir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
        for (const file of files) {
          reportedAgents.add(file.replace(/\.md$/, "").toLowerCase());
        }
      } catch {}
    }
  }

  if (reportedAgents.size === 0 && config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `logs/${date}`,
        ref: "main",
      });
      if (Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.type === "file" && item.name.endsWith(".md") && !item.name.startsWith(".")) {
            reportedAgents.add(item.name.replace(/\.md$/, "").toLowerCase());
          }
        }
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.warn(`[Silence Check] Error reading logs/${date} from main:`, err.message);
      }
    }
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
 * Finds a standup post made by /standup as well as by cron (via state file, then conversations.history).
 * Reads conversations.replies on the post, processes new replies from the Architect, deduped by ts.
 */
export async function pollStandupReplies(options?: {
  channel?: string;
  standupTs?: string;
  testMode?: boolean;
  dateStr?: string;
}): Promise<{
  polled: boolean;
  channel: string;
  standupTs?: string;
  repliesFound: number;
  newProcessedCount: number;
}> {
  const isTest = options?.testMode || process.env.TGL_TEST_MODE === "1";
  const date = options?.dateStr || getTodayDateString();

  // 1. Read state file to find today's standup post (from cron or /standup)
  const state = await getStandupState(date, { testMode: isTest });

  const channel = options?.channel || state?.channel || (isTest ? (config.opsChannelId || "#ops") : config.standupChannelId);
  let standupTs = options?.standupTs || state?.standupTs;

  console.log(`[Chief of Staff Poll] Checking standup replies in ${channel}...`);

  // 2. If no standupTs in state, search Slack channel history (finds bot post from /standup or cron)
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
          console.log(`[Chief of Staff Poll] Located standup digest post at ts=${standupTs} via history in ${channel}`);
          // Sync state file so subsequent polls don't need history lookup
          const updatedState: StandupState = {
            ...(state || { date }),
            date,
            posted: true,
            standupTs,
            channel,
          };
          await saveStandupState(date, updatedState, { testMode: isTest });
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

  // Load set of already processed reply timestamps
  const processedFromState = new Set<string>(state?.processedReplies || []);
  const newlyProcessedList: string[] = [];

  for (const reply of threadReplies) {
    const replyTs = reply.ts;
    if (!replyTs || isReplyProcessed(replyTs) || processedFromState.has(replyTs)) {
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
      newlyProcessedList.push(replyTs);
      processedFromState.add(replyTs);
    }
  }

  // If new replies were processed, persist them in state file
  if (newlyProcessedList.length > 0) {
    const updatedState: StandupState = {
      ...(state || { date, posted: true, standupTs, channel }),
      processedReplies: Array.from(processedFromState),
    };
    await saveStandupState(date, updatedState, { testMode: isTest });
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

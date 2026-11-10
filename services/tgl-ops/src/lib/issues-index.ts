import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../config.js";
import { octokit } from "./github-client.js";

export interface IssueIndexEntry {
  channel: string;
  ts: string;
  agent?: string;
  door?: string;
  title?: string;
  updatedAt?: string;
  cardType?: "issue" | "pr_review" | "plan" | "proposal" | string;
  linkedIssueNumber?: number;
  issueNumber?: number;
  prNumber?: number;
  threadTimestamps?: string[];
}

export type IssuesIndex = Record<string, IssueIndexEntry>;

const INDEX_FILE_PATH = "logs/.index/issues.json";
let memoryIndexCache: IssuesIndex | null = null;
let testIndexCache: IssuesIndex | null = null;
let lastKnownSha: string | undefined;

export function resetIssuesIndexCacheForTests(): void {
  testIndexCache = null;
  memoryIndexCache = null;
  lastKnownSha = undefined;
}

function getIndexPath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, "logs/.test", "issues.json");
  }
  return path.join(config.repoRoot, INDEX_FILE_PATH);
}

/**
 * Loads the issue-to-Slack mapping index from logs/.index/issues.json.
 */
export async function loadIssuesIndex(options?: { testMode?: boolean }): Promise<IssuesIndex> {
  const isTest = options?.testMode === true || isTestMode();
  if (isTest) {
    if (testIndexCache) return testIndexCache;
    const localFullPath = getIndexPath(true);
    if (fs.existsSync(localFullPath)) {
      try {
        const raw = fs.readFileSync(localFullPath, "utf8");
        testIndexCache = JSON.parse(raw);
        return testIndexCache || {};
      } catch {
        // fallback
      }
    }
    testIndexCache = {};
    return testIndexCache;
  }

  if (memoryIndexCache) {
    return memoryIndexCache;
  }

  // 1. Try local filesystem (for local dev)
  const localFullPath = getIndexPath(false);
  if (fs.existsSync(localFullPath)) {
    try {
      const raw = fs.readFileSync(localFullPath, "utf8");
      memoryIndexCache = JSON.parse(raw);
      return memoryIndexCache || {};
    } catch (err) {
      console.warn(`[Issues Index] Could not parse local index file at ${localFullPath}:`, err);
    }
  }

  // 2. Try GitHub Contents API
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: INDEX_FILE_PATH,
        ref: "main",
      });

      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        lastKnownSha = res.data.sha;
        const decoded = Buffer.from(res.data.content, "base64").toString("utf8");
        memoryIndexCache = JSON.parse(decoded);
        return memoryIndexCache || {};
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.warn("[Issues Index] Failed to load index from GitHub:", err.message);
      }
    }
  }

  memoryIndexCache = {};
  return memoryIndexCache;
}

/**
 * Look up a mapped Slack channel and card timestamp for an issue number.
 */
export async function getIssueMapping(
  issueNumber: number,
  options?: { testMode?: boolean }
): Promise<IssueIndexEntry | undefined> {
  const index = await loadIssuesIndex(options);
  return index[String(issueNumber)];
}

/**
 * Records or updates a card mapping in the thread→issue map.
 * Supports every card type (issue card, PR review card, plan card, proposal card).
 * Stores direct thread mapping (thread:<ts>) and per-issue card history.
 */
export interface CardMappingParams {
  threadTs: string;
  channel: string;
  issueNumber: number;
  cardType?: "issue" | "pr_review" | "plan" | "proposal" | string;
  prNumber?: number;
  agent?: string;
  door?: string;
  title?: string;
  testMode?: boolean;
}

export async function persistIssuesIndex(
  index: IssuesIndex,
  issueNumber: number,
  isTest: boolean
): Promise<void> {
  if (isTest) {
    testIndexCache = index;
    const localFullPath = getIndexPath(true);
    try {
      const dir = path.dirname(localFullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(localFullPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    } catch {
      // ignore
    }
    return;
  }

  memoryIndexCache = index;
  const contentStr = JSON.stringify(index, null, 2) + "\n";

  // Sync locally if repository directory exists
  const localFullPath = getIndexPath(false);
  try {
    const dir = path.dirname(localFullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localFullPath, contentStr, "utf8");
    console.log(`[Issues Index] Updated local index for issue #${issueNumber}`);
  } catch (err) {
    console.warn(`[Issues Index] Could not write local index:`, err);
  }

  // Persist to GitHub via Contents API
  if (config.githubToken) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        let currentSha = lastKnownSha;
        if (!currentSha || attempt > 1) {
          try {
            const getRes = await octokit.repos.getContent({
              owner: config.githubOwner,
              repo: config.githubRepo,
              path: INDEX_FILE_PATH,
              ref: "main",
            });
            if (!Array.isArray(getRes.data) && getRes.data.type === "file") {
              currentSha = getRes.data.sha;
            }
          } catch (err: any) {
            if (err.status !== 404) throw err;
          }
        }

        const putRes = await octokit.repos.createOrUpdateFileContents({
          owner: config.githubOwner,
          repo: config.githubRepo,
          path: INDEX_FILE_PATH,
          message: `chore(index): record issue #${issueNumber} Slack card mapping`,
          content: Buffer.from(contentStr, "utf8").toString("base64"),
          branch: "main",
          sha: currentSha,
        });

        lastKnownSha = putRes.data.content?.sha;
        console.log(`[Issues Index] Persisted issue #${issueNumber} mapping to GitHub (sha: ${lastKnownSha})`);
        break;
      } catch (err: any) {
        if (err.status === 409 && attempt < 3) {
          console.warn(`[Issues Index] 409 Conflict on index (attempt ${attempt}); retrying...`);
          await new Promise((r) => setTimeout(r, attempt * 500));
          continue;
        }
        console.error(`[Issues Index] Failed to persist index to GitHub:`, err.message);
        break;
      }
    }
  }
}

export async function recordCardMapping(
  params: CardMappingParams,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = params.testMode === true || options?.testMode === true || isTestMode();
  const index = await loadIssuesIndex({ testMode: isTest });
  const { threadTs, channel, issueNumber, cardType = "issue", prNumber, agent, door, title } = params;

  if (!threadTs || !issueNumber) {
    return;
  }

  // 1. Direct thread mapping: "thread:<ts>"
  const directKey = `thread:${threadTs}`;
  index[directKey] = {
    channel,
    ts: threadTs,
    issueNumber,
    linkedIssueNumber: issueNumber,
    cardType,
    prNumber,
    agent,
    door,
    title,
    updatedAt: new Date().toISOString(),
  };

  // 2. Issue number mapping: "<issueNumber>"
  const numKey = String(issueNumber);
  const existingIssueEntry = index[numKey] || { channel, ts: threadTs };
  const existingThreads = Array.isArray(existingIssueEntry.threadTimestamps)
    ? existingIssueEntry.threadTimestamps
    : existingIssueEntry.ts
    ? [existingIssueEntry.ts]
    : [];

  index[numKey] = {
    ...existingIssueEntry,
    channel: channel || existingIssueEntry.channel,
    ts: threadTs, // latest card ts
    agent: agent || existingIssueEntry.agent,
    door: door || existingIssueEntry.door,
    title: title || existingIssueEntry.title,
    cardType: cardType || existingIssueEntry.cardType,
    linkedIssueNumber: issueNumber,
    threadTimestamps: Array.from(new Set([...existingThreads, threadTs])),
    updatedAt: new Date().toISOString(),
  };

  // 3. If PR number exists and is distinct from issue number, map PR number to linked issue
  if (prNumber && prNumber !== issueNumber) {
    const prKey = String(prNumber);
    const existingPrEntry = index[prKey] || { channel, ts: threadTs };
    index[prKey] = {
      ...existingPrEntry,
      channel: channel || existingPrEntry.channel,
      ts: threadTs,
      linkedIssueNumber: issueNumber,
      cardType: "pr_review",
      prNumber,
      agent: agent || existingPrEntry.agent,
      door: door || existingPrEntry.door,
      title: title || existingPrEntry.title,
      updatedAt: new Date().toISOString(),
    };
  }

  await persistIssuesIndex(index, issueNumber, isTest);
}

/**
 * Records or updates an issue mapping in logs/.index/issues.json.
 * Writes locally and persists to GitHub via Contents API.
 */
export async function recordIssueMapping(
  issueNumber: number,
  entry: IssueIndexEntry,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  return recordCardMapping(
    {
      threadTs: entry.ts,
      channel: entry.channel,
      issueNumber,
      cardType: entry.cardType || "issue",
      prNumber: entry.prNumber,
      agent: entry.agent,
      door: entry.door,
      title: entry.title,
      testMode: isTest,
    },
    { testMode: isTest }
  );
}

/**
 * Automatically inspects card options when postCard runs, resolves any associated issue,
 * and records the mapping in the thread→issue map.
 */
export async function autoRecordCardFromPostCard(
  channel: string,
  threadTs: string,
  options: {
    title?: string;
    agent?: string;
    door?: string;
    issue?: number | string;
    pr?: number | string;
    linkedIssue?: number | string;
    thread_ts?: string;
    links?: Array<{ label: string; url: string }>;
    extraMeta?: Record<string, any>;
  },
  testMode?: boolean
): Promise<void> {
  const isTest = testMode === true || isTestMode();

  // 1. Resolve linked issue number
  let linkedIssueNum: number | undefined;

  // PR review card priority: linkedIssue is the original issue
  if (options.linkedIssue !== undefined && options.linkedIssue !== null && options.linkedIssue !== "") {
    const num = Number(options.linkedIssue);
    if (!isNaN(num) && num > 0) linkedIssueNum = num;
  }

  // issue option
  if (!linkedIssueNum && options.issue !== undefined && options.issue !== null && options.issue !== "") {
    const num = Number(options.issue);
    if (!isNaN(num) && num > 0) linkedIssueNum = num;
  }

  // extraMeta
  if (!linkedIssueNum && options.extraMeta) {
    const metaNum = options.extraMeta.linkedIssue || options.extraMeta.issue || options.extraMeta.issueNumber;
    if (metaNum) {
      const num = Number(metaNum);
      if (!isNaN(num) && num > 0) linkedIssueNum = num;
    }
  }

  // links (e.g. Issue #8 link)
  if (!linkedIssueNum && options.links) {
    for (const link of options.links) {
      const m = link.url?.match(/\/issues\/(\d+)/i);
      if (m) {
        const num = Number(m[1]);
        if (!isNaN(num) && num > 0) {
          linkedIssueNum = num;
          break;
        }
      }
    }
  }

  // extraMeta.planDay or title Plan Day
  if (!linkedIssueNum && options.extraMeta?.planDay) {
    const planDay = Number(options.extraMeta.planDay);
    if (!isNaN(planDay) && planDay > 0) {
      linkedIssueNum = planDay;
    }
  }

  if (!linkedIssueNum && options.title) {
    const planMatch =
      options.title.match(/\[PLAN-D(\d+)\]/i) ||
      options.title.match(/Plan Day\s+(\d+)/i) ||
      options.title.match(/Your hour today: Day\s+(\d+)/i);
    if (planMatch) {
      const dayNum = Number(planMatch[1]);
      if (!isNaN(dayNum) && dayNum > 0) {
        linkedIssueNum = dayNum;
      }
    }
  }

  if (!linkedIssueNum && options.title) {
    const issueMatch = options.title.match(/#(\d+)/);
    if (issueMatch) {
      const num = Number(issueMatch[1]);
      if (!isNaN(num) && num > 0) {
        linkedIssueNum = num;
      }
    }
  }

  if (!linkedIssueNum) {
    return;
  }

  // 2. Determine card type
  let cardType = "issue";
  if (options.pr || (options.linkedIssue && options.issue && Number(options.issue) !== Number(options.linkedIssue))) {
    cardType = "pr_review";
  } else if (
    options.extraMeta?.planDay ||
    options.title?.toLowerCase().includes("plan day") ||
    options.title?.toLowerCase().includes("your hour today: day") ||
    options.title?.includes("[PLAN-D")
  ) {
    cardType = "plan";
  } else if (options.extraMeta?.type === "proposal" || options.title?.toLowerCase().startsWith("proposal:")) {
    cardType = "proposal";
  }

  const prNum = options.pr ? Number(options.pr) : undefined;

  await recordCardMapping(
    {
      threadTs,
      channel,
      issueNumber: linkedIssueNum,
      cardType,
      prNumber: prNum,
      agent: options.agent,
      door: options.door,
      title: options.title,
      testMode: isTest,
    },
    { testMode: isTest }
  );

  if (options.thread_ts && options.thread_ts !== threadTs) {
    await recordCardMapping(
      {
        threadTs: options.thread_ts,
        channel,
        issueNumber: linkedIssueNum,
        cardType,
        prNumber: prNum,
        agent: options.agent,
        door: options.door,
        title: options.title,
        testMode: isTest,
      },
      { testMode: isTest }
    );
  }
}

/**
 * Look up mapped issue for a Slack thread timestamp.
 * Returns the most relevant matching issue (prioritising open status:needs-brief issues).
 */
export async function findNeedsBriefIssueByThreadTs(
  threadTs: string,
  options?: { testMode?: boolean; channel?: string }
): Promise<{ issueNumber: number; entry: IssueIndexEntry } | undefined> {
  const match = await findIssueByThreadTs(threadTs, options);
  if (!match) return undefined;

  // Lazy import getIssue to prevent circular dependency
  const { getIssue } = await import("./github-client.js");
  const issue = await getIssue(match.issueNumber);
  if (issue && issue.state === "open" && issue.labels.includes("status:needs-brief")) {
    return match;
  }
  return undefined;
}

/**
 * Look up mapped issue for a Slack thread timestamp covering every card type
 * (issue card, PR review card, plan card, proposal card).
 */
export async function findIssueByThreadTs(
  threadTs: string,
  options?: { testMode?: boolean; channel?: string }
): Promise<{ issueNumber: number; entry: IssueIndexEntry } | undefined> {
  const isTest = options?.testMode === true || isTestMode();
  const index = await loadIssuesIndex(options);

  // 1. Direct thread key lookup: "thread:<ts>"
  const directKey = `thread:${threadTs}`;
  if (index[directKey]) {
    const direct = index[directKey];
    const resolvedNum = direct.linkedIssueNumber || direct.issueNumber;
    if (resolvedNum && !isNaN(Number(resolvedNum))) {
      return { issueNumber: Number(resolvedNum), entry: direct };
    }
  }

  // 2. Scan all entries for matching ts or threadTimestamps
  const candidates: { issueNumber: number; entry: IssueIndexEntry }[] = [];

  for (const [key, entry] of Object.entries(index)) {
    if (key.startsWith("thread:")) continue;

    const matchesTs =
      entry.ts === threadTs ||
      (Array.isArray(entry.threadTimestamps) && entry.threadTimestamps.includes(threadTs));

    if (matchesTs) {
      const issueNum = entry.linkedIssueNumber || Number(key);
      if (!isNaN(issueNum) && issueNum > 0) {
        candidates.push({ issueNumber: issueNum, entry });
      }
    }
  }

  if (candidates.length > 0) {
    // Sort descending by issue number (most recent first)
    candidates.sort((a, b) => b.issueNumber - a.issueNumber);
    return candidates[0];
  }

  // 3. Resilient Slack message inspection fallback (if not test mode and channel provided)
  if (config.slackBotToken && !isTest && options?.channel) {
    try {
      const { slackClient } = await import("./slack-client.js");
      const history = await slackClient.conversations.history({
        channel: options.channel,
        latest: threadTs,
        inclusive: true,
        limit: 1,
      });
      const rootMsg = history.messages?.[0];
      if (rootMsg && rootMsg.ts === threadTs && rootMsg.blocks) {
        for (const block of rootMsg.blocks) {
          if (block.elements && Array.isArray(block.elements)) {
            for (const elem of block.elements) {
              if (elem.value) {
                try {
                  const parsed = JSON.parse(elem.value);
                  const foundIssue = Number(parsed.linkedIssue || parsed.issue || parsed.issueNumber);
                  if (!isNaN(foundIssue) && foundIssue > 0) {
                    await recordCardMapping(
                      {
                        threadTs,
                        channel: options.channel,
                        issueNumber: foundIssue,
                        cardType: parsed.pr ? "pr_review" : (parsed.planDay ? "plan" : "issue"),
                        prNumber: parsed.pr ? Number(parsed.pr) : undefined,
                        agent: parsed.agent,
                        door: parsed.door,
                        title: parsed.title || rootMsg.text,
                        testMode: isTest,
                      },
                      { testMode: isTest }
                    );
                    return {
                      issueNumber: foundIssue,
                      entry: {
                        channel: options.channel,
                        ts: threadTs,
                        issueNumber: foundIssue,
                        linkedIssueNumber: foundIssue,
                        agent: parsed.agent,
                        door: parsed.door,
                        title: parsed.title,
                      },
                    };
                  }
                } catch {}
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[findIssueByThreadTs Slack Fallback Notice]:`, e.message || e);
    }
  }

  return undefined;
}

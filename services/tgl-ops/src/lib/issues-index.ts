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
}

export type IssuesIndex = Record<string, IssueIndexEntry>;

const INDEX_FILE_PATH = "logs/.index/issues.json";
let memoryIndexCache: IssuesIndex | null = null;
let testIndexCache: IssuesIndex | null = null;
let lastKnownSha: string | undefined;

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
 * Records or updates an issue mapping in logs/.index/issues.json.
 * Writes locally and persists to GitHub via Contents API.
 */
export async function recordIssueMapping(
  issueNumber: number,
  entry: IssueIndexEntry,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const index = await loadIssuesIndex({ testMode: isTest });
  index[String(issueNumber)] = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };

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

/**
 * Look up mapped issue for a Slack thread timestamp.
 * Returns the most relevant matching issue (prioritising open status:needs-brief issues).
 */
export async function findNeedsBriefIssueByThreadTs(
  threadTs: string,
  options?: { testMode?: boolean }
): Promise<{ issueNumber: number; entry: IssueIndexEntry } | undefined> {
  const index = await loadIssuesIndex(options);
  const candidates: { issueNumber: number; entry: IssueIndexEntry }[] = [];

  for (const [numStr, entry] of Object.entries(index)) {
    if (entry.ts === threadTs) {
      candidates.push({ issueNumber: Number(numStr), entry });
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  // Sort descending by issue number (most recent first)
  candidates.sort((a, b) => b.issueNumber - a.issueNumber);

  // Lazy import getIssue to prevent circular dependency
  const { getIssue } = await import("./github-client.js");

  for (const c of candidates) {
    const issue = await getIssue(c.issueNumber);
    if (issue && issue.state === "open" && issue.labels.includes("status:needs-brief")) {
      return c;
    }
  }

  return candidates[0];
}

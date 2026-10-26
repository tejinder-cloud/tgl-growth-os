import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../config.js";
import { octokit } from "../lib/github-client.js";

export interface RunnerRecord {
  agent: string;
  door?: string;
  title: string;
  status: "in-progress" | "completed" | "failed" | "needs-brief" | "blocked";
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  runStartedAt: string;
  runCompletedAt?: string;
  error?: string;
}

export interface RunnerState {
  version: number;
  updatedAt: string;
  runs: Record<string, RunnerRecord>;
}

const RUNNER_STATE_PATH = "logs/.state/runner.json";

function getLocalStatePath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, "logs/.test/.state", "runner.json");
  }
  return path.join(config.repoRoot, RUNNER_STATE_PATH);
}

/**
 * Reads runner state.
 * In production/main: reads logs/.state/runner.json via GitHub Contents API.
 * In test mode: reads from logs/.test/.state/runner.json.
 */
export async function getRunnerState(options?: { testMode?: boolean }): Promise<RunnerState> {
  const isTest = options?.testMode === true || isTestMode();

  if (isTest) {
    const localPath = getLocalStatePath(true);
    if (fs.existsSync(localPath)) {
      try {
        const raw = fs.readFileSync(localPath, "utf8");
        return JSON.parse(raw);
      } catch (err) {
        console.warn("[RunnerState Test Mode] Failed to parse local state file, returning fresh state:", err);
      }
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {},
    };
  }

  if (!config.githubToken) {
    const localPath = getLocalStatePath(false);
    if (fs.existsSync(localPath)) {
      try {
        return JSON.parse(fs.readFileSync(localPath, "utf8"));
      } catch {}
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      runs: {},
    };
  }

  try {
    const res = await octokit.repos.getContent({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: RUNNER_STATE_PATH,
      ref: "main",
    });

    if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
      const decoded = Buffer.from(res.data.content, "base64").toString("utf8");
      return JSON.parse(decoded);
    }
  } catch (err: any) {
    if (err.status !== 404) {
      console.warn("[RunnerState] GitHub read error:", err.message);
    }
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: {},
  };
}

/**
 * Saves runner state.
 * In test mode: writes to logs/.test/.state/runner.json.
 * In production/main: writes to logs/.state/runner.json via GitHub Contents API.
 */
export async function saveRunnerState(
  state: RunnerState,
  options?: { testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  state.updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(state, null, 2);

  if (isTest) {
    const localPath = getLocalStatePath(true);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, serialized, "utf8");
    return true;
  }

  // Sync to local file
  try {
    const localPath = getLocalStatePath(false);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, serialized, "utf8");
  } catch (err) {
    console.warn("[RunnerState] Local sync warning:", err);
  }

  if (!config.githubToken) {
    return false;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let sha: string | undefined;
      try {
        const getRes = await octokit.repos.getContent({
          owner: config.githubOwner,
          repo: config.githubRepo,
          path: RUNNER_STATE_PATH,
          ref: "main",
        });
        if (!Array.isArray(getRes.data) && getRes.data.type === "file") {
          sha = getRes.data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      await octokit.repos.createOrUpdateFileContents({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: RUNNER_STATE_PATH,
        message: `chore(state): update runner state [${state.updatedAt}]`,
        content: Buffer.from(serialized, "utf8").toString("base64"),
        branch: "main",
        sha,
      });

      return true;
    } catch (err: any) {
      if (attempt === 3) {
        console.error("[RunnerState] GitHub commit failed after 3 attempts:", err.message);
        return false;
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }

  return false;
}

/**
 * Records an issue run record in runner state.
 */
export async function recordRunnerIssue(
  issueNumber: number,
  record: Partial<RunnerRecord>,
  options?: { testMode?: boolean }
): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const state = await getRunnerState({ testMode: isTest });
  const key = String(issueNumber);

  const existing = state.runs[key] || {
    agent: "web-builder",
    title: `Issue #${issueNumber}`,
    status: "in-progress",
    runStartedAt: new Date().toISOString(),
  };

  state.runs[key] = {
    ...existing,
    ...record,
  };

  await saveRunnerState(state, { testMode: isTest });
}

import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { readFileFromRepo, putFileInRepo } from "../../lib/github-client.js";

export interface AutorunRecord {
  issueNumber: number;
  agent: string;
  door?: string;
  title?: string;
  status: "in-progress" | "completed" | "failed";
  runStartedAt: string;
  runCompletedAt?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
}

export interface AutorunState {
  runs: Record<string, AutorunRecord>;
  lastCycleAt?: string;
}

const STATE_FILE_PATH = "logs/.state/autorun.json";

/**
 * Reads the autorun state.
 * In test mode: reads from logs/.test/.state/autorun.json locally.
 * In production: reads from main branch via GitHub Contents API.
 */
export async function getAutorunState(options?: { testMode?: boolean }): Promise<AutorunState> {
  const isTest = options?.testMode === true || isTestMode();

  if (isTest) {
    const testStatePath = path.join(config.repoRoot, "logs/.test/.state", "autorun.json");
    if (fs.existsSync(testStatePath)) {
      try {
        const raw = fs.readFileSync(testStatePath, "utf8");
        return JSON.parse(raw);
      } catch (err) {
        console.warn("[Autorun State] Error parsing local test autorun.json:", err);
      }
    }
    return { runs: {} };
  }

  try {
    const raw = await readFileFromRepo(STATE_FILE_PATH);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err: any) {
    console.warn(`[Autorun State] Error reading ${STATE_FILE_PATH} from repo:`, err.message);
  }

  return { runs: {} };
}

/**
 * Persists the autorun state.
 * In test mode: writes to logs/.test/.state/autorun.json locally.
 * In production: writes to main branch via GitHub Contents API.
 */
export async function saveAutorunState(
  state: AutorunState,
  options?: { testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  const jsonContent = JSON.stringify(state, null, 2);

  if (isTest) {
    const testDir = path.join(config.repoRoot, "logs/.test/.state");
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    const testStatePath = path.join(testDir, "autorun.json");
    fs.writeFileSync(testStatePath, jsonContent, "utf8");
    return true;
  }

  const putRes = await putFileInRepo(
    STATE_FILE_PATH,
    jsonContent,
    `chore(state): update autorun state [${new Date().toISOString()}]`
  );

  return putRes.success;
}

/**
 * Updates a specific issue's record in autorun state.
 */
export async function recordIssueRun(
  issueNumber: number,
  record: Partial<AutorunRecord> & { agent: string; status: "in-progress" | "completed" | "failed" },
  options?: { testMode?: boolean }
): Promise<void> {
  const state = await getAutorunState(options);
  const existing = state.runs[String(issueNumber)] || {
    issueNumber,
    agent: record.agent,
    runStartedAt: new Date().toISOString(),
    status: record.status,
  };

  state.runs[String(issueNumber)] = {
    ...existing,
    ...record,
    issueNumber,
  };
  state.lastCycleAt = new Date().toISOString();

  await saveAutorunState(state, options);
}

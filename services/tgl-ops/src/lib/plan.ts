import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { config, isTestMode } from "../config.js";
import { octokit } from "./github-client.js";

export interface PlanEntry {
  day: number;
  date?: string;
  agent: string;
  door: string;
  title: string;
  brief: string;
  definition_of_done: string[];
  depends_on: (number | string)[];
  architect_hour: string;
}

export interface PlanFileContent {
  version: number;
  generated_at: string;
  start_date?: string;
  days_count: number;
  plan: PlanEntry[];
}

const PLAN_FILE_PATH = "config/plan.yaml";
const TEST_PLAN_FILE_PATH = "logs/.test/plan.yaml";
const PLAN_PROGRESS_PATH = "logs/.state/plan-progress.json";
const TEST_PLAN_PROGRESS_PATH = "logs/.test/.state/plan-progress.json";

export function getPlanProgressPath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, TEST_PLAN_PROGRESS_PATH);
  }
  return path.join(config.repoRoot, PLAN_PROGRESS_PATH);
}

export async function getCurrentPlanDay(options?: { testMode?: boolean }): Promise<number> {
  const isTest = options?.testMode === true || isTestMode();
  const filePath = getPlanProgressPath(isTest);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof data.currentDay === "number") return data.currentDay;
    } catch {}
  }
  return 8; // Default start at Day 8
}

export async function setCurrentPlanDay(day: number, options?: { testMode?: boolean }): Promise<void> {
  const isTest = options?.testMode === true || isTestMode();
  const filePath = getPlanProgressPath(isTest);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ currentDay: day, updatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[Plan Progress Save Warning]", err);
  }
}

export function isTrueLeadParked(): boolean {
  try {
    const doorPath = path.join(config.repoRoot, "config/doors/truelead.yaml");
    if (fs.existsSync(doorPath)) {
      const content = fs.readFileSync(doorPath, "utf8");
      return /status:\s*parked/i.test(content);
    }
  } catch {}
  return true;
}

export function getPlanFilePath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, TEST_PLAN_FILE_PATH);
  }
  return path.join(config.repoRoot, PLAN_FILE_PATH);
}

/**
 * Loads all plan entries from config/plan.yaml.
 */
export async function loadPlanEntries(options?: { testMode?: boolean }): Promise<PlanEntry[]> {
  const isTest = options?.testMode === true || isTestMode();

  // Test mode: read local file
  if (isTest) {
    const testPath = getPlanFilePath(true);
    if (fs.existsSync(testPath)) {
      try {
        const raw = fs.readFileSync(testPath, "utf8");
        const parsed = parse(raw) as PlanFileContent;
        if (parsed?.plan && Array.isArray(parsed.plan)) return parsed.plan;
      } catch {}
    }
    // Fall back to main config/plan.yaml if test copy doesn't exist
    const defaultPath = path.join(config.repoRoot, PLAN_FILE_PATH);
    if (fs.existsSync(defaultPath)) {
      try {
        const raw = fs.readFileSync(defaultPath, "utf8");
        const parsed = parse(raw) as PlanFileContent;
        if (parsed?.plan && Array.isArray(parsed.plan)) return parsed.plan;
      } catch {}
    }
    return [];
  }

  // Production: Try GitHub Contents API from main, fallback to local disk
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: PLAN_FILE_PATH,
        ref: "main",
      });
      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        const decoded = Buffer.from(res.data.content, "base64").toString("utf8");
        const parsed = parse(decoded) as PlanFileContent;
        if (parsed?.plan && Array.isArray(parsed.plan)) return parsed.plan;
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.warn("[Plan Loader] GitHub read warning:", err.message);
      }
    }
  }

  const localPath = path.join(config.repoRoot, PLAN_FILE_PATH);
  if (fs.existsSync(localPath)) {
    try {
      const raw = fs.readFileSync(localPath, "utf8");
      const parsed = parse(raw) as PlanFileContent;
      if (parsed?.plan && Array.isArray(parsed.plan)) return parsed.plan;
    } catch {}
  }

  return [];
}

/**
 * Saves plan entries to config/plan.yaml.
 */
export async function savePlanEntries(
  entries: PlanEntry[],
  options?: { testMode?: boolean }
): Promise<boolean> {
  const isTest = options?.testMode === true || isTestMode();
  const cleanEntries = entries.map((e) => {
    const copy: any = { ...e };
    delete copy.date;
    return copy;
  });
  const fileContent: PlanFileContent = {
    version: 1,
    generated_at: new Date().toISOString(),
    days_count: cleanEntries.length,
    plan: cleanEntries,
  };
  const serialized = stringify(fileContent);

  if (isTest) {
    const testPath = getPlanFilePath(true);
    fs.mkdirSync(path.dirname(testPath), { recursive: true });
    fs.writeFileSync(testPath, serialized, "utf8");
    return true;
  }

  // Local sync
  try {
    const localPath = path.join(config.repoRoot, PLAN_FILE_PATH);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, serialized, "utf8");
  } catch (err) {
    console.warn("[Plan Save] Local write warning:", err);
  }

  if (!config.githubToken) {
    return false;
  }

  // GitHub commit to main
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let sha: string | undefined;
      try {
        const getRes = await octokit.repos.getContent({
          owner: config.githubOwner,
          repo: config.githubRepo,
          path: PLAN_FILE_PATH,
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
        path: PLAN_FILE_PATH,
        message: `chore(plan): update config/plan.yaml with ${entries.length} entries`,
        content: Buffer.from(serialized, "utf8").toString("base64"),
        branch: "main",
        sha,
      });

      return true;
    } catch (err: any) {
      if (attempt === 3) {
        console.error("[Plan Save] GitHub commit failed:", err.message);
        return false;
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }

  return false;
}

/**
 * Returns plan entries scheduled for a given date.
 */
export async function getPlanEntriesForDate(
  dateStr: string,
  options?: { testMode?: boolean }
): Promise<PlanEntry[]> {
  const all = await loadPlanEntries(options);
  return all.filter((e) => e.date === dateStr);
}

/**
 * Converts an approved proposal into a new plan entry.
 */
export async function addProposalToPlan(
  proposal: {
    title: string;
    brief: string;
    agent: string;
    door?: string;
    definition_of_done?: string[];
    architect_hour?: string;
  },
  options?: { testMode?: boolean }
): Promise<PlanEntry> {
  const entries = await loadPlanEntries(options);
  const maxDay = entries.reduce((max, e) => (e.day > max ? e.day : max), 0);
  const nextDay = maxDay + 1;

  const newEntry: PlanEntry = {
    day: nextDay,
    agent: proposal.agent,
    door: proposal.door || "core",
    title: proposal.title,
    brief: proposal.brief,
    definition_of_done: proposal.definition_of_done || [
      `Implement approved proposal: ${proposal.title}`,
      "Review card approved and verified",
    ],
    depends_on: [maxDay],
    architect_hour: proposal.architect_hour || "Review deliverable on card.",
  };

  entries.push(newEntry);
  await savePlanEntries(entries, options);
  return newEntry;
}


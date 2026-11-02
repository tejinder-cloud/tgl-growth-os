import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { config, isTestMode } from "../config.js";
import { octokit } from "./github-client.js";
import { postFile } from "./post.js";

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

export async function getCurrentPlanDay(options?: {
  testMode?: boolean;
  mockCurrentDay?: number;
  mockIssuedDays?: (number | string)[];
}): Promise<number> {
  if (options?.mockCurrentDay !== undefined) {
    return options.mockCurrentDay;
  }

  let maxDispatchedDay = 0;

  // 1. Check mockIssuedDays if passed
  if (options?.mockIssuedDays && options.mockIssuedDays.length > 0) {
    for (const d of options.mockIssuedDays) {
      const num = typeof d === "number" ? d : parseInt(String(d), 10);
      if (!isNaN(num) && num > maxDispatchedDay) {
        maxDispatchedDay = num;
      }
    }
  }

  // 2. Check local/test state file
  const isTest = options?.testMode === true || isTestMode();
  const filePath = getPlanProgressPath(isTest);
  let fileDay = 0;
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (typeof data.currentDay === "number") fileDay = data.currentDay;
    } catch {}
  }

  // 3. Reconcile with live dispatched issues in GitHub
  let githubMaxDay = 0;
  if (!isTest && config.githubToken) {
    try {
      const issuesRes = await octokit.issues.listForRepo({
        owner: config.githubOwner,
        repo: config.githubRepo,
        state: "all",
        per_page: 100,
      });

      for (const iss of issuesRes.data) {
        const match = iss.title.match(/\[PLAN-D(\d+)\]/i);
        if (match) {
          const dayNum = parseInt(match[1], 10);
          if (dayNum > githubMaxDay) {
            githubMaxDay = dayNum;
          }
        }
      }
    } catch (err: any) {
      console.warn("[Plan Progress Reconcile Warning] Could not list GitHub issues:", err.message);
    }
  }

  const determinedDay = Math.max(maxDispatchedDay, fileDay, githubMaxDay);
  return determinedDay > 0 ? determinedDay : 8; // Default start at Day 8
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

export interface PlanStatusOptions {
  testMode?: boolean;
  mockCurrentDay?: number;
  mockIssuedDays?: (number | string)[];
  mockPlanEntries?: PlanEntry[];
  mockIssues?: Array<{
    number: number;
    title: string;
    state: "open" | "closed" | string;
    pull_request?: any;
    mergedPr?: number;
  }>;
  channel?: string;
  thread_ts?: string;
}

export interface PlanStatusBreakdown {
  currentDay: number;
  sortedEntries: PlanEntry[];
  completedDays: PlanEntry[];
  openDays: PlanEntry[];
  notStartedDays: PlanEntry[];
  dayLines: string[];
  issuesByDay: Map<number, { number: number; title: string; state: string }>;
}

/**
 * Computes plan status breakdown by matching config/plan.yaml against live or mock issues.
 */
export async function computePlanStatusBreakdown(options?: PlanStatusOptions): Promise<PlanStatusBreakdown> {
  const isTest = options?.testMode === true || isTestMode();
  const currentDay = await getCurrentPlanDay(options);
  const planEntries = options?.mockPlanEntries || (await loadPlanEntries(options));

  // Sort plan entries by day ascending
  const sortedEntries = [...planEntries].sort((a, b) => a.day - b.day);

  // Retrieve live or mock issues
  let issues: Array<{ number: number; title: string; state: string; pull_request?: any }> = [];
  if (options?.mockIssues) {
    issues = options.mockIssues;
  } else if (!isTest && config.githubToken) {
    try {
      const res = await octokit.issues.listForRepo({
        owner: config.githubOwner,
        repo: config.githubRepo,
        state: "all",
        per_page: 100,
      });
      issues = (res.data || []).filter((iss) => !iss.pull_request);
    } catch (err: any) {
      console.warn("[Plan Status] Failed to fetch issues from GitHub:", err.message);
    }
  }

  // Index issues by [PLAN-Dn] or [PLAN-D(\d+)]
  const issuesByDay = new Map<number, { number: number; title: string; state: string }>();
  for (const iss of issues) {
    const match = iss.title.match(/\[PLAN-D(\d+)\]/i);
    if (match) {
      const dayNum = parseInt(match[1], 10);
      issuesByDay.set(dayNum, {
        number: iss.number,
        title: iss.title,
        state: iss.state,
      });
    }
  }

  const completedDays: PlanEntry[] = [];
  const openDays: PlanEntry[] = [];
  const notStartedDays: PlanEntry[] = [];
  const dayLines: string[] = [];

  for (const entry of sortedEntries) {
    const iss = issuesByDay.get(entry.day);
    let statusLabel = "not started (no issue)";
    let issueRef = "";

    if (iss) {
      issueRef = ` (#${iss.number})`;
      if (iss.state === "closed") {
        statusLabel = "completed (issue closed with merged PR)";
        completedDays.push(entry);
      } else {
        statusLabel = "open (issue open)";
        openDays.push(entry);
      }
    } else {
      notStartedDays.push(entry);
    }

    dayLines.push(`• *Day ${entry.day}:* ${statusLabel} — ${entry.title}${issueRef}`);
  }

  return {
    currentDay,
    sortedEntries,
    completedDays,
    openDays,
    notStartedDays,
    dayLines,
    issuesByDay,
  };
}

/**
 * Returns the full per-day plan status report suitable for file attachment.
 */
export async function getPlanStatusFullReport(options?: PlanStatusOptions): Promise<string> {
  const breakdown = await computePlanStatusBreakdown(options);
  const { currentDay, sortedEntries, completedDays, openDays, notStartedDays, dayLines } = breakdown;

  return [
    `The Growth Lab — Complete Plan Status`,
    `Current Day: Day ${currentDay}`,
    `Total Plan Days: ${sortedEntries.length}`,
    `Completed: ${completedDays.length} | Open: ${openDays.length} | Not Started: ${notStartedDays.length}`,
    "",
    `Per-Day Breakdown:`,
    ...dayLines,
    "",
    `Verified from config/plan.yaml and live GitHub issues.`,
  ].join("\n");
}

/**
 * Compiles a plan status summary:
 * - current day
 * - counts (completed/open/not started)
 * - the open issues by day
 * - the next 5 not-started days
 * with the full per-day list attached as a file via postFile.
 * Strictly uses plain text and bold only (no emojis).
 */
export async function getPlanStatusAnswer(options?: PlanStatusOptions): Promise<string> {
  const breakdown = await computePlanStatusBreakdown(options);
  const { currentDay, sortedEntries, completedDays, openDays, notStartedDays, dayLines, issuesByDay } = breakdown;

  const completedSummary =
    completedDays.length > 0
      ? `${completedDays.length} day${completedDays.length === 1 ? "" : "s"} (${completedDays.map((d) => `Day ${d.day}`).join(", ")})`
      : "0 days";

  const openSummary =
    openDays.length > 0
      ? `${openDays.length} day${openDays.length === 1 ? "" : "s"} (${openDays.map((d) => `Day ${d.day}`).join(", ")})`
      : "0 days";

  const notStartedSummary = `${notStartedDays.length} day${notStartedDays.length === 1 ? "" : "s"}`;

  // 1. Open issues by day
  const openIssuesLines = openDays.map((entry) => {
    const iss = issuesByDay.get(entry.day);
    const issueRef = iss ? ` (#${iss.number})` : "";
    return `• *Day ${entry.day}:* open (issue open) — ${entry.title}${issueRef}`;
  });

  // 2. Next 5 not-started days
  const next5NotStarted = notStartedDays.slice(0, 5);
  const next5Lines = next5NotStarted.map((entry) => {
    return `• *Day ${entry.day}:* not started (no issue) — ${entry.title}`;
  });

  const remainingNotStartedCount = notStartedDays.length - next5NotStarted.length;
  const moreNotStartedNote =
    remainingNotStartedCount > 0
      ? `\n_(+${remainingNotStartedCount} more not-started days in attached complete plan)_`
      : "";

  const openSection =
    openIssuesLines.length > 0
      ? `*Open Issues by Day:*\n${openIssuesLines.join("\n")}`
      : `*Open Issues by Day:* None active`;

  const next5Section =
    next5Lines.length > 0
      ? `*Next 5 Not-Started Days:*\n${next5Lines.join("\n")}${moreNotStartedNote}`
      : `*Next 5 Not-Started Days:* None remaining`;

  // Attach full per-day list as a file via postFile if channel is provided
  if (options?.channel) {
    const fullPerDayText = [
      `The Growth Lab — Complete Plan Status`,
      `Current Day: Day ${currentDay}`,
      `Total Plan Days: ${sortedEntries.length}`,
      `Completed: ${completedDays.length} | Open: ${openDays.length} | Not Started: ${notStartedDays.length}`,
      "",
      `Per-Day Breakdown:`,
      ...dayLines,
      "",
      `Verified from config/plan.yaml and live GitHub issues.`,
    ].join("\n");

    await postFile({
      channel: options.channel,
      thread_ts: options.thread_ts,
      filename: `plan-status-day-${currentDay}.txt`,
      title: `Complete Plan Status — Day ${currentDay} (${sortedEntries.length} days)`,
      fileBuffer: Buffer.from(fullPerDayText, "utf8"),
    }).catch((err) => {
      console.warn("[Plan Status postFile Warning]", err);
    });
  }

  return [
    `*Plan Status (Current Day: Day ${currentDay})*`,
    `• *Completed:* ${completedSummary}`,
    `• *Open:* ${openSummary}`,
    `• *Not Started:* ${notStartedSummary}`,
    `• *Total Plan Days:* ${sortedEntries.length}`,
    "",
    openSection,
    "",
    next5Section,
    "",
    `_Full per-day list attached as a file via postFile (${sortedEntries.length} days)._`,
  ].join("\n");
}


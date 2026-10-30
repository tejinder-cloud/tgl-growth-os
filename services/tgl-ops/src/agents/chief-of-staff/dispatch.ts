import { config, isTestMode } from "../../config.js";
import { loadAgents } from "../../lib/agents.js";
import { createIssue, octokit } from "../../lib/github-client.js";
import { postCard, postLine } from "../../lib/post.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import {
  loadPlanEntries,
  getCurrentPlanDay,
  setCurrentPlanDay,
  isTrueLeadParked,
  type PlanEntry,
} from "../../lib/plan.js";

export interface DispatchResult {
  date: string;
  status?: string;
  dispatchedCount: number;
  skippedCount: number;
  carriedForwardCount: number;
  dispatchedEntries: PlanEntry[];
  carriedForwardEntries: PlanEntry[];
  architectHourCardTs?: string;
}

export interface PlanDayDispatchResult {
  success: boolean;
  status: "dispatched" | "blocked" | "already-issued" | "not-found";
  reason?: string;
  entry?: PlanEntry;
  assignedAgent?: string;
  issueNumber?: number;
  issueUrl?: string;
  architectCardTs?: string;
}

/**
 * Checks if a plan dependency (by day number or key) has been completed.
 */
async function isDependencyDone(
  depDay: number | string,
  options?: { testMode?: boolean; mockCompletedDays?: (number | string)[] }
): Promise<boolean> {
  // Check architect-unpark dependency
  if (depDay === "architect-unpark") {
    return !isTrueLeadParked();
  }

  const num = typeof depDay === "number" ? depDay : parseInt(depDay, 10);
  if (isNaN(num)) return false;

  // Days 1–7 (Phase 0 and earlier) are foundational and completed
  if (num < 8) return true;

  if (options?.mockCompletedDays && options.mockCompletedDays.includes(num)) {
    return true;
  }

  const isTest = options?.testMode === true || isTestMode();
  if (isTest) {
    return true;
  }

  if (!config.githubToken) return true;

  try {
    const issues = await octokit.issues.listForRepo({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "all",
      per_page: 50,
    });

    const match = issues.data.find(
      (iss) =>
        iss.title.includes(`[PLAN-D${num}]`) ||
        iss.title.includes(`Plan Day ${num}`) ||
        (iss.body && iss.body.includes(`Day ${num}`))
    );

    if (!match) return false;
    return match.state === "closed";
  } catch (err: any) {
    console.warn(`[Plan Dispatch Dependency Warning] Error checking Day ${num}:`, err.message);
    return false;
  }
}

// In-memory set to ensure idempotency across dispatch runs
const issuedDaysCache = new Set<number>();

export function resetIssuedDaysCache(): void {
  issuedDaysCache.clear();
}

/**
 * Checks if an issue has already been created for this plan entry.
 */
export async function isEntryAlreadyIssued(
  entry: PlanEntry,
  options?: { testMode?: boolean; mockIssuedDays?: number[] }
): Promise<boolean> {
  if (issuedDaysCache.has(entry.day)) {
    return true;
  }

  if (options?.mockIssuedDays && options.mockIssuedDays.includes(entry.day)) {
    return true;
  }

  const isTest = options?.testMode === true || isTestMode();
  if (isTest) {
    return false;
  }

  if (!config.githubToken) return false;

  try {
    const issues = await octokit.issues.listForRepo({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "all",
      per_page: 50,
    });

    const match = issues.data.find(
      (iss) =>
        iss.title.includes(`[PLAN-D${entry.day}]`) ||
        (iss.title.includes(entry.title) && iss.state === "open")
    );

    return Boolean(match);
  } catch (err: any) {
    console.warn(`[Plan Dispatch Check Warning] Error checking Day ${entry.day}:`, err.message);
    return false;
  }
}

/**
 * Dispatches a specific plan day on the Architect's word ("go" or "day N").
 * Weekends allowed. Evaluates dependencies (including "architect-unpark").
 */
export async function dispatchPlanDay(
  targetDay: number,
  options?: {
    testMode?: boolean;
    dateStr?: string;
    mockCompletedDays?: (number | string)[];
    mockIssuedDays?: number[];
  }
): Promise<PlanDayDispatchResult> {
  const isTest = options?.testMode === true || isTestMode();
  const allEntries = await loadPlanEntries(options);
  const entry = allEntries.find((e) => e.day === targetDay);

  if (!entry) {
    return {
      success: false,
      status: "not-found",
      reason: `Plan Day ${targetDay} not found in config/plan.yaml.`,
    };
  }

  // 1. Check if already issued
  const alreadyIssued = await isEntryAlreadyIssued(entry, options);
  if (alreadyIssued) {
    return {
      success: false,
      status: "already-issued",
      reason: `Plan Day ${targetDay} ("${entry.title}") has already been issued.`,
      entry,
      issueNumber: entry.day,
      issueUrl: `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${entry.day}`,
    };
  }

  // 2. Check dependencies
  for (const dep of entry.depends_on) {
    const done = await isDependencyDone(dep, options);
    if (!done) {
      const depMsg =
        dep === "architect-unpark"
          ? `Day ${targetDay} is parked until TrueVisible ships (depends on architect-unpark).`
          : `Day ${targetDay} is blocked: Dependency Day ${dep} is not done.`;
      return {
        success: false,
        status: "blocked",
        reason: depMsg,
        entry,
      };
    }
  }

  // 3. Assign agent
  const createsAgentSkillOrService =
    entry.definition_of_done.some(
      (d) =>
        /agents\/[^/]+\/SKILL\.md/i.test(d) ||
        /services\//i.test(d) ||
        /service code/i.test(d) ||
        /SKILL\.md/i.test(d)
    ) ||
    /agents\/[^/]+\/SKILL\.md/i.test(entry.brief) ||
    /new service code/i.test(entry.brief);

  const assignedAgent = createsAgentSkillOrService ? "web-builder" : entry.agent;
  const registeredAgents = await loadAgents();
  const agentRecord = registeredAgents.find((a) => a.name === assignedAgent);
  const targetChannel = isTest
    ? (config.opsChannelId || "#ops")
    : (agentRecord?.channel || config.standupChannelId);

  const issueBody = `### for-agent
${assignedAgent}

### door
${entry.door || "core"}

### brief
${entry.brief}

### definition-of-done
${entry.definition_of_done.map((d) => `- [ ] ${d}`).join("\n")}

### plan-day
Day ${entry.day}

### depends-on
${entry.depends_on.join(", ") || "None"}
`;

  let issueNumber = entry.day;
  let issueUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${entry.day}`;

  if (!isTest && config.githubToken) {
    try {
      const ghIssue = await createIssue({
        title: `[PLAN-D${entry.day}]: ${entry.title}`,
        body: issueBody,
        labels: [`for:${assignedAgent}`, `door:${entry.door || "core"}`, "type:build", "status:in-progress"],
      });
      issueNumber = ghIssue.number;
      issueUrl = ghIssue.html_url;
    } catch (err: any) {
      console.error(`[Plan Dispatch Issue Error] Day ${entry.day}:`, err.message);
    }
  }

  // Post card to agent channel
  await postCard({
    channel: targetChannel,
    agent: assignedAgent,
    door: entry.door || "core",
    title: `Plan Day ${entry.day}: ${entry.title}`,
    summary: `*Brief:* ${entry.brief}\n\n*Definition of Done:*\n${entry.definition_of_done.map((d) => `• ${d}`).join("\n")}`,
    links: [
      { label: `Issue #${issueNumber}`, url: issueUrl },
      { label: "Plan", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/plan.yaml` },
    ],
    actions: ["approve", "reject", "discuss"],
    issue: issueNumber,
    extraMeta: {
      planDay: entry.day,
      agent: assignedAgent,
    },
  }).catch((err) => console.warn("[Plan Dispatch Card Post Warning]", err));

  issuedDaysCache.add(entry.day);

  // If entry has architect_hour, post morning card to #architect
  let architectCardTs: string | undefined;
  if (entry.architect_hour) {
    const architectChannel = isTest
      ? (config.opsChannelId || "#ops")
      : config.architectChannelId;
    if (architectChannel) {
      const cardRes = await postCard({
        channel: architectChannel,
        agent: "chief-of-staff",
        door: entry.door || "core",
        title: `Your hour today: Day ${entry.day}`,
        summary: `*Your hour today (Day ${entry.day} — @${assignedAgent}):*\n• ${entry.architect_hour}`,
        links: [
          { label: `Issue #${issueNumber}`, url: issueUrl },
          { label: "PROJECT-PLAN.md", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/PROJECT-PLAN.md` },
        ],
        actions: ["discuss"],
      }).catch(() => ({ ok: false, ts: undefined }));
      architectCardTs = cardRes?.ts;
    }
  }

  // Advance current day
  await setCurrentPlanDay(targetDay, options);

  return {
    success: true,
    status: "dispatched",
    entry,
    assignedAgent,
    issueNumber,
    issueUrl,
    architectCardTs,
  };
}

/**
 * 09:00 IST Morning Plan Status Card.
 * Per Architect Decision 2:
 * The 09:00 card becomes a status card: current day, open issues, carried items, "say go for Day N+1".
 */
export async function execute0900PlanDispatch(options?: {
  dateStr?: string;
  testMode?: boolean;
  day?: number;
  autoDispatch?: boolean;
  mockCompletedDays?: (number | string)[];
  mockIssuedDays?: number[];
}): Promise<DispatchResult> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = options?.dateStr || getTodayDateString();
  const currentDay = options?.day || (await getCurrentPlanDay(options));

  console.log(`\n=======================================================`);
  console.log(`📋 Chief of Staff: 09:00 IST Morning Status Card (Day ${currentDay})`);
  console.log(`=======================================================`);

  const allEntries = await loadPlanEntries(options);
  const currentEntry = allEntries.find((e) => e.day === currentDay);

  // Gather open issues count
  let openIssuesCount = 0;
  if (!isTest && config.githubToken) {
    try {
      const res = await octokit.issues.listForRepo({
        owner: config.githubOwner,
        repo: config.githubRepo,
        state: "open",
        per_page: 50,
      });
      openIssuesCount = res.data.length;
    } catch {}
  }

  // Carried items: past days not done or parked
  const carriedForwardEntries: PlanEntry[] = [];
  const pastEntries = allEntries.filter((e) => e.day < currentDay);
  for (const past of pastEntries) {
    const isDone = await isDependencyDone(past.day, options);
    if (!isDone) carriedForwardEntries.push(past);
  }

  // Post 09:00 Status Card to #architect
  const architectChannel = isTest ? (config.opsChannelId || "#ops") : config.architectChannelId;
  let architectCardTs: string | undefined;

  if (architectChannel) {
    const carriedNotice =
      carriedForwardEntries.length > 0
        ? `\n• *Carried / Blocked:* ${carriedForwardEntries.map((c) => `Day ${c.day} (@${c.agent})`).join(", ")}`
        : "\n• *Carried Items:* None";

    const summaryText = `*Chief of Staff 09:00 IST Status Card*
• *Current Day:* Day ${currentDay} (${currentEntry?.title || "Active"})
• *Open Issues:* ${openIssuesCount} active in repo${carriedNotice}

👉 *Action:* Say *"go"* in #architect for Day ${currentDay + 1} (or *"day N"* for any specific day). Weekends allowed.`;

    const cardRes = await postCard({
      channel: architectChannel,
      agent: "chief-of-staff",
      door: "core",
      title: `Plan Status Card — Day ${currentDay}`,
      summary: summaryText,
      links: [
        { label: "PROJECT-PLAN.md", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/PROJECT-PLAN.md` },
        { label: "config/plan.yaml", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/plan.yaml` },
      ],
      actions: ["discuss"],
    }).catch(() => ({ ok: false, ts: undefined }));

    architectCardTs = cardRes?.ts;
  }

  // When autoDispatch is explicitly requested, execute dispatchPlanDay for currentDay
  const dispatchedEntries: PlanEntry[] = [];
  let skippedCount = 0;

  if (options?.autoDispatch) {
    const res = await dispatchPlanDay(currentDay, options);
    if (res.success && res.entry) {
      dispatchedEntries.push(res.entry);
    } else if (res.status === "already-issued") {
      skippedCount++;
    }
  }

  console.log(`[Plan Status Complete] Current Day: ${currentDay} | Dispatched: ${dispatchedEntries.length} | Skipped: ${skippedCount} | Carried: ${carriedForwardEntries.length}`);

  return {
    date: dateStr,
    status: "status-card",
    dispatchedCount: dispatchedEntries.length,
    skippedCount,
    carriedForwardCount: carriedForwardEntries.length,
    dispatchedEntries,
    carriedForwardEntries,
    architectHourCardTs: architectCardTs,
  };
}


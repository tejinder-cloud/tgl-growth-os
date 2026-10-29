import { config, isTestMode } from "../../config.js";
import { loadAgents } from "../../lib/agents.js";
import { createIssue, octokit } from "../../lib/github-client.js";
import { postCard, postLine } from "../../lib/post.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { loadPlanEntries, type PlanEntry } from "../../lib/plan.js";

export interface DispatchResult {
  date: string;
  dispatchedCount: number;
  skippedCount: number;
  carriedForwardCount: number;
  dispatchedEntries: PlanEntry[];
  carriedForwardEntries: PlanEntry[];
  architectHourCardTs?: string;
}

/**
 * Checks if a plan dependency (by day number) has been completed.
 */
async function isDependencyDone(
  depDay: number,
  options?: { testMode?: boolean; mockCompletedDays?: number[] }
): Promise<boolean> {
  // Days 1–7 (Phase 0 and earlier) are foundational and completed
  if (depDay < 8) return true;

  if (options?.mockCompletedDays && options.mockCompletedDays.includes(depDay)) {
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
        iss.title.includes(`[PLAN-D${depDay}]`) ||
        iss.title.includes(`Plan Day ${depDay}`) ||
        (iss.body && iss.body.includes(`Day ${depDay}`))
    );

    if (!match) return false;
    return match.state === "closed";
  } catch (err: any) {
    console.warn(`[Plan Dispatch Dependency Warning] Error checking Day ${depDay}:`, err.message);
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
async function isEntryAlreadyIssued(
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
 * 09:00 IST Morning Plan Dispatcher.
 */
export async function execute0900PlanDispatch(options?: {
  dateStr?: string;
  testMode?: boolean;
  mockCompletedDays?: number[];
  mockIssuedDays?: number[];
}): Promise<DispatchResult> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = options?.dateStr || getTodayDateString();
  const timeStr = getCurrentTimeIST();

  console.log(`\n=======================================================`);
  console.log(`📋 Chief of Staff: Executing 09:00 IST Plan Dispatch (${dateStr})`);
  console.log(`=======================================================`);

  const allEntries = await loadPlanEntries(options);
  const todayEntries = allEntries.filter((e) => e.date === dateStr);
  const pastEntries = allEntries.filter((e) => e.date < dateStr);

  const registeredAgents = await loadAgents();
  const dispatchedEntries: PlanEntry[] = [];
  const carriedForwardEntries: PlanEntry[] = [];
  let skippedCount = 0;

  // 1. Evaluate today's entries
  for (const entry of todayEntries) {
    // Check if already issued
    const alreadyIssued = await isEntryAlreadyIssued(entry, options);
    if (alreadyIssued) {
      console.log(`[Plan Dispatch] Day ${entry.day} ("${entry.title}") already issued. Skipping.`);
      skippedCount++;
      continue;
    }

    // Check depends_on
    let dependenciesMet = true;
    for (const dep of entry.depends_on) {
      const done = await isDependencyDone(dep, options);
      if (!done) {
        dependenciesMet = false;
        console.log(`[Plan Dispatch] Day ${entry.day} blocked: Dependency Day ${dep} is not done.`);
        break;
      }
    }

    if (!dependenciesMet) {
      carriedForwardEntries.push(entry);
      continue;
    }

    // Eligible for dispatch: create issue & post card
    console.log(`[Plan Dispatch] Dispatching Day ${entry.day}: "${entry.title}" to @${entry.agent}...`);

    const agentRecord = registeredAgents.find((a) => a.name === entry.agent);
    const targetChannel = isTest
      ? (config.opsChannelId || "#ops")
      : (agentRecord?.channel || config.standupChannelId);

    const issueBody = `### for-agent
${entry.agent}

### door
${entry.door || "core"}

### brief
${entry.brief}

### definition-of-done
${entry.definition_of_done.map((d) => `- [ ] ${d}`).join("\n")}

### plan-day
Day ${entry.day} · ${entry.date}

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
          labels: [`for:${entry.agent}`, `door:${entry.door || "core"}`, "type:build", "status:in-progress"],
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
      agent: entry.agent,
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
        agent: entry.agent,
      },
    }).catch((err) => console.warn("[Plan Dispatch Card Post Warning]", err));

    dispatchedEntries.push(entry);
    issuedDaysCache.add(entry.day);
  }

  // 2. Identify unfinished past entries to carry forward
  for (const past of pastEntries) {
    const isDone = await isDependencyDone(past.day, options);
    if (!isDone) {
      carriedForwardEntries.push(past);
    }
  }

  // 3. Post Architect Hour Morning Card to #architect
  let architectCardTs: string | undefined;
  const activeEntriesWithHour = todayEntries.filter((e) => e.architect_hour);

  if (activeEntriesWithHour.length > 0) {
    const architectChannel = isTest
      ? (config.opsChannelId || "#ops")
      : config.architectChannelId;

    if (!architectChannel) {
      console.warn("[Plan Dispatch] ARCHITECT_CHANNEL_ID not configured; skipping morning architect hour card.");
    } else {
      const hourSummaryLines = activeEntriesWithHour
        .map((e) => `• *Day ${e.day} (@${e.agent}):* ${e.architect_hour}`)
        .join("\n");

      const carriedNotice =
        carriedForwardEntries.length > 0
          ? `\n\n_Note: ${carriedForwardEntries.length} tasks carried forward: ${carriedForwardEntries.map((c) => `Day ${c.day}`).join(", ")}._`
          : "";

      const cardRes = await postCard({
        channel: architectChannel,
        agent: "chief-of-staff",
        door: "core",
        title: `Your hour today (${dateStr})`,
        summary: `*Your hour today:*\n${hourSummaryLines}${carriedNotice}`,
        links: [
          { label: "PROJECT-PLAN.md", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/PROJECT-PLAN.md` },
          { label: "config/plan.yaml", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/plan.yaml` },
        ],
        actions: ["discuss"],
      }).catch((err) => {
        console.warn("[Architect Hour Card Warning]", err);
        return { ok: false, ts: undefined };
      });

      architectCardTs = cardRes?.ts;
    }
  }

  console.log(`[Plan Dispatch Complete] Dispatched: ${dispatchedEntries.length} | Skipped: ${skippedCount} | Carried Forward: ${carriedForwardEntries.length}`);

  return {
    date: dateStr,
    dispatchedCount: dispatchedEntries.length,
    skippedCount,
    carriedForwardCount: carriedForwardEntries.length,
    dispatchedEntries,
    carriedForwardEntries,
    architectHourCardTs: architectCardTs,
  };
}


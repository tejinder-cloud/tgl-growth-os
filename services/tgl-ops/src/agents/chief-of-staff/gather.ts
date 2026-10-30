import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { octokit } from "../../lib/github-client.js";
import { slackClient } from "../../lib/slack-client.js";
import { loadDoorConfig } from "../../lib/agents.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { getAgentsCostStatusForStandup, type AgentCostCapInfo } from "../../lib/cost-cap.js";
import { loadPlanEntries, getCurrentPlanDay } from "../../lib/plan.js";

export interface LogEntry {
  agent: string;
  content: string;
}

export interface OpenApproval {
  title: string;
  agent: string;
  ts: string;
  permalink?: string;
  ageHours?: number;
}

export interface InProgressIssue {
  number: number;
  title: string;
  agent: string;
  door: string;
  ageDays: number;
  url: string;
}

export interface OpenPR {
  number: number;
  title: string;
  author: string;
  url: string;
  ageDays: number;
}

export interface OpenProposal {
  number: number;
  title: string;
  agent: string;
  body: string;
  url: string;
}

export interface CarriedForwardPlanEntry {
  day: number;
  date?: string;
  agent: string;
  title: string;
}

export interface GatheredData {
  date: string;
  compileTime?: string;
  logs: LogEntry[];
  openApprovals: OpenApproval[];
  inProgressIssues: InProgressIssue[];
  openPrs: OpenPR[];
  doors: { name: string; scorecardLines: string[] }[];
  openProposals: OpenProposal[];
  agentCostStatuses: AgentCostCapInfo[];
  carriedForwardPlanEntries: CarriedForwardPlanEntry[];
  rawSummaryText: string;
}

/**
 * Gathers all operational material for the 17:50 IST standup synthesis:
 * - logs/<today>/*.md
 * - open cards in #approvals with no matching decisions/ line
 * - issues labeled status:in-progress per agent with age
 * - PRs awaiting review
 * - door configurations from config/doors/*.yaml
 */
export async function gatherStandupMaterial(
  dateStr?: string,
  options?: { testMode?: boolean; compileTime?: string }
): Promise<GatheredData> {
  const date = dateStr || getTodayDateString();
  const compileTime = options?.compileTime || getCurrentTimeIST();
  const isTest = options?.testMode === true || process.env.TGL_TEST_MODE === "1";

  // 1. Gather logs/<date>/*.md from main via Contents API, never local disk
  const logs: LogEntry[] = [];

  // In test mode, allow reading mock logs from logs/.test/logs if present
  if (isTest) {
    const testLogsDir = path.join(config.repoRoot, "logs/.test/logs");
    if (fs.existsSync(testLogsDir)) {
      try {
        const files = fs.readdirSync(testLogsDir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
        for (const file of files) {
          const agent = file.replace(/\.md$/, "");
          const content = fs.readFileSync(path.join(testLogsDir, file), "utf8");
          logs.push({ agent, content: content.trim() });
        }
      } catch {}
    }
  }

  // Primary path (production & testing against real logs): Read directly from main via GitHub Contents API
  if (logs.length === 0 && config.githubToken) {
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
            const fileRes = await octokit.repos.getContent({
              owner: config.githubOwner,
              repo: config.githubRepo,
              path: item.path,
              ref: "main",
            });
            if (!Array.isArray(fileRes.data) && fileRes.data.type === "file" && fileRes.data.content) {
              const decoded = Buffer.from(fileRes.data.content, "base64").toString("utf8");
              const agent = item.name.replace(/\.md$/, "");
              if (!logs.some((l) => l.agent === agent)) {
                logs.push({ agent, content: decoded.trim() });
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.warn(`[Gather] GitHub error fetching logs for ${date} from main:`, err.message);
      }
    }
  }

  // 2. Gather confirmed decisions to determine open approvals from main via Contents API
  let confirmedDecisionsText = "";
  if (isTest) {
    const testDecisionsPath = path.join(config.repoRoot, "logs/.test/decisions.md");
    if (fs.existsSync(testDecisionsPath)) {
      confirmedDecisionsText = fs.readFileSync(testDecisionsPath, "utf8");
    }
  }

  if (!confirmedDecisionsText && config.githubToken) {
    try {
      const decRes = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `decisions/${date}.md`,
        ref: "main",
      });
      if (!Array.isArray(decRes.data) && decRes.data.type === "file" && decRes.data.content) {
        confirmedDecisionsText = Buffer.from(decRes.data.content, "base64").toString("utf8");
      }
    } catch {
      // No decisions file yet today
    }
  }

  // 3. Gather open approvals from Slack #approvals
  const openApprovals: OpenApproval[] = [];
  if (config.slackBotToken && config.approvalsChannelId) {
    try {
      const history = await slackClient.conversations.history({
        channel: config.approvalsChannelId,
        limit: 30,
      });

      const messages = history.messages || [];
      const now = Date.now();

      for (const msg of messages) {
        // Ignore system messages (join, leave, rename, purpose, topic, etc.)
        if (msg.subtype && msg.subtype !== "bot_message") {
          continue;
        }

        // Count only bot-posted cards
        const isBot = Boolean(msg.bot_id || msg.app_id || msg.subtype === "bot_message");
        if (!isBot) {
          continue;
        }

        // Count only cards with action buttons (block_id card_actions or type actions with button elements)
        const hasActionButtons = (msg.blocks || []).some(
          (b: any) =>
            (b.block_id === "card_actions" || b.type === "actions") &&
            Array.isArray(b.elements) &&
            b.elements.some((el: any) => el.type === "button")
        );
        if (!hasActionButtons) {
          continue;
        }

        const text = msg.text || "";

        // Extract title or summary
        let title = "Approval proposal";
        const headerBlock = (msg.blocks || []).find((b: any) => b.type === "header");
        if (headerBlock?.text?.text) {
          title = headerBlock.text.text;
        } else if (text) {
          title = text.split("\n")[0].slice(0, 80);
        }

        // Extract agent
        let agent = "web-builder";
        const agentMatch = text.match(/@([a-zA-Z0-9_-]+)/);
        if (agentMatch) {
          agent = agentMatch[1];
        }

        // Check if this card was decided in decisions/<date>.md (no decisions/ line)
        const isDecided =
          (msg.ts && confirmedDecisionsText.includes(msg.ts)) ||
          (title && confirmedDecisionsText.includes(title.slice(0, 40))) ||
          (msg.blocks || []).some((b: any) => b.text?.text?.includes("Approved by") || b.text?.text?.includes("Rejected by"));

        if (!isDecided && msg.ts) {
          const ageHours = Math.max(0, Math.round((now - Number(msg.ts) * 1000) / 3600000));
          const permalink = `https://itsthegrowthlab.slack.com/archives/${config.approvalsChannelId}/p${msg.ts.replace(".", "")}`;
          openApprovals.push({
            title,
            agent,
            ts: msg.ts,
            permalink,
            ageHours,
          });
        }
      }
    } catch (err: any) {
      console.warn("[Gather] Error fetching Slack approvals history:", err.message);
    }
  }

  // 4. Gather issues labeled status:in-progress
  const inProgressIssues: InProgressIssue[] = [];
  if (config.githubToken) {
    try {
      const issuesRes = await octokit.issues.listForRepo({
        owner: config.githubOwner,
        repo: config.githubRepo,
        labels: "status:in-progress",
        state: "open",
        per_page: 50,
      });

      const now = Date.now();
      for (const iss of issuesRes.data) {
        if (iss.pull_request) continue; // Exclude PRs returned by issues endpoint

        const forLabel = iss.labels.find((l) => typeof l !== "string" && l.name?.startsWith("for:"));
        const doorLabel = iss.labels.find((l) => typeof l !== "string" && l.name?.startsWith("door:"));

        const agent = typeof forLabel !== "string" && forLabel?.name ? forLabel.name.replace(/^for:/, "") : "unassigned";
        const door = typeof doorLabel !== "string" && doorLabel?.name ? doorLabel.name.replace(/^door:/, "") : "core";
        const createdMs = new Date(iss.created_at).getTime();
        const ageDays = Math.max(0, Math.floor((now - createdMs) / 86400000));

        inProgressIssues.push({
          number: iss.number,
          title: iss.title,
          agent,
          door,
          ageDays,
          url: iss.html_url,
        });
      }
    } catch (err: any) {
      console.warn("[Gather] Error listing in-progress issues:", err.message);
    }
  }

  // 5. Gather open pull requests awaiting review
  const openPrs: OpenPR[] = [];
  if (config.githubToken) {
    try {
      const pullsRes = await octokit.pulls.list({
        owner: config.githubOwner,
        repo: config.githubRepo,
        state: "open",
        per_page: 30,
      });

      const now = Date.now();
      for (const pr of pullsRes.data) {
        const createdMs = new Date(pr.created_at).getTime();
        const ageDays = Math.max(0, Math.floor((now - createdMs) / 86400000));
        openPrs.push({
          number: pr.number,
          title: pr.title,
          author: pr.user?.login || "unknown",
          url: pr.html_url,
          ageDays,
        });
      }
    } catch (err: any) {
      console.warn("[Gather] Error listing open PRs:", err.message);
    }
  }

  // 6. Gather doors specifications
  const doors: { name: string; scorecardLines: string[] }[] = [];
  for (const dName of ["aeo", "ai", "truelead"]) {
    try {
      const doorData = await loadDoorConfig(dName);
      if (doorData) {
        doors.push({
          name: doorData.name || dName,
          scorecardLines: doorData.scorecard_lines || [],
        });
      }
    } catch {
      // Ignore missing door configs
    }
  }

  // 7. Gather open proposals (issues labelled type:proposal)
  const openProposals: OpenProposal[] = [];
  if (config.githubToken) {
    try {
      const propRes = await octokit.issues.listForRepo({
        owner: config.githubOwner,
        repo: config.githubRepo,
        labels: "type:proposal",
        state: "open",
        per_page: 30,
      });

      for (const p of propRes.data) {
        if (p.pull_request) continue;
        const forLabel = p.labels.find((l) => typeof l !== "string" && l.name?.startsWith("for:"));
        const agent = typeof forLabel !== "string" && forLabel?.name ? forLabel.name.replace(/^for:/, "") : "unknown";
        openProposals.push({
          number: p.number,
          title: p.title,
          agent,
          body: p.body || "",
          url: p.html_url,
        });
      }
    } catch (err: any) {
      console.warn("[Gather] Error listing open proposals:", err.message);
    }
  }

  // 8. Gather agent cost caps & spend statuses
  let agentCostStatuses: AgentCostCapInfo[] = [];
  try {
    agentCostStatuses = await getAgentsCostStatusForStandup({ testMode: isTest });
  } catch (err: any) {
    console.warn("[Gather] Error fetching agent cost statuses:", err.message);
  }

  // 9. Gather carried forward plan entries (entries up to current plan day whose issues are in-progress)
  const carriedForwardPlanEntries: CarriedForwardPlanEntry[] = [];
  try {
    const allEntries = await loadPlanEntries({ testMode: isTest });
    const currentDay = await getCurrentPlanDay({ testMode: isTest });
    for (const entry of allEntries) {
      if (entry.day <= currentDay) {
        const matchingInProgress = inProgressIssues.some(
          (iss) =>
            iss.agent === entry.agent &&
            (iss.title.toLowerCase().includes(entry.title.toLowerCase().slice(0, 20)) ||
              entry.title.toLowerCase().includes(iss.title.toLowerCase().slice(0, 20)))
        );
        if (matchingInProgress) {
          carriedForwardPlanEntries.push({
            day: entry.day,
            date: entry.date,
            agent: entry.agent,
            title: entry.title,
          });
        }
      }
    }
  } catch (err: any) {
    console.warn("[Gather] Error checking carried forward entries:", err.message);
  }

  // 10. Format raw material string for LLM user prompt
  const rawSummaryText = formatGatheredText({
    date,
    compileTime,
    logs,
    openApprovals,
    inProgressIssues,
    openPrs,
    doors,
    openProposals,
    agentCostStatuses,
    carriedForwardPlanEntries,
  });

  return {
    date,
    compileTime,
    logs,
    openApprovals,
    inProgressIssues,
    openPrs,
    doors,
    openProposals,
    agentCostStatuses,
    carriedForwardPlanEntries,
    rawSummaryText,
  };
}

export function formatGatheredText(data: Omit<GatheredData, "rawSummaryText">): string {
  const parts: string[] = [];
  parts.push(`OPERATIONAL LOGS & STATUS FOR DATE: ${data.date} (${data.compileTime || "18:00"} IST)`);
  parts.push("=================================================");

  // 1. Logs
  parts.push("\n### 1. AGENT WORK LOGS (`logs/${data.date}/*.md`):");
  if (data.logs.length === 0) {
    parts.push("No agent logs recorded today.");
  } else {
    for (const l of data.logs) {
      parts.push(`\n--- Agent: @${l.agent} ---`);
      parts.push(l.content);
    }
  }

  // 2. Open Approvals
  parts.push("\n### 2. PENDING APPROVALS IN #approvals (No decision line in decisions/):");
  if (data.openApprovals.length === 0) {
    parts.push("None. Zero open approvals.");
  } else {
    for (const a of data.openApprovals) {
      parts.push(`- [${a.agent}] ${a.title} (Age: ${a.ageHours ?? 0}h) · Link: ${a.permalink || "in #approvals"}`);
    }
  }

  // 3. Issues In-Progress
  parts.push("\n### 3. GITHUB ISSUES IN PROGRESS (`status:in-progress`):");
  if (data.inProgressIssues.length === 0) {
    parts.push("None in progress.");
  } else {
    for (const i of data.inProgressIssues) {
      parts.push(`- #${i.number} "${i.title}" (Agent: @${i.agent}, Door: ${i.door}, Age: ${i.ageDays}d) · ${i.url}`);
    }
  }

  // 4. PRs Awaiting Review
  parts.push("\n### 4. PULL REQUESTS AWAITING REVIEW:");
  if (data.openPrs.length === 0) {
    parts.push("None open.");
  } else {
    for (const p of data.openPrs) {
      parts.push(`- PR #${p.number} "${p.title}" by @${p.author} (Age: ${p.ageDays}d) · ${p.url}`);
    }
  }

  // 5. Doors Configured
  parts.push("\n### 5. DOORS TRACKED:");
  for (const d of data.doors) {
    parts.push(`- Door: ${d.name} | Metrics: ${d.scorecardLines.join(", ")}`);
  }

  // 6. Open Proposals
  parts.push("\n### 6. OPEN PROPOSALS (`type:proposal`):");
  if (data.openProposals.length === 0) {
    parts.push("None open.");
  } else {
    for (const p of data.openProposals) {
      parts.push(`- #${p.number} "${p.title}" by @${p.agent} · ${p.url}`);
    }
  }

  // 7. Agent Spend & Cost Caps
  parts.push("\n### 7. AGENT SPEND & DAILY COST CAPS:");
  if (data.agentCostStatuses.length === 0) {
    parts.push("All agents within normal limits.");
  } else {
    for (const s of data.agentCostStatuses) {
      const flag = s.isOver80Percent ? " ⚠️ OVER 80% DAILY CAP" : "";
      parts.push(`- @${s.agent}: $${s.currentSpendUsd.toFixed(2)} / $${s.capUsd.toFixed(2)} (${Math.round(s.percentage)}%)${flag}`);
    }
  }

  // 8. Carried Forward Plan Entries
  parts.push("\n### 8. UNFINISHED PLAN ENTRIES CARRIED FORWARD:");
  if (data.carriedForwardPlanEntries.length === 0) {
    parts.push("None carried forward.");
  } else {
    for (const c of data.carriedForwardPlanEntries) {
      parts.push(`- Day ${c.day} (@${c.agent}): "${c.title}"`);
    }
  }

  return parts.join("\n");
}

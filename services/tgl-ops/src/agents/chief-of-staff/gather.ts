import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { octokit } from "../../lib/github-client.js";
import { slackClient } from "../../lib/slack-client.js";
import { loadDoorConfig } from "../../lib/agents.js";
import { getTodayDateString } from "../../lib/standup.js";

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

export interface GatheredData {
  date: string;
  logs: LogEntry[];
  openApprovals: OpenApproval[];
  inProgressIssues: InProgressIssue[];
  openPrs: OpenPR[];
  doors: { name: string; scorecardLines: string[] }[];
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
export async function gatherStandupMaterial(dateStr?: string): Promise<GatheredData> {
  const date = dateStr || getTodayDateString();

  // 1. Gather logs/<date>/*.md
  const logs: LogEntry[] = [];
  const localLogsDir = path.join(config.repoRoot, "logs", date);

  if (fs.existsSync(localLogsDir)) {
    try {
      const files = fs.readdirSync(localLogsDir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
      for (const file of files) {
        const agent = file.replace(/\.md$/, "");
        const content = fs.readFileSync(path.join(localLogsDir, file), "utf8");
        logs.push({ agent, content: content.trim() });
      }
    } catch (err) {
      console.warn(`[Gather] Error reading local logs from ${localLogsDir}:`, err);
    }
  }

  // Also query GitHub Contents API if remote has additional or fresh logs
  if (config.githubToken && logs.length === 0) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `logs/${date}`,
        ref: "main",
      });

      if (Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.type === "file" && item.name.endsWith(".md")) {
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
        console.warn(`[Gather] GitHub error fetching logs for ${date}:`, err.message);
      }
    }
  }

  // 2. Gather confirmed decisions to determine open approvals
  let confirmedDecisionsText = "";
  const localDecisionsPath = path.join(config.repoRoot, "decisions", `${date}.md`);
  if (fs.existsSync(localDecisionsPath)) {
    confirmedDecisionsText = fs.readFileSync(localDecisionsPath, "utf8");
  } else if (config.githubToken) {
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
        // Detect approval card by presence of actions or specific format
        const hasActions = (msg.blocks || []).some(
          (b: any) => b.block_id === "card_actions" || b.type === "actions"
        );
        const text = msg.text || "";

        if (hasActions || text.includes("review") || text.includes("approval") || text.includes("Approve")) {
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

          // Check if this card was decided in decisions/<date>.md
          const isDecided =
            confirmedDecisionsText.includes(msg.ts || "") ||
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

  // 7. Format raw material string for LLM user prompt
  const rawSummaryText = formatGatheredText({
    date,
    logs,
    openApprovals,
    inProgressIssues,
    openPrs,
    doors,
  });

  return {
    date,
    logs,
    openApprovals,
    inProgressIssues,
    openPrs,
    doors,
    rawSummaryText,
  };
}

function formatGatheredText(data: Omit<GatheredData, "rawSummaryText">): string {
  const parts: string[] = [];
  parts.push(`OPERATIONAL LOGS & STATUS FOR DATE: ${data.date}`);
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

  return parts.join("\n");
}

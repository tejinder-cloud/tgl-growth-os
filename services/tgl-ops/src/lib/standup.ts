import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { loadAgents } from "./agents.js";
import { postLine } from "./post.js";

export function getTodayDateString(tz = config.timezone): string {
  // Returns YYYY-MM-DD formatted date in the target timezone
  const d = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

export function getCurrentTimeIST(): string {
  const d = new Date();
  return d.toLocaleTimeString("en-IN", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export interface AgentLogSummary {
  agent: string;
  did: string[];
  blocked: string[];
  needs: string[];
  tomorrow: string[];
  rawText: string;
}

export interface StandupDigest {
  date: string;
  loggedAgents: AgentLogSummary[];
  silentAgents: string[];
  blockers: { agent: string; issue: string }[];
  pendingApprovals: { agent: string; need: string }[];
}

export function compileStandupDigest(targetDate?: string): StandupDigest {
  const dateStr = targetDate || getTodayDateString();
  const logsDir = path.join(config.repoRoot, "logs", dateStr);
  const allAgents = loadAgents();

  const loggedAgents: AgentLogSummary[] = [];
  const blockers: { agent: string; issue: string }[] = [];
  const pendingApprovals: { agent: string; need: string }[] = [];

  const foundAgentNames = new Set<string>();

  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
    for (const file of files) {
      const agentName = file.replace(/\.md$/, "");
      foundAgentNames.add(agentName.toLowerCase());

      const content = fs.readFileSync(path.join(logsDir, file), "utf8");
      const summary = parseAgentLog(agentName, content);
      loggedAgents.push(summary);

      for (const b of summary.blocked) {
        if (b && !b.toLowerCase().includes("none")) {
          blockers.push({ agent: agentName, issue: b });
        }
      }

      for (const n of summary.needs) {
        if (n && !n.toLowerCase().includes("none")) {
          pendingApprovals.push({ agent: agentName, need: n });
        }
      }
    }
  }

  const silentAgents = allAgents
    .map((a) => a.name)
    .filter((name) => !foundAgentNames.has(name.toLowerCase()));

  return {
    date: dateStr,
    loggedAgents,
    silentAgents,
    blockers,
    pendingApprovals,
  };
}

function parseAgentLog(agent: string, content: string): AgentLogSummary {
  const lines = content.split("\n");
  const did: string[] = [];
  const blocked: string[] = [];
  const needs: string[] = [];
  const tomorrow: string[] = [];

  let currentSection: "did" | "blocked" | "needs" | "tomorrow" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\*?\*?did:\*?\*?/i.test(trimmed)) {
      currentSection = "did";
      const val = trimmed.replace(/^\*?\*?did:\*?\*?\s*/i, "");
      if (val) did.push(val);
      continue;
    }
    if (/^\*?\*?blocked:\*?\*?/i.test(trimmed)) {
      currentSection = "blocked";
      const val = trimmed.replace(/^\*?\*?blocked:\*?\*?\s*/i, "");
      if (val) blocked.push(val);
      continue;
    }
    if (/^\*?\*?need(s)?\s*(from\s*the\s*architect)?:\*?\*?/i.test(trimmed)) {
      currentSection = "needs";
      const val = trimmed.replace(/^\*?\*?need(s)?\s*(from\s*the\s*architect)?:\*?\*?\s*/i, "");
      if (val) needs.push(val);
      continue;
    }
    if (/^\*?\*?tomorrow:\*?\*?/i.test(trimmed)) {
      currentSection = "tomorrow";
      const val = trimmed.replace(/^\*?\*?tomorrow:\*?\*?\s*/i, "");
      if (val) tomorrow.push(val);
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      const clean = trimmed.replace(/^[-•]\s*/, "");
      if (currentSection === "did") did.push(clean);
      else if (currentSection === "blocked") blocked.push(clean);
      else if (currentSection === "needs") needs.push(clean);
      else if (currentSection === "tomorrow") tomorrow.push(clean);
    }
  }

  return {
    agent,
    did,
    blocked,
    needs,
    tomorrow,
    rawText: content,
  };
}

export function formatStandupMessage(digest: StandupDigest): string {
  const parts: string[] = [];

  parts.push(`*📊 The Growth Lab — Daily Standup Digest*\n*Date:* \`${digest.date}\` · *Compiled:* \`18:00 IST\``);
  parts.push("──────────────────────────────────────────");

  // Blockers
  parts.push("*🚨 Blockers:*");
  if (digest.blockers.length === 0) {
    parts.push("• _None reported today._");
  } else {
    for (const b of digest.blockers) {
      parts.push(`• *\`@${b.agent}\`*: ${b.issue}`);
    }
  }

  // Pending Approvals
  parts.push("\n*⏳ Approvals Pending from Architect:*");
  if (digest.pendingApprovals.length === 0) {
    parts.push("• _None pending._");
  } else {
    for (const p of digest.pendingApprovals) {
      parts.push(`• *\`@${p.agent}\`*: ${p.need}`);
    }
  }

  // Agent Reports
  parts.push("\n*📋 Agent Reports:*");
  if (digest.loggedAgents.length === 0) {
    parts.push("• _No agent log files found for today._");
  } else {
    for (const a of digest.loggedAgents) {
      const didText = a.did.length > 0 ? a.did.join("; ") : "Work in progress";
      const tomorrowText = a.tomorrow.length > 0 ? a.tomorrow.join("; ") : "Continuing priorities";
      parts.push(`• *\`@${a.agent}\`* — *Did:* ${didText} | *Tomorrow:* ${tomorrowText}`);
    }
  }

  parts.push("\n_Active agents: reply in-thread with your 4 lines: Did · Blocked · Need · Tomorrow._");

  return parts.join("\n");
}

export async function broadcast1800Standup(): Promise<void> {
  console.log("[Standup Scheduler] Compiling and broadcasting 18:00 IST standup...");
  const digest = compileStandupDigest();
  const text = formatStandupMessage(digest);
  await postLine({
    channel: config.standupChannelId,
    text,
  });
}

export async function broadcast1815SilenceFlag(): Promise<void> {
  console.log("[Standup Scheduler] Checking for silent agents at 18:15 IST...");
  const digest = compileStandupDigest();
  if (digest.silentAgents.length > 0) {
    const mentions = digest.silentAgents.map((a) => `\`@${a}\``).join(", ");
    const text = `*⚠️ Silence Flag — 18:15 IST (Chief of Staff)*\nNo daily standup logs recorded today in \`logs/${digest.date}/\` for: ${mentions}.\nPlease append your four standup lines before close of day.`;
    await postLine({
      channel: config.standupChannelId,
      text,
    });
  } else {
    console.log("[Standup Scheduler] All registered agents reported today. Zero silence flags.");
  }
}

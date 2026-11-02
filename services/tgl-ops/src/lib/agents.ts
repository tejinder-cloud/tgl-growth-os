import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { config } from "../config.js";
import { octokit } from "./github-client.js";

export interface AgentRoutine {
  name: string;
  frequency: "daily" | "weekly" | "monthly" | "continuous" | string;
  schedule: string;
  description: string;
}

export interface AgentRunnerLimits {
  max_tool_calls: number;
  timeout_minutes: number;
}

export interface AgentRecord {
  name: string;
  department: string;
  channel: string;
  trigger: string;
  reviewer: string;
  status?: "active" | "planned" | string;
  autorun?: boolean;
  daily_cost_cap_usd?: number;
  runner_limits?: AgentRunnerLimits;
  routines?: AgentRoutine[];
}

export function getAgentRunnerLimits(agent?: AgentRecord | null): {
  maxToolCalls: number;
  timeoutMinutes: number;
  timeoutMs: number;
} {
  const maxCalls = agent?.runner_limits?.max_tool_calls || 25;
  const timeoutMins = agent?.runner_limits?.timeout_minutes || 15;
  return {
    maxToolCalls: maxCalls,
    timeoutMinutes: timeoutMins,
    timeoutMs: timeoutMins * 60 * 1000,
  };
}

/**
 * Evaluates whether a standard 5-field cron schedule runs on a specific YYYY-MM-DD date.
 * Fields: minute hour day-of-month month day-of-week
 */
export function doesCronRunOnDate(schedule: string, dateStr: string): boolean {
  if (!schedule || typeof schedule !== "string") return false;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [_min, _hour, dom, month, dow] = parts;

  const [y, m, d] = dateStr.split("-").map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;

  const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const targetDow = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const targetDom = d;
  const targetMonth = m;

  function matchesField(field: string, targetVal: number, isDow = false): boolean {
    if (field === "*") return true;
    const subParts = field.split(",");
    for (const sub of subParts) {
      if (sub.includes("-")) {
        const [startStr, endStr] = sub.split("-");
        let start = parseInt(startStr, 10);
        let end = parseInt(endStr, 10);
        if (isDow) {
          if (start === 7) start = 0;
          if (end === 7) end = 0;
          if (start <= end) {
            if (targetVal >= start && targetVal <= end) return true;
          } else {
            if (targetVal >= start || targetVal <= end) return true;
          }
        } else {
          if (targetVal >= start && targetVal <= end) return true;
        }
      } else {
        let val = parseInt(sub, 10);
        if (isDow && val === 7) val = 0;
        if (val === targetVal) return true;
      }
    }
    return false;
  }

  const matchMonth = matchesField(month, targetMonth);
  if (!matchMonth) return false;

  const matchDom = dom === "*" ? true : matchesField(dom, targetDom);
  const matchDow = dow === "*" ? true : matchesField(dow, targetDow, true);

  if (dom === "*" && dow === "*") return true;
  if (dom !== "*" && dow === "*") return matchDom;
  if (dom === "*" && dow !== "*") return matchDow;
  return matchDom || matchDow;
}

/**
 * Checks if an agent has at least one routine scheduled to run on dateStr.
 */
export function isAgentScheduledOnDate(agent: AgentRecord, dateStr: string): boolean {
  if (!agent.routines || agent.routines.length === 0) {
    return false;
  }
  return agent.routines.some((routine) => doesCronRunOnDate(routine.schedule, dateStr));
}

export interface DoorRecord {
  name: string;
  icp: string;
  audit_spec: string;
  sla_hours: number;
  ghl_pipeline: string;
  content_pillar: string;
  scorecard_lines: string[];
}

// 5-minute in-memory cache TTL
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let agentsCache: CacheEntry<AgentRecord[]> | null = null;
const doorsCache = new Map<string, CacheEntry<DoorRecord>>();

/**
 * Loads agents from GitHub Contents API (main branch) with a 5-minute cache
 * and local file fallback for development only.
 */
export async function loadAgents(): Promise<AgentRecord[]> {
  const now = Date.now();
  if (agentsCache && now - agentsCache.timestamp < CACHE_TTL_MS) {
    return agentsCache.data;
  }

  // 1. Local-file fallback for development
  const localCandidates = [
    path.join(config.repoRoot, "config/agents.yaml"),
    path.join(process.cwd(), "config/agents.yaml"),
    path.join(process.cwd(), "../../config/agents.yaml"),
  ];

  for (const localPath of localCandidates) {
    if (fs.existsSync(localPath)) {
      try {
        const raw = fs.readFileSync(localPath, "utf8");
        const parsed = yaml.parse(raw);
        if (Array.isArray(parsed)) {
          const agents = parsed.filter((a): a is AgentRecord => typeof a === "object" && a !== null && !!a.name);
          agentsCache = { data: agents, timestamp: now };
          return agents;
        }
      } catch (err) {
        console.warn(`[Agents] Error parsing local ${localPath}:`, err);
      }
    }
  }

  // 2. Fetch from GitHub Contents API on main branch
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: "config/agents.yaml",
        ref: "main",
      });

      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        const content = Buffer.from(res.data.content, "base64").toString("utf8");
        const parsed = yaml.parse(content);
        if (Array.isArray(parsed)) {
          const agents = parsed.filter((a): a is AgentRecord => typeof a === "object" && a !== null && !!a.name);
          agentsCache = { data: agents, timestamp: now };
          console.log(`[Agents] Loaded ${agents.length} agents from GitHub API (cached 5m).`);
          return agents;
        }
      }
    } catch (err) {
      console.error("[Agents] Error fetching config/agents.yaml from GitHub API:", err);
    }
  }

  if (agentsCache) {
    return agentsCache.data;
  }

  return [];
}

/**
 * Loads a door specification (aeo, ai, truelead) from GitHub Contents API
 * with a 5-minute cache and local file fallback for development only.
 */
export async function loadDoorConfig(door: string): Promise<DoorRecord | null> {
  const cleanDoor = door.toLowerCase().replace(/^doors?-?/, "");
  const now = Date.now();
  const cached = doorsCache.get(cleanDoor);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // 1. Local fallback for development
  const localCandidates = [
    path.join(config.repoRoot, `config/doors/${cleanDoor}.yaml`),
    path.join(process.cwd(), `config/doors/${cleanDoor}.yaml`),
  ];

  for (const localPath of localCandidates) {
    if (fs.existsSync(localPath)) {
      try {
        const raw = fs.readFileSync(localPath, "utf8");
        const parsed = yaml.parse(raw);
        if (parsed && typeof parsed === "object") {
          doorsCache.set(cleanDoor, { data: parsed, timestamp: now });
          return parsed;
        }
      } catch (err) {
        console.warn(`[Doors] Error parsing local ${localPath}:`, err);
      }
    }
  }

  // 2. Fetch from GitHub Contents API on main branch
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `config/doors/${cleanDoor}.yaml`,
        ref: "main",
      });

      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        const content = Buffer.from(res.data.content, "base64").toString("utf8");
        const parsed = yaml.parse(content);
        if (parsed && typeof parsed === "object") {
          doorsCache.set(cleanDoor, { data: parsed, timestamp: now });
          console.log(`[Doors] Loaded door '${cleanDoor}' from GitHub API (cached 5m).`);
          return parsed;
        }
      }
    } catch (err) {
      console.error(`[Doors] Error fetching config/doors/${cleanDoor}.yaml from GitHub:`, err);
    }
  }

  if (cached) {
    return cached.data;
  }

  return null;
}

export async function findAgentByName(name: string): Promise<AgentRecord | undefined> {
  const agents = await loadAgents();
  const normalized = name.toLowerCase().replace(/^@/, "").trim();
  return agents.find((a) => a.name.toLowerCase() === normalized);
}

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { config } from "../config.js";

export interface AgentRecord {
  name: string;
  department: string;
  channel: string;
  trigger: string;
  reviewer: string;
}

export function loadAgents(): AgentRecord[] {
  const agentsPath = path.join(config.repoRoot, "config/agents.yaml");
  if (!fs.existsSync(agentsPath)) {
    console.warn(`[Agents] Config not found at ${agentsPath}`);
    return [];
  }

  try {
    const raw = fs.readFileSync(agentsPath, "utf8");
    const parsed = yaml.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((a): a is AgentRecord => typeof a === "object" && a !== null && !!a.name);
    }
    return [];
  } catch (err) {
    console.error("[Agents] Error parsing config/agents.yaml:", err);
    return [];
  }
}

export function findAgentByName(name: string): AgentRecord | undefined {
  const agents = loadAgents();
  const normalized = name.toLowerCase().replace(/^@/, "").trim();
  return agents.find((a) => a.name.toLowerCase() === normalized);
}

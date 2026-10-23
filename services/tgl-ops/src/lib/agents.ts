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
  const candidatePaths = [
    path.join(config.repoRoot, "config/agents.yaml"),
    path.join(process.cwd(), "config/agents.yaml"),
    path.join(__dirname, "../config/agents.yaml"),
    path.join(__dirname, "../../config/agents.yaml"),
    path.resolve("/app/config/agents.yaml"),
  ];

  const agentsPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!agentsPath) {
    console.warn(`[Agents] Config not found in candidate paths: ${candidatePaths.join(", ")}`);
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
    console.error(`[Agents] Error parsing ${agentsPath}:`, err);
    return [];
  }
}

export function findAgentByName(name: string): AgentRecord | undefined {
  const agents = loadAgents();
  const normalized = name.toLowerCase().replace(/^@/, "").trim();
  return agents.find((a) => a.name.toLowerCase() === normalized);
}

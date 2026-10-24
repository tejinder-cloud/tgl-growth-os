import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { config } from "../config.js";
import { octokit } from "./github-client.js";

export interface OrgConfig {
  slack_url?: string;
  github_repo?: string;
  railway_project?: string;
  supabase_url?: string;
  architect?: {
    slack_user_id?: string;
    display_name?: string;
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let orgCache: { data: OrgConfig; timestamp: number } | null = null;

/**
 * Loads organization configuration from config/org.yaml via GitHub Contents API
 * with a 5-minute cache and local filesystem fallback.
 */
export async function loadOrgConfig(): Promise<OrgConfig> {
  const now = Date.now();
  if (orgCache && now - orgCache.timestamp < CACHE_TTL_MS) {
    return orgCache.data;
  }

  // 1. Local-file fallback for development
  const localCandidates = [
    path.join(config.repoRoot, "config/org.yaml"),
    path.join(process.cwd(), "config/org.yaml"),
    path.join(process.cwd(), "../../config/org.yaml"),
  ];

  for (const localPath of localCandidates) {
    if (fs.existsSync(localPath)) {
      try {
        const raw = fs.readFileSync(localPath, "utf8");
        const parsed = yaml.parse(raw);
        if (parsed && typeof parsed === "object") {
          orgCache = { data: parsed, timestamp: now };
          return parsed;
        }
      } catch (err) {
        console.warn(`[Org Config] Failed to read local config from ${localPath}:`, err);
      }
    }
  }

  // 2. Fetch from GitHub Contents API
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: "config/org.yaml",
        ref: "main",
      });

      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        const raw = Buffer.from(res.data.content, "base64").toString("utf8");
        const parsed = yaml.parse(raw);
        if (parsed && typeof parsed === "object") {
          orgCache = { data: parsed, timestamp: now };
          return parsed;
        }
      }
    } catch (err: any) {
      console.warn("[Org Config] Failed to fetch config/org.yaml from GitHub Contents API:", err.message);
    }
  }

  return {
    architect: {
      display_name: "Tejinder Singh",
    },
  };
}

export async function getArchitectConfig(): Promise<{ slack_user_id?: string; display_name: string }> {
  const org = await loadOrgConfig();
  return {
    slack_user_id: org.architect?.slack_user_id || undefined,
    display_name: org.architect?.display_name || "Tejinder Singh",
  };
}

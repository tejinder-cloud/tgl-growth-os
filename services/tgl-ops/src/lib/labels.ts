import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { config } from "../config.js";
import { octokit } from "./github-client.js";

export interface LabelDefinition {
  name: string;
  color: string;
  description?: string;
}

export interface SyncLabelsResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Loads label definitions from .github/labels.yml via GitHub Contents API
 * or local file fallback. Automatically appends door:core if missing.
 */
export async function loadLabelsConfig(): Promise<LabelDefinition[]> {
  let rawContent: string | null = null;

  // 1. Try local file fallback (development)
  const localCandidates = [
    path.join(config.repoRoot, ".github/labels.yml"),
    path.join(process.cwd(), ".github/labels.yml"),
    path.join(process.cwd(), "../../.github/labels.yml"),
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        rawContent = fs.readFileSync(candidate, "utf8");
        break;
      } catch (err) {
        console.warn(`[Labels] Failed to read local labels file at ${candidate}:`, err);
      }
    }
  }

  // 2. Fetch from GitHub Contents API if not read locally
  if (!rawContent && config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: ".github/labels.yml",
        ref: "main",
      });

      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        rawContent = Buffer.from(res.data.content, "base64").toString("utf8");
      }
    } catch (err: any) {
      console.warn("[Labels] Could not fetch .github/labels.yml from GitHub:", err.message);
    }
  }

  const labels: LabelDefinition[] = [];

  if (rawContent) {
    try {
      const parsed = yaml.parse(rawContent);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && typeof item.name === "string") {
            const cleanColor = String(item.color || "8A827B").replace(/^#/, "").trim();
            labels.push({
              name: item.name.trim(),
              color: cleanColor,
              description: item.description ? String(item.description).trim() : undefined,
            });
          }
        }
      }
    } catch (err) {
      console.error("[Labels] Failed to parse .github/labels.yml YAML:", err);
    }
  }

  // Ensure door:core is present if missing
  const hasDoorCore = labels.some((l) => l.name === "door:core");
  if (!hasDoorCore) {
    labels.push({
      name: "door:core",
      color: "8A827B",
      description: "Cross-door foundations, branding, infrastructure, and core operating system",
    });
  }

  return labels;
}

/**
 * Synchronises all labels from .github/labels.yml to the GitHub repository.
 * Creates missing labels and updates existing ones if color or description differ.
 */
export async function syncLabels(): Promise<SyncLabelsResult> {
  const labels = await loadLabelsConfig();
  const result: SyncLabelsResult = {
    total: labels.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  if (!config.githubToken) {
    console.warn("[Labels Sync] GITHUB_TOKEN not set; dry-run simulated for", labels.length, "labels");
    result.unchanged = labels.length;
    return result;
  }

  console.log(`[Labels Sync] Starting sync of ${labels.length} labels against ${config.githubOwner}/${config.githubRepo}...`);

  for (const label of labels) {
    try {
      let existing: { color: string; description?: string | null } | null = null;
      try {
        const getRes = await octokit.issues.getLabel({
          owner: config.githubOwner,
          repo: config.githubRepo,
          name: label.name,
        });
        existing = {
          color: getRes.data.color,
          description: getRes.data.description,
        };
      } catch (err: any) {
        if (err.status !== 404) {
          throw err;
        }
      }

      if (!existing) {
        // Label does not exist -> Create
        await octokit.issues.createLabel({
          owner: config.githubOwner,
          repo: config.githubRepo,
          name: label.name,
          color: label.color,
          description: label.description,
        });
        result.created++;
        console.log(`  + Created label: "${label.name}" (#${label.color})`);
      } else {
        // Label exists -> check if color or description changed
        const colorChanged = existing.color.toLowerCase() !== label.color.toLowerCase();
        const descChanged = (existing.description || "") !== (label.description || "");

        if (colorChanged || descChanged) {
          await octokit.issues.updateLabel({
            owner: config.githubOwner,
            repo: config.githubRepo,
            name: label.name,
            new_name: label.name,
            color: label.color,
            description: label.description,
          });
          result.updated++;
          console.log(`  ~ Updated label: "${label.name}"`);
        } else {
          result.unchanged++;
        }
      }
    } catch (err: any) {
      const errMsg = `Failed to sync label "${label.name}": ${err.message}`;
      console.error(`[Labels Sync Error] ${errMsg}`);
      result.errors.push(errMsg);
    }
  }

  console.log(`[Labels Sync Complete] Total: ${result.total} | Created: ${result.created} | Updated: ${result.updated} | Unchanged: ${result.unchanged} | Errors: ${result.errors.length}`);
  return result;
}

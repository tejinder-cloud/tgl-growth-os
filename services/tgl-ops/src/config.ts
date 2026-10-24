import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

dotenv.config();

// Determine repo root (assumes services/tgl-ops is two directories down from repo root)
export const REPO_ROOT = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(__dirname, "../../..");

export interface AppConfig {
  port: number;
  slackBotToken: string;
  slackSigningSecret: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  approvalsChannelId: string;
  standupChannelId: string;
  alertsChannelId: string;
  opsChannelId: string;
  githubWebhookSecret: string;
  timezone: string;
  repoRoot: string;
}

const githubRepoFull = process.env.GITHUB_REPO || "https://github.com/tejinder-cloud/tgl-growth-os";
// Extract owner and repo from URL or "owner/repo" string
let githubOwner = "tejinder-cloud";
let githubRepo = "tgl-growth-os";

try {
  const cleanRepo = githubRepoFull.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const parts = cleanRepo.split("/");
  if (parts.length >= 2) {
    githubOwner = parts[0];
    githubRepo = parts[1];
  }
} catch {
  // fallback to defaults
}

export const config: AppConfig = {
  port: Number(process.env.PORT) || 3000,
  slackBotToken: (process.env.SLACK_BOT_TOKEN || "").trim(),
  slackSigningSecret: (process.env.SLACK_SIGNING_SECRET || "").trim().replace(/^["']|["']$/g, ""),
  githubToken: (process.env.GITHUB_TOKEN || "").trim(),
  githubOwner: (process.env.GITHUB_OWNER || githubOwner).trim(),
  githubRepo: (process.env.GITHUB_REPO_NAME || githubRepo).trim(),
  githubWebhookSecret: (process.env.GITHUB_WEBHOOK_SECRET || "").trim(),
  approvalsChannelId: (process.env.APPROVALS_CHANNEL_ID || "#approvals").trim(),
  standupChannelId: (process.env.STANDUP_CHANNEL_ID || "#standup").trim(),
  alertsChannelId: (process.env.ALERTS_CHANNEL_ID || "#alerts").trim(),
  opsChannelId: (process.env.OPS_CHANNEL_ID || "#ops").trim(),
  timezone: (process.env.TIMEZONE || "Asia/Kolkata").trim(),
  repoRoot: REPO_ROOT,
};

export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.slackSigningSecret) missing.push("SLACK_SIGNING_SECRET");
  if (!config.slackBotToken) missing.push("SLACK_BOT_TOKEN");
  if (!config.githubToken) missing.push("GITHUB_TOKEN");

  if (missing.length > 0) {
    console.warn(`[TGL Ops WARNING] Missing environment variables: ${missing.join(", ")}`);
    console.warn("[TGL Ops WARNING] Some GitHub / Slack webhook operations will run in mock/dry-run mode.");
  }
}

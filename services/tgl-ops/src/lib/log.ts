import fs from "node:fs";
import path from "node:path";
import { appendFileInRepo, type AppendFileResult } from "./github-client.js";
import { getTodayDateString, getCurrentTimeIST } from "./standup.js";
import { config, isTestMode } from "../config.js";

export interface AppendLogOptions {
  agent: string;
  text: string;
  date?: string;
  time?: string;
}

/**
 * Appends a log line to logs/<YYYY-MM-DD>/<agent>.md via the GitHub Contents API.
 * In test mode (TGL_TEST_MODE=1), writes strictly to logs/.test/ and never touches main.
 * The standup cron directly reads these logs at 17:50 IST to assemble the daily digest.
 */
export async function appendLog(options: AppendLogOptions): Promise<AppendFileResult> {
  const { agent, text, date, time } = options;
  const dateStr = date || getTodayDateString();
  const timeStr = time || getCurrentTimeIST();
  const lineToAppend = `- ${timeStr} IST — ${text}`;

  if (isTestMode()) {
    const testLogsDir = path.join(config.repoRoot, "logs/.test", dateStr);
    fs.mkdirSync(testLogsDir, { recursive: true });
    const localFullPath = path.join(testLogsDir, `${agent}.md`);
    fs.appendFileSync(localFullPath, `${lineToAppend}\n`, "utf8");
    return { success: true, status: 200 };
  }

  const filePath = `logs/${dateStr}/${agent}.md`;
  const commitMessage = `chore(log): record ${agent} progress for ${dateStr}`;

  return appendFileInRepo(filePath, lineToAppend, commitMessage);
}

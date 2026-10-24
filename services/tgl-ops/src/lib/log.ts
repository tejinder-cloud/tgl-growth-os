import { appendFileInRepo, type AppendFileResult } from "./github-client.js";
import { getTodayDateString, getCurrentTimeIST } from "./standup.js";

export interface AppendLogOptions {
  agent: string;
  text: string;
  date?: string;
  time?: string;
}

/**
 * Appends a log line to logs/<YYYY-MM-DD>/<agent>.md via the GitHub Contents API.
 * The standup cron directly reads these logs at 17:50 IST to assemble the daily digest.
 */
export async function appendLog(options: AppendLogOptions): Promise<AppendFileResult> {
  const { agent, text, date, time } = options;
  const dateStr = date || getTodayDateString();
  const timeStr = time || getCurrentTimeIST();
  const filePath = `logs/${dateStr}/${agent}.md`;

  const lineToAppend = `- ${timeStr} IST — ${text}`;
  const commitMessage = `chore(log): record ${agent} progress for ${dateStr}`;

  return appendFileInRepo(filePath, lineToAppend, commitMessage);
}

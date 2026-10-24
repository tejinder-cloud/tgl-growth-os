import { Octokit } from "@octokit/rest";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export const octokit = new Octokit({
  auth: config.githubToken || undefined,
});

export interface CreateIssueParams {
  title: string;
  body: string;
  labels?: string[];
}

export async function createIssue(params: CreateIssueParams): Promise<{ number: number; html_url: string }> {
  if (!config.githubToken) {
    console.warn("[GitHub] GITHUB_TOKEN not set; simulating issue creation");
    const fakeNum = Math.floor(100 + Math.random() * 900);
    return {
      number: fakeNum,
      html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/${fakeNum}`,
    };
  }

  const res = await octokit.issues.create({
    owner: config.githubOwner,
    repo: config.githubRepo,
    title: params.title,
    body: params.body,
    labels: params.labels,
  });

  return {
    number: res.data.number,
    html_url: res.data.html_url,
  };
}

export async function addLabelsToIssue(issueNumber: number, labels: string[]): Promise<void> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating adding labels [${labels.join(", ")}] to issue #${issueNumber}`);
    return;
  }

  try {
    await octokit.issues.addLabels({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
      labels,
    });
  } catch (err) {
    console.error(`[GitHub] Failed to add labels to issue #${issueNumber}:`, err);
  }
}

export async function addCommentToIssue(issueNumber: number, body: string): Promise<void> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating comment on issue #${issueNumber}`);
    return;
  }

  try {
    await octokit.issues.createComment({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
      body,
    });
  } catch (err) {
    console.error(`[GitHub] Failed to add comment to issue #${issueNumber}:`, err);
  }
}

/**
 * Appends a line to a file in the repository using the GitHub Contents API.
 * Also synchronises to local filesystem if the local repository exists.
 */
export interface AppendFileResult {
  success: boolean;
  status?: number;
  error?: string;
  sha?: string;
}

export async function appendFileInRepo(
  filePath: string,
  lineToAppend: string,
  commitMessage: string
): Promise<AppendFileResult> {
  const syncLocal = (): void => {
    const localFullPath = path.join(config.repoRoot, filePath);
    try {
      const dir = path.dirname(localFullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const localContent = fs.existsSync(localFullPath) ? fs.readFileSync(localFullPath, "utf8") : "";
      const updatedLocal = localContent.endsWith("\n") || localContent.length === 0
        ? `${localContent}${lineToAppend}\n`
        : `${localContent}\n${lineToAppend}\n`;
      fs.writeFileSync(localFullPath, updatedLocal, "utf8");
      console.log(`[File Sync] Appended line to local file: ${filePath}`);
    } catch (err) {
      console.warn(`[File Sync] Could not write to local filesystem for ${filePath}:`, err);
    }
  };

  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; skipped remote commit for ${filePath}`);
    // If run locally in dry-run without token, sync locally and indicate dry-run status
    syncLocal();
    return { success: true, status: 200, error: "Simulated local write (GITHUB_TOKEN not set)" };
  }

  try {
    let sha: string | undefined;
    let existingContent = "";

    try {
      const getRes = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: filePath,
      });

      if (!Array.isArray(getRes.data) && getRes.data.type === "file") {
        sha = getRes.data.sha;
        existingContent = Buffer.from(getRes.data.content, "base64").toString("utf8");
      }
    } catch (err: any) {
      if (err.status !== 404) {
        throw err;
      }
      // File doesn't exist yet on remote; will create
    }

    const newContent = existingContent.endsWith("\n") || existingContent.length === 0
      ? `${existingContent}${lineToAppend}\n`
      : `${existingContent}\n${lineToAppend}\n`;

    const putRes = await octokit.repos.createOrUpdateFileContents({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: filePath,
      message: commitMessage,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      sha,
    });

    const isSuccess = putRes.status === 200 || putRes.status === 201;
    if (isSuccess) {
      syncLocal();
    }

    return {
      success: isSuccess,
      status: putRes.status,
      sha: putRes.data.content?.sha,
    };
  } catch (err: any) {
    console.error(`[GitHub Contents API] Error writing to ${filePath}:`, err);
    const status = err.status || 500;
    const message = err.response?.data?.message || err.message || "Unknown error";
    return {
      success: false,
      status,
      error: message.replace(/\n+/g, " ").trim(),
    };
  }
}

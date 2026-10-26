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
    return { success: false, status: 401, error: "GITHUB_TOKEN not set; remote write skipped" };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let sha: string | undefined;
      let existingContent = "";

      try {
        const getRes = await octokit.repos.getContent({
          owner: config.githubOwner,
          repo: config.githubRepo,
          path: filePath,
          ref: "main",
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
        branch: "main",
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
      const status = err.status || 500;
      if (status === 409 && attempt < maxAttempts) {
        console.warn(`[GitHub Contents API] 409 Conflict on ${filePath} (attempt ${attempt}/${maxAttempts}); retrying in ${attempt * 500}ms...`);
        await new Promise((r) => setTimeout(r, attempt * 500));
        continue;
      }
      console.error(`[GitHub Contents API] Error writing to ${filePath}:`, err);
      const message = err.response?.data?.message || err.message || "Unknown error";
      return {
        success: false,
        status,
        error: message.replace(/\n+/g, " ").trim(),
      };
    }
  }

  return { success: false, status: 409, error: "Exceeded max conflict retries" };
}

/**
 * Creates or overwrites an entire file on the main branch via the GitHub Contents API.
 */
export async function putFileInRepo(
  filePath: string,
  content: string,
  commitMessage: string
): Promise<AppendFileResult> {
  const syncLocal = (): void => {
    const localFullPath = path.join(config.repoRoot, filePath);
    try {
      const dir = path.dirname(localFullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(localFullPath, content, "utf8");
    } catch {}
  };

  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; skipped remote commit for ${filePath}`);
    return { success: false, status: 401, error: "GITHUB_TOKEN not set; remote write skipped" };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let sha: string | undefined;

      try {
        const getRes = await octokit.repos.getContent({
          owner: config.githubOwner,
          repo: config.githubRepo,
          path: filePath,
          ref: "main",
        });

        if (!Array.isArray(getRes.data) && getRes.data.type === "file") {
          sha = getRes.data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) {
          throw err;
        }
      }

      const putRes = await octokit.repos.createOrUpdateFileContents({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: "main",
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
      const status = err.status || 500;
      if (status === 409 && attempt < maxAttempts) {
        console.warn(`[GitHub Contents API] 409 Conflict on ${filePath} (attempt ${attempt}/${maxAttempts}); retrying...`);
        await new Promise((r) => setTimeout(r, attempt * 500));
        continue;
      }
      return {
        success: false,
        status,
        error: (err.response?.data?.message || err.message || "Unknown error").replace(/\n+/g, " ").trim(),
      };
    }
  }

  return { success: false, status: 409, error: "Exceeded max conflict retries" };
}

/**
 * Reads a file's content directly from the main branch via the GitHub Contents API.
 */
export async function readFileFromRepo(filePath: string): Promise<string | null> {
  if (!config.githubToken) {
    const localFullPath = path.join(config.repoRoot, filePath);
    if (fs.existsSync(localFullPath)) {
      try {
        return fs.readFileSync(localFullPath, "utf8");
      } catch {}
    }
    return null;
  }

  try {
    const res = await octokit.repos.getContent({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: filePath,
      ref: "main",
    });

    if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
      return Buffer.from(res.data.content, "base64").toString("utf8");
    }
  } catch (err: any) {
    if (err.status !== 404) {
      console.warn(`[GitHub Contents API] Error reading ${filePath}:`, err.message);
    }
  }
  return null;
}

/**
 * Creates a git branch referencing the base branch (default: main).
 * If the branch already exists, returns success with existing SHA.
 */
export async function createBranch(
  branchName: string,
  baseBranch = "main"
): Promise<{ success: boolean; sha?: string; error?: string }> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating branch creation: ${branchName}`);
    return { success: true, sha: "simulated-sha-" + Date.now() };
  }

  try {
    // 1. Get base branch SHA
    const baseRef = await octokit.git.getRef({
      owner: config.githubOwner,
      repo: config.githubRepo,
      ref: `heads/${baseBranch}`,
    });
    const baseSha = baseRef.data.object.sha;

    // 2. Check if target branch already exists
    try {
      const existingRef = await octokit.git.getRef({
        owner: config.githubOwner,
        repo: config.githubRepo,
        ref: `heads/${branchName}`,
      });
      return { success: true, sha: existingRef.data.object.sha };
    } catch (err: any) {
      if (err.status !== 404) throw err;
    }

    // 3. Create target branch ref
    const created = await octokit.git.createRef({
      owner: config.githubOwner,
      repo: config.githubRepo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    return { success: true, sha: created.data.object.sha };
  } catch (err: any) {
    console.error(`[GitHub Git API] Error creating branch ${branchName}:`, err);
    return {
      success: false,
      error: err.response?.data?.message || err.message || "Failed to create branch",
    };
  }
}

/**
 * Creates or updates a file directly on a specific git branch via the GitHub Contents API.
 */
export async function createOrUpdateFileOnBranch(
  filePath: string,
  content: string,
  commitMessage: string,
  branchName: string
): Promise<AppendFileResult> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating file write to ${filePath} on ${branchName}`);
    return { success: true, status: 200, sha: "simulated-sha-" + Date.now() };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let sha: string | undefined;

      try {
        const getRes = await octokit.repos.getContent({
          owner: config.githubOwner,
          repo: config.githubRepo,
          path: filePath,
          ref: branchName,
        });

        if (!Array.isArray(getRes.data) && getRes.data.type === "file") {
          sha = getRes.data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) {
          throw err;
        }
      }

      const putRes = await octokit.repos.createOrUpdateFileContents({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: branchName,
        sha,
      });

      return {
        success: putRes.status === 200 || putRes.status === 201,
        status: putRes.status,
        sha: putRes.data.content?.sha,
      };
    } catch (err: any) {
      const status = err.status || 500;
      if (status === 409 && attempt < maxAttempts) {
        console.warn(`[GitHub Contents API] 409 Conflict on ${filePath} on branch ${branchName} (attempt ${attempt}/${maxAttempts}); retrying...`);
        await new Promise((r) => setTimeout(r, attempt * 500));
        continue;
      }
      return {
        success: false,
        status,
        error: (err.response?.data?.message || err.message || "Unknown error").replace(/\n+/g, " ").trim(),
      };
    }
  }

  return { success: false, status: 409, error: "Exceeded max conflict retries" };
}

export interface CreatePullRequestParams {
  title: string;
  body: string;
  head: string;
  base?: string;
  labels?: string[];
}

/**
 * Opens a Pull Request in the repository and applies labels.
 */
export async function createPullRequest(
  params: CreatePullRequestParams
): Promise<{ number: number; html_url: string }> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating PR creation for ${params.title}`);
    const fakePrNum = Math.floor(200 + Math.random() * 800);
    return {
      number: fakePrNum,
      html_url: `https://github.com/${config.githubOwner}/${config.githubRepo}/pull/${fakePrNum}`,
    };
  }

  const res = await octokit.pulls.create({
    owner: config.githubOwner,
    repo: config.githubRepo,
    title: params.title,
    head: params.head,
    base: params.base || "main",
    body: params.body,
  });

  const prNumber = res.data.number;
  const html_url = res.data.html_url;

  if (params.labels && params.labels.length > 0) {
    try {
      await octokit.issues.addLabels({
        owner: config.githubOwner,
        repo: config.githubRepo,
        issue_number: prNumber,
        labels: params.labels,
      });
    } catch (err) {
      console.warn(`[GitHub API] Warning: Failed to label PR #${prNumber}:`, err);
    }
  }

  return { number: prNumber, html_url };
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  body: string;
  labels: string[];
  html_url: string;
  created_at: string;
  updated_at: string;
}

/**
 * Lists open issues with given labels (filters out pull requests).
 */
export async function findOpenIssuesWithLabels(labels: string[]): Promise<GitHubIssueSummary[]> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating finding open issues for [${labels.join(", ")}]`);
    return [];
  }

  try {
    const res = await octokit.issues.listForRepo({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "open",
      labels: labels.join(","),
      per_page: 50,
    });

    return res.data
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body || "",
        labels: (item.labels || []).map((l: any) => (typeof l === "string" ? l : l.name || "")),
        html_url: item.html_url,
        created_at: item.created_at,
        updated_at: item.updated_at,
      }));
  } catch (err) {
    console.error("[GitHub API] Error listing open issues with labels:", err);
    return [];
  }
}

/**
 * Searches for any Pull Request linked to an issue (open, merged, or closed).
 */
export async function findLinkedPR(
  issueNumber: number
): Promise<{ number: number; html_url: string; state: string } | null> {
  if (!config.githubToken) {
    return null;
  }

  try {
    const pulls = await octokit.pulls.list({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "all",
      per_page: 50,
    });

    const issueRegex = new RegExp(`(?:fixes|closes|resolves|issue|#)\\s*#?${issueNumber}\\b`, "i");
    const matched = pulls.data.find(
      (pr) =>
        issueRegex.test(pr.body || "") ||
        pr.head.ref.includes(`issue-${issueNumber}`) ||
        pr.title.includes(`#${issueNumber}`)
    );

    if (matched) {
      return {
        number: matched.number,
        html_url: matched.html_url,
        state: matched.state,
      };
    }
  } catch (err) {
    console.error(`[GitHub API] Error checking linked PR for #${issueNumber}:`, err);
  }
  return null;
}

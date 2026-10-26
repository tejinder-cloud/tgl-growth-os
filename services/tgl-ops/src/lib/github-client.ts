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

export interface GitHubIssueDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  html_url: string;
}

export const mockIssuesStore = new Map<number, GitHubIssueDetails>();

export async function getIssue(issueNumber: number): Promise<GitHubIssueDetails | null> {
  if (mockIssuesStore.has(issueNumber)) {
    return mockIssuesStore.get(issueNumber)!;
  }

  if (!config.githubToken) {
    return null;
  }

  try {
    const res = await octokit.issues.get({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
    });
    const labels = (res.data.labels || []).map((l: any) =>
      typeof l === "string" ? l : l.name || ""
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body || "",
      state: res.data.state,
      labels,
      html_url: res.data.html_url,
    };
  } catch (err: any) {
    console.warn(`[GitHub API] Failed to fetch issue #${issueNumber}:`, err.message);
    return null;
  }
}

export async function updateIssueBody(issueNumber: number, body: string): Promise<boolean> {
  if (mockIssuesStore.has(issueNumber)) {
    mockIssuesStore.get(issueNumber)!.body = body;
    return true;
  }

  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating body update on issue #${issueNumber}`);
    return true;
  }

  try {
    await octokit.issues.update({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
      body,
    });
    return true;
  } catch (err: any) {
    console.warn(`[GitHub API] Failed to update body of issue #${issueNumber}:`, err.message);
    return false;
  }
}

export async function addLabelsToIssue(issueNumber: number, labels: string[]): Promise<void> {
  if (mockIssuesStore.has(issueNumber)) {
    const item = mockIssuesStore.get(issueNumber)!;
    for (const l of labels) {
      if (!item.labels.includes(l)) item.labels.push(l);
    }
  }

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
 * Searches for an open Pull Request linked to an issue.
 * Per Architect rule: an issue counts as "has a PR" only if an OPEN PR references it;
 * a closed or merged PR never blocks an issue that is still open.
 */
export async function findLinkedPR(
  issueNumber: number,
  options?: { state?: "open" | "all" }
): Promise<{ number: number; html_url: string; state: string } | null> {
  if (!config.githubToken) {
    return null;
  }

  const queryState = options?.state || "open";

  try {
    const pulls = await octokit.pulls.list({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: queryState,
      per_page: 50,
    });

    const issueRegex = new RegExp(`(?:fixes|closes|resolves)\\s*#?${issueNumber}\\b`, "i");
    const matched = pulls.data.find(
      (pr) =>
        (queryState === "all" || pr.state === "open") && (
          issueRegex.test(pr.body || "") ||
          pr.head.ref.includes(`issue-${issueNumber}`) ||
          pr.head.ref.includes(`/${issueNumber}-`) ||
          new RegExp(`(?:fixes|closes|resolves|#)\\s*${issueNumber}\\b`, "i").test(pr.title)
        )
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

/**
 * Deletes a git branch via GitHub Git API.
 */
export async function deleteBranch(
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating branch deletion: ${branchName}`);
    return { success: true };
  }

  try {
    await octokit.git.deleteRef({
      owner: config.githubOwner,
      repo: config.githubRepo,
      ref: `heads/${branchName}`,
    });
    return { success: true };
  } catch (err: any) {
    if (err.status === 404 || err.status === 422) {
      // Branch already deleted or not found
      return { success: true };
    }
    console.error(`[GitHub API] Error deleting branch ${branchName}:`, err);
    return {
      success: false,
      error: err.response?.data?.message || err.message || "Failed to delete branch",
    };
  }
}

/**
 * Reads file content from a specific git branch.
 */
export async function readFileFromBranch(
  filePath: string,
  branchName: string
): Promise<string | null> {
  const readLocal = (): string | null => {
    const localFullPath = path.join(config.repoRoot, filePath);
    if (fs.existsSync(localFullPath)) {
      try {
        return fs.readFileSync(localFullPath, "utf8");
      } catch {}
    }
    return null;
  };

  if (!config.githubToken || branchName.startsWith("__test__")) {
    return readLocal();
  }

  try {
    const res = await octokit.repos.getContent({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: filePath,
      ref: branchName,
    });

    if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
      return Buffer.from(res.data.content, "base64").toString("utf8");
    }
  } catch (err: any) {
    if (err.status !== 404) {
      console.warn(`[GitHub API] Error reading ${filePath} from branch ${branchName}:`, err.message);
    }
    return readLocal();
  }
  return null;
}

/**
 * Lists items in a directory on a specific git branch.
 */
export async function listDirectoryOnBranch(
  dirPath: string,
  branchName: string
): Promise<string[]> {
  const listLocal = (): string[] => {
    const localFullPath = path.join(config.repoRoot, dirPath);
    if (fs.existsSync(localFullPath) && fs.statSync(localFullPath).isDirectory()) {
      try {
        return fs.readdirSync(localFullPath).map((f) => {
          const itemPath = path.join(localFullPath, f);
          const isDir = fs.statSync(itemPath).isDirectory();
          return `${isDir ? "[DIR]" : "[FILE]"} ${path.join(dirPath, f)}`;
        });
      } catch {}
    }
    return [];
  };

  if (!config.githubToken || branchName.startsWith("__test__")) {
    return listLocal();
  }

  try {
    const res = await octokit.repos.getContent({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: dirPath,
      ref: branchName,
    });

    if (Array.isArray(res.data)) {
      return res.data.map((item) => `${item.type === "dir" ? "[DIR]" : "[FILE]"} ${item.path}`);
    }
  } catch (err: any) {
    return listLocal();
  }
  return [];
}

/**
 * Fetches a Pull Request by number.
 */
export async function getPR(
  prNumber: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!config.githubToken) {
    return { success: false, error: "GITHUB_TOKEN not set" };
  }
  try {
    const res = await octokit.pulls.get({
      owner: config.githubOwner,
      repo: config.githubRepo,
      pull_number: prNumber,
    });
    return { success: true, data: res.data };
  } catch (err: any) {
    return {
      success: false,
      error: (err.response?.data?.message || err.message || "Failed to fetch PR").replace(/\n+/g, " ").trim(),
    };
  }
}

/**
 * Squash-merges a Pull Request using admin token.
 */
export async function squashMergePR(
  prNumber: number,
  commitTitle?: string,
  commitMessage?: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating squash-merge for PR #${prNumber}`);
    return { success: true, sha: "simulated-merge-sha-" + Date.now() };
  }

  try {
    const res = await octokit.pulls.merge({
      owner: config.githubOwner,
      repo: config.githubRepo,
      pull_number: prNumber,
      merge_method: "squash",
      commit_title: commitTitle,
      commit_message: commitMessage,
    });

    return {
      success: res.data.merged,
      sha: res.data.sha,
      error: res.data.merged ? undefined : (res.data.message || "Pull request was not merged"),
    };
  } catch (err: any) {
    console.error(`[GitHub API] Error squash-merging PR #${prNumber}:`, err);
    return {
      success: false,
      error: (err.response?.data?.message || err.message || "Failed to squash-merge PR").replace(/\n+/g, " ").trim(),
    };
  }
}

/**
 * Closes a Pull Request without merging.
 */
export async function closePR(
  prNumber: number
): Promise<{ success: boolean; error?: string }> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating PR #${prNumber} closure`);
    return { success: true };
  }

  try {
    await octokit.pulls.update({
      owner: config.githubOwner,
      repo: config.githubRepo,
      pull_number: prNumber,
      state: "closed",
    });
    return { success: true };
  } catch (err: any) {
    console.error(`[GitHub API] Error closing PR #${prNumber}:`, err);
    return {
      success: false,
      error: err.response?.data?.message || err.message || "Failed to close PR",
    };
  }
}

/**
 * Closes a GitHub issue with an optional closing comment.
 */
export async function closeIssue(
  issueNumber: number,
  comment?: string
): Promise<{ success: boolean; error?: string }> {
  if (!config.githubToken) {
    console.warn(`[GitHub] GITHUB_TOKEN not set; simulating issue #${issueNumber} closure`);
    return { success: true };
  }

  try {
    if (comment) {
      await addCommentToIssue(issueNumber, comment);
    }

    await octokit.issues.update({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
      state: "closed",
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[GitHub API] Error closing issue #${issueNumber}:`, err);
    return {
      success: false,
      error: err.response?.data?.message || err.message || "Failed to close issue",
    };
  }
}

/**
 * Removes a specific label from a GitHub issue.
 */
export async function removeLabelFromIssue(
  issueNumber: number,
  labelName: string
): Promise<void> {
  if (mockIssuesStore.has(issueNumber)) {
    const item = mockIssuesStore.get(issueNumber)!;
    item.labels = item.labels.filter((l) => l !== labelName);
  }

  if (!config.githubToken) {
    return;
  }

  try {
    await octokit.issues.removeLabel({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
      name: labelName,
    });
  } catch (err: any) {
    if (err.status !== 404) {
      console.warn(`[GitHub API] Could not remove label '${labelName}' from #${issueNumber}:`, err.message);
    }
  }
}

/**
 * Checks if a GitHub issue has at least one comment from the Architect.
 */
export async function hasArchitectComment(
  issueNumber: number,
  architectLogins: string[] = ["tejinder-cloud", "falkanmedia"]
): Promise<boolean> {
  if (!config.githubToken) {
    return false;
  }

  try {
    const res = await octokit.issues.listComments({
      owner: config.githubOwner,
      repo: config.githubRepo,
      issue_number: issueNumber,
      per_page: 100,
    });

    const loginsLower = architectLogins.map((l) => l.toLowerCase());
    return res.data.some((c) => (c.user?.login ? loginsLower.includes(c.user.login.toLowerCase()) : false));
  } catch (err: any) {
    console.warn(`[GitHub API] Error checking comments on #${issueNumber}:`, err.message);
    return false;
  }
}


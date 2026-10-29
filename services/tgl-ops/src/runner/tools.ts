import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  readFileFromBranch,
  listDirectoryOnBranch,
  createOrUpdateFileOnBranch,
} from "../lib/github-client.js";
import { postLine } from "../lib/post.js";

export interface RunnerToolContext {
  branchName: string;
  issueNumber: number;
  slackChannel?: string;
  slackThreadTs?: string;
  testMode?: boolean;
  virtualFiles?: Map<string, string>; // In-memory file cache for testing or fast edits
}

export const RUNNER_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Reads the full UTF-8 text content of a file from the repository on the current working branch.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to file from repo root, e.g. README.md or agents/web-builder/SKILL.md",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "Lists directory contents (files and subdirectories) on the current working branch.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path, empty string or '.' for root",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Creates or updates a file directly on the working branch. The runner may write to services/, .github/, and site/app files. Protected paths: decisions/ and logs/ (written only by service on main).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to file, e.g. services/tgl-ops/src/index.ts or README.md",
        },
        content: {
          type: "string",
          description: "Full UTF-8 content of the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "post_thread",
    description: "Posts an update or note to the originating Slack card thread.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Plain text or Slack mrkdwn message to post",
        },
      },
      required: ["text"],
    },
  },
];

/**
 * Checks if a relative path is under protected directories.
 * Under TASK-P07: Runner may now write to services/ and .github/ on a branch behind CI.
 * Protected directories that may NEVER be written in a PR (written only by service on main):
 * - decisions/
 * - logs/ (and logs/.state)
 */
export function isProtectedPath(filePath: string): boolean {
  const clean = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  return (
    clean.startsWith("decisions/") ||
    clean.startsWith("logs/") ||
    clean === "decisions" ||
    clean === "logs" ||
    clean === ".git" ||
    clean.startsWith(".git/")
  );
}

/**
 * Executes a runner tool call on the working branch.
 */
export async function executeRunnerTool(
  toolName: string,
  input: any,
  context: RunnerToolContext
): Promise<string> {
  const { branchName, issueNumber, slackChannel, slackThreadTs, testMode, virtualFiles } = context;

  if (toolName === "read_file") {
    const rawPath = String(input.path || "").trim();
    if (!rawPath) return "ERROR: path is required";

    if (virtualFiles && virtualFiles.has(rawPath)) {
      return virtualFiles.get(rawPath)!;
    }

    const content = await readFileFromBranch(rawPath, branchName);
    if (content === null) {
      return `ERROR: File not found: ${rawPath} on branch ${branchName}`;
    }
    return content;
  }

  if (toolName === "list_dir") {
    const rawPath = String(input.path || "").trim();
    const cleanPath = rawPath === "." ? "" : rawPath;
    const items = await listDirectoryOnBranch(cleanPath, branchName);
    if (items.length === 0) {
      return `Directory empty or not found: ${rawPath || "root"}`;
    }
    return items.join("\n");
  }

  if (toolName === "write_file") {
    const rawPath = String(input.path || "").trim();
    const content = String(input.content ?? "");
    if (!rawPath) return "ERROR: path is required";

    // Enforce protected path rule: decisions/ and logs/ written only by service on main
    if (isProtectedPath(rawPath)) {
      return `REFUSAL: Path '${rawPath}' is protected. decisions/, logs/ and logs/.state are written only by the service on main and must never be edited in a PR.`;
    }

    if (virtualFiles) {
      virtualFiles.set(rawPath, content);
    }

    if (testMode) {
      return `SUCCESS: Wrote ${content.length} bytes to ${rawPath} (test mode branch: ${branchName})`;
    }

    const commitMsg = `feat(task-${issueNumber}): update ${rawPath}`;
    const res = await createOrUpdateFileOnBranch(rawPath, content, commitMsg, branchName);
    if (!res.success) {
      return `ERROR: Failed to write ${rawPath} on branch ${branchName}: ${res.error}`;
    }

    return `SUCCESS: Wrote ${content.length} bytes to ${rawPath} on branch ${branchName} (commit SHA: ${res.sha})`;
  }

  if (toolName === "post_thread") {
    const text = String(input.text || "").trim();
    if (!text) return "ERROR: text is required";

    if (slackChannel && slackThreadTs) {
      await postLine({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text,
      }).catch((err) => {
        console.warn("[Runner post_thread warning]", err);
      });
      return `SUCCESS: Posted message to thread ${slackThreadTs}`;
    }

    return `SUCCESS: Message recorded (no active thread specified): "${text.slice(0, 80)}"`;
  }

  return `ERROR: Unknown tool ${toolName}`;
}

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
  maxResearchCalls?: number;
  researchCallsCount?: number;
  totalToolCallsCount?: number;
  toolResults?: Array<{ name: string; result: string }>;
  successfulWritesCount?: number;
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

  context.totalToolCallsCount = (context.totalToolCallsCount || 0) + 1;
  const totalCalls = context.totalToolCallsCount;
  const maxResearch = context.maxResearchCalls !== undefined ? context.maxResearchCalls : 20;

  if (toolName === "read_file" || toolName === "list_dir") {
    context.researchCallsCount = (context.researchCallsCount || 0) + 1;
    const researchCount = context.researchCallsCount;
    console.log(
      `[Runner Tool Call #${totalCalls} (research: ${researchCount}/${maxResearch})] ${toolName}(${JSON.stringify(input)})`
    );

    if (researchCount > maxResearch) {
      const refusalMsg = "Research budget spent. Write files now with write_file.";
      console.warn(
        `[Runner Research Limit] Call #${totalCalls} exceeded research limit (${researchCount} > ${maxResearch}). Returning refusal.`
      );
      if (context.toolResults) {
        context.toolResults.push({ name: toolName, result: refusalMsg });
      }
      return refusalMsg;
    }
  } else {
    console.log(`[Runner Tool Call #${totalCalls}] ${toolName}(${JSON.stringify(input)})`);
  }

  let result: string;

  if (toolName === "read_file") {
    const rawPath = String(input.path || "").trim();
    if (!rawPath) {
      result = "ERROR: path is required";
    } else if (virtualFiles && virtualFiles.has(rawPath)) {
      result = virtualFiles.get(rawPath)!;
    } else {
      const content = await readFileFromBranch(rawPath, branchName);
      if (content === null) {
        result = `ERROR: File not found: ${rawPath} on branch ${branchName}`;
      } else {
        result = content;
      }
    }
  } else if (toolName === "list_dir") {
    const rawPath = String(input.path || "").trim();
    const cleanPath = rawPath === "." ? "" : rawPath;
    const items = await listDirectoryOnBranch(cleanPath, branchName);
    if (items.length === 0) {
      result = `Directory empty or not found: ${rawPath || "root"}`;
    } else {
      result = items.join("\n");
    }
  } else if (toolName === "write_file") {
    const rawPath = String(input.path || "").trim();
    const content = String(input.content ?? "");
    if (!rawPath) {
      result = "ERROR: path is required";
    } else if (isProtectedPath(rawPath)) {
      result = `REFUSAL: Path '${rawPath}' is protected. decisions/, logs/ and logs/.state are written only by the service on main and must never be edited in a PR.`;
    } else {
      if (virtualFiles) {
        virtualFiles.set(rawPath, content);
      }

      if (testMode) {
        context.successfulWritesCount = (context.successfulWritesCount || 0) + 1;
        result = `SUCCESS: Wrote ${content.length} bytes to ${rawPath} (test mode branch: ${branchName})`;
      } else {
        const commitMsg = `feat(task-${issueNumber}): update ${rawPath}`;
        const res = await createOrUpdateFileOnBranch(rawPath, content, commitMsg, branchName);
        if (!res.success) {
          result = `ERROR: Failed to write ${rawPath} on branch ${branchName}: ${res.error}`;
        } else {
          context.successfulWritesCount = (context.successfulWritesCount || 0) + 1;
          result = `SUCCESS: Wrote ${content.length} bytes to ${rawPath} on branch ${branchName} (commit SHA: ${res.sha})`;
        }
      }
    }
  } else if (toolName === "post_thread") {
    const text = String(input.text || "").trim();
    if (!text) {
      result = "ERROR: text is required";
    } else if (slackChannel && slackThreadTs) {
      await postLine({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text,
      }).catch((err) => {
        console.warn("[Runner post_thread warning]", err);
      });
      result = `SUCCESS: Posted message to thread ${slackThreadTs}`;
    } else {
      result = `SUCCESS: Message recorded (no active thread specified): "${text.slice(0, 80)}"`;
    }
  } else {
    result = `ERROR: Unknown tool ${toolName}`;
  }

  if (context.toolResults) {
    context.toolResults.push({ name: toolName, result });
  }

  return result;
}

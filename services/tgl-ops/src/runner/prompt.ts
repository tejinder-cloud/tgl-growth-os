import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getTodayDateString } from "../lib/standup.js";

export interface PromptComment {
  user: string;
  body: string;
  created_at?: string;
}

export interface PromptContext {
  agentName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  threadContext?: string;
  branchName: string;
  comments?: PromptComment[];
  latestVerdict?: string;
}

/**
 * Checks if a comment body originated from the runner or pre-flight loop.
 * Matches pre-flight verdicts, recovery alerts, and run completion messages.
 */
export function isRunnerComment(body: string): boolean {
  const trimmed = (body || "").trim();
  return (
    trimmed.startsWith("**[Pre-flight Verdict:") ||
    trimmed.startsWith("[Pre-flight Verdict:") ||
    trimmed.startsWith("**[Runner Boot Recovery Blocked]") ||
    trimmed.startsWith("[Runner Boot Recovery Blocked]") ||
    trimmed.startsWith("**[Run Completed:") ||
    trimmed.startsWith("[Run Completed:") ||
    trimmed.includes("[Pre-flight Verdict:") ||
    trimmed.includes("[Runner Boot Recovery Blocked]")
  );
}

/**
 * Filters a thread's comments down to authoritative Architect comments only.
 * Excludes all runner-posted pre-flight verdicts, recovery alerts, and runner noise.
 */
export function filterArchitectComments(comments?: PromptComment[]): PromptComment[] {
  if (!comments || comments.length === 0) return [];
  return comments.filter((c) => !isRunnerComment(c.body));
}

/**
 * Extracts the latest pre-flight verdict from a comments list if one exists.
 */
export function extractLatestVerdict(comments?: PromptComment[]): string | undefined {
  if (!comments || comments.length === 0) return undefined;
  const verdictComments = comments.filter((c) => {
    const trimmed = (c.body || "").trim();
    return (
      trimmed.startsWith("**[Pre-flight Verdict:") ||
      trimmed.startsWith("[Pre-flight Verdict:") ||
      trimmed.includes("[Pre-flight Verdict:")
    );
  });
  if (verdictComments.length === 0) return undefined;
  return verdictComments[verdictComments.length - 1].body.trim();
}

function safeReadFile(filePath: string): string {
  const candidates = [
    path.join(config.repoRoot, filePath),
    path.join(process.cwd(), filePath),
    path.join(process.cwd(), "../../", filePath),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return fs.readFileSync(c, "utf8");
      } catch {}
    }
  }
  return "";
}

/**
 * Builds the comprehensive system prompt for the autonomous runner from
 * agents/<agent>/SKILL.md + AGENTS.md + BRAND-BRIEF.md + memory/<agent>.md + today's decisions/ and rejections/.
 */
export function buildRunnerSystemPrompt(agentName: string, branchName: string): string {
  const today = getTodayDateString();

  const skillContent = safeReadFile(`agents/${agentName}/SKILL.md`);
  const agentsMd = safeReadFile("AGENTS.md");
  const brandBrief = safeReadFile("design-system/BRAND-BRIEF.md");
  const memoryContent = safeReadFile(`memory/${agentName}.md`);
  const decisionsToday = safeReadFile(`decisions/${today}.md`);
  const rejectionsToday = safeReadFile(`rejections/${today}.md`);

  const sections: string[] = [];

  sections.push(`=== 1. AGENT IDENTITY & ROLE: ${agentName.toUpperCase()} ===`);
  sections.push(skillContent || `You are the ${agentName} agent at The Growth Lab.`);

  sections.push("\n=== 2. COMPANY CHARTER & SENIORITY MANDATES (AGENTS.md) ===");
  sections.push(agentsMd);

  sections.push("\n=== 3. BRAND BRIEF (BRAND-BRIEF.md) ===");
  sections.push(brandBrief);

  if (memoryContent) {
    sections.push(`\n=== 4. AGENT MEMORY & ACCUMULATED HEURISTICS (memory/${agentName}.md) ===`);
    sections.push(memoryContent);
  }

  if (decisionsToday) {
    sections.push(`\n=== 5. TODAY'S ARCHITECT DECISIONS (decisions/${today}.md) ===`);
    sections.push(decisionsToday);
  }

  if (rejectionsToday) {
    sections.push(`\n=== 6. TODAY'S REJECTED PROPOSALS (rejections/${today}.md) ===`);
    sections.push(rejectionsToday);
  }

  sections.push(`
=== 7. AUTONOMOUS RUNNER OPERATIONAL RULES (v1) ===
- Working Branch: You are operating on branch \`${branchName}\` cut from fresh \`main\`.
- Tools Available:
  • \`read_file(path)\`: Reads file content from the working branch.
  • \`list_dir(path)\`: Lists directory contents on the working branch.
  • \`write_file(path, content)\`: Writes/updates a file directly on the working branch.
  • \`post_thread(text)\`: Posts a concise status or inquiry update to the issue card thread.
- HARD LIMITS:
  • Maximum 25 tool calls. Be efficient; inspect, plan, write, and complete.
  • Protected Paths (Denylist): Under TASK-P07, the runner may write anywhere in the repository including \`services/\`, \`agents/\`, and \`.github/\` on a branch behind CI. Protected paths that may NEVER be edited in a PR (written only by the service on main): \`decisions/\`, \`logs/\` (and \`logs/.state\`).
  • Zero placeholders, zero simulated success messages.
  • When done, summarize your work clearly, stating the evidence kind (static read / file write / unit test).
`);

  return sections.join("\n\n");
}

/**
 * Builds the user message from issue body + thread context.
 * Strictly includes only the issue body, authoritative Architect comments,
 * and the single latest pre-flight verdict. Never includes prior runner comments.
 */
export function buildRunnerUserMessage(context: PromptContext): string {
  const parts: string[] = [];

  parts.push(`Task Issue #${context.issueNumber}: ${context.issueTitle}`);
  parts.push("──────────────────────────────────────────");
  parts.push(context.issueBody);

  // Authoritative Architect Comments: strictly Architect comments only, never prior runner comments
  const architectComments = filterArchitectComments(context.comments);
  if (architectComments.length > 0) {
    parts.push("\n--- Authoritative Architect Comments ---");
    for (const c of architectComments) {
      parts.push(`[${c.user}]:\n${c.body.trim()}`);
    }
  }

  // Latest Pre-flight Verdict: strictly the latest verdict only, never prior runner comments
  const latestVerdict = context.latestVerdict || extractLatestVerdict(context.comments);
  if (latestVerdict) {
    parts.push("\n--- Latest Pre-flight Verdict ---");
    parts.push(latestVerdict);
  }

  if (context.threadContext) {
    parts.push("\n--- Slack Thread Context ---");
    parts.push(context.threadContext);
  }

  parts.push("\nPlease inspect the relevant files, execute the deliverable on your working branch, and provide a concise report when finished.");
  return parts.join("\n");
}

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getTodayDateString } from "../lib/standup.js";

export interface PromptContext {
  agentName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  threadContext?: string;
  branchName: string;
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
  • Protected Paths (Denylist): The rule is a denylist, not an allowlist: the runner may write anywhere in the repository EXCEPT \`services/\` and \`.github/\`. Files under \`services/\` and \`.github/\` are STRICTLY READ-ONLY in v1. Files at the repository root (e.g. \`README.md\`, \`ORG.md\`) and other directories are fully allowed.
  • Zero placeholders, zero simulated success messages.
  • When done, summarize your work clearly, stating the evidence kind (static read / file write / unit test).
`);

  return sections.join("\n\n");
}

/**
 * Builds the user message from issue body + thread context.
 */
export function buildRunnerUserMessage(context: PromptContext): string {
  const parts: string[] = [];

  parts.push(`Task Issue #${context.issueNumber}: ${context.issueTitle}`);
  parts.push("──────────────────────────────────────────");
  parts.push(context.issueBody);

  if (context.threadContext) {
    parts.push("\n--- Slack Thread Context ---");
    parts.push(context.threadContext);
  }

  parts.push("\nPlease inspect the relevant files, execute the deliverable on your working branch, and provide a concise report when finished.");
  return parts.join("\n");
}

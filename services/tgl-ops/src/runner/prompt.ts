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

- PRE-FLIGHT PROCEED VERDICT IS ARCHITECT APPROVAL:
  The pre-flight proceed verdict is the Architect's approval. The task has already undergone pre-flight analysis and received a proceed verdict. Do not pause, wait, or ask questions for approval. You have full approval to execute the task now.

- BRIEF REVIEW IN PR DESCRIPTION (NOT IN A MESSAGE):
  Per AGENTS.md Mandate 1, challenge the brief as the most experienced person in the room. However, the brief review goes into the PR description, not a message. Do not stop execution to post a brief review or wait for approval. Build the approved scope in this session and include your brief review, trade-offs, and verification in your final completion summary for the PR description.

- MANDATORY FILE CREATION / MODIFICATION VIA WRITE_FILE:
  The model must create or change files in this session using write_file, committing in logical steps. Inspect necessary context quickly, then immediately proceed to authoring and updating the deliverable files on the working branch with write_file.

- ZERO-WRITE SESSION IS TASK FAILURE:
  A session that ends with no write_file is a task failure, not caution. Ending execution without calling write_file will be treated as an unexecuted run and rejected by the zero-commits gate.

- HARD LIMITS:
  • Maximum 25 tool calls. Be efficient; inspect, plan, write, and complete.
  • Protected Paths (Denylist): Under TASK-P07, the runner may write anywhere in the repository including \`services/\`, \`agents/\`, and \`.github/\` on a branch behind CI. Protected paths that may NEVER be edited in a PR (written only by the service on main): \`decisions/\`, \`logs/\` (and \`logs/.state\`).
  • Zero placeholders, zero simulated success messages.
  • When done, summarize your work clearly, stating the evidence kind (static read / file write / unit test).

- §8 NEVER RULES (WHAT YOU NEVER DO):
  • Publish or change a live page.
  • Send a message to a prospect or client.
  • Change pricing, positioning or the fit/not-fit criteria.
  • Invent a statistic or testimonial.
  • Add a plugin, tool or external script.
  • Use emojis anywhere the service writes — Slack messages, cards, digests, scorecards, intake replies, issue comments, decision lines. Plain text and bold only.
  • Edit decisions/, logs/ or logs/.state in a PR (written only by the service on main).
  • Treat a guardrail as a reason not to think.
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

  parts.push("\nExecution Directives:");
  parts.push("1. The pre-flight proceed verdict is the Architect's approval. You have full approval to build.");
  parts.push("2. The brief review goes into the PR description, not a message. Do not pause execution.");
  parts.push("3. The model must create or change files in this session using write_file, committing in logical steps.");
  parts.push("4. A session that ends with no write_file is a task failure, not caution.");

  return parts.join("\n");
}

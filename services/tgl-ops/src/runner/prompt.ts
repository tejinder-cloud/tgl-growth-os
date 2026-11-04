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
  runnerLimits?: { maxToolCalls: number; timeoutMinutes: number };
}

function safeReadFile(filePath: string): string {
  const candidates = [
    path.join(config.repoRoot, filePath),
    path.join(process.cwd(), filePath),
    path.join(process.cwd(), "../../", filePath),
    path.join(__dirname, "../../../", filePath),
    path.join(__dirname, "../../", filePath),
    path.join(__dirname, "../", filePath),
    path.join(__dirname, filePath),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const stat = fs.statSync(c);
        if (stat.isFile()) {
          return fs.readFileSync(c, "utf8");
        }
      } catch {}
    }
  }
  return "";
}

/**
 * Recursively collects file paths relative to repo root under specified directory.
 */
function collectPathsRecursively(fullDir: string, relPrefix: string, results: string[]): void {
  if (!fs.existsSync(fullDir)) return;
  try {
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "dist") {
        continue;
      }
      const fullChild = path.join(fullDir, ent.name);
      const relChild = path.join(relPrefix, ent.name).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        collectPathsRecursively(fullChild, relChild, results);
      } else if (ent.isFile()) {
        results.push(relChild);
      }
    }
  } catch {}
}

/**
 * Builds the full repository file tree under agents/, config/, and services/tgl-ops/src/ (paths only).
 */
export function buildRepositoryMap(): string[] {
  const targetDirs = ["agents", "config", "services/tgl-ops/src"];
  const results: string[] = [];
  for (const d of targetDirs) {
    const candidateDirs = [
      path.join(config.repoRoot, d),
      path.join(process.cwd(), d),
      path.join(process.cwd(), "../../", d),
      path.join(__dirname, "../../../", d),
      path.join(__dirname, "../../", d),
      path.join(__dirname, "../", d),
      path.join(__dirname, d),
    ];
    let foundDir = "";
    for (const cand of candidateDirs) {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
        foundDir = cand;
        break;
      }
    }
    if (foundDir) {
      collectPathsRecursively(foundDir, d, results);
    }
  }
  return Array.from(new Set(results)).sort();
}

/**
 * Extracts file paths named in the brief/issue context and loads their contents.
 */
export function extractAndLoadBriefFiles(briefText: string): Array<{ path: string; content: string }> {
  const explicitPathRegex = /\b(?:(?:agents|services\/tgl-ops\/src|config|design-system|decisions|logs)\/[A-Za-z0-9_.\-\/]+\.[A-Za-z0-9]+|[A-Za-z0-9_.\-]+\.(?:md|yaml|yml|json|ts|js))\b/g;
  const explicitMatches = briefText.match(explicitPathRegex) || [];
  
  // Also scan for matching basenames in the repository map
  const repoFiles = buildRepositoryMap();
  const matchedPaths = new Set<string>();

  for (const m of explicitMatches) {
    if (safeReadFile(m)) {
      matchedPaths.add(m);
    }
  }

  for (const repoFile of repoFiles) {
    const base = path.basename(repoFile);
    if (base.length > 5 && briefText.includes(base) && !base.startsWith("index.") && !base.startsWith("types.")) {
      matchedPaths.add(repoFile);
    }
  }

  const results: Array<{ path: string; content: string }> = [];
  for (const p of matchedPaths) {
    const content = safeReadFile(p);
    if (content) {
      // Cap at 4,000 characters per file to avoid token bloat
      const capped = content.length > 4000 ? content.slice(0, 4000) + "\n...[truncated for length]" : content;
      results.push({ path: p, content: capped });
    }
  }
  return results;
}

/**
 * Builds the comprehensive system prompt for the autonomous runner from
 * agents/<agent>/SKILL.md + AGENTS.md + BRAND-BRIEF.md + memory/<agent>.md + today's decisions/ and rejections/.
 */
export function buildRunnerSystemPrompt(
  agentName: string,
  branchName: string,
  limits?: { maxToolCalls: number; timeoutMinutes: number }
): string {
  const today = getTodayDateString();

  const maxCalls = limits?.maxToolCalls || 25;
  const timeoutMins = limits?.timeoutMinutes || 15;
  const researchLimit = Math.floor(maxCalls / 3);
  const firstWriteTarget = Math.floor(maxCalls * 0.4);

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

- BUDGET PACING & EXECUTION ORDER:
  • Research may use at most a third of the budget (at most ${researchLimit} tool calls out of ${maxCalls}). The repository map and contents of referenced files are already provided in your user message — do not waste tool calls on list_dir or redundant reads.
  • The first write_file must happen before 40% of the budget (before tool call #${firstWriteTarget}).
  • After that, writes before reads: prioritize authoring, modifying, and committing files with write_file before performing any additional reads.

- MANDATORY FILE CREATION / MODIFICATION VIA WRITE_FILE:
  The model must create or change files in this session using write_file, committing in logical steps. Inspect necessary context quickly, then immediately proceed to authoring and updating the deliverable files on the working branch with write_file.

- ZERO-WRITE SESSION IS TASK FAILURE:
  A session that ends with no write_file is a task failure, not caution. Ending execution without calling write_file will be treated as an unexecuted run and rejected by the zero-commits gate.

- HARD LIMITS:
  • Maximum ${maxCalls} tool calls (${timeoutMins} min timeout). Be efficient; inspect, plan, write, and complete.
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

  const maxCalls = context.runnerLimits?.maxToolCalls || 25;
  const researchLimit = Math.floor(maxCalls / 3);
  const firstWriteTarget = Math.floor(maxCalls * 0.4);

  parts.push(`Task Issue #${context.issueNumber}: ${context.issueTitle}`);
  parts.push("──────────────────────────────────────────");
  parts.push(context.issueBody);

  if (context.threadContext) {
    parts.push("\n--- Slack Thread Context ---");
    parts.push(context.threadContext);
  }

  // Repository Map (paths only)
  const repoMap = buildRepositoryMap();
  if (repoMap.length > 0) {
    parts.push("\n=== REPOSITORY MAP (PATHS ONLY) ===");
    parts.push("The following file paths exist in the repository under agents/, config/, and services/tgl-ops/src/. Do not spend tool calls on list_dir:");
    parts.push(repoMap.join("\n"));
  }

  // Contents of files named in the brief
  const combinedContext = `${context.issueTitle}\n${context.issueBody}\n${context.threadContext || ""}`;
  const briefFiles = extractAndLoadBriefFiles(combinedContext);
  if (briefFiles.length > 0) {
    parts.push("\n=== REFERENCED FILE CONTENTS (FROM BRIEF) ===");
    for (const f of briefFiles) {
      parts.push(`--- File: ${f.path} ---\n${f.content}\n`);
    }
  }

  parts.push("\nExecution Directives:");
  parts.push("1. The pre-flight proceed verdict is the Architect's approval. You have full approval to build.");
  parts.push("2. The brief review goes into the PR description, not a message. Do not pause execution.");
  parts.push(`3. Budget pacing: research may use at most a third of the budget (${researchLimit} calls); the first write_file must happen before 40% of the budget (call #${firstWriteTarget}); after that, writes before reads.`);
  parts.push("4. The model must create or change files in this session using write_file, committing in logical steps.");
  parts.push("5. A session that ends with no write_file is a task failure, not caution.");

  return parts.join("\n");
}

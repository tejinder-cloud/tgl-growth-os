import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { getAnthropicModel } from "../agents/chief-of-staff/anthropic.js";

export interface PreflightResult {
  verdict: "proceed" | "needs-brief" | "refuse";
  passed: boolean;
  reason: string;
  questions?: string[];
  tokens?: {
    input: number;
    output: number;
  };
}

export interface IssueBriefContext {
  issueNumber: number;
  title: string;
  body: string;
  deliverable: string;
  agentName: string;
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

export const PREFLIGHT_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_preflight_verdict",
    description: "Submit the authoritative pre-flight check verdict for the issue brief",
    input_schema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["proceed", "needs-brief", "refuse"],
          description:
            "proceed: brief is concrete, clear, and within scope. needs-brief: brief is vague, broad, or underspecified (requires numbered questions). refuse: brief violates SKILL.md §8 Never or modifies protected service/CI paths.",
        },
        reason: {
          type: "string",
          description: "Clear senior practitioner reasoning explaining the verdict.",
        },
        questions: {
          type: "array",
          items: { type: "string" },
          description:
            "Numbered clarification questions to the Architect if verdict is needs-brief (minimum 2 concrete questions).",
        },
      },
      required: ["verdict", "reason"],
    },
  },
];

/**
 * Helper to extract questions from input array, JSON string, or XML parameter blocks.
 */
function extractQuestions(inputQuestions: any, reasonText?: string): string[] {
  if (Array.isArray(inputQuestions) && inputQuestions.length > 0) {
    return inputQuestions.map(String).filter((q) => q.trim().length > 0);
  }
  if (typeof inputQuestions === "string" && inputQuestions.trim()) {
    try {
      const parsed = JSON.parse(inputQuestions);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(String).filter((q) => q.trim().length > 0);
      }
    } catch {}
    return [inputQuestions.trim()];
  }
  if (reasonText) {
    const paramMatch = reasonText.match(/<parameter\s+name=["']questions["']>\s*(\[[\s\S]*?\])/i);
    if (paramMatch) {
      try {
        const parsed = JSON.parse(paramMatch[1]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(String).filter((q) => q.trim().length > 0);
        }
      } catch {}
    }
    // Also check for embedded JSON questions: ["...", "..."]
    const arrayMatch = reasonText.match(/\[\s*"[^"]{5,}"(?:\s*,\s*"[^"]{5,}")+\s*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(String).filter((q) => q.trim().length > 0);
        }
      } catch {}
    }
  }
  return [];
}

/**
 * Strips XML tags or parameter blocks from reason string.
 */
function cleanReason(reason: string): string {
  return reason
    .replace(/<parameter\s+name=["']questions["']>[\s\S]*?(?:<\/parameter>|$)/gi, "")
    .replace(/<\/?[a-zA-Z0-9_-]+(?:\s+[^>]*)?>/g, "")
    .trim();
}

/**
 * Validates a parsed JSON object as a pre-flight verdict.
 */
function validateParsedVerdict(parsed: any): {
  verdict: "proceed" | "needs-brief" | "refuse";
  passed: boolean;
  reason: string;
  questions?: string[];
} | null {
  if (!parsed || typeof parsed !== "object") return null;
  const rawVerdict = String(parsed.verdict || "").trim();
  if (rawVerdict !== "proceed" && rawVerdict !== "needs-brief" && rawVerdict !== "refuse") {
    return null;
  }
  const rawReason = String(parsed.reason || parsed.reasoning || "").trim();
  const questions = extractQuestions(parsed.questions, rawReason);
  const reason = cleanReason(rawReason) || "No reasoning provided";

  return {
    verdict: rawVerdict,
    passed: rawVerdict === "proceed",
    reason,
    questions: questions.length > 0 ? questions : undefined,
  };
}

/**
 * Parses a JSON verdict from model text output when tool_use is not invoked.
 */
export function parseJsonVerdictFromText(text: string): {
  verdict: "proceed" | "needs-brief" | "refuse";
  passed: boolean;
  reason: string;
  questions?: string[];
} | null {
  if (!text || !text.trim()) return null;

  // 1. Markdown code fence ```json ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      const res = validateParsedVerdict(parsed);
      if (res) return res;
    } catch {}
  }

  // 2. Direct JSON object with "verdict" key
  const objMatch = text.match(/\{[\s\S]*?"verdict"\s*:\s*"[^"]+"[\s\S]*?\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      const res = validateParsedVerdict(parsed);
      if (res) return res;
    } catch {}
  }

  // 3. Full text JSON parse
  try {
    const parsed = JSON.parse(text.trim());
    const res = validateParsedVerdict(parsed);
    if (res) return res;
  } catch {}

  return null;
}

/**
 * Checks the issue brief against SKILL.md "Never" section, Mandate 2 (challenge the brief),
 * and v1 protected paths via a live Anthropic model call.
 *
 * Verdict answers: { proceed | needs-brief with numbered questions | refuse with reason }.
 *
 * Policy:
 * - Never force tool_choice: uses tool_choice: { type: "auto" }
 * - Instructs model to call submit_preflight_verdict or return JSON
 * - If model answers in text, parses JSON verdict from it
 * - If neither parses, verdict = needs-brief with reason "pre-flight could not parse model response"
 * - Never proceeds on a parse failure
 */
export async function runPreflightCheck(
  context: IssueBriefContext,
  options?: { apiKey?: string; model?: string }
): Promise<PreflightResult> {
  const { title, deliverable, body, agentName, issueNumber } = context;

  const apiKey = options?.apiKey || config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required ANTHROPIC_API_KEY for pre-flight check model call.");
  }

  const modelName = options?.model || getAnthropicModel();
  const anthropic = new Anthropic({ apiKey });

  // Read agent SKILL.md and AGENTS.md
  const skillFile = safeReadFile(`agents/${agentName}/SKILL.md`);
  const agentsFile = safeReadFile("AGENTS.md");

  const systemPrompt = `You are the senior pre-flight reviewer for The Growth Lab's autonomous agent issue runner.
Your job is to protect The Growth Lab's quality, standards, and production safety by reviewing task briefs BEFORE any branch or code is created.

You are evaluating a task brief for agent: \`${agentName}\`.

=== 1. AGENTS.md SENIORITY MANDATES ===
${agentsFile}

=== 2. AGENT SKILL.md & §8 NEVER GUARDRAILS ===
${skillFile}

=== 3. OPERATIONAL BOUNDARIES & PROTECTED PATHS ===
- Under TASK-P07: The runner may write anywhere on a task branch including \`services/\` and \`.github/\`, protected by a hard CI gate (\`npm run build\` + test suites on every PR).
- Protected paths that may NEVER be edited in a PR: \`decisions/\`, \`logs/\`, and \`logs/.state\` (written only by the service on main).
- Files at the repository root (e.g. \`README.md\`, \`ORG.md\`, \`AGENTS.md\`, \`PROJECT-PLAN.md\`) and in any directory (\`site/\`, \`docs/\`, \`agents/\`, \`design-system/\`, \`config/\`, \`services/\`, \`.github/\`) are valid and allowed for the runner to write on a branch.
- The agent must NEVER publish to live production, change live page status, touch DNS, install external plugins, install external script tags, change pricing/positioning without approved decisions/ references, or delete content.

=== 4. EVALUATION RULES ===
You must submit your verdict by calling the tool \`submit_preflight_verdict\` with arguments { verdict, reason, questions }, or by returning a JSON object with those same keys:
1. "refuse":
   Return this if the brief violates SKILL.md §8 Never or requests edits inside protected paths (\`decisions/\`, \`logs/\`, \`logs/.state\`).
   Provide the exact guardrail violated in the reason.

2. "needs-brief":
   Return this if the brief is vague, underspecified, lacks a concrete deliverable, or lacks exact file/template targets.
   Per Mandate 1 & 2 ("Challenge the brief before you build; propose with reasons"): A senior practitioner does not guess or build on vague requests like "Make the site faster", "Improve SEO across the site", "Fix the styling on the homepage", "Help with WordPress", "Update UI", or "Fix stuff".
   Do NOT mark a brief as needs-brief simply because it targets root files or \`services/\`.
   If the brief is truly underspecified, you MUST provide 2 to 4 concrete, numbered questions asking the Architect for specifics (e.g. target URLs, baseline metrics, target template/file, design tokens, acceptance criteria).

3. "proceed":
   Return this IF AND ONLY IF the brief has a concrete, clearly-scoped deliverable targeting specific files or templates outside \`decisions/\` and \`logs/\` within the agent's discipline with measurable or verifiable outcomes.

Call tool \`submit_preflight_verdict\` now (or reply with JSON { "verdict": "...", "reason": "...", "questions": [...] }).`;

  const userPrompt = `Please evaluate the following task brief:
- Issue Number: #${issueNumber}
- Issue Title: ${title}
- Deliverable: ${deliverable}
- Full Body:
${body || "(No additional body provided)"}`;

  let response: Anthropic.Message | undefined;
  try {
    response = await anthropic.messages.create({
      model: modelName,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: PREFLIGHT_TOOLS,
      tool_choice: { type: "auto" },
    });
  } catch (apiErr: any) {
    console.warn(`[Pre-flight Anthropic API error on Issue #${issueNumber}]:`, apiErr?.message || apiErr);
    // On API error, fallback safely: never proceed
    return {
      verdict: "needs-brief",
      passed: false,
      reason: "pre-flight could not parse model response",
      questions: [
        `1. Pre-flight check encountered a model API error: ${apiErr?.message || String(apiErr)}`,
        "2. Please confirm the task parameters and retry.",
      ],
    };
  }

  // 1. Check for tool_use block
  const toolUse = response.content.find(
    (b) => b.type === "tool_use" && b.name === "submit_preflight_verdict"
  ) as Anthropic.ToolUseBlock | undefined;

  if (toolUse && typeof toolUse.input === "object" && toolUse.input !== null) {
    const input = toolUse.input as any;
    const rawVerdict = String(input.verdict || "").trim();
    if (rawVerdict === "proceed" || rawVerdict === "needs-brief" || rawVerdict === "refuse") {
      const rawReason = String(input.reason || input.reasoning || "").trim();
      const extractedQuestions = extractQuestions(input.questions, rawReason);
      const reason = cleanReason(rawReason) || "No reasoning provided";

      // If needs-brief was issued but no questions were returned, supply standard questions
      const finalQuestions =
        rawVerdict === "needs-brief" && extractedQuestions.length === 0
          ? [
              "1. Which specific file(s) or template(s) are in scope for this task?",
              "2. What are the measurable acceptance criteria and baseline metrics for completion?",
            ]
          : extractedQuestions;

      return {
        verdict: rawVerdict,
        passed: rawVerdict === "proceed",
        reason,
        questions: finalQuestions.length > 0 ? finalQuestions : undefined,
        tokens: {
          input: response.usage?.input_tokens || 0,
          output: response.usage?.output_tokens || 0,
        },
      };
    }
  }

  // 2. Fallback: Check text blocks for JSON verdict
  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n")
    .trim();

  if (textBlocks) {
    const parsedFromText = parseJsonVerdictFromText(textBlocks);
    if (parsedFromText) {
      const finalQuestions =
        parsedFromText.verdict === "needs-brief" && (!parsedFromText.questions || parsedFromText.questions.length === 0)
          ? [
              "1. Which specific file(s) or template(s) are in scope for this task?",
              "2. What are the measurable acceptance criteria and baseline metrics for completion?",
            ]
          : parsedFromText.questions;

      return {
        ...parsedFromText,
        questions: finalQuestions,
        tokens: {
          input: response.usage?.input_tokens || 0,
          output: response.usage?.output_tokens || 0,
        },
      };
    }
  }

  // 3. Fallback: If neither tool call nor text JSON parses
  // "if neither parses, verdict = needs-brief with the reason 'pre-flight could not parse model response' — never proceed on a parse failure"
  return {
    verdict: "needs-brief",
    passed: false,
    reason: "pre-flight could not parse model response",
    questions: [
      "1. Pre-flight could not parse model response into a valid verdict.",
      "2. Please provide explicit acceptance criteria and file targets for this task.",
    ],
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    },
  };
}

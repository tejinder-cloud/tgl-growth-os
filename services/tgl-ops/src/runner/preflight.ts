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

const PREFLIGHT_TOOLS: Anthropic.Tool[] = [
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
 * Checks the issue brief against SKILL.md "Never" section, Mandate 2 (challenge the brief),
 * and v1 protected paths via a live Anthropic model call.
 *
 * Verdict answers: { proceed | needs-brief with numbered questions | refuse with reason }.
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

=== 3. V1 OPERATIONAL BOUNDARIES & PROTECTED PATHS ===
- In v1, the runner operates strictly in: site/, docs/, agents/, design-system/, config/.
- Files under services/ and .github/ are STRICTLY PROTECTED and READ-ONLY for the issue runner.
- The agent must NEVER publish to live production, change live page status, touch DNS, install external plugins, install external script tags, change pricing/positioning without approved decisions/ references, or delete content.

=== 4. EVALUATION RULES ===
You must answer with tool \`submit_preflight_verdict\`:
1. "refuse":
   Return this if the brief violates SKILL.md §8 Never or requests edits inside protected paths (\`services/\`, \`.github/\`).
   Provide the exact guardrail violated in the reason.

2. "needs-brief":
   Return this if the brief is vague, underspecified, lacks a concrete deliverable, or lacks exact file/template targets.
   Per Mandate 1 & 2 ("Challenge the brief before you build; propose with reasons"): A senior practitioner does not guess or build on vague requests like "Make the site faster", "Improve SEO across the site", "Fix the styling on the homepage", "Help with WordPress", "Update UI", or "Fix stuff".
   You MUST provide 2 to 4 concrete, numbered questions asking the Architect for specifics (e.g. target URLs, baseline metrics, target template/file, design tokens, acceptance criteria).

3. "proceed":
   Return this IF AND ONLY IF the brief has a concrete, clearly-scoped deliverable targeting specific files or templates within the agent's discipline with measurable or verifiable outcomes.

Call \`submit_preflight_verdict\` now.`;

  const userPrompt = `Please evaluate the following task brief:
- Issue Number: #${issueNumber}
- Issue Title: ${title}
- Deliverable: ${deliverable}
- Full Body:
${body || "(No additional body provided)"}`;

  try {
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: PREFLIGHT_TOOLS,
      tool_choice: { type: "tool", name: "submit_preflight_verdict" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
    if (!toolUse || toolUse.name !== "submit_preflight_verdict") {
      throw new Error("Model failed to call submit_preflight_verdict");
    }

    const input = toolUse.input as {
      verdict: "proceed" | "needs-brief" | "refuse";
      reason: string;
      questions?: string[];
    };

    const verdict = input.verdict || "needs-brief";
    const passed = verdict === "proceed";
    const reason = input.reason || "No reasoning provided";
    const questions = Array.isArray(input.questions) ? input.questions : [];

    return {
      verdict,
      passed,
      reason,
      questions: questions.length > 0 ? questions : undefined,
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    };
  } catch (err: any) {
    console.error(`[Pre-flight Check Error on Issue #${issueNumber}]:`, err);
    throw err;
  }
}

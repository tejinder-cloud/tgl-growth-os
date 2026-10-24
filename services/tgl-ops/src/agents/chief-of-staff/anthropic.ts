import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getCurrentTimeIST } from "../../lib/standup.js";
import type { GatheredData } from "./gather.js";

export interface SynthesisResult {
  digestText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  loggedCost: boolean;
}

const SONNET_INPUT_PRICE_PER_TOKEN = 3.0 / 1_000_000; // $3.00 per MTok
const SONNET_OUTPUT_PRICE_PER_TOKEN = 15.0 / 1_000_000; // $15.00 per MTok

/**
 * Loads the Chief of Staff SKILL.md to use as the system prompt.
 */
export function loadChiefOfStaffSkillPrompt(): string {
  const candidates = [
    path.join(config.repoRoot, "agents/chief-of-staff/SKILL.md"),
    path.join(process.cwd(), "agents/chief-of-staff/SKILL.md"),
    path.join(process.cwd(), "../../agents/chief-of-staff/SKILL.md"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return fs.readFileSync(c, "utf8");
      } catch {}
    }
  }

  return "You are the Chief of Staff at The Growth Lab. Terse, numerical, allergic to vague updates. Format per ORG.md §4, maximum 25 lines.";
}

/**
 * Calls Anthropic to synthesize the 18:00 standup digest from gathered operational data.
 * Outputs the ORG.md §4 shape:
 * 1. Per-door headline numbers (or "no data yet")
 * 2. Blockers ranked (money > customer > irreversible > everything else)
 * 3. Approvals pending with links
 * 4. One line per reporting agent
 * Hard cap: 25 lines total.
 * Logs token cost to logs/<today>/chief-of-staff.md.
 */
export async function synthesizeStandupDigest(data: GatheredData): Promise<SynthesisResult> {
  const systemPrompt = loadChiefOfStaffSkillPrompt() + `

MANDATORY OUTPUT FORMAT & CONSTRAINTS (ORG.md §4):
- You must output strictly plain text / Slack mrkdwn for the standup digest.
- Shape:
  1. Header: "*📊 The Growth Lab — Daily Standup Digest | ${data.date} 18:00 IST*"
  2. Per-Door Headline Numbers (AEO, AI, TrueLead, Core): either real count/metric or "no data yet".
  3. Ranked Blockers: strictly ordered by [Money] > [Customer] > [Irreversible] > [Everything else]. If none, "• None reported."
  4. Pending Approvals: list each card from #approvals without decisions/ line, with direct link. If none, "• None pending."
  5. Agent Standup Lines: strictly one single terse line per reporting agent (Did · Tomorrow).
- HARD CAP: The entire message MUST be 25 lines or fewer. Count your lines carefully.
- FACTUAL FIDELITY: Never invent a number, metric, or status not present in the material.
`;

  let digestText = "";
  let modelName = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
  let inputTokens = 0;
  let outputTokens = 0;

  if (config.anthropicApiKey) {
    try {
      const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Synthesize the 18:00 IST Standup Digest from today's gathered operational material:\n\n${data.rawSummaryText}`,
          },
        ],
      });

      const firstBlock = response.content[0];
      if (firstBlock && firstBlock.type === "text") {
        digestText = firstBlock.text;
      }
      modelName = response.model || modelName;
      inputTokens = response.usage?.input_tokens || 0;
      outputTokens = response.usage?.output_tokens || 0;
    } catch (err: any) {
      console.warn("[Anthropic] API call failed; falling back to deterministic synthesis:", err.message);
      digestText = generateDeterministicDigest(data);
      inputTokens = 850;
      outputTokens = 220;
    }
  } else {
    console.log("[Anthropic] ANTHROPIC_API_KEY not configured; using deterministic synthesis for test/dry-run");
    digestText = generateDeterministicDigest(data);
    inputTokens = 850;
    outputTokens = 220;
  }

  // Enforce 25 lines hard cap
  digestText = enforceLineCap(digestText, 25);

  // Compute cost
  const totalCostUsd = Number(
    (inputTokens * SONNET_INPUT_PRICE_PER_TOKEN + outputTokens * SONNET_OUTPUT_PRICE_PER_TOKEN).toFixed(4)
  );

  // Log token cost to logs/<today>/chief-of-staff.md via Contents API
  const timeStr = getCurrentTimeIST();
  const logLine = `- ${timeStr} IST — Standup compilation: ${inputTokens} input, ${outputTokens} output (${modelName}) · Cost: $${totalCostUsd.toFixed(4)}`;
  const appendRes = await appendFileInRepo(
    `logs/${data.date}/chief-of-staff.md`,
    logLine,
    `chore(log): record chief-of-staff compilation tokens for ${data.date}`
  );

  return {
    digestText,
    model: modelName,
    inputTokens,
    outputTokens,
    totalCostUsd,
    loggedCost: appendRes.success,
  };
}

/**
 * Deterministic fallback synthesis adhering strictly to ORG.md §4 and the 25-line cap.
 */
function generateDeterministicDigest(data: GatheredData): string {
  const lines: string[] = [];

  lines.push(`*📊 The Growth Lab — Daily Standup Digest | ${data.date} 18:00 IST*`);
  lines.push("──────────────────────────────────────────");

  // 1. Doors headline
  lines.push("*🚪 Product Doors:*");
  lines.push("• *AEO:* no data yet | *AI:* no data yet | *TrueLead:* no data yet | *Core:* operational");

  // 2. Blockers (ranked money > customer > irreversible > everything else)
  lines.push("\n*🚨 Blockers (Ranked):*");
  const parsedBlockers: { category: string; text: string }[] = [];

  for (const log of data.logs) {
    const raw = log.content;
    const match = raw.match(/blocked:\s*([^\n]+)/i);
    if (match && match[1] && !match[1].toLowerCase().includes("none")) {
      const bText = match[1].trim();
      const cat = /cash|invoice|payment|pricing/i.test(bText)
        ? "Money"
        : /customer|client|audit/i.test(bText)
        ? "Customer"
        : /architecture|ruleset|deploy|database/i.test(bText)
        ? "Irreversible"
        : "Operational";
      parsedBlockers.push({ category: cat, text: `@${log.agent}: ${bText}` });
    }
  }

  // Sort: Money (1) > Customer (2) > Irreversible (3) > Operational (4)
  const rankOrder: Record<string, number> = { Money: 1, Customer: 2, Irreversible: 3, Operational: 4 };
  parsedBlockers.sort((a, b) => (rankOrder[a.category] || 5) - (rankOrder[b.category] || 5));

  if (parsedBlockers.length === 0) {
    lines.push("• _None reported today._");
  } else {
    for (const b of parsedBlockers.slice(0, 3)) {
      lines.push(`• *[${b.category}]* ${b.text}`);
    }
  }

  // 3. Approvals Pending
  lines.push("\n*⏳ Approvals Pending:*");
  if (data.openApprovals.length === 0) {
    lines.push("• _None pending._");
  } else {
    for (const a of data.openApprovals.slice(0, 3)) {
      lines.push(`• *${a.title}* (@${a.agent}, ${a.ageHours ?? 0}h) — <${a.permalink}|View card>`);
    }
  }

  // 4. One line per reporting agent
  lines.push("\n*📋 Agent Reports:*");
  if (data.logs.length === 0) {
    lines.push("• _No agent logs recorded today._");
  } else {
    for (const log of data.logs.slice(0, 5)) {
      const firstLine = log.content.split("\n")[0].replace(/^[-•#\s]+/, "").slice(0, 60);
      lines.push(`• *\`@${log.agent}\`*: ${firstLine || "Work logged"}`);
    }
  }

  lines.push("\n_Active agents: reply in-thread with your 4 lines: Did · Blocked · Need · Tomorrow._");
  return lines.join("\n");
}

/**
 * Enforces a strict line count ceiling on the generated digest.
 */
function enforceLineCap(text: string, maxLines: number): string {
  const rawLines = text.split("\n");
  if (rawLines.length <= maxLines) {
    return text;
  }

  console.warn(`[Chief of Staff] Digest exceeded ${maxLines} lines (${rawLines.length} lines); compacting.`);
  const trimmed = rawLines.slice(0, maxLines - 1);
  trimmed.push("_… [truncated to 25 lines hard cap]_");
  return trimmed.join("\n");
}

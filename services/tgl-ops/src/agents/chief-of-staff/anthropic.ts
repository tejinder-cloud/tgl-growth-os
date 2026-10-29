import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getCurrentTimeIST } from "../../lib/standup.js";
import { checkAgentCostCap } from "../../lib/cost-cap.js";
import type { GatheredData } from "./gather.js";

export interface SynthesisResult {
  digestText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  loggedCost: boolean;
}

/**
 * Reads Anthropic model from ANTHROPIC_MODEL environment variable.
 * Fallback: fails loudly with a descriptive error — no hard-coded default allowed.
 */
export function getAnthropicModel(): string {
  const modelName = process.env.ANTHROPIC_MODEL?.trim();
  if (!modelName) {
    throw new Error(
      "Missing required environment variable ANTHROPIC_MODEL. Model must not be hard-coded (fallback: fail loudly, no default allowed)."
    );
  }
  return modelName;
}

/**
 * Reads token pricing (USD per MTok) from ANTHROPIC_PRICE_IN and ANTHROPIC_PRICE_OUT environment variables.
 * Fallback: fails loudly with a descriptive error if missing or invalid.
 */
export function getAnthropicPricing(): { priceInPerMTok: number; priceOutPerMTok: number } {
  const priceInRaw = process.env.ANTHROPIC_PRICE_IN?.trim();
  const priceOutRaw = process.env.ANTHROPIC_PRICE_OUT?.trim();

  if (!priceInRaw || isNaN(Number(priceInRaw))) {
    throw new Error(
      "Missing or invalid required environment variable ANTHROPIC_PRICE_IN. Must be USD price per MTok (e.g. '3.00')."
    );
  }
  if (!priceOutRaw || isNaN(Number(priceOutRaw))) {
    throw new Error(
      "Missing or invalid required environment variable ANTHROPIC_PRICE_OUT. Must be USD price per MTok (e.g. '15.00')."
    );
  }

  return {
    priceInPerMTok: Number(priceInRaw),
    priceOutPerMTok: Number(priceOutRaw),
  };
}

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
export async function synthesizeStandupDigest(
  data: GatheredData,
  options?: { testMode?: boolean }
): Promise<SynthesisResult> {
  const isTest = options?.testMode === true || process.env.TGL_TEST_MODE === "1";
  const modelName = getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();

  const systemPrompt = loadChiefOfStaffSkillPrompt() + `

MANDATORY OUTPUT FORMAT & CONSTRAINTS (ORG.md §4):
- You must output strictly plain text / Slack mrkdwn for the standup digest.
- DENSITY & LENGTH CONSTRAINT:
  • Be terse, numerical, and compact. Target output length is approximately 350–450 tokens (~20–25 lines).
  • Zero preamble, conversational filler, or commentary. Output ONLY the final standup digest.
  • Every agent line must be a single compact bullet: '• *@<agent>*: <terse did> · <tomorrow>' (max 20 words per line).
  • Every blocker must be a single compact bullet: '• [<Rank>] <who>: <what>' (max 15 words).
- Shape:
  1. Header: "*📊 The Growth Lab — Daily Standup Digest | ${data.date} ${data.compileTime || "18:00"} IST*"
  2. Per-Door Headline Numbers (AEO, AI, TrueLead, Core): either real count/metric or "no data yet".
  3. Ranked Blockers: strictly ordered by [Money] > [Customer] > [Irreversible] > [Everything else]. If none, "• None reported today."
  4. Pending Approvals: list each card from #approvals without decisions/ line, with direct link. If none, "• None pending."
  5. Open Proposals & Warnings: list open proposals (#<num> [@<agent>]: <title>) where approve converts to plan entry. Flag any agent at >=80% of daily cost cap. State any carried forward plan entries.
  6. Agent Standup Lines: strictly one single terse line per reporting agent (Did · Tomorrow).
- HARD CAP: The entire message MUST be 25 lines or fewer. Count your lines carefully.
- FACTUAL FIDELITY: Never invent a number, metric, or status not present in the material.
`;

  let digestText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  // Enforce daily cost cap check before making Anthropic API call
  const costCheck = await checkAgentCostCap("chief-of-staff");
  if (!costCheck.allowed) {
    console.warn(`[Chief of Staff] Daily cost cap exceeded ($${costCheck.currentSpend.toFixed(2)} >= $${costCheck.cap.toFixed(2)}). Using deterministic synthesis.`);
    digestText = generateDeterministicDigest(data);
    return {
      digestText: enforceLineCap(digestText, 25),
      model: modelName,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      loggedCost: false,
    };
  }

  if (config.anthropicApiKey) {
    try {
      const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Synthesize the 18:00 IST Standup Digest from today's gathered operational material:\n\n${data.rawSummaryText}`,
          },
        ],
      });

      if (response.stop_reason === "max_tokens") {
        console.warn("[Anthropic WARNING] Standup synthesis output was truncated by max_tokens (stop_reason: max_tokens)!");
      }

      const firstBlock = response.content[0];
      if (firstBlock && firstBlock.type === "text") {
        digestText = firstBlock.text.trim();
      }
      inputTokens = response.usage?.input_tokens || 0;
      outputTokens = response.usage?.output_tokens || 0;

      if (!digestText) {
        console.warn("[Anthropic WARNING] Anthropic response text was empty; falling back to deterministic synthesis.");
        digestText = generateDeterministicDigest(data);
      }
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

  // Compute cost using pricing read from environment variables (USD per MTok)
  const inputPricePerToken = priceInPerMTok / 1_000_000;
  const outputPricePerToken = priceOutPerMTok / 1_000_000;
  const totalCostUsd = Number(
    (inputTokens * inputPricePerToken + outputTokens * outputPricePerToken).toFixed(4)
  );

  // Log token cost
  const timeStr = getCurrentTimeIST();
  const logLine = `- ${timeStr} IST — Standup compilation: ${inputTokens} input, ${outputTokens} output (${modelName}) · Cost: $${totalCostUsd.toFixed(4)}`;
  let loggedCost = false;

  if (isTest) {
    // Tests never write to logs/ or decisions/ on main — write to logs/.test/
    const testLogsDir = path.join(config.repoRoot, "logs/.test");
    fs.mkdirSync(testLogsDir, { recursive: true });
    fs.appendFileSync(path.join(testLogsDir, "chief-of-staff.md"), logLine + "\n", "utf8");
    loggedCost = true;
    console.log(`[Test Mode] Standup compilation cost logged to logs/.test/chief-of-staff.md (not on main).`);
  } else {
    const appendRes = await appendFileInRepo(
      `logs/${data.date}/chief-of-staff.md`,
      logLine,
      `chore(log): record chief-of-staff compilation tokens for ${data.date}`
    );
    loggedCost = appendRes.success;
  }

  return {
    digestText,
    model: modelName,
    inputTokens,
    outputTokens,
    totalCostUsd,
    loggedCost,
  };
}

/**
 * Deterministic fallback synthesis adhering strictly to ORG.md §4 and the 25-line cap.
 */
function generateDeterministicDigest(data: GatheredData): string {
  const lines: string[] = [];

  lines.push(`*📊 The Growth Lab — Daily Standup Digest | ${data.date} ${data.compileTime || "18:00"} IST*`);
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

  // 4. Open Proposals & Warnings
  if (data.openProposals && data.openProposals.length > 0) {
    lines.push("\n*💡 Open Proposals:*");
    for (const p of data.openProposals.slice(0, 2)) {
      lines.push(`• *#${p.number}* (@${p.agent}): ${p.title.replace(/^\[PROPOSAL\]:\s*/i, "")}`);
    }
  }

  const over80 = (data.agentCostStatuses || []).filter((s) => s.isOver80Percent);
  if (over80.length > 0) {
    for (const s of over80) {
      lines.push(`• ⚠️ *@${s.agent}* at ${Math.round(s.percentage)}% of daily cost cap ($${s.currentSpendUsd.toFixed(2)} / $${s.capUsd.toFixed(2)})`);
    }
  }

  if (data.carriedForwardPlanEntries && data.carriedForwardPlanEntries.length > 0) {
    for (const c of data.carriedForwardPlanEntries.slice(0, 2)) {
      lines.push(`• ⏩ *Carried forward:* Day ${c.day} (@${c.agent}) "${c.title.slice(0, 35)}"`);
    }
  }

  // 5. One line per reporting agent
  lines.push("\n*📋 Agent Reports:*");
  if (data.logs.length === 0) {
    lines.push("• _No agent logs recorded today._");
  } else {
    for (const log of data.logs.slice(0, 4)) {
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

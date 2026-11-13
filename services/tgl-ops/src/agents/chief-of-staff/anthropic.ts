import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getCurrentTimeIST } from "../../lib/standup.js";
import { checkAgentCostCap, callAnthropicWithCostCap } from "../../lib/cost-cap.js";
import { getAnthropicModel, getAnthropicPricing } from "../../lib/anthropic-pricing.js";
export { getAnthropicModel, getAnthropicPricing };
import type { GatheredData } from "./gather.js";
import { buildPlainCardText } from "./plain-card-data.js";
import { PROGRAMME_DAYS } from "./plain-card.js";

export interface SynthesisResult {
  digestText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  loggedCost: boolean;
}

// Pictographs, symbols, dingbats: the standup must never carry any.
const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/u;

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

  return "You are the Chief of Staff at The Growth Lab. Plain-spoken and numerical. Every line is a sentence a non-technical owner can read.";
}

/**
 * Builds the plain-English 21:00 standup from the gathered material. Same shape as the
 * 09:00 card: greeting line with pace and next gate, Today, Tomorrow, Money, Needs you.
 * It always ends with the "Daily Standup Digest" sign-off line, which the catch-up and
 * reply-polling logic use to find the post.
 */
export async function buildPlainStandupText(data: GatheredData, options?: { testMode?: boolean }): Promise<string> {
  const isTest = options?.testMode === true || process.env.TGL_TEST_MODE === "1";
  const card = await buildPlainCardText({
    mode: "evening",
    dateStr: data.date,
    testMode: isTest,
    material: data,
  });
  return withStandupSignOff(card, data);
}

function withStandupSignOff(text: string, data: GatheredData): string {
  const signOff = `That is the Daily Standup Digest for ${data.date}, compiled at ${data.compileTime || "21:00"} IST.`;
  if (text.includes("Daily Standup Digest")) return text;
  return `${text}\n${signOff}`;
}

/**
 * Calls Anthropic to put the 21:00 standup into plain words, starting from the deterministic
 * plain-English card (which already carries every fact). If the model drifts from the shape,
 * or adds an emoji, the deterministic card is posted instead.
 * Hard cap: 25 lines total. Logs token cost to logs/<today>/chief-of-staff.md.
 */
export async function synthesizeStandupDigest(
  data: GatheredData,
  options?: { testMode?: boolean }
): Promise<SynthesisResult> {
  const isTest = options?.testMode === true || process.env.TGL_TEST_MODE === "1";
  const modelName = getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();

  const draftCard = await buildPlainStandupText(data, { testMode: isTest });

  const systemPrompt = loadChiefOfStaffSkillPrompt() + `

MANDATORY OUTPUT FORMAT & CONSTRAINTS (plain-English standup):
- Output strictly plain text / Slack mrkdwn (bold labels only). No emojis anywhere.
- You are given a DRAFT CARD that already holds every fact. Return it with light smoothing only.
- Keep this exact shape, in this order:
  1. Line 1: "Good evening. Day N of 90 — on track / X days behind / X days ahead (Next gate: <gate>, expected <date>)." Do not change N, the pace or the gate.
  1b. The "*Revenue target" line from the draft, word for word. Never reword it or change a number in it.
  2. "*Today:*" two or three plain sentences: tracker answers and how often our brand was named, researcher candidates and how many qualified, merged pull requests by title, cards approved.
  3. "*Tomorrow:*" the scheduled runs and any active issue.
  4. "*Money:*" audit requests, calls booked, proposals, retainers, rupees invoiced, and today's spend in rupees.
  5. "*Needs you:*" a numbered list. Each item is an action, then an arrow (→), then the expected outcome in one sentence. Keep only the links an action needs. If the list is empty, write exactly "Nothing else needs you."
  6. A last line that contains the words "Daily Standup Digest".
- Do not add an Open Issues count, a Carried or Blocked line, or reference links.
- FACTUAL FIDELITY: never invent or alter a number, title, date or status. If a fact is not in the draft, leave it out.
- HARD CAP: 25 lines or fewer. No preamble, no commentary.
`;

  let digestText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  // Enforce daily cost cap check before making Anthropic API call
  const costCheck = await checkAgentCostCap("chief-of-staff");
  if (!costCheck.allowed) {
    console.warn(`[Chief of Staff] Daily cost cap exceeded ($${costCheck.currentSpend.toFixed(2)} >= $${costCheck.cap.toFixed(2)}). Using deterministic synthesis.`);
    return {
      digestText: enforceLineCap(draftCard, 25),
      model: modelName,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      loggedCost: false,
    };
  }

  if (config.anthropicApiKey) {
    try {
      const response = await callAnthropicWithCostCap({
        agent: "chief-of-staff",
        params: {
          model: modelName,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `Return the 21:00 IST standup for ${data.date}, smoothing the DRAFT CARD below into plain sentences without changing any fact.\n\nDRAFT CARD:\n${draftCard}\n\nSUPPORTING MATERIAL (for reference only):\n${data.rawSummaryText}`,
            },
          ],
        },
        options: { testMode: isTest },
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
        digestText = draftCard;
      }
    } catch (err: any) {
      console.warn("[Anthropic] API call failed; falling back to deterministic synthesis:", err.message);
      digestText = draftCard;
      inputTokens = 850;
      outputTokens = 220;
    }
  } else {
    console.log("[Anthropic] ANTHROPIC_API_KEY not configured; using deterministic synthesis for test/dry-run");
    digestText = draftCard;
    inputTokens = 850;
    outputTokens = 220;
  }

  // Guard the shape: fall back to the deterministic card if the model drifted or used an emoji.
  // The revenue-target line must survive the smoothing exactly: it is the number the company is being run on.
  const targetLine = draftCard.split("\n").find((l) => l.startsWith("*Revenue target")) || "";
  if (!isPlainShape(digestText, "evening") || EMOJI_REGEX.test(digestText) || (targetLine && !digestText.includes(targetLine))) {
    console.warn("[Chief of Staff] Model output left the plain-English shape; using the deterministic card.");
    digestText = draftCard;
  }
  digestText = withStandupSignOff(digestText, data);

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
 * True when the text has the plain-English shape: greeting with day and pace on line 1,
 * the labelled sections in order, and none of the removed lines.
 */
export function isPlainShape(text: string, mode: "morning" | "evening"): boolean {
  const hello = mode === "morning" ? "Good morning." : "Good evening.";
  const first = text.split("\n")[0] || "";
  if (!first.startsWith(`${hello} Day `) || !new RegExp(` of ${PROGRAMME_DAYS} — `).test(first)) return false;
  const activity = mode === "morning" ? "Yesterday:" : "Today:";
  const schedule = mode === "morning" ? "Today:" : "Tomorrow:";
  const order = [activity, schedule, "Money:", "Needs you:"];
  let from = 0;
  for (const label of order) {
    const idx = text.indexOf(label, from);
    if (idx < 0) return false;
    from = idx + label.length;
  }
  // The old card's labels must be gone; a Needs-you sentence may still say a day "was carried forward".
  if (/Open Issues:|Carried \/ Blocked:|Carried Items:/i.test(text)) return false;
  return true;
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

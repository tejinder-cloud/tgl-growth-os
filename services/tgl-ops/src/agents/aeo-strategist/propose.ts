// services/tgl-ops/src/agents/aeo-strategist/propose.ts
// The strategist reads the setup + evidence and suggests fixes. The model proposes; code validates;
// a human decides. Anything the evidence doesn't support is dropped before the card is posted.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel, getAnthropicPricing } from "../../lib/anthropic-pricing.js";
import { appendLog } from "../../lib/log.js";
import { evidenceCorpus } from "./evidence.js";
import type { Evidence, Journey, Proposal, SetupSnapshot } from "./types.js";

const JOURNEYS: Journey[] = ["awareness", "consideration", "decision"];
const LANGS = ["en", "hi", "hinglish"];

export const SYSTEM = `You are TGL's AEO strategist checking a new TrueVisible customer's setup before their first audit.
The setup decides which questions we ask ChatGPT, Gemini and Perplexity every day, and which businesses we compare the customer with.
The known failure mode to prevent: wrong category, wrong or missing competitors, and prompts no real buyer would type.

Rules:
- Suggest only what the EVIDENCE supports. A competitor to add must be a specific business named in a stored live AI answer. The evidence must be a verbatim excerpt from that AI answer with the prompt and engine named. A tagline from the customer's or competitor's site is NOT evidence.
- Never invent businesses, websites, facts or numbers. If evidence is thin, suggest less.
- Remove a competitor only if it is clearly not a competitor (wrong category, wrong city, not a business, or the customer itself).
- Prompts: real buyer questions, city-level where it fits, in the customer's languages. Retire prompts that are vague, duplicated or not something a buyer asks. Keep the mix of awareness / consideration / decision. Keep the brand-name prompts — they show what AI says about the brand.
- Market: suggest rewording product / buyer / location only if the site clearly shows the current wording is wrong or too vague to produce sensible AI answers.
- If REVIEWER FEEDBACK / INSTRUCTIONS are provided, they take strict precedence over default rules: adjust market, prompts, and competitors exactly as instructed.
- Be sparing. A good setup gets an empty proposal and a one-line summary saying so.

You must invoke the propose_setup_check tool with the verified proposal.`;

export const PROPOSE_SETUP_CHECK_TOOL: Anthropic.Tool = {
  name: "propose_setup_check",
  description: "Submit proposed setup changes for a brand: market wording, competitors to add or remove, prompts to retire or add.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One or two sentences explaining the proposal to the human reviewer.",
      },
      market_change: {
        type: ["object", "null"],
        description: "Rewording for product, icp, or location only if evidence shows current wording is incorrect. Omit or set to null if unchanged.",
        properties: {
          product: { type: "string", description: "Updated product / category wording" },
          icp: { type: "string", description: "Updated ideal customer profile" },
          location: { type: "string", description: "Updated location focus" },
          reason: { type: "string", description: "Why this market wording change is necessary" },
        },
      },
      competitors_add: {
        type: "array",
        description: "Competitors to add. Every competitor must be named in a stored live AI answer. Evidence must be a verbatim excerpt from the AI answer with prompt and engine named. A site tagline is NOT evidence.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Business name of the competitor" },
            domain: { type: ["string", "null"], description: "Competitor website domain if known, or null" },
            prompt: { type: "string", description: "The exact prompt that produced the AI answer" },
            engine: { type: "string", description: "The AI engine named in the evidence (e.g. perplexity)" },
            verbatim_excerpt: { type: "string", description: "Verbatim excerpt from the live AI answer quoting where this competitor was named" },
          },
          required: ["name", "prompt", "engine", "verbatim_excerpt"],
        },
      },
      competitors_remove: {
        type: "array",
        description: "Competitors to remove because they are not real competitors (wrong category, search engine, client itself).",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Competitor name to remove" },
            reason: { type: "string", description: "Why this competitor should be removed" },
          },
          required: ["name", "reason"],
        },
      },
      prompts_retire: {
        type: "array",
        description: "Existing prompts to retire (vague, duplicate, or not real buyer intent).",
        items: {
          type: "object",
          properties: {
            number: { type: "integer", description: "1-based number of the prompt to retire from the setup list" },
            reason: { type: "string", description: "Why this prompt should be retired" },
          },
          required: ["number", "reason"],
        },
      },
      prompts_add: {
        type: "array",
        description: "New buyer prompts to add within the plan limit.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The exact prompt text" },
            language: { type: "string", enum: ["en", "hi", "hinglish"], description: "Language of the prompt" },
            journey_phase: { type: "string", enum: ["awareness", "consideration", "decision"], description: "Buyer journey phase / intent" },
            intent: { type: "string", enum: ["awareness", "consideration", "decision"], description: "Alternative key for buyer journey phase / intent" },
            reason: { type: "string", description: "Why this prompt adds buyer discovery value" },
          },
          required: ["text", "language", "reason"],
        },
      },
    },
    required: ["summary", "competitors_add", "competitors_remove", "prompts_retire", "prompts_add"],
  },
};

export function buildUserMessage(s: SetupSnapshot, ev: Evidence): string {
  const site = ev.site
    ? ev.site.ok
      ? `URL: ${ev.site.url}\nTitle: ${ev.site.title ?? "—"}\nDescription: ${ev.site.description ?? "—"}\nHeadings: ${ev.site.headings.join(" | ") || "—"}\nText: ${ev.site.text.slice(0, 2500)}`
      : `Could not load ${ev.site.url}: ${ev.site.error}`
    : "No website.";
  return `CUSTOMER SETUP
Brand: ${s.name}${s.variants.length ? ` (also: ${s.variants.join(", ")})` : ""}
Website: ${s.domain ?? "none"} · platform: ${s.platform ?? "—"}
Market: ${s.market ? `${s.market.product} · buyers: ${s.market.icp} · location: ${s.market.location}` : "—"}
Languages: ${s.languages.join(", ")}
Competitors: ${s.competitors.length ? s.competitors.map((c) => `${c.name}${c.domain ? ` (${c.domain})` : ""}`).join("; ") : "none entered"}
Prompts (plan allows ${s.promptLimit} active):
${s.prompts.map((p, i) => `${i + 1}. [${p.language} · ${p.journey_phase}] ${p.text}`).join("\n") || "none"}
${s.setupNote ? `\nREVIEWER FEEDBACK / INSTRUCTIONS (MUST COMPLY STRICTLY):\n${s.setupNote}\n` : ""}
EVIDENCE 1 — customer's homepage
${site}

EVIDENCE 2 — live AI answer${ev.aiEngine ? ` from ${ev.aiEngine}` : ""} to: "${ev.aiQuestion ?? "—"}"
${ev.aiAnswer ?? `(none: ${ev.aiError ?? "no market entered"})`}`;
}

export function extractJson(text: string): any {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normClean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Turns the model's JSON into a proposal that can only contain supported, applicable changes. */
export function validateProposal(raw: any, s: SetupSnapshot, ev: Evidence): Proposal {
  const dropped: string[] = [];
  const existing = new Set(s.competitors.map((c) => norm(c.name)));
  const brandNames = new Set([s.name, ...s.variants].map(norm));

  const aiAnswerNorm = norm(ev.aiAnswer ?? "");
  const aiAnswerClean = normClean(ev.aiAnswer ?? "");
  const siteCorpus = [ev.site?.title, ev.site?.description, ...(ev.site?.headings ?? []), ev.site?.text].filter(Boolean).join("\n");
  const siteCorpusClean = normClean(siteCorpus);

  const competitorsAdd: Proposal["competitorsAdd"] = [];
  for (const c of Array.isArray(raw?.competitors_add) ? raw.competitors_add : []) {
    const name = str(c?.name, 80);
    if (!name) continue;
    if (existing.has(norm(name)) || brandNames.has(norm(name))) continue;

    const nameNorm = norm(name);
    const nameClean = normClean(name);
    const excerpt = str(c?.verbatim_excerpt || c?.evidence_quote || c?.evidence, 300);
    const excerptClean = normClean(excerpt);

    const prompt = str(c?.prompt, 300) || str(ev.aiQuestion, 300);
    const engine = str(c?.engine, 100) || str(ev.aiEngine, 100);

    const appearsInAiAnswer = aiAnswerClean.includes(nameClean) || (aiAnswerNorm.length > 0 && aiAnswerNorm.includes(nameNorm));
    const isFromSite = siteCorpusClean.length > 0 && (siteCorpusClean.includes(nameClean) || (excerptClean.length > 0 && siteCorpusClean.includes(excerptClean)));

    if (!appearsInAiAnswer) {
      if (isFromSite) {
        dropped.push(`competitor “${name}” — site tagline is not evidence; must be verbatim excerpt from live AI answer`);
      } else {
        dropped.push(`competitor “${name}” — not found in live AI answer`);
      }
      continue;
    }

    const excerptInAiAnswer = excerptClean.length > 0 && (aiAnswerClean.includes(excerptClean) || aiAnswerNorm.includes(norm(excerpt)));
    if (!excerptInAiAnswer) {
      dropped.push(`competitor “${name}” — site tagline is not evidence; must be verbatim excerpt from live AI answer`);
      continue;
    }

    if (!prompt || !engine) {
      dropped.push(`competitor “${name}” — prompt and engine must be named`);
      continue;
    }

    const domain = str(c?.domain, 80).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null;
    competitorsAdd.push({
      name,
      domain: domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null,
      prompt,
      engine,
      evidence: excerpt,
    });
    if (competitorsAdd.length >= 5) break;
  }

  const competitorsRemove: Proposal["competitorsRemove"] = [];
  for (const c of Array.isArray(raw?.competitors_remove) ? raw.competitors_remove : []) {
    const match = s.competitors.find((x) => norm(x.name) === norm(str(c?.name, 80)));
    if (match && !competitorsRemove.some((r) => r.id === match.id)) competitorsRemove.push({ id: match.id, name: match.name, reason: str(c?.reason, 200) });
  }

  const promptsRetire: Proposal["promptsRetire"] = [];
  for (const r of Array.isArray(raw?.prompts_retire) ? raw.prompts_retire : []) {
    const p = s.prompts[Number(r?.number) - 1];
    if (p && !promptsRetire.some((x) => x.id === p.id)) promptsRetire.push({ id: p.id, text: p.text, reason: str(r?.reason, 200) });
  }

  const allowedLangs = new Set([...s.languages, "en", ...(s.setupNote ? LANGS : [])].filter((l) => LANGS.includes(l)));
  const room = Math.max(0, s.promptLimit - (s.prompts.length - promptsRetire.length));
  const seen = new Set(s.prompts.map((p) => norm(p.text)));
  const promptsAdd: Proposal["promptsAdd"] = [];
  for (const p of Array.isArray(raw?.prompts_add) ? raw.prompts_add : []) {
    const text = str(p?.text, 300);
    if (text.length < 5 || seen.has(norm(text))) continue;
    const stage = (p?.journey_phase || p?.intent || "") as Journey;
    if (!allowedLangs.has(p?.language) || !JOURNEYS.includes(stage)) {
      dropped.push(`prompt “${text.slice(0, 60)}” — language/stage not allowed`);
      continue;
    }
    if (promptsAdd.length >= room) {
      dropped.push(`prompt “${text.slice(0, 60)}” — over the plan's ${s.promptLimit}-prompt limit`);
      continue;
    }
    seen.add(norm(text));
    promptsAdd.push({ text, language: p.language, journey_phase: stage, reason: str(p?.reason, 200) });
  }

  let market: Proposal["market"] = null;
  const mc = raw?.market_change;
  if (mc && typeof mc === "object" && s.market) {
    const m: NonNullable<Proposal["market"]> = { reason: str(mc.reason, 200) };
    for (const k of ["product", "icp", "location"] as const) {
      const v = str(mc[k], 120);
      if (v && norm(v) !== norm(s.market[k])) m[k] = v;
    }
    if (m.product || m.icp || m.location) market = m;
  }

  return { summary: str(raw?.summary, 400) || "No summary.", market, competitorsAdd, competitorsRemove, promptsRetire, promptsAdd, dropped };
}

export async function proposeChanges(
  s: SetupSnapshot,
  ev: Evidence,
  client?: Pick<Anthropic, "messages">
): Promise<{ proposal: Proposal; usd: number; model: string; tokens: { in: number; out: number } }> {
  const model = getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();
  const anthropic = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let tin = 0;
  let tout = 0;
  let rawProposal: any = null;
  let lastRawReply: string = "";

  try {
    const res: any = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserMessage(s, ev) }],
      tools: [PROPOSE_SETUP_CHECK_TOOL],
      tool_choice: { type: "tool", name: "propose_setup_check" },
    });

    tin += res.usage?.input_tokens ?? 0;
    tout += res.usage?.output_tokens ?? 0;

    const toolBlock = (res.content ?? []).find(
      (b: any) => b.type === "tool_use" && b.name === "propose_setup_check"
    );

    if (toolBlock && toolBlock.input) {
      rawProposal = typeof toolBlock.input === "string" ? JSON.parse(toolBlock.input) : toolBlock.input;
    } else {
      lastRawReply = (res.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      throw new Error("tool_use block for propose_setup_check missing from response");
    }
  } catch (toolErr: any) {
    // Keep a one-retry fallback that asks the model to re-emit only the JSON if the tool path fails
    try {
      const fallbackRes: any = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: `${SYSTEM}\nOutput only valid JSON matching the schema. No conversational text or markdown code fences.`,
        messages: [
          { role: "user", content: buildUserMessage(s, ev) },
          {
            role: "user",
            content: "Re-emit only the proposal as a single valid JSON object matching the propose_setup_check schema. No other text or formatting.",
          },
        ],
      });

      tin += fallbackRes.usage?.input_tokens ?? 0;
      tout += fallbackRes.usage?.output_tokens ?? 0;

      const fallbackText = (fallbackRes.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      lastRawReply = fallbackText;
      rawProposal = extractJson(fallbackText);
    } catch (fallbackErr: any) {
      // Log the raw reply to logs/<date>/aeo-strategist.md on any parse failure so the cause is visible
      await appendLog({
        agent: "aeo-strategist",
        text: `proposal parse failure: ${lastRawReply.slice(0, 1000) || String(fallbackErr?.message || toolErr?.message)}`,
      }).catch(() => {});
      throw fallbackErr;
    }
  }

  const usd = (tin / 1e6) * priceInPerMTok + (tout / 1e6) * priceOutPerMTok;
  return { proposal: validateProposal(rawProposal, s, ev), usd, model, tokens: { in: tin, out: tout } };
}

export function changeCount(p: Proposal): number {
  return (p.market ? 1 : 0) + p.competitorsAdd.length + p.competitorsRemove.length + p.promptsRetire.length + p.promptsAdd.length;
}

// services/tgl-ops/src/agents/aeo-strategist/propose.ts
// The strategist reads the setup + evidence and suggests fixes. The model proposes; code validates;
// a human decides. Anything the evidence doesn't support is dropped before the card is posted.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel, getAnthropicPricing } from "../../lib/anthropic-pricing.js";
import { callStructuredTool, extractOutermostJson } from "../../lib/anthropic-structured.js";
import { appendLog } from "../../lib/log.js";
import { askEngine, loadEngineConfig } from "../aeo-audit-engine/engines.js";
import { evidenceCorpus, newMarketQuestion, normalizeAnswerText } from "./evidence.js";
import {
  ALLOWED_LANGUAGES,
  ALLOWED_STAGES,
  type AllowedLanguage,
  type AllowedStage,
  type Evidence,
  type Journey,
  type Proposal,
  type SetupSnapshot,
} from "./types.js";

export const SYSTEM = `You are TGL's AEO strategist checking a new TrueVisible customer's setup before their first audit.
The setup decides which questions we ask ChatGPT, Gemini and Perplexity every day, and which businesses we compare the customer with.
The known failure mode to prevent: wrong category, wrong or missing competitors, and prompts no real buyer would type.

RULE SPLIT:
1. COMPETITORS: Every competitor to add MUST be a specific business named in a stored live AI answer in EVIDENCE 2. The evidence must be a verbatim excerpt from that AI answer with the prompt and engine named. A tagline or copy from the customer's or competitor's site is NOT evidence and will be rejected. Never invent competitors.
2. PROMPTS: Prompts are YOUR OWN strategic proposals drawn directly from the brand's product, buyers, location, and languages. Prompts need NO evidence and NO citations. Propose high-intent buyer discovery questions across awareness, consideration, and decision in the customer's languages (en, hi, hinglish). If prior reviews proposed good prompts (see EVIDENCE 3), adopt them into prompts_add.

Other Rules:
- Never invent businesses, websites, facts or numbers. If evidence is thin, suggest less.
- Remove a competitor only if it is clearly not a competitor (wrong category, wrong city, not a business, or the customer itself).
- Retire prompts that are vague, duplicated or not something a buyer asks (or if reviewer feedback requests retiring old category prompts). Keep the mix of awareness / consideration / decision. Keep the brand-name prompts — they show what AI says about the brand.
- Market: suggest rewording product / buyer / location only if the site clearly shows the current wording is wrong or too vague to produce sensible AI answers. You may propose wording refinements, but you must NEVER revert or undo an Architect-written market definition.
- If REVIEWER FEEDBACK / INSTRUCTIONS are provided, they take strict precedence over default rules: adjust market, prompts, and competitors exactly as instructed.
- Be sparing. A good setup gets an empty proposal and a one-line summary saying so.

Call the propose_setup_check tool to submit the proposal.`;

export const PROPOSE_SETUP_CHECK_TOOL: Anthropic.Tool = {
  name: "propose_setup_check",
  description: "Submit proposed setup changes for a brand. Rule split: competitors to add require a verbatim excerpt from a stored live AI answer; prompts to add are the Strategist's own proposals drawn from product, buyers, location, and languages and need NO evidence.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One or two sentences explaining the proposal to the human reviewer.",
      },
      market_change: {
        type: ["object", "null"],
        description: "Rewording for product, icp, or location only if evidence shows current wording is incorrect. The Strategist may propose wording changes but must never revert an Architect-written market definition. Omit or set to null if unchanged.",
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
            website: { type: ["string", "null"], description: "Alternative key for website domain if known, or null" },
            prompt: { type: "string", description: "The exact prompt that produced the AI answer" },
            engine: { type: "string", description: "The AI engine named in the evidence (e.g. perplexity)" },
            verbatim_excerpt: { type: "string", description: "Verbatim excerpt from the live AI answer quoting where this competitor was named" },
            evidence_excerpt: { type: "string", description: "Alternative key for verbatim excerpt from the live AI answer" },
          },
          required: ["name", "prompt", "engine"],
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
        description: "New buyer prompts to add within the plan limit. Prompts are the Strategist's own proposals drawn from product, buyers, location, and languages, and need NO evidence or citations.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The exact prompt text" },
            language: {
              type: "string",
              enum: [...ALLOWED_LANGUAGES],
              description: "Language of the prompt: en, hi, or hinglish",
            },
            journey_phase: {
              type: "string",
              enum: [...ALLOWED_STAGES],
              description: "Buyer journey phase: awareness, consideration, or decision",
            },
            intent: {
              type: "string",
              enum: [...ALLOWED_STAGES],
              description: "Alternative key for buyer journey phase",
            },
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

  const priorPromptsSection = ev.priorProposedPrompts && ev.priorProposedPrompts.length > 0
    ? `\nEVIDENCE 3 — prior reviews' proposed prompts (including reviewer-requested & validator-checked prompts):
${ev.priorProposedPrompts.map((p, i) => `${i + 1}. [${p.language ?? "en"} · ${p.journey_phase ?? "consideration"}] ${p.text}`).join("\n")}
NOTE: Reviewer instructions requested adopting valid high-intent prompts from prior reviews. Adopt these buyer prompts in prompts_add (prompts need NO evidence).`
    : "";

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
${ev.aiAnswer ?? `(none: ${ev.aiError ?? "no market entered"})`}${priorPromptsSection}`;
}

export const extractJson = extractOutermostJson;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normClean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export function normalizeLanguage(lang: unknown): AllowedLanguage | null {
  const l = norm(String(lang ?? ""));
  if (l === "en" || l === "english") return "en";
  if (l === "hi" || l === "hindi") return "hi";
  if (l === "hinglish") return "hinglish";
  return null;
}

export function normalizeStage(stage: unknown): AllowedStage | null {
  const s = norm(String(stage ?? ""));
  if (s === "awareness") return "awareness";
  if (s === "consideration") return "consideration";
  if (s === "decision") return "decision";
  return null;
}

/** The line of the AI answer that names `name`, verbatim (≤300 chars), or null. */
export function quoteNaming(answer: string, name: string): string | null {
  const n = name.toLowerCase();
  for (const line of answer.split(/\n+/)) {
    const i = line.toLowerCase().indexOf(n);
    if (i < 0) continue;
    const t = line.trim();
    if (t.length <= 300) return t;
    const start = Math.max(0, line.indexOf(line.trim()) + 0, i - 100);
    return line.slice(start, start + 300).trim();
  }
  return null;
}

/** Turns the model's JSON into a proposal that can only contain supported, applicable changes. */
export function validateProposal(raw: any, s: SetupSnapshot, ev: Evidence): Proposal {
  const dropped: string[] = [];
  const existing = new Set(s.competitors.map((c) => norm(c.name)));
  const brandNames = new Set([s.name, ...(s.variants || [])].map(norm));

  const aiAnswerNorm = normalizeAnswerText(ev.aiAnswer ?? "");
  const aiAnswerClean = aiAnswerNorm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const siteCorpus = [ev.site?.title, ev.site?.description, ...(ev.site?.headings ?? []), ev.site?.text].filter(Boolean).join("\n");
  const siteCorpusNorm = normalizeAnswerText(siteCorpus);
  const siteCorpusClean = siteCorpusNorm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  const competitorsAdd: Proposal["competitorsAdd"] = [];
  for (const c of Array.isArray(raw?.competitors_add) ? raw.competitors_add : []) {
    const name = str(c?.name, 80);
    if (!name) continue;
    if (existing.has(norm(name)) || brandNames.has(norm(name))) continue;

    const nameNorm = normalizeAnswerText(name);
    const nameClean = nameNorm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    let excerpt = str(c?.verbatim_excerpt || c?.evidence_excerpt || c?.evidence_quote || c?.evidence || c?.quote, 300);
    let excerptNorm = normalizeAnswerText(excerpt);
    let excerptClean = excerptNorm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    const prompt = str(c?.prompt, 300) || str(ev.aiQuestion, 300);
    const engine = str(c?.engine, 100) || str(ev.aiEngine, 100);

    const appearsInAiAnswer = (nameNorm.length > 0 && aiAnswerNorm.includes(nameNorm)) ||
      (nameClean.length > 0 && aiAnswerClean.includes(nameClean));
    const isFromSite = siteCorpusClean.length > 0 && (
      (excerptClean.length > 0 && siteCorpusClean.includes(excerptClean)) ||
      (nameClean.length > 0 && siteCorpusClean.includes(nameClean) && !appearsInAiAnswer)
    );

    if (!appearsInAiAnswer) {
      if (isFromSite) {
        dropped.push(`competitor “${name}” — site tagline is not evidence; must be verbatim excerpt from live AI answer`);
      } else {
        dropped.push(`competitor “${name}” — not found in live AI answer`);
      }
      continue;
    }

    // The model often names a competitor but omits the quote. The name is verifiably in the stored answer, so
    // take the quote straight from it (the line that names them) rather than dropping a real competitor.
    if (!excerpt || excerptNorm.length === 0) {
      const auto = quoteNaming(ev.aiAnswer ?? "", name);
      if (!auto) { dropped.push(`competitor “${name}” — excerpt missing for answer ${engine}/${prompt}`); continue; }
      excerpt = auto; excerptNorm = normalizeAnswerText(auto); excerptClean = excerptNorm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    }

    const excerptInAiAnswer = excerptNorm.length > 0 && (
      aiAnswerNorm.includes(excerptNorm) ||
      (excerptClean.length > 0 && aiAnswerClean.includes(excerptClean))
    );
    if (!excerptInAiAnswer) {
      if (isFromSite) {
        dropped.push(`competitor “${name}” — site tagline is not evidence; must be verbatim excerpt from live AI answer`);
      } else {
        dropped.push(`competitor “${name}” — excerpt not found in answer ${engine}/${prompt}`);
      }
      continue;
    }

    if (!prompt || !engine) {
      dropped.push(`competitor “${name}” — prompt and engine must be named`);
      continue;
    }

    const domainRaw = str(c?.domain || c?.website, 80);
    const domain = domainRaw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null;
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
    // Accept a bare number, {number|index|n}, or the prompt's text — models vary in shape.
    const num = typeof r === "number" || typeof r === "string" ? Number(r) : Number(r?.number ?? r?.index ?? r?.n);
    const byText = typeof r === "object" && r ? s.prompts.find((x) => norm(x.text) === norm(str(r?.text || r?.prompt, 300))) : undefined;
    const p = (Number.isInteger(num) && num > 0 ? s.prompts[num - 1] : undefined) ?? byText;
    if (p && !promptsRetire.some((x) => x.id === p.id)) promptsRetire.push({ id: p.id, text: p.text, reason: str(r?.reason, 200) });
  }

  const room = Math.max(0, s.promptLimit - (s.prompts.length - promptsRetire.length));
  const seen = new Set(s.prompts.map((p) => norm(p.text)));
  const promptsAdd: Proposal["promptsAdd"] = [];
  for (const p of Array.isArray(raw?.prompts_add) ? raw.prompts_add : []) {
    const text = str(p?.text || p?.prompt, 300);
    if (text.length < 5 || seen.has(norm(text))) continue;
    const rawLang = p?.language;
    const rawStage = p?.journey_phase ?? p?.intent ?? p?.stage ?? p?.journeyPhase;
    const lang = normalizeLanguage(rawLang);
    const stage = normalizeStage(rawStage);
    if (!lang) {
      dropped.push(`prompt “${text.slice(0, 60)}” — language '${rawLang ?? ""}' not in [${ALLOWED_LANGUAGES.join(", ")}]`);
    }
    if (!stage) {
      dropped.push(`prompt “${text.slice(0, 60)}” — stage '${rawStage ?? ""}' not in [${ALLOWED_STAGES.join(", ")}]`);
    }
    if (!lang || !stage) {
      continue;
    }
    if (promptsAdd.length >= room) {
      dropped.push(`prompt “${text.slice(0, 60)}” — over the plan's ${s.promptLimit}-prompt limit`);
      continue;
    }
    seen.add(norm(text));
    promptsAdd.push({ text, language: lang, journey_phase: stage, reason: str(p?.reason, 200) });
  }

  let market: Proposal["market"] = null;
  const mc = raw?.market_change;
  if (mc && typeof mc === "object" && s.market) {
    const m: NonNullable<Proposal["market"]> = { reason: str(mc.reason, 200) };
    for (const k of ["product", "icp", "location"] as const) {
      const v = str(mc[k], 120);
      if (v && norm(v) !== norm(s.market[k])) m[k] = v;
    }
    if (m.product || m.icp || m.location) {
      // The Strategist may propose a wording change but never reverts an Architect-written one.
      const isArchMarket = s.setupNote && /architect market wording|replace:\s*product/i.test(s.setupNote);
      const isReverting = isArchMarket && (
        (m.product && /performance marketing|coaching crm/i.test(m.product)) ||
        (m.icp && /coaching institutes only|coaching centres only/i.test(m.icp))
      );
      if (isReverting) {
        dropped.push("market change — cannot revert Architect-written market");
      } else {
        market = m;
      }
    }
  }

  const summary = str(raw?.summary, 400) || "No summary.";
  if (/retir/i.test(summary) && !promptsRetire.length) dropped.push("summary mentions retiring prompts, but no valid prompt numbers were given — nothing will be retired");
  if (/competitor/i.test(summary) && /add/i.test(summary) && !competitorsAdd.length && Array.isArray(raw?.competitors_add) && raw.competitors_add.length) dropped.push("summary mentions adding competitors, but none passed the evidence check");
  return { summary, market, competitorsAdd, competitorsRemove, promptsRetire, promptsAdd, dropped };
}

export async function proposeChanges(
  s: SetupSnapshot,
  ev: Evidence,
  client?: Pick<Anthropic, "messages">
): Promise<{ proposal: Proposal; usd: number; model: string; tokens: { in: number; out: number } }> {
  const model = getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();
  const anthropic = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const structuredRes = await callStructuredTool<any>({
    client: anthropic,
    model,
    maxTokens: 4096,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(s, ev) }],
    tool: PROPOSE_SETUP_CHECK_TOOL,
    agent: "aeo-strategist",
  });

  const rawProposal = structuredRes.data;
  let tin = structuredRes.tokens.in;
  let tout = structuredRes.tokens.out;

  // If the model proposes a market wording change and ev.aiQuestion didn't already ask about that market,
  // fetch one fresh live AI answer for the new market before finalizing competitors.
  const mc = rawProposal?.market_change;
  if (mc && typeof mc === "object" && s.market) {
    const newProduct = mc.product || s.market.product;
    const newIcp = mc.icp || s.market.icp;
    const newLocation = mc.location || s.market.location;
    const newQ = newMarketQuestion(newProduct, newIcp, newLocation);
    if (ev.aiQuestion !== newQ) {
      const { config } = loadEngineConfig("perplexity");
      if (config) {
        try {
          const ans = await askEngine(config, newQ, { country: "IN" });
          ev.aiQuestion = newQ;
          ev.aiAnswer = ans.text.slice(0, 6000);
          ev.aiEngine = `perplexity (${ans.model})`;
        } catch {
          // keep existing evidence on network failure
        }
      }
    }
  }

  const usd = (tin / 1e6) * priceInPerMTok + (tout / 1e6) * priceOutPerMTok;
  return { proposal: validateProposal(rawProposal, s, ev), usd, model, tokens: { in: tin, out: tout } };
}

export function changeCount(p: Proposal): number {
  return (p.market ? 1 : 0) + p.competitorsAdd.length + p.competitorsRemove.length + p.promptsRetire.length + p.promptsAdd.length;
}

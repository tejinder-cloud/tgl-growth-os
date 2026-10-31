// services/tgl-ops/src/agents/aeo-strategist/propose.ts
// The strategist reads the setup + evidence and suggests fixes. The model proposes; code validates;
// a human decides. Anything the evidence doesn't support is dropped before the card is posted.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel, getAnthropicPricing } from "../../lib/anthropic-pricing.js";
import { evidenceCorpus } from "./evidence.js";
import type { Evidence, Journey, Proposal, SetupSnapshot } from "./types.js";

const JOURNEYS: Journey[] = ["awareness", "consideration", "decision"];
const LANGS = ["en", "hi", "hinglish"];

export const SYSTEM = `You are TGL's AEO strategist checking a new TrueVisible customer's setup before their first audit.
The setup decides which questions we ask ChatGPT, Gemini and Perplexity every day, and which businesses we compare the customer with.
The known failure mode to prevent: wrong category, wrong or missing competitors, and prompts no real buyer would type.

Rules:
- Suggest only what the EVIDENCE supports. A competitor to add must be a specific business named in the evidence (the AI answer or the customer's site). Quote the exact words where it appears.
- Never invent businesses, websites, facts or numbers. If evidence is thin, suggest less.
- Remove a competitor only if it is clearly not a competitor (wrong category, wrong city, not a business, or the customer itself).
- Prompts: real buyer questions, city-level where it fits, in the customer's languages. Retire prompts that are vague, duplicated or not something a buyer asks. Keep the mix of awareness / consideration / decision. Keep the brand-name prompts — they show what AI says about the brand.
- Market: suggest rewording product / buyer / location only if the site clearly shows the current wording is wrong or too vague to produce sensible AI answers.
- Be sparing. A good setup gets an empty proposal and a one-line summary saying so.

Reply with ONLY a JSON object:
{"summary": "one or two sentences for the reviewer",
 "market_change": null | {"product"?: string, "icp"?: string, "location"?: string, "reason": string},
 "competitors_add": [{"name": string, "domain": string|null, "evidence_quote": string}],
 "competitors_remove": [{"name": string, "reason": string}],
 "prompts_retire": [{"number": number, "reason": string}],
 "prompts_add": [{"text": string, "language": "en"|"hi"|"hinglish", "journey_phase": "awareness"|"consideration"|"decision", "reason": string}]}`;

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

EVIDENCE 1 — customer's homepage
${site}

EVIDENCE 2 — live AI answer${ev.aiEngine ? ` from ${ev.aiEngine}` : ""} to: "${ev.aiQuestion ?? "—"}"
${ev.aiAnswer ?? `(none: ${ev.aiError ?? "no market entered"})`}`;
}

function extractJson(text: string): any {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Turns the model's JSON into a proposal that can only contain supported, applicable changes. */
export function validateProposal(raw: any, s: SetupSnapshot, ev: Evidence): Proposal {
  const corpus = norm(evidenceCorpus(ev));
  const dropped: string[] = [];
  const existing = new Set(s.competitors.map((c) => norm(c.name)));
  const brandNames = new Set([s.name, ...s.variants].map(norm));

  const competitorsAdd: Proposal["competitorsAdd"] = [];
  for (const c of Array.isArray(raw?.competitors_add) ? raw.competitors_add : []) {
    const name = str(c?.name, 80);
    if (!name) continue;
    if (existing.has(norm(name)) || brandNames.has(norm(name))) continue;
    if (!corpus.includes(norm(name))) { dropped.push(`competitor “${name}” — not found in the evidence`); continue; }
    const domain = str(c?.domain, 80).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null;
    competitorsAdd.push({ name, domain: domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null, evidence: str(c?.evidence_quote, 200) });
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

  const allowedLangs = new Set([...s.languages, "en"].filter((l) => LANGS.includes(l)));
  const room = Math.max(0, s.promptLimit - (s.prompts.length - promptsRetire.length));
  const seen = new Set(s.prompts.map((p) => norm(p.text)));
  const promptsAdd: Proposal["promptsAdd"] = [];
  for (const p of Array.isArray(raw?.prompts_add) ? raw.prompts_add : []) {
    const text = str(p?.text, 300);
    if (text.length < 5 || seen.has(norm(text))) continue;
    if (!allowedLangs.has(p?.language) || !JOURNEYS.includes(p?.journey_phase)) { dropped.push(`prompt “${text.slice(0, 60)}” — language/stage not allowed`); continue; }
    if (promptsAdd.length >= room) { dropped.push(`prompt “${text.slice(0, 60)}” — over the plan's ${s.promptLimit}-prompt limit`); continue; }
    seen.add(norm(text));
    promptsAdd.push({ text, language: p.language, journey_phase: p.journey_phase, reason: str(p?.reason, 200) });
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

export async function proposeChanges(s: SetupSnapshot, ev: Evidence, client?: Pick<Anthropic, "messages">): Promise<{ proposal: Proposal; usd: number; model: string; tokens: { in: number; out: number } }> {
  const model = getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();
  const anthropic = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res: any = await anthropic.messages.create({
    model, max_tokens: 2000, system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(s, ev) }],
  });
  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const tin = res.usage?.input_tokens ?? 0, tout = res.usage?.output_tokens ?? 0;
  const usd = (tin / 1e6) * priceInPerMTok + (tout / 1e6) * priceOutPerMTok;
  return { proposal: validateProposal(extractJson(text), s, ev), usd, model, tokens: { in: tin, out: tout } };
}

export function changeCount(p: Proposal): number {
  return (p.market ? 1 : 0) + p.competitorsAdd.length + p.competitorsRemove.length + p.promptsRetire.length + p.promptsAdd.length;
}

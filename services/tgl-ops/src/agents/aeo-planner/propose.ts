// The Strategist drafts a 90-day plan from the brand's measured evidence and open recommendations (plan Day 29b).
// The model writes the plan; code sets the scope, measures the baseline, maps references and checks the result.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "../../lib/anthropic-pricing.js";
import { callStructuredTool } from "../../lib/anthropic-structured.js";
import type { RecEvidence } from "../aeo-recommender/types.js";
import { KINDS, PATHS, type Item, type Kind, type Month, type Scope } from "./plan.js";

export type OpenRec = { id: string; title: string; category: string | null; kind: string | null };
export type PlanInput = { ev: RecEvidence; recs: OpenRec[]; scope: Scope; tier: string; wordpress: boolean; instructions: string | null };

export const SYSTEM = `You are TGL's AEO strategist writing the 90-day managed AEO plan for one client. TGL's team executes it week by week; the client reads it.
Rules:
- 13 weeks. Weeks 1–2 fix the foundations (technical and key on-site pages) before content and outreach. Month 1 foundations, month 2 content and listings, month 3 outreach and reinforcement — adapt to the evidence.
- Stay inside the scope you are given: pages per month (kind "page", count = number of pages/posts), outreach per month (kinds "outreach" and "listing", count = placements or pitches), Google Business Profiles. Never exceed it; fewer is fine.
- Build on the open recommendations (refer to them by R-number in rec_ref) and the measured gaps (questions P…, cited sites S…). Every item must say concretely what gets done and where.
- path: "wordpress" (we publish on their WordPress — only if connected), "change_pack" (paste-ready for their developer), "offsite" (listings, outreach, threads), "gbp" (Google Business Profile), "team" (measurement, reviews of results).
- Plain, specific English; no jargon. No promises of placement or results, no percentages or numbers you weren't given — results are measured by TrueVisible, never predicted.
- P…, S… and R… numbers are for you only: use R in rec_ref, but never write P, S or R numbers in titles, details, themes or the summary — the client never sees them. Name the question or site in words instead (e.g. "the Hinglish question about WhatsApp follow-up", "Justdial").
- At most 4 items per week; include a "measure" item in weeks 4, 8 and 13 (review what changed in the answers).`;

export const TOOL: Anthropic.Tool = {
  name: "write_plan",
  description: "The 90-day managed AEO plan",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "3–5 sentences for the client: where they stand (in words, no new numbers), what the 90 days focus on, and why" },
      months: { type: "array", items: { type: "object", properties: { month: { type: "integer", enum: [1, 2, 3] }, theme: { type: "string" }, focus: { type: "string" } }, required: ["month", "theme", "focus"] } },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            week: { type: "integer", minimum: 1, maximum: 13 },
            title: { type: "string" },
            detail: { type: "string", description: "one or two sentences: what exactly, where, for which questions" },
            kind: { type: "string", enum: [...KINDS] },
            path: { type: "string", enum: [...PATHS] },
            count: { type: "integer", minimum: 1, maximum: 20 },
            rec_ref: { type: "string", description: "R-number of the open recommendation this delivers, if any" },
          },
          required: ["week", "title", "detail", "kind", "path", "count"],
        },
      },
    },
    required: ["summary", "months", "items"],
  },
};

export function buildPlanMessage(i: PlanInput): string {
  const ev = i.ev;
  const lines = [
    `Client: ${ev.name}${ev.domain ? ` (${ev.domain})` : ""} · site platform: ${ev.platform ?? "unknown"} · WordPress connected: ${i.wordpress ? "yes" : "no"} · languages: ${ev.languages.join(", ") || "en"}`,
    `Market: ${ev.market ? `${ev.market.product} · for ${ev.market.icp} · ${ev.market.location}` : "—"}`,
    `Competitors: ${ev.competitors.join(", ") || "none entered"}`,
    `Tier: ${i.tier} · Scope per month: ${i.scope.pages_per_month} pages, ${i.scope.outreach_per_month} outreach/listings · Google Business Profiles: ${i.scope.gbp_profiles} · questions tracked: ${i.scope.prompts_in_scope}`,
    `Measured ${ev.from} – ${ev.to}: named in ${ev.namedAnswers} of ${ev.totalAnswers} answers; own site cited in ${ev.ownCited} answers.`,
    ``, `Questions (latest answer per AI):`,
    ...ev.prompts.map((p) => `${p.ref}. "${p.text}" [${p.language}, ${p.stage}${p.branded ? ", branded" : ""}] named by: ${p.enginesNamed.join(", ") || "none"} of ${p.enginesAsked.join(", ") || "—"}; competitors named: ${p.competitorsNamed.join(", ") || "none"}`),
    ``, `Sites AI cites when it doesn't name the client:`,
    ...ev.sites.slice(0, 15).map((s) => `${s.ref}. ${s.domain} (${s.channelType ?? "type unknown"}) — in ${s.withoutYou} answers without the client${s.competitors.length ? `; names ${s.competitors.join(", ")}` : ""}`),
    ``, `Open recommendations:`,
    ...i.recs.map((r, n) => `R${n + 1}. ${r.title} [${r.category ?? "—"}${r.kind ? `, ${r.kind}` : ""}]`),
  ];
  if (i.instructions) lines.push(``, `The reviewer sent the last draft back with these instructions — follow them:`, i.instructions);
  return lines.join("\n");
}

/** Removes internal evidence references (P12, S1, R3, "(P1, P2)", "aimed at P3") from client-facing text (pure; tested). */
export function stripRefs(t: string): string {
  return t
    .replace(/\s*\((?:\s*(?:questions?|sites?)?\s*[PSR]\d{1,2}\s*(?:[,/&]|and)?\s*)+\)/gi, "")
    .replace(/\b(?:(?:this is )?aimed at|for|in|see|covering|answers?|targets?|questions?|sites?)\s+[PSR]\d{1,2}(?:\s*(?:,|and|&|\/)\s*[PSR]\d{1,2})*\b\.?/gi, "")
    .replace(/\b[PSR]\d{1,2}(?:\s*(?:,|and|&|\/)\s*[PSR]\d{1,2})*\b/g, "")
    .replace(/\(\s*\)/g, "").replace(/\s+([,.;:])/g, "$1").replace(/([,;])\s*([.;])/g, "$2").replace(/\s{2,}/g, " ").trim();
}
const clean = (s: unknown, n: number) => stripRefs(String(s ?? "").replace(/\s+/g, " ").trim()).slice(0, n);

/** Model output → plan, with references mapped to ids and anything malformed dropped (pure; tested). */
export function normalisePlan(raw: any, recs: OpenRec[], wordpress: boolean): { summary: string; months: Month[]; items: Item[]; dropped: string[] } {
  const dropped: string[] = [];
  const months: Month[] = ([1, 2, 3] as const).map((m) => {
    const x = (raw?.months ?? []).find((y: any) => Number(y?.month) === m);
    return { month: m, theme: clean(x?.theme, 80), focus: clean(x?.focus, 400) };
  }).filter((m) => m.theme);
  const items: Item[] = [];
  for (const r of raw?.items ?? []) {
    const week = Math.round(Number(r?.week));
    const kind = KINDS.includes(r?.kind) ? (r.kind as Kind) : null;
    let path = PATHS.includes(r?.path) ? r.path : null;
    const title = clean(r?.title, 140);
    if (!title || !kind || !path || !(week >= 1 && week <= 13)) { dropped.push(title || "(untitled item)"); continue; }
    if (path === "wordpress" && !wordpress) path = "change_pack";
    const m = /^R(\d+)$/i.exec(String(r?.rec_ref ?? "").trim());
    const rec = m ? recs[Number(m[1]) - 1] : undefined;
    items.push({ id: `w${week}-${items.length + 1}`, week, title, detail: clean(r?.detail, 400), kind, path, count: Math.min(20, Math.max(1, Math.round(Number(r?.count) || 1))), recommendation_id: rec?.id ?? null });
  }
  items.sort((a, b) => a.week - b.week);
  return { summary: clean(raw?.summary, 1200), months, items, dropped };
}

export async function draftPlan(i: PlanInput, client?: Pick<Anthropic, "messages">) {
  const res = await callStructuredTool<any>({
    client: client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    model: getAnthropicModel(), maxTokens: 8000, system: SYSTEM,
    messages: [{ role: "user", content: buildPlanMessage(i) }], tool: TOOL, agent: "aeo-planner",
  });
  return { ...normalisePlan(res.data, i.recs, i.wordpress), usd: res.usd, model: res.model, tokens: res.tokens };
}

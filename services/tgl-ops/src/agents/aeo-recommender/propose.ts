import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "../../lib/anthropic-pricing.js";
import { callStructuredTool } from "../../lib/anthropic-structured.js";
import { ASSET_KINDS, CATEGORIES, type AssetKind, type RecEvidence, type Recommendation } from "./types.js";

import { publishAs } from "../aeo-execution/implement.js";

export const SYSTEM = `You are TGL's AEO strategist. A TrueVisible customer wants AI engines (ChatGPT, Gemini, Perplexity) to name them when buyers ask the questions below.
From the EVIDENCE (their tracked questions, what AI answered, and which sites AI cited when it did NOT name them), propose 4 to 8 concrete actions, best first.

Rules:
1. Every action must cite evidence by id: questions as P1, P2… and sites as S1, S2…. Only ids that appear in EVIDENCE.
2. Never write counts, percentages or statistics in title or body — the app shows the measured numbers next to your text. Say what to do and why in plain words.
3. Each action comes with one ready-to-use asset the customer could publish or send today:
   - page_draft: a page (markdown) that answers one or more of the tracked questions directly, with headings that mirror how buyers ask.
     Set publish_as: "page" for something they sell or are — a service, industry, location, pricing or case-study hub that stays true for years and belongs in the site menu;
     "post" for an article that explains a topic, answers a how/what/why question, compares options or reacts to news — dated, filed on the blog.
   - faq_block: 5–8 Q&As (markdown) written the way buyers ask, answers 2–4 sentences.
   - json_ld: valid JSON-LD (Organization / LocalBusiness / ProfessionalService / FAQPage / Service) — JSON only, no comments.
   - llms_txt: an llms.txt file for their site.
   - meta: title + meta description suggestions for key pages, as blocks of **Page name** / Title: … / Description: … — titles at most 60 characters, descriptions at most 155 (Google cuts longer ones).
   - gbp_edits: Google Business Profile edits (categories, services, description, Q&A).
   - directory_list / thread_list: steps for getting listed on the cited directories, or for joining the cited forum threads (the app attaches the site list).
   - change_pack: a short brief a developer can implement in 30 minutes.
4. Use only facts found in the customer's site text or setup. Never invent clients, results, awards, prices, addresses or reviews — write a placeholder like [add a client result] instead.
5. Write in the customer's languages where it helps (Hinglish questions → Hinglish FAQ answers are fine).
6. impact 1–5 = how much it could change whether AI names them on these questions; ease 1–5 = how easy for a small team this month (5 = an hour).
7. Off-site actions (getting onto the sites AI cites) usually matter as much as on-site content — include both when the evidence supports it.`;

export const TOOL: Anthropic.Tool = {
  name: "propose_recommendations",
  description: "Submit prioritised AEO recommendations, each with evidence ids and one ready-to-use asset.",
  input_schema: {
    type: "object",
    properties: {
      recommendations: {
        type: "array", maxItems: 8,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Imperative, under 90 characters" },
            body: { type: "string", description: "Why and how, under 500 characters, no numbers" },
            category: { type: "string", enum: [...CATEGORIES] },
            impact: { type: "integer", minimum: 1, maximum: 5 },
            ease: { type: "integer", minimum: 1, maximum: 5 },
            prompt_refs: { type: "array", items: { type: "string" } },
            site_refs: { type: "array", items: { type: "string" } },
            asset: {
              type: "object",
              properties: {
                kind: { type: "string", enum: [...ASSET_KINDS] },
                title: { type: "string" },
                content: { type: "string" },
                publish_as: { type: "string", enum: ["page", "post"], description: "page_draft only: page (service/hub, in the menu) or post (blog article)" },
              },
              required: ["kind", "title", "content"],
            },
          },
          required: ["title", "body", "category", "impact", "ease", "prompt_refs", "site_refs", "asset"],
        },
      },
    },
    required: ["recommendations"],
  },
};

export function buildUserMessage(ev: RecEvidence): string {
  const L: string[] = [];
  L.push(`CUSTOMER: ${ev.name}${ev.domain ? ` (${ev.domain})` : ""} · site platform ${ev.platform ?? "unknown"} · languages ${ev.languages.join(", ") || "en"}`);
  if (ev.market) L.push(`MARKET: sells ${ev.market.product} · to ${ev.market.icp} · in ${ev.market.location}`);
  L.push(`TRACKED COMPETITORS: ${ev.competitors.join(", ") || "none yet"}`);
  L.push(`PERIOD: ${ev.from} to ${ev.to}`);
  L.push(`\nEVIDENCE — QUESTIONS (latest answer per engine):`);
  for (const p of ev.prompts) {
    L.push(`${p.ref}. "${p.text}" [${p.language}, ${p.stage}${p.branded ? ", contains their name" : ""}] — named by: ${p.enginesNamed.join(", ") || "none"} of ${p.enginesAsked.join(", ") || "not asked"}${p.competitorsNamed.length ? ` · competitors named: ${p.competitorsNamed.join(", ")}` : ""}`);
    if (p.excerpt && !p.branded) L.push(`   excerpt of an answer that did not name them: ${p.excerpt}`);
  }
  L.push(`\nEVIDENCE — SITES AI CITED IN ANSWERS THAT DID NOT NAME THEM (most first):`);
  for (const s of ev.sites) L.push(`${s.ref}. ${s.domain}${s.channelType ? ` [${s.channelType}]` : ""}${s.competitors.length ? ` · names instead: ${s.competitors.join(", ")}` : ""}${s.urls.length ? ` · pages: ${s.urls.join(" ")}` : ""}`);
  L.push(`\nTheir own site was ${ev.ownCited ? "cited in some answers" : "not cited in any answer"} in this period.`);
  if (ev.site?.ok) L.push(`\nTHEIR SITE (${ev.site.url}):\nTitle: ${ev.site.title ?? ""}\nDescription: ${ev.site.description ?? ""}\nHeadings: ${ev.site.headings.join(" | ")}\nText: ${ev.site.text.slice(0, 3500)}`);
  else L.push(`\nTHEIR SITE: could not be read${ev.site?.error ? ` (${ev.site.error})` : ""}.`);
  return L.join("\n");
}

const NUMBERY = /\d+\s*(%|percent|per ?cent|answers?|times|citations?|out of|of \d)/i;
const strip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

// A site you can get listed on: a known directory/marketplace, or a page that is itself a list ("best …", "/list/").
// A competitor agency's own website is not a place to get listed (Architect review, 4 Nov).
const LISTING_DOMAINS = /(^|\.)(semrush\.com|sortlist\.(com|in)|clutch\.co|goodfirms\.co|designrush\.com|justdial\.com|sulekha\.com|indiamart\.com|trustpilot\.com|g2\.com|pickanagency\.com|upcity\.com|themanifest\.com|yelp\.com|tripadvisor\.[a-z.]+|practo\.com|99acres\.com|magicbricks\.com|shiksha\.com|collegedunia\.com|google\.com)$/;
export function isListingSite(s: { domain: string; channelType: string | null; urls: string[] }, kind: AssetKind): boolean {
  if (kind === "thread_list") return s.channelType === "forum" || s.channelType === "social" || /(^|\.)(reddit\.com|quora\.com|linkedin\.com)$/.test(s.domain);
  if (s.channelType === "directory" || s.channelType === "marketplace") return true;
  if (LISTING_DOMAINS.test(s.domain)) return true;
  return s.urls.some((u) => /\/(list|lists|directory|top|best)[-/]|best-[a-z-]*agenc|top-\d+/i.test(u));
}

function siteList(ev: RecEvidence, refs: string[], kind: AssetKind): string {
  const rows = refs.map((r) => ev.sites.find((s) => s.ref === r)!).filter(Boolean);
  const head = kind === "thread_list" ? "## Threads and communities AI cites" : "## Sites to get listed on";
  return [head, ...rows.map((s) => `- **${s.domain}**${s.urls.length ? `\n${s.urls.map((u) => `  - ${u}`).join("\n")}` : ""}`)].join("\n");
}

/** Model output → only recommendations whose evidence is real; every number attached here, from stored data. */
export function validateRecommendations(raw: any, ev: RecEvidence): { recs: Recommendation[]; dropped: string[] } {
  const dropped: string[] = [];
  const recs: Recommendation[] = [];
  const pRefs = new Set(ev.prompts.map((p) => p.ref));
  const sRefs = new Set(ev.sites.map((s) => s.ref));
  for (const r of Array.isArray(raw?.recommendations) ? raw.recommendations : []) {
    const title = strip(r?.title, 90);
    const body = strip(r?.body, 600);
    if (!title || !body) { dropped.push("missing title/body"); continue; }
    if (NUMBERY.test(title) || NUMBERY.test(body)) { dropped.push(`“${title}” — states a number (the app shows measured numbers)`); continue; }
    const promptRefs = [...new Set((Array.isArray(r?.prompt_refs) ? r.prompt_refs : []).map(String).filter((x: string) => pRefs.has(x)))] as string[];
    const siteRefs = [...new Set((Array.isArray(r?.site_refs) ? r.site_refs : []).map(String).filter((x: string) => sRefs.has(x)))] as string[];
    if (!promptRefs.length && !siteRefs.length) { dropped.push(`“${title}” — no valid evidence ids`); continue; }
    const kind = ASSET_KINDS.includes(r?.asset?.kind) ? (r.asset.kind as AssetKind) : null;
    let content = strip(r?.asset?.content, 8000);
    if (!kind || content.length < 40) { dropped.push(`“${title}” — asset missing or too short`); continue; }
    let format: "markdown" | "json" | "text" = kind === "llms_txt" ? "text" : "markdown";
    if (kind === "json_ld") {
      const j = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      try { content = JSON.stringify(JSON.parse(j), null, 2); format = "json"; } catch { dropped.push(`“${title}” — JSON-LD is not valid JSON`); continue; }
    }
    if ((kind === "directory_list" || kind === "thread_list")) {
      const listable = siteRefs.filter((ref) => isListingSite(ev.sites.find((x) => x.ref === ref)!, kind));
      if (!listable.length) { dropped.push(`“${title}” — none of its sites is a directory, list or forum`); continue; }
      siteRefs.splice(0, siteRefs.length, ...listable);
      content = `${siteList(ev, siteRefs, kind)}\n\n## How to do it\n${content}`;
    }
    const impact = Math.min(5, Math.max(1, Math.round(Number(r?.impact) || 3)));
    const ease = Math.min(5, Math.max(1, Math.round(Number(r?.ease) || 3)));
    const category = (CATEGORIES as readonly string[]).includes(r?.category) ? r.category : (siteRefs.length && !promptRefs.length ? "offsite" : "content");
    if (recs.some((x) => x.title.toLowerCase() === title.toLowerCase())) continue;
    const evidence = {
      period: { from: ev.from, to: ev.to },
      prompts: promptRefs.map((ref) => { const p = ev.prompts.find((x) => x.ref === ref)!; return { id: p.id, text: p.text, engines_asked: p.enginesAsked, engines_named: p.enginesNamed, competitors_named: p.competitorsNamed }; }),
      sites: siteRefs.map((ref) => { const s = ev.sites.find((x) => x.ref === ref)!; return { domain: s.domain, answers_without_you: s.withoutYou, competitor_named: s.competitorNotYou, competitors: s.competitors }; }),
      answers_without_you: ev.totalAnswers - ev.namedAnswers, total_answers: ev.totalAnswers,
    };
    recs.push({ title, body, category, impact, ease, promptRefs, siteRefs, asset: { kind, title: strip(r.asset.title, 120) || title, format, content, ...(kind === "page_draft" ? { publishAs: r?.asset?.publish_as === "post" || r?.asset?.publish_as === "page" ? r.asset.publish_as : publishAs({ title: r.asset.title ?? "", body: content }) } : {}) }, evidence });
    if (recs.length >= 8) break;
  }
  recs.sort((a, b) => b.impact * b.ease - a.impact * a.ease);
  return { recs, dropped };
}

export async function proposeRecommendations(ev: RecEvidence, client?: Pick<Anthropic, "messages">): Promise<{ recs: Recommendation[]; dropped: string[]; usd: number; model: string; tokens: { in: number; out: number } }> {
  const model = getAnthropicModel();
  const anthropic = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const structuredRes = await callStructuredTool<any>({
    client: anthropic,
    model,
    maxTokens: 12000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(ev) }],
    tool: TOOL,
    agent: "aeo-strategist",
  });
  const { recs, dropped } = validateRecommendations(structuredRes.data, ev);
  return { recs, dropped, usd: structuredRes.usd, model: structuredRes.model, tokens: structuredRes.tokens };
}

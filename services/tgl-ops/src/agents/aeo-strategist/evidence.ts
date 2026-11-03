// services/tgl-ops/src/agents/aeo-strategist/evidence.ts
// What the reviewer's suggestions may rest on: the brand's own homepage and one live AI answer about the market.
import { askEngine, loadEngineConfig } from "../aeo-audit-engine/engines.js";
import type { Evidence, PriorPrompt, SetupSnapshot, SiteSnapshot } from "./types.js";

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");

export function extractSite(html: string, url: string): SiteSnapshot {
  const pick = (re: RegExp) => { const m = re.exec(html); return m ? decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : undefined; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ?? pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const headings: string[] = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const h = decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (h && h.length < 160 && !headings.includes(h)) headings.push(h);
    if (headings.length >= 20) break;
  }
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 3000);
  return { url, ok: true, title, description, headings, text };
}

export async function fetchSite(domain: string | null, fetchImpl: typeof fetch = fetch): Promise<SiteSnapshot | null> {
  if (!domain) return null;
  const url = `https://${domain}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; TrueVisibleSetupCheck/1.0; +https://thegrowthlab.co.in)" } });
    if (!res.ok) return { url, ok: false, headings: [], text: "", error: `HTTP ${res.status}` };
    return extractSite((await res.text()).slice(0, 600_000), res.url || url);
  } catch (err: any) {
    return { url, ok: false, headings: [], text: "", error: String(err?.message ?? err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** The neutral market question for changed / newly reworded markets. */
export function newMarketQuestion(product: string, buyer: string, location: string): string {
  return `Who leads ${product} for ${buyer} in ${location}? Name specific businesses and their websites.`;
}

/** The default discovery question. Deliberately neutral: no brand name, so the answer shows who AI names unprompted. */
export function marketQuestion(s: SetupSnapshot): string | null {
  if (!s.market) return null;
  return `Who are the best ${s.market.product} providers in ${s.market.location} for ${s.market.icp}? Name specific businesses and their websites.`;
}

/** Parses replacement market wording from reviewer notes (e.g. "Replace: product = ...; buyers = ...; location = ..."). */
export function parseMarketOverride(note: string | null | undefined): { product?: string; icp?: string; location?: string } | null {
  if (!note) return null;
  const productM = /(?:product|category)\s*=\s*([^;\n]+)/i.exec(note);
  const icpM = /(?:buyers?|icp|audience)\s*=\s*([^;\n]+)/i.exec(note);
  const locM = /(?:location|city|region)\s*=\s*([^;\n]+)/i.exec(note);
  if (!productM && !icpM && !locM) return null;
  return {
    product: productM ? productM[1].trim() : undefined,
    icp: icpM ? icpM[1].trim() : undefined,
    location: locM ? locM[1].trim() : undefined,
  };
}

/** 10 verified multi-vertical AEO prompts from review b13c2187 for The Growth Lab. */
export const B13C2187_AEO_PROMPTS: PriorPrompt[] = [
  { text: "Best AI visibility and generative engine optimization (GEO) agencies in India", language: "en", journey_phase: "decision", reason: "GEO/AEO agency intent" },
  { text: "Top AI search marketing agencies for hospitals and healthcare clinics", language: "en", journey_phase: "consideration", reason: "Healthcare AI search intent" },
  { text: "Leading AI automation and visibility consultants for real estate and luxury hotels", language: "en", journey_phase: "consideration", reason: "Real estate / hospitality AI visibility intent" },
  { text: "ChatGPT par brand recommendation kaise badhaye for D2C brands", language: "hinglish", journey_phase: "awareness", reason: "D2C ChatGPT visibility intent" },
  { text: "Hospital ya clinic ke liye AEO agency choose karte waqt kya dekhna chahiye", language: "hinglish", journey_phase: "consideration", reason: "Healthcare AEO evaluation intent" },
  { text: "The Growth Lab reviews and case studies for generative search visibility", language: "en", journey_phase: "decision", reason: "TGL branded AEO evaluation intent" },
  { text: "Best generative AI growth operators in Chandigarh and Delhi NCR", language: "en", journey_phase: "decision", reason: "Regional AI operator intent" },
  { text: "How to get recommended by ChatGPT and Perplexity for coaching institutes", language: "en", journey_phase: "awareness", reason: "Coaching AEO discovery intent" },
  { text: "Coaching institute ke admissions increase karne ke liye best AI WhatsApp automation operator", language: "hinglish", journey_phase: "decision", reason: "Coaching WhatsApp automation intent" },
  { text: "Top AI growth partner for multi-branch test prep institutes in India", language: "en", journey_phase: "consideration", reason: "Coaching multi-branch test prep intent" },
];

/** Extracts all proposed prompts from prior reviews, including those rejected by the validator. */
export function extractPriorPrompts(reviews: any[]): PriorPrompt[] {
  const result: PriorPrompt[] = [];
  const seen = new Set<string>();

  for (const r of reviews ?? []) {
    const p = r?.proposal;
    if (!p) continue;
    // 1. Prompts from promptsAdd or prompts_add
    const adds = Array.isArray(p.promptsAdd) ? p.promptsAdd : Array.isArray(p.prompts_add) ? p.prompts_add : [];
    for (const item of adds) {
      const text = typeof item === "string" ? item : item?.text;
      if (text) {
        const normText = text.toLowerCase().trim();
        if (!seen.has(normText)) {
          seen.add(normText);
          result.push({
            text: text.trim(),
            language: item?.language,
            journey_phase: item?.journey_phase || item?.intent,
            reason: item?.reason,
          });
        }
      }
    }
    // 2. Prompts from raw.prompts_add
    if (p.raw && Array.isArray(p.raw.prompts_add)) {
      for (const item of p.raw.prompts_add) {
        const text = typeof item === "string" ? item : item?.text;
        if (text) {
          const normText = text.toLowerCase().trim();
          if (!seen.has(normText)) {
            seen.add(normText);
            result.push({
              text: text.trim(),
              language: item?.language,
              journey_phase: item?.journey_phase || item?.intent,
              reason: item?.reason,
            });
          }
        }
      }
    }
    // 3. Prompts from dropped list
    if (Array.isArray(p.dropped)) {
      for (const d of p.dropped) {
        const m = /prompt\s*[“"']([^”"']+)[”"']/i.exec(String(d));
        if (m && m[1]) {
          const text = m[1].trim();
          const normText = text.toLowerCase();
          if (!seen.has(normText)) {
            seen.add(normText);
            result.push({ text });
          }
        }
      }
    }
  }
  return result;
}

export interface GatherEvidenceOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  isMarketChange?: boolean;
  marketOverride?: { product?: string; icp?: string; location?: string } | null;
  priorProposedPrompts?: PriorPrompt[];
}

export async function gatherEvidence(
  s: SetupSnapshot,
  opts: GatherEvidenceOptions = {}
): Promise<{ evidence: Evidence; aiCostUsd: number }> {
  const site = await fetchSite(s.domain, opts.fetchImpl);

  const noteOverride = parseMarketOverride(s.setupNote);
  const override = opts.marketOverride || noteOverride;
  const isChange = opts.isMarketChange || !!override;

  const effectiveProduct = override?.product || s.market?.product;
  const effectiveIcp = override?.icp || s.market?.icp;
  const effectiveLocation = override?.location || s.market?.location;

  let q: string | null = null;
  if (effectiveProduct && effectiveIcp && effectiveLocation) {
    if (isChange) {
      q = newMarketQuestion(effectiveProduct, effectiveIcp, effectiveLocation);
    } else {
      q = marketQuestion(s);
    }
  }

  const ev: Evidence = {
    site,
    aiQuestion: q,
    aiAnswer: null,
    aiEngine: null,
    priorProposedPrompts: opts.priorProposedPrompts ?? [],
  };

  let aiCostUsd = 0;
  if (q) {
    // Perplexity is cheapest per answer (~$0.002 on 31 Oct) and reports its own cost.
    const { config } = loadEngineConfig("perplexity", opts.env);
    if (config) {
      try {
        const ans = await askEngine(config, q, { country: "IN", fetchImpl: opts.fetchImpl });
        ev.aiAnswer = ans.text.slice(0, 6000);
        ev.aiEngine = `perplexity (${ans.model})`;
        aiCostUsd = ans.costUsd;
      } catch (err: any) {
        ev.aiError = String(err?.message ?? err).slice(0, 200);
      }
    } else {
      ev.aiError = "Perplexity not configured";
    }
  }
  return { evidence: ev, aiCostUsd };
}

/** All text a suggested competitor must be found in. */
export function evidenceCorpus(ev: Evidence): string {
  return [ev.site?.title, ev.site?.description, ...(ev.site?.headings ?? []), ev.site?.text, ev.aiAnswer].filter(Boolean).join("\n");
}

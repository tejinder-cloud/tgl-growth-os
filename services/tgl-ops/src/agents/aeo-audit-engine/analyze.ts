// services/tgl-ops/src/agents/aeo-audit-engine/analyze.ts
// Deterministic reading of an answer: is the brand named, in what order versus tracked competitors,
// which competitors appear, and what kind of source each citation is. No LLM, so no invented findings;
// anything we can't know from the text (sentiment, what a cited page says) is left null → "—" on screen.
import type { AnswerAnalysis, BrandLens, ChannelType, CitationAnalysis, EngineCitation } from "./types.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lower-case, strip markdown link targets' noise, unify quotes/whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
}

/** Index of the first whole-word occurrence of any name, or -1. Names shorter than 3 chars are ignored (too ambiguous). */
export function firstIndexOf(text: string, names: string[]): number {
  const t = norm(text);
  let best = -1;
  for (const raw of names) {
    const n = norm(raw).trim();
    if (n.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9\\u0900-\\u097F])${escape(n)}(?=$|[^a-z0-9\\u0900-\\u097F])`, "i");
    const m = re.exec(t);
    if (m) {
      const idx = m.index + m[1].length;
      if (best === -1 || idx < best) best = idx;
    }
  }
  return best;
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stem(domain: string): string {
  return domain.split(".")[0];
}

export function namesFor(lens: BrandLens): string[] {
  return [lens.name, ...lens.variants, ...lens.domains, ...lens.domains.map(stem)];
}

export function analyzeAnswer(text: string, lens: BrandLens): AnswerAnalysis {
  const brandAt = firstIndexOf(text, namesFor(lens));
  const comps = lens.competitors.map((c) => ({
    name: c.name,
    at: firstIndexOf(text, [c.name, ...(c.domain ? [c.domain, stem(c.domain)] : [])]),
  }));
  const found = comps.filter((c) => c.at >= 0);
  let position: number | null = null;
  if (brandAt >= 0) position = 1 + found.filter((c) => c.at < brandAt).length;
  return { mentioned: brandAt >= 0, position, competitorsMentioned: found.sort((a, b) => a.at - b.at).map((c) => c.name) };
}

// Source buckets. Unknown domains stay null rather than being guessed.
const BUCKETS: [ChannelType, string[]][] = [
  ["forum", ["reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com"]],
  ["video", ["youtube.com", "youtu.be", "vimeo.com"]],
  ["social", ["facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "threads.net", "medium.com", "pinterest.com"]],
  ["directory", ["justdial.com", "sulekha.com", "indiamart.com", "yelp.com", "tripadvisor.com", "tripadvisor.in", "practo.com", "glassdoor.com", "ambitionbox.com", "clutch.co", "goodfirms.co", "g2.com", "capterra.com", "trustpilot.com", "google.com", "maps.google.com", "shiksha.com", "collegedunia.com", "careers360.com"]],
  ["marketplace", ["amazon.in", "amazon.com", "flipkart.com", "myntra.com", "meesho.com", "nykaa.com", "magicbricks.com", "99acres.com", "housing.com", "nobroker.in", "makaan.com"]],
  ["news", ["timesofindia.indiatimes.com", "indiatimes.com", "hindustantimes.com", "ndtv.com", "thehindu.com", "indianexpress.com", "economictimes.indiatimes.com", "livemint.com", "business-standard.com", "moneycontrol.com", "news18.com", "tribuneindia.com", "yourstory.com", "inc42.com", "bbc.com", "reuters.com", "forbes.com", "forbesindia.com"]],
  ["reference", ["wikipedia.org", "britannica.com", "gov.in", "nic.in"]],
];

export function channelFor(domain: string, lens: BrandLens): ChannelType | null {
  const matches = (list: string[]) => list.some((d) => domain === d || domain.endsWith("." + d));
  if (matches(lens.domains)) return "owned";
  for (const [type, list] of BUCKETS) if (matches(list)) return type;
  return null;
}

export function analyzeCitation(c: EngineCitation, lens: BrandLens): CitationAnalysis | null {
  const fromUrl = domainOf(c.url);
  // Gemini's grounding URLs are redirects (vertexaisearch.cloud.google.com); the real domain is in the title.
  const domain = (fromUrl && !fromUrl.endsWith("vertexaisearch.cloud.google.com") ? fromUrl : c.domainHint?.toLowerCase().replace(/^www\./, "")) || fromUrl;
  if (!domain) return null;
  const owned = lens.domains.some((d) => domain === d || domain.endsWith("." + d));
  const competitorsMentioned = lens.competitors
    .filter((x) => x.domain && (domain === x.domain || domain.endsWith("." + x.domain)))
    .map((x) => x.name);
  return {
    domain,
    url: fromUrl && fromUrl !== domain && fromUrl.endsWith("vertexaisearch.cloud.google.com") ? null : c.url,
    channelType: channelFor(domain, lens),
    brandMentioned: owned ? true : null,
    competitorsMentioned,
  };
}

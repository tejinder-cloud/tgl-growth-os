// services/tgl-ops/src/agents/prospect-researcher/rubric.ts
import type { ProspectSignals, DecisionMaker } from "./types.js";
import { isDecisionMakerRole } from "./sources/enrichment.js";
import { FIT_QUALIFIED_THRESHOLD } from "./threshold.js";

export interface RubricEvaluation {
  fitScore: number;
  qualified: boolean;
  fitReasons: string[];
  disqualified?: boolean;
  disqualificationReason?: string;
  /** Rubric v2: true when Dimension 4 was scored from a probe result supplied by the caller. */
  dim4Probed?: boolean;
}

/**
 * Detects whether a URL represents a specific branch, centre, or location
 * hosted on a root domain network (e.g. /hospital-network/saket, /locations/gurgaon).
 */
export function isSubBranchUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    let clean = url.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    const parsed = new URL(clean);
    const path = parsed.pathname.toLowerCase();
    if (path === "/" || path === "") return false;
    const branchPathPatterns = [
      /\/(?:hospital-network|locations?|centres?|centers?|branches?|clinics?|hospitals?|our-locations?|our-centres?|our-centers?|facilities|units)\/[a-z0-9_-]+/i,
      /\/find-(?:a-)?(?:centre|center|clinic|hospital|location|doctor)\//i,
    ];
    return branchPathPatterns.some((pattern) => pattern.test(path));
  } catch {
    return false;
  }
}

/**
 * Normalizes and checks whether two metro/city strings refer to the same operational metro.
 */
export function areSameMetro(m1: string, m2: string): boolean {
  if (!m1 || !m2) return true;
  const norm1 = m1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const norm2 = m2.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm1 || !norm2) return true;
  if (norm1 === norm2) return true;
  if (norm1.includes("delhi") && norm2.includes("delhi")) return true;
  if (
    (norm1.includes("chandigarh") || norm1.includes("tricity") || norm1.includes("mohali") || norm1.includes("panchkula")) &&
    (norm2.includes("chandigarh") || norm2.includes("tricity") || norm2.includes("mohali") || norm2.includes("panchkula"))
  ) return true;
  if (
    (norm1.includes("mumbai") || norm1.includes("bombay") || norm1.includes("navi")) &&
    (norm2.includes("mumbai") || norm2.includes("bombay") || norm2.includes("navi"))
  ) return true;
  if (
    (norm1.includes("bengaluru") || norm1.includes("bangalore")) &&
    (norm2.includes("bengaluru") || norm2.includes("bangalore"))
  ) return true;
  if (
    (norm1.includes("hyderabad") || norm1.includes("secunderabad")) &&
    (norm2.includes("hyderabad") || norm2.includes("secunderabad"))
  ) return true;
  return false;
}

/**
 * Generic Playbook C Chain Rule:
 * Rejects enterprise healthcare / coaching chains without any hardcoded names.
 * Triggers if ANY of the following 3 generic signals are present:
 * 1. Brand appears at 3 or more Places locations (places_brand_count >= 3 or branch_count >= 3).
 * 2. Root domain hosts other branches (subpath on network domain, /locations /hospital-network page, or scraped network evidence).
 * 3. Registered HQ is in another metro (registered_hq_metro !== candidate metro).
 */
export function checkPlaybookCDisqualification(
  company: string,
  domain: string,
  signals?: ProspectSignals,
  metro?: string
): { disqualified: boolean; reason?: string } {
  // Signal 1: Brand appears at 3 or more Places locations
  const placesCount = signals?.places_brand_count ?? signals?.branch_count ?? 1;
  const has3OrMorePlaces = Boolean(
    placesCount >= 3 ||
    signals?.chain_evidence?.some((e) => {
      const match = e.match(/Found (\d+) Places results sharing brand/i);
      return match && parseInt(match[1], 10) >= 3;
    })
  );
  if (has3OrMorePlaces) {
    const brandName = signals?.brand_prefix || company;
    return {
      disqualified: true,
      reason: `Playbook C Chain Rule: brand appears at 3 or more Places locations (${placesCount >= 3 ? placesCount : 3}+ locations under brand '${brandName}')`,
    };
  }

  // Signal 2: Root domain hosts other branches
  const isBranchPath = isSubBranchUrl(domain);
  const hasLocationsPageEvidence = Boolean(
    signals?.root_domain_hosts_other_branches ||
    signals?.chain_evidence?.some((e) =>
      /locations?\/centres? page found|hospital-network|root domain hosts other branches|website lists \d+ cities/i.test(e)
    )
  );
  if (isBranchPath || hasLocationsPageEvidence) {
    let detail = "";
    if (isBranchPath) {
      try {
        const p = new URL(domain.startsWith("http") ? domain : `https://${domain}`).pathname;
        detail = `subpath ${p} indicates network branch on root domain`;
      } catch {
        detail = "subpath indicates network branch on root domain";
      }
    } else {
      detail =
        signals?.chain_evidence?.find((e) =>
          /locations?\/centres? page found|hospital-network|root domain hosts other branches|website lists \d+ cities/i.test(e)
        ) || "locations/centres network page detected on root domain";
    }
    return {
      disqualified: true,
      reason: `Playbook C Chain Rule: root domain hosts other branches (${detail})`,
    };
  }

  // Signal 3: Registered HQ is in another metro
  const candidateCity = (metro || signals?.raw_signals?.city || "").trim();
  const hqCity = (signals?.registered_hq_metro || "").trim();
  const isDifferentMetro = Boolean(
    candidateCity && hqCity && !areSameMetro(candidateCity, hqCity)
  );
  const hasHqEvidence = Boolean(
    isDifferentMetro ||
    signals?.chain_evidence?.some((e) =>
      /registered (?:hq|office|headquarters) in another metro|corporate (?:office|hq) in/i.test(e)
    )
  );
  if (hasHqEvidence) {
    const hqDetail = isDifferentMetro
      ? `registered HQ in ${hqCity}, candidate branch in ${candidateCity}`
      : (signals?.chain_evidence?.find((e) =>
          /registered (?:hq|office|headquarters) in another metro|corporate (?:office|hq) in/i.test(e)
        ) || "registered corporate HQ located in another metro");
    return {
      disqualified: true,
      reason: `Playbook C Chain Rule: registered HQ is in another metro (${hqDetail})`,
    };
  }

  // 4. Any remaining explicit evidence from scraped website signals (funding, multi-branch footprint)
  if (signals?.chain_evidence && signals.chain_evidence.length > 0) {
    const evidenceSummary = signals.chain_evidence.join(" · ");
    return {
      disqualified: true,
      reason: `Playbook C Chain Rule: Enterprise chain detected by signals (${evidenceSummary})`,
    };
  }

  return { disqualified: false };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Rubric v2 · Dimension 4: AI visibility gap (decisions/2026-11-10.md)
// One engine, one buyer question built from the prospect's category and city.
//   competitor named and prospect absent  -> 25
//   prospect named but not first          -> 10
//   prospect named first                  ->  0
// The probe result is stored under fit_reasons as `dim4_probe` so touch 1 can quote it verbatim.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const DIM4_MAX_POINTS = 25;
export const DIM4_PROSPECT_ABSENT_POINTS = 25;
export const DIM4_PROSPECT_NOT_FIRST_POINTS = 10;
export const DIM4_PROSPECT_FIRST_POINTS = 0;
export const DIM4_PROBE_PREFIX = "dim4_probe:";

/** Buyer-question template per category. `{city}` is replaced with the prospect's city. */
export const DIM4_QUESTION_TEMPLATES: Record<string, string> = {
  hospitals: "best hospital in {city}",
  hospital: "best hospital in {city}",
  cosmetic_dental: "best dental clinic in {city}",
  dental: "best dental clinic in {city}",
  ivf_fertility: "best IVF clinic in {city}",
  ivf: "best IVF clinic in {city}",
  high_ticket_coaching: "best coaching institute in {city}",
  coaching: "best coaching institute in {city}",
  hotels: "best boutique hotel in {city}",
  real_estate: "best real estate developer in {city}",
  law_ca: "best chartered accountant in {city}",
};

/** Builds the single buyer question for a category and city. Unknown categories fall back to "best <category> in <city>". */
export function buildDim4Question(category: string, city: string): string {
  const key = (category || "").toLowerCase().trim();
  const template = DIM4_QUESTION_TEMPLATES[key] || `best ${key.replace(/_/g, " ") || "service provider"} in {city}`;
  return template.replace("{city}", (city || "").trim() || "India");
}

/** The record stored under fit_reasons as `dim4_probe`. Every field is observed, none is inferred. */
export interface Dim4Probe {
  rubric_version: "v2";
  engine: string;
  model: string;
  question: string;
  /** The engine's answer, verbatim. */
  answer: string;
  /** Business names found in the answer, in order of appearance (includes the prospect when named). */
  names_found: string[];
  prospect_named: boolean;
  /** 1 = first business named in the answer; null when the prospect is absent. */
  prospect_position: number | null;
  competitor_named: boolean;
  score: number;
  /** ISO timestamp of the probe. */
  date: string;
  cost_usd: number;
}

export type Dim4ProbeFn = (input: {
  company: string;
  domain: string;
  category: string;
  city?: string;
}) => Promise<Dim4Probe | null>;

const NAME_STOPWORDS = new Set([
  "the", "and", "of", "in", "at", "a", "an", "dr", "dental", "dentist", "dentistry", "clinic", "clinics",
  "hospital", "hospitals", "centre", "center", "centers", "centres", "care", "health", "healthcare", "medical",
  "multispeciality", "multispecialty", "speciality", "specialty", "super", "institute", "institutes", "academy",
  "classes", "coaching", "ivf", "fertility", "pvt", "ltd", "private", "limited", "llp", "hotel", "hotels",
]);

const HEADING_LEAD_WORDS = new Set([
  "top", "best", "key", "note", "disclaimer", "important", "why", "how", "here", "summary", "tip", "tips",
  "factors", "conclusion", "things", "what", "when", "consider", "according", "based", "please", "remember",
  "always", "other", "additional", "also", "overall", "recommendation", "recommendations", "important:",
]);

function nameTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function distinctiveTokens(s: string): string[] {
  return nameTokens(s).filter((t) => !NAME_STOPWORDS.has(t) && t.length >= 2);
}

/** True when a name found in an answer refers to the prospect: every distinctive token of the prospect appears in the name. */
export function nameMatchesProspect(foundName: string, company: string): boolean {
  const want = distinctiveTokens(company);
  if (want.length === 0) {
    return nameTokens(foundName).join(" ") === nameTokens(company).join(" ");
  }
  const have = new Set(nameTokens(foundName));
  return want.every((t) => have.has(t));
}

function cleanFoundName(raw: string): string | null {
  let n = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  n = n.replace(/^[\d.)\s-]+/, "").replace(/[:.,;\s]+$/, "").trim();
  if (n.length < 3 || n.length > 80) return null;
  if (/[?]$/.test(raw.trim()) || /:$/.test(raw.trim())) return null;
  if (!/^[A-Z0-9]/.test(n)) return null;
  const words = n.split(" ");
  if (words.length > 8) return null;
  if (HEADING_LEAD_WORDS.has(words[0].toLowerCase())) return null;
  return n;
}

/** Extracts business names from an answer: bold spans and numbered-list lead-ins, in order of appearance. */
export function extractNamedBusinesses(answer: string): { name: string; index: number }[] {
  const found: { name: string; index: number }[] = [];
  const push = (raw: string, index: number) => {
    const name = cleanFoundName(raw);
    if (!name) return;
    const key = nameTokens(name).join(" ");
    if (!key || found.some((f) => nameTokens(f.name).join(" ") === key)) return;
    found.push({ name, index });
  };
  const text = answer || "";
  for (const m of text.matchAll(/\*\*([^*\n]{3,90}?)\*\*/g)) push(m[1], m.index ?? 0);
  for (const m of text.matchAll(/^[ \t]*\d+[.)][ \t]+(?!\*\*)([A-Z][^:\n–—]{2,80}?)(?=[ \t]*(?:[:–—(]|-\s|$))/gm)) push(m[1], (m.index ?? 0) + m[0].indexOf(m[1]));
  return found.sort((a, b) => a.index - b.index);
}

function hostLabel(domain: string): { host: string; label: string } {
  try {
    let clean = (domain || "").trim();
    if (!clean) return { host: "", label: "" };
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    const host = new URL(clean).hostname.replace(/^www\./, "").toLowerCase();
    return { host, label: host.split(".")[0] };
  } catch {
    return { host: "", label: "" };
  }
}

/**
 * Reads an engine answer for one prospect and scores Dimension 4. Pure function: no network, no clock.
 */
export function analyseDim4Answer(params: {
  company: string;
  domain: string;
  answer: string;
}): { namesFound: string[]; prospectNamed: boolean; prospectPosition: number | null; competitorNamed: boolean; score: number } {
  const { company, domain, answer } = params;
  const named = extractNamedBusinesses(answer);
  const lower = (answer || "").toLowerCase();

  // Where does the prospect first appear? Match extracted names, then the full company name, then the website host.
  const indexes: number[] = [];
  for (const n of named) if (nameMatchesProspect(n.name, company)) indexes.push(n.index);
  const companyLower = (company || "").toLowerCase().trim();
  if (companyLower.length >= 4) {
    const i = lower.indexOf(companyLower);
    if (i >= 0) indexes.push(i);
  }
  const { host, label } = hostLabel(domain);
  if (host) {
    const i = lower.indexOf(host);
    if (i >= 0) indexes.push(i);
  }
  if (label.length >= 6) {
    const i = lower.indexOf(label);
    if (i >= 0) indexes.push(i);
  }
  const prospectIndex = indexes.length ? Math.min(...indexes) : null;

  const competitors = named.filter((n) => !nameMatchesProspect(n.name, company));
  const prospectNamed = prospectIndex !== null;
  const prospectPosition = prospectNamed ? 1 + competitors.filter((c) => c.index < (prospectIndex as number)).length : null;

  let score = 0;
  if (!prospectNamed) {
    score = competitors.length > 0 ? DIM4_PROSPECT_ABSENT_POINTS : 0;
  } else {
    score = prospectPosition === 1 ? DIM4_PROSPECT_FIRST_POINTS : DIM4_PROSPECT_NOT_FIRST_POINTS;
  }

  return {
    namesFound: named.map((n) => n.name),
    prospectNamed,
    prospectPosition,
    competitorNamed: competitors.length > 0,
    score,
  };
}

/** Serialises the probe as the `dim4_probe` entry of fit_reasons. */
export function serializeDim4Probe(probe: Dim4Probe): string {
  return `${DIM4_PROBE_PREFIX} ${JSON.stringify(probe)}`;
}

/** Reads a stored `dim4_probe` entry back out of fit_reasons. Returns null when absent or unreadable. */
export function parseDim4Probe(fitReasons: unknown): Dim4Probe | null {
  if (!Array.isArray(fitReasons)) return null;
  const entry = fitReasons.find((r) => typeof r === "string" && r.startsWith(DIM4_PROBE_PREFIX));
  if (typeof entry !== "string") return null;
  try {
    const parsed = JSON.parse(entry.slice(DIM4_PROBE_PREFIX.length).trim());
    return parsed && typeof parsed === "object" && typeof parsed.score === "number" ? (parsed as Dim4Probe) : null;
  } catch {
    return null;
  }
}

/** A short, quotable summary of the stored probe for the review card. Never includes the full answer. */
export function summariseDim4Probe(probe: Dim4Probe): string {
  const where = !probe.prospect_named
    ? "prospect not named"
    : probe.prospect_position === 1
    ? "prospect named first"
    : `prospect named at position ${probe.prospect_position}`;
  return `${probe.engine} asked "${probe.question}" on ${probe.date.slice(0, 10)}: ${where}; names found: ${probe.names_found.join(", ") || "none"}`;
}

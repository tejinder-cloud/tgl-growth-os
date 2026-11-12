// services/tgl-ops/src/agents/prospect-researcher/dim4.ts
// Rubric v2 · Dimension 4: AI visibility gap (decisions/2026-11-10.md; fixes in issue #184)
// One engine, one buyer question built from the prospect's primary Google Places type and name (specialty-specific),
// falling back to the generic category question only when Places gives nothing more specific.
//   competitor named and prospect absent  -> 25
//   prospect named but not first          -> 10
//   prospect named first                  ->  0
// The prospect counts as named when its full name, its website host, or any distinctive brand token
// (brand_prefix, minus generic words such as dr, hospital, clinic) appears in the answer.
// The probe result is stored under fit_reasons as `dim4_probe` so touch 1 can quote it verbatim.
// This module is pure: no network, no clock, no engine call. The engine call lives in probe.ts.
import { nameTokens, distinctiveTokens, brandTokensFor } from "./brand.js";

export const DIM4_MAX_POINTS = 25;
export const DIM4_PROSPECT_ABSENT_POINTS = 25;
export const DIM4_PROSPECT_NOT_FIRST_POINTS = 10;
export const DIM4_PROSPECT_FIRST_POINTS = 0;
export const DIM4_PROBE_PREFIX = "dim4_probe:";

/** Buyer-question template per category. `{city}` is replaced with the prospect's city. Used only as the fallback. */
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

/** Place types / labels that name no specialty. When the primary type is one of these, the name is read for a specialty. */
const GENERIC_PLACE_TYPES = new Set([
  "hospital", "general hospital", "doctor", "clinic", "medical clinic", "health", "medical center", "medical centre",
  "dentist", "dental clinic", "point of interest", "establishment", "health and medical", "service", "store",
  "school", "tutor", "educational institution", "university", "medical", "healthcare", "health care",
]);

/** Specialty words found in a business name, mapped to the phrase used in the buyer question. */
const NAME_SPECIALTY_PHRASES: Record<string, string> = {
  maternity: "maternity",
  laparoscopic: "laparoscopic",
  orthopaedic: "orthopaedic",
  orthopedic: "orthopedic",
  orthodontic: "orthodontic",
  orthodontics: "orthodontic",
  cardiac: "cardiac",
  cardiology: "cardiology",
  neuro: "neuro",
  neurology: "neurology",
  paediatric: "paediatric",
  pediatric: "pediatric",
  ophthalmology: "eye",
  eye: "eye",
  ent: "ENT",
  oncology: "cancer",
  cancer: "cancer",
  nephrology: "kidney",
  kidney: "kidney",
  urology: "urology",
  gynaecology: "gynaecology",
  gynecology: "gynecology",
  dermatology: "skin",
  skin: "skin",
  cosmetic: "cosmetic",
  implant: "dental implant",
  implants: "dental implant",
  endodontic: "endodontic",
  periodontic: "periodontic",
  bariatric: "bariatric",
  spine: "spine",
  transplant: "transplant",
  neet: "NEET",
  jee: "JEE",
  upsc: "UPSC",
};

const FACILITY_NOUNS = ["hospital", "clinic", "centre", "center", "institute", "surgeon", "dentist", "doctor"];

function humanizeType(t: string | undefined): string {
  return (t || "").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function restoreAcronyms(s: string): string {
  return s.replace(/\bivf\b/gi, "IVF").replace(/\bent\b/gi, "ENT").replace(/\bneet\b/gi, "NEET").replace(/\bjee\b/gi, "JEE").replace(/\bupsc\b/gi, "UPSC");
}

function categoryNoun(category: string): string {
  const key = (category || "").toLowerCase().trim();
  const template = DIM4_QUESTION_TEMPLATES[key] || `best ${key.replace(/_/g, " ") || "service provider"} in {city}`;
  return template.replace(/^best\s+/i, "").replace(/\s+in \{city\}$/i, "");
}

/** What the prospect's Google Places entry says about its specialty. */
export interface Dim4Specialty {
  /** Places primaryType, e.g. "maternity_hospital". */
  primaryType?: string;
  /** Places primaryTypeDisplayName, e.g. "Maternity hospital". Preferred over primaryType. */
  primaryTypeLabel?: string;
  /** Prospect name, read for a specialty word when the Places type is generic. */
  company?: string;
}

export type Dim4QuestionBasis = "places_type" | "name" | "category_fallback";

export interface Dim4Question {
  question: string;
  basis: Dim4QuestionBasis;
  /** The specialty phrase the question was built from (for example "maternity hospital"). Empty for the fallback. */
  specialty: string;
}

/**
 * Builds the single buyer question for one prospect (issue #184).
 * 1. Primary Google Places type is specific ("Maternity hospital", "Laparoscopic surgeon"): "best <type> in <city>".
 * 2. Type is generic ("Hospital", "Dentist"): a specialty word in the prospect's name ("Orthodontic", "Maternity")
 *    plus the facility noun: "best maternity hospital in <city>".
 * 3. Neither: the generic category question, flagged basis "category_fallback" so the gap is visible in the stored probe.
 */
export function buildSpecialtyDim4Question(category: string, city: string, specialty?: Dim4Specialty): Dim4Question {
  const where = (city || "").trim() || "India";
  const label = humanizeType(specialty?.primaryTypeLabel) || humanizeType(specialty?.primaryType);

  if (label && !GENERIC_PLACE_TYPES.has(label)) {
    const phrase = restoreAcronyms(label);
    return { question: `best ${phrase} in ${where}`, basis: "places_type", specialty: phrase };
  }

  const nameWords = nameTokens(specialty?.company || "");
  const keyword = nameWords.find((w) => NAME_SPECIALTY_PHRASES[w] !== undefined);
  if (keyword) {
    const labelNoun = FACILITY_NOUNS.find((n) => label.split(" ").includes(n));
    const nameNoun = FACILITY_NOUNS.find((n) => nameWords.includes(n));
    const noun = labelNoun || nameNoun || categoryNoun(category);
    const phrase = restoreAcronyms(`${NAME_SPECIALTY_PHRASES[keyword]} ${noun}`.replace(/\s+/g, " ").trim());
    return { question: `best ${phrase} in ${where}`, basis: "name", specialty: phrase };
  }

  return { question: `best ${categoryNoun(category)} in ${where}`, basis: "category_fallback", specialty: "" };
}

/**
 * Builds the single buyer question for a category and city. With a `specialty` it is specialty-specific
 * (see buildSpecialtyDim4Question); without one it is the generic category question.
 */
export function buildDim4Question(category: string, city: string, specialty?: Dim4Specialty): string {
  return buildSpecialtyDim4Question(category, city, specialty).question;
}

/** The record stored under fit_reasons as `dim4_probe`. Every field is observed, none is inferred. */
export interface Dim4Probe {
  rubric_version: "v2";
  engine: string;
  model: string;
  question: string;
  /** Issue #184: how the question was built. Absent on probes stored before the fix. */
  question_basis?: Dim4QuestionBasis;
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
  /** Issue #184: brand prefix used for brand-token matching in the answer. */
  brandPrefix?: string;
  /** Issue #184: Places primaryType and display name, used to build the specialty-specific question. */
  primaryType?: string;
  primaryTypeLabel?: string;
}) => Promise<Dim4Probe | null>;

// Bold spans that are section headings or labels, not businesses.
const HEADING_LEAD_WORDS = new Set([
  "top", "best", "key", "note", "disclaimer", "important", "why", "how", "here", "summary", "tip", "tips",
  "factors", "conclusion", "things", "what", "when", "consider", "according", "based", "please", "remember",
  "always", "other", "additional", "also", "overall", "recommendation", "recommendations", "pros", "cons",
  "cost", "price", "pricing", "services", "contact", "location", "address", "rating", "ratings", "reviews",
  "specialty", "specialties", "speciality", "specialities", "facilities", "timings", "hours", "phone", "website",
  "known", "famous", "popular", "highly", "reputation", "technology", "experience", "expertise", "accreditation",
]);

/** True when a name found in an answer refers to the prospect: every distinctive token of the prospect appears in the name. */
export function nameMatchesProspect(foundName: string, company: string): boolean {
  const want = distinctiveTokens(company);
  if (want.length === 0) {
    return nameTokens(foundName).join(" ") === nameTokens(company).join(" ");
  }
  const have = new Set(nameTokens(foundName));
  return want.every((t) => have.has(t));
}

/** True when a found name contains any distinctive brand token of the prospect ("Motherhood Hospital" has "motherhood"). */
export function nameHasBrandToken(foundName: string, brandTokens: string[]): boolean {
  if (brandTokens.length === 0) return false;
  const have = new Set(nameTokens(foundName));
  return brandTokens.some((t) => have.has(t));
}

function cleanFoundName(raw: string): string | null {
  if (/\?\s*\**$/.test(raw.trim())) return null;
  let n = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  n = n.replace(/^[\d.)\s-]+/, "").replace(/[:.,;\s]+$/, "").trim();
  if (n.length < 3 || n.length > 80) return null;
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
  for (const m of text.matchAll(/^[ \t]*\d+[.)][ \t]+(?!\*\*)([A-Z][^:\n–—]{2,80}?)(?=[ \t]*(?:[:–—(]|-\s|$))/gm)) {
    push(m[1], (m.index ?? 0) + m[0].indexOf(m[1]));
  }
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the first whole-word occurrence of a token in lowercase text, or -1. */
function wordIndex(lowerText: string, token: string): number {
  const m = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}(?![a-z0-9])`).exec(lowerText);
  return m ? m.index + m[1].length : -1;
}

export interface Dim4Analysis {
  namesFound: string[];
  prospectNamed: boolean;
  prospectPosition: number | null;
  competitorNamed: boolean;
  score: number;
}

/**
 * Reads an engine answer for one prospect and scores Dimension 4.
 * prospect_named is true when ANY of these appears: a found name matching every distinctive token of the company,
 * the full company name, the website host, or any distinctive brand token (brandPrefix without generic words) as a
 * whole word in a found name or in the answer text.
 * An answer that names nobody at all scores 0: there is no observed gap to quote.
 */
export function analyseDim4Answer(params: { company: string; domain: string; answer: string; brandPrefix?: string }): Dim4Analysis {
  const { company, domain, answer, brandPrefix } = params;
  const named = extractNamedBusinesses(answer);
  const lower = (answer || "").toLowerCase();
  const brandTokens = brandTokensFor(brandPrefix, company).filter((t) => t.length >= 3);
  const isProspectName = (n: string) => nameMatchesProspect(n, company) || nameHasBrandToken(n, brandTokens);

  // Where does the prospect first appear? Match extracted names, then the full company name, brand tokens, then the website host.
  const indexes: number[] = [];
  for (const n of named) if (isProspectName(n.name)) indexes.push(n.index);
  const companyLower = (company || "").toLowerCase().trim();
  if (companyLower.length >= 4) {
    const i = lower.indexOf(companyLower);
    if (i >= 0) indexes.push(i);
  }
  for (const t of brandTokens) {
    const i = wordIndex(lower, t);
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

  const competitors = named.filter((n) => !isProspectName(n.name));
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

/**
 * Re-reads a STORED probe answer with the current analysis logic. No engine call, no spend: question, answer, engine,
 * model, date and cost are kept verbatim; only the derived fields (names, prospect_named, position, score) are recomputed.
 */
export function reanalyseDim4Probe(
  probe: Dim4Probe,
  params: { company: string; domain: string; brandPrefix?: string }
): Dim4Probe {
  const a = analyseDim4Answer({ company: params.company, domain: params.domain, answer: probe.answer, brandPrefix: params.brandPrefix });
  return {
    ...probe,
    names_found: a.namesFound,
    prospect_named: a.prospectNamed,
    prospect_position: a.prospectPosition,
    competitor_named: a.competitorNamed,
    score: a.score,
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

/** A short, quotable summary of the stored probe for cards and logs. Never includes the full answer. */
export function summariseDim4Probe(probe: Dim4Probe): string {
  const where = !probe.prospect_named
    ? "prospect not named"
    : probe.prospect_position === 1
    ? "prospect named first"
    : `prospect named at position ${probe.prospect_position}`;
  return `${probe.engine} asked "${probe.question}" on ${probe.date.slice(0, 10)}: ${where}; names found: ${probe.names_found.join(", ") || "none"}`;
}

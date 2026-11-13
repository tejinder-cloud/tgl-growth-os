// services/tgl-ops/src/agents/prospect-researcher/dim4.ts
// Rubric v2 · Dimension 4: AI visibility gap (decisions/2026-11-10.md)
// One engine, one buyer question built from the prospect's specialty (name, Places primary type) and city;
// the rotation category is the fallback (issue #184).
//   competitor named and prospect absent  -> 25
//   prospect named but not first          -> 10
//   prospect named first                  ->  0
// The probe result is stored under fit_reasons as `dim4_probe` so touch 1 can quote it verbatim.
// This module is pure: no network, no clock, no engine call. The engine call lives in probe.ts.

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

/** What the probe may know about the prospect beyond its rotation category. All optional. */
export interface Dim4QuestionHint {
  /** The prospect's name as Google Places shows it. */
  company?: string;
  /** Google Places primary type, e.g. "dental_clinic". */
  placeType?: string;
  /** Google Places primary type display name, e.g. "Dental clinic". */
  placeTypeLabel?: string;
}

// Specialty read from the prospect's own name. First match wins, so narrower specialties come first.
// The phrase is what a buyer would type: "best <phrase> in <city>".
const NAME_SPECIALTIES: Array<{ pattern: RegExp; phrase: string; person?: string }> = [
  { pattern: /\b(?:ivf|fertility|test tube)\b/i, phrase: "IVF clinic", person: "IVF specialist" },
  { pattern: /\b(?:laparoscop\w*|bariatric|gall\s*bladder|hernia)\b/i, phrase: "laparoscopic surgery hospital", person: "laparoscopic surgeon" },
  { pattern: /\b(?:matern\w*|motherhood|mother\s*(?:and|&)\s*child|gynae\w*|gyne\w*|obstetric\w*|women'?s?)\b/i, phrase: "maternity hospital", person: "gynaecologist" },
  { pattern: /\b(?:paediatric\w*|pediatric\w*|children'?s?|child|kids|neonat\w*)\b/i, phrase: "children's hospital", person: "paediatrician" },
  { pattern: /\b(?:eye|ophthal\w*|lasik|retina|cataract)\b/i, phrase: "eye hospital", person: "eye specialist" },
  { pattern: /\b(?:implant\w*|orthodont\w*|smile|dental|dentist\w*)\b/i, phrase: "dental clinic", person: "dentist" },
  { pattern: /\b(?:cardiac|cardio\w*|heart)\b/i, phrase: "heart hospital", person: "cardiologist" },
  { pattern: /\b(?:cancer|onco\w*)\b/i, phrase: "cancer hospital", person: "oncologist" },
  { pattern: /\b(?:ortho\w*|joint replacement|spine|bone)\b/i, phrase: "orthopaedic hospital", person: "orthopaedic surgeon" },
  { pattern: /\b(?:neuro\w*|brain|stroke)\b/i, phrase: "neurology hospital", person: "neurologist" },
  { pattern: /\b(?:kidney|nephro\w*|uro\w*|dialysis)\b/i, phrase: "kidney hospital", person: "urologist" },
  { pattern: /\b(?:gastro\w*|liver|digestive)\b/i, phrase: "gastroenterology hospital", person: "gastroenterologist" },
  { pattern: /\b(?:hair transplant|hair)\b/i, phrase: "hair transplant clinic", person: "hair transplant surgeon" },
  { pattern: /\b(?:plastic|cosmetic surg\w*|aesthetic\w*)\b/i, phrase: "cosmetic surgery clinic", person: "plastic surgeon" },
  { pattern: /\b(?:skin|derma\w*|laser)\b/i, phrase: "skin clinic", person: "dermatologist" },
  { pattern: /\b(?:ent|ear nose|sinus)\b/i, phrase: "ENT hospital", person: "ENT specialist" },
  { pattern: /\b(?:psychiatr\w*|mental health|de-?addiction|rehab\w*)\b/i, phrase: "psychiatry clinic", person: "psychiatrist" },
  { pattern: /\b(?:physio\w*)\b/i, phrase: "physiotherapy clinic", person: "physiotherapist" },
  { pattern: /\b(?:diabet\w*|endocrin\w*|thyroid)\b/i, phrase: "diabetes clinic", person: "diabetologist" },
  { pattern: /\b(?:ayurved\w*|panchakarma)\b/i, phrase: "ayurvedic hospital", person: "ayurvedic doctor" },
  { pattern: /\b(?:homeo\w*)\b/i, phrase: "homeopathy clinic", person: "homeopathic doctor" },
  { pattern: /\b(?:ielts|pte|toefl)\b/i, phrase: "IELTS coaching institute" },
  { pattern: /\b(?:upsc|ias|civil services?)\b/i, phrase: "UPSC coaching institute" },
  { pattern: /\b(?:neet|medical entrance)\b/i, phrase: "NEET coaching institute" },
  { pattern: /\b(?:jee|iit)\b/i, phrase: "IIT JEE coaching institute" },
  { pattern: /\b(?:cat|mba entrance|gmat)\b/i, phrase: "CAT coaching institute" },
  { pattern: /\b(?:clat|law entrance)\b/i, phrase: "CLAT coaching institute" },
  { pattern: /\b(?:nursing|norcet)\b/i, phrase: "nursing exam coaching institute" },
  { pattern: /\b(?:bank\w*|ssc)\b/i, phrase: "bank and SSC coaching institute" },
];

// Google Places primary types that say nothing a buyer would type. For these the name or the category decides.
const GENERIC_PLACE_TYPES = new Set([
  "", "hospital", "general_hospital", "doctor", "health", "medical_clinic", "establishment", "point_of_interest",
  "school", "educational_institution", "store", "corporate_office", "consultant", "service", "medical_center",
]);

function opensWithHonorific(name: string): boolean {
  return /^\s*(?:dr|doctor|prof|professor)\b\.?\s+/i.test(name || "");
}

/**
 * The specialty phrase for a prospect, or null when nothing more specific than the category is known.
 * Order: the prospect's own name (most specific), then its Google Places primary type when that type is not generic.
 */
export function dim4SpecialtyPhrase(hint?: Dim4QuestionHint): string | null {
  const company = (hint?.company || "").trim();
  if (company) {
    for (const s of NAME_SPECIALTIES) {
      if (s.pattern.test(company)) {
        return opensWithHonorific(company) && s.person ? s.person : s.phrase;
      }
    }
  }
  const type = (hint?.placeType || "").toLowerCase().trim();
  if (type && !GENERIC_PLACE_TYPES.has(type)) {
    const label = (hint?.placeTypeLabel || "").trim() || type.replace(/_/g, " ");
    return label.charAt(0).toLowerCase() + label.slice(1);
  }
  return null;
}

/**
 * Builds the single buyer question for one prospect.
 * A specialty read from the prospect's name or Places primary type wins ("best maternity hospital in <city>");
 * otherwise the category template is used; unknown categories fall back to "best <category> in <city>".
 * The generic category question is the last resort: a maternity hospital or a single surgeon is never the answer
 * to "best hospital in <city>", so scoring them on it measures nothing.
 */
export function buildDim4Question(category: string, city: string, hint?: Dim4QuestionHint): string {
  const where = (city || "").trim() || "India";
  const specialty = dim4SpecialtyPhrase(hint);
  if (specialty) return `best ${specialty} in ${where}`;
  const key = (category || "").toLowerCase().trim();
  const template = DIM4_QUESTION_TEMPLATES[key] || `best ${key.replace(/_/g, " ") || "service provider"} in {city}`;
  return template.replace("{city}", where);
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
  /** Brand token of the prospect (signals.brand_prefix). Used to recognise the brand in the answer. */
  brand?: string;
  /** Google Places primary type and its display name, when known. */
  placeType?: string;
  placeTypeLabel?: string;
}) => Promise<Dim4Probe | null>;

const NAME_STOPWORDS = new Set([
  "the", "and", "of", "in", "at", "a", "an", "dr", "dental", "dentist", "dentistry", "clinic", "clinics",
  "hospital", "hospitals", "centre", "center", "centers", "centres", "care", "health", "healthcare", "medical",
  "multispeciality", "multispecialty", "speciality", "specialty", "super", "institute", "institutes", "academy",
  "classes", "coaching", "ivf", "fertility", "pvt", "ltd", "private", "limited", "llp", "hotel", "hotels",
]);

// Bold spans that are section headings or labels, not businesses.
const HEADING_LEAD_WORDS = new Set([
  "top", "best", "key", "note", "disclaimer", "important", "why", "how", "here", "summary", "tip", "tips",
  "factors", "conclusion", "things", "what", "when", "consider", "according", "based", "please", "remember",
  "always", "other", "additional", "also", "overall", "recommendation", "recommendations", "pros", "cons",
  "cost", "price", "pricing", "services", "contact", "location", "address", "rating", "ratings", "reviews",
  "specialty", "specialties", "speciality", "specialities", "facilities", "timings", "hours", "phone", "website",
  "known", "famous", "popular", "highly", "reputation", "technology", "experience", "expertise", "accreditation",
  // Group headings an answer puts above its lists ("For Smile Makeovers / Veneers", "Locations") are not businesses.
  "for", "locations", "branches", "options", "option", "category", "categories", "treatments", "procedures", "if", "who",
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

// Words too common to identify a brand on their own. Kept local so this module stays dependency-free.
const BRAND_GENERIC_WORDS = new Set([
  ...NAME_STOPWORDS, "doctor", "prof", "professor", "new", "sri", "shri", "shree", "city", "best", "top", "life",
  "medicare", "eye", "multi", "advanced", "modern", "global", "india", "indian", "national", "international",
]);

/**
 * The words of a brand token that may be used to recognise the prospect in an answer.
 * Empty when the brand is missing or generic ("dr", "hospital", "city"), so a generic word never counts as a mention.
 */
export function brandMatchWords(brand: string | undefined | null): string[] {
  const words = nameTokens(brand || "").filter((t) => !BRAND_GENERIC_WORDS.has(t) && t.length >= 3);
  return words.some((t) => t.length >= 4) ? words : [];
}

function nameCarriesBrand(foundName: string, brandWords: string[]): boolean {
  if (brandWords.length === 0) return false;
  const have = new Set(nameTokens(foundName));
  return brandWords.every((t) => have.has(t));
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

export interface Dim4Analysis {
  namesFound: string[];
  prospectNamed: boolean;
  prospectPosition: number | null;
  competitorNamed: boolean;
  score: number;
}

/**
 * Reads an engine answer for one prospect and scores Dimension 4.
 * An answer that names nobody at all scores 0: there is no observed gap to quote.
 */
export function analyseDim4Answer(params: { company: string; domain: string; answer: string; brand?: string }): Dim4Analysis {
  const { company, domain, answer, brand } = params;
  const named = extractNamedBusinesses(answer);
  const lower = (answer || "").toLowerCase();
  const brandWords = brandMatchWords(brand);
  const isProspect = (name: string) => nameMatchesProspect(name, company) || nameCarriesBrand(name, brandWords);

  // Where does the prospect first appear? Match extracted names (full name or brand), then the brand as a whole
  // word anywhere in the answer, then the full company name, then the website host.
  const indexes: number[] = [];
  for (const n of named) if (isProspect(n.name)) indexes.push(n.index);
  if (brandWords.length === 1) {
    const m = new RegExp(`(?:^|[^a-z0-9])${brandWords[0]}(?:[^a-z0-9]|$)`).exec(lower);
    if (m) indexes.push(m.index);
  }
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

  const competitors = named.filter((n) => !isProspect(n.name));
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

/** A short, quotable summary of the stored probe for cards and logs. Never includes the full answer. */
export function summariseDim4Probe(probe: Dim4Probe): string {
  const where = !probe.prospect_named
    ? "prospect not named"
    : probe.prospect_position === 1
    ? "prospect named first"
    : `prospect named at position ${probe.prospect_position}`;
  return `${probe.engine} asked "${probe.question}" on ${probe.date.slice(0, 10)}: ${where}; names found: ${probe.names_found.join(", ") || "none"}`;
}

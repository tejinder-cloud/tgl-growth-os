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

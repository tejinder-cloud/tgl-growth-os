// services/tgl-ops/src/agents/aeo-audit-engine/named-businesses.ts
// Business names an engine's answer puts forward, read from the answer itself (bold spans and numbered-list
// lead-ins), for audits where there is no tracked competitor list (prospect audits, decisions/2026-11-12.md).
// Pure: no network, no model call. Section headings, labels and accreditation acronyms are filtered out, so a
// name reported to a prospect is something the answer actually presented as a business.
import { extractNamedBusinesses } from "../prospect-researcher/dim4.js";

// First words of bold spans that are labels, not businesses.
const LABEL_LEAD_WORDS = new Set([
  "for", "best", "top", "why", "how", "what", "when", "where", "who", "which", "highlights", "highlight", "drawback",
  "drawbacks", "strengths", "strength", "weakness", "weaknesses", "key", "note", "notes", "tip", "tips", "summary",
  "conclusion", "recommendation", "recommendations", "overview", "location", "locations", "address", "cost", "costs",
  "price", "prices", "pricing", "fees", "fee", "services", "service", "specialties", "specialities", "specialty",
  "speciality", "facilities", "features", "pros", "cons", "rating", "ratings", "reviews", "contact", "timings",
  "important", "disclaimer", "premier", "leading", "private", "government", "public", "other", "others", "also",
  "known", "ideal", "good", "great", "quick", "final", "bottom", "option", "options", "category", "categories",
  "things", "factors", "criteria", "consider", "considerations", "budget", "luxury", "mid", "affordable", "popular",
  "highly", "well", "single", "multi", "super", "comprehensive", "advanced", "specialized", "specialised", "top-rated",
]);

// Words that describe a kind of business or care. A name made only of these is a category heading, not a business.
const GENERIC_WORDS = new Set([
  "the", "and", "of", "in", "at", "a", "an", "for", "to", "with", "by", "or", "near", "care", "eye", "mother", "child",
  "children", "maternity", "women", "womens", "kids", "heart", "cardiac", "cancer", "dental", "dentist", "dentistry",
  "skin", "hair", "bone", "joint", "spine", "kidney", "ivf", "fertility", "hospital", "hospitals", "clinic", "clinics",
  "centre", "center", "centres", "centers", "institute", "institutes", "academy", "academies", "classes", "coaching",
  "school", "schools", "college", "colleges", "university", "hotel", "hotels", "resort", "resorts", "developer",
  "developers", "builders", "realty", "estate", "real", "store", "stores", "shop", "brand", "brands", "company",
  "companies", "agency", "agencies", "service", "services", "health", "healthcare", "medical", "multi", "super",
  "speciality", "specialty", "multispeciality", "multispecialty", "single", "private", "public", "government",
  "premier", "tertiary", "autonomous", "apex", "regional", "specialized", "specialised", "general", "emergency",
  "surgery", "surgeon", "surgeons", "doctor", "doctors", "specialist", "specialists", "treatment", "treatments",
  "options", "option", "tier", "top", "best", "luxury", "budget", "boutique", "online", "local", "india", "indian",
  "institution", "institutions", "facility", "facilities", "provider", "providers", "chain", "chains", "group",
  "groups", "network", "networks", "exam", "exams", "entrance", "preparation", "courses", "course", "program",
  "programs", "programme", "programmes", "property", "properties", "projects", "project", "residential",
  "commercial", "apartments", "villas", "stay", "stays", "rooms",
]);

// Accreditations, rankings and bodies that answers put in bold next to real businesses.
const NON_BUSINESS_ACRONYMS = new Set([
  "jci", "nabh", "nabl", "nirf", "iso", "naac", "ugc", "aicte", "rera", "gst", "who", "icmr", "mci", "nmc", "dci",
  "cghs", "echs", "tpa", "opd", "icu", "nicu", "emi", "faq", "ai", "seo", "aeo",
]);

function tokens(s: string): string[] {
  return (s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

/** True when a bold span or list lead-in reads as a business, not a heading, label or accreditation. */
export function looksLikeBusinessName(name: string): boolean {
  const n = (name || "").trim();
  if (n.length < 3 || n.length > 70) return false;
  if (/[?!]$/.test(n) || /:$/.test(n)) return false;
  const words = tokens(n);
  if (words.length === 0 || words.length > 7) return false;
  if (LABEL_LEAD_WORDS.has(words[0])) return false;
  if (words.length === 1 && NON_BUSINESS_ACRONYMS.has(words[0])) return false;
  if (words.every((w) => NON_BUSINESS_ACRONYMS.has(w) || GENERIC_WORDS.has(w) || /^\d+$/.test(w))) return false;
  // A slash between generic phrases is a category heading ("Mother & Child Care / Maternity").
  if (/\s\/\s/.test(n) && words.filter((w) => !GENERIC_WORDS.has(w)).length < 2) return false;
  return true;
}

/** Trailing locality detail is dropped so one business is not counted as several: "Fortis Hospital, Sector 62, Mohali" -> "Fortis Hospital". */
export function canonicalBusinessName(name: string): string {
  return (name || "").split(/\s*,\s*/)[0].replace(/\s+/g, " ").trim();
}

/** Businesses named in one answer, in order of appearance, one entry per business. */
export function businessNamesInAnswer(answer: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  const seen = new Set<string>();
  for (const found of extractNamedBusinesses(answer || "")) {
    const name = canonicalBusinessName(found.name);
    if (!looksLikeBusinessName(name)) continue;
    const key = tokens(name).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, index: found.index });
  }
  return out;
}

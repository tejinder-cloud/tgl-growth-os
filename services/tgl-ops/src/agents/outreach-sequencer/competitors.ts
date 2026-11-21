// services/tgl-ops/src/agents/outreach-sequencer/competitors.ts
// Which names an outreach email may quote as a competitor, and the one question to fix first.
// 21 Nov 2026: the first live emails quoted "Panchkula" and "Hyderabad" as competitors. A name now has to read as a
// business: not a place, not a treatment or service, not a heading, and (since a single word is too often a place
// or a treatment) at least two words or a word that marks a business. When nothing passes, the email says nothing
// about competitors rather than something untrue.
import { looksLikeBusinessName } from "../aeo-audit-engine/named-businesses.js";
import { METRO_AREAS } from "../prospect-researcher/sources/places.js";
import type { ShortFormAuditResult } from "../aeo-audit-engine/short-form.js";

const PLACE_WORDS = new Set<string>([
  "india", "north", "south", "east", "west", "central", "city", "tricity", "sector", "phase", "road", "nagar", "colony",
  "hills", "layout", "area", "near", "me", "delhi", "ncr", "new", "mumbai", "bengaluru", "bangalore", "hyderabad",
  "chennai", "kolkata", "pune", "ahmedabad", "jaipur", "lucknow", "chandigarh", "mohali", "panchkula", "zirakpur",
  "kharar", "ludhiana", "amritsar", "jalandhar", "punjab", "haryana", "gurugram", "gurgaon", "noida", "secunderabad",
]);
for (const [city, areas] of Object.entries(METRO_AREAS)) for (const p of [city, ...areas]) for (const w of tokens(p)) PLACE_WORDS.add(w);

const SERVICE_WORDS = new Set<string>([
  "implant", "implants", "root", "canal", "canals", "rct", "braces", "aligner", "aligners", "invisible", "clear",
  "whitening", "veneer", "veneers", "crown", "crowns", "bridge", "bridges", "denture", "dentures", "filling", "fillings",
  "extraction", "extractions", "wisdom", "tooth", "teeth", "gum", "gums", "smile", "design", "makeover", "cosmetic",
  "orthodontic", "orthodontics", "orthodontist", "endodontist", "prosthodontist", "periodontist", "implantologist",
  "pediatric", "paediatric", "oral", "maxillofacial", "laser", "lasers", "painless", "emergency", "consultation",
  "checkup", "check", "up", "cleaning", "scaling", "polishing", "transplant", "hair", "skin", "acne", "botox", "filler",
  "fillers", "egg", "freezing", "embryo", "iui", "icsi", "ivf", "fertility", "infertility", "pregnancy", "test", "tube",
  "baby", "surrogacy", "tuition", "tutorial", "tutorials", "coaching", "classes", "batch", "batches", "mock", "tests",
  "foundation", "crash", "online", "offline", "home", "visit", "cost", "price", "fees", "reviews", "results", "rating",
  "affordable", "cheap", "experienced", "expert", "experts", "specialist", "specialists", "doctor", "doctors", "dentist",
  "dentists", "dental", "care", "treatment", "treatments", "procedure", "procedures", "surgery", "therapy", "services",
]);

// A word that marks a business when the name has only one other word ("Apollo Dental", "Clove Dental").
const BUSINESS_MARKERS = new Set<string>([
  "clinic", "clinics", "hospital", "hospitals", "centre", "center", "dental", "dentistry", "studio", "care", "health",
  "healthcare", "institute", "academy", "classes", "tutorials", "coaching", "school", "college", "group", "labs", "lab",
  "medical", "fertility", "ivf", "smiles", "smile", "dentists", "specialists", "hotel", "resort", "realty", "developers",
  "builders", "pvt", "ltd", "llp", "inc", "co",
]);

function tokens(s: string): string[] {
  return (s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

export interface QuoteContext {
  company: string;
  city: string;
}

export function isQuotableCompetitor(name: string, ctx: QuoteContext): boolean {
  if (!looksLikeBusinessName(name)) return false;
  const words = tokens(name);
  const own = new Set(tokens(ctx.company));
  const cityWords = new Set(tokens(ctx.city));
  if (words.length > 0 && words.every((w) => own.has(w))) return false;
  const meaningful = words.filter((w) => !PLACE_WORDS.has(w) && !cityWords.has(w) && !SERVICE_WORDS.has(w) && !["the", "and", "of", "in", "at", "for", "a", "an", "by"].includes(w));
  if (meaningful.length === 0) return false;
  // "Dr. Vikas Gowd" is a practitioner: a title plus a name.
  if (/^dr\.?\s/i.test(name.trim()) && words.length >= 2) return true;
  if (words.length >= 2) return true;
  return BUSINESS_MARKERS.has(words[0]);
}

export interface Weakest {
  query?: string;
  competitor?: string;
}

/**
 * The question to fix first: one where no engine named the prospect. Preferred: one where the top competitor is
 * named; then one where any quotable competitor is named; then any. Undefined when the prospect was named everywhere.
 */
export function weakestQuery(result: ShortFormAuditResult, quotable: (n: string) => boolean, topCompetitor?: string): Weakest {
  const missed = result.results.filter((r) => Object.values(r.engineResults).every((er) => !er.analysis.mentioned));
  if (missed.length === 0) return {};
  const compsIn = (r: (typeof missed)[number]) => {
    const counts = new Map<string, number>();
    for (const er of Object.values(r.engineResults)) for (const c of new Set(er.analysis.competitorsMentioned)) if (quotable(c)) counts.set(c, (counts.get(c) || 0) + 1);
    return counts;
  };
  if (topCompetitor) {
    const hit = missed.find((r) => compsIn(r).has(topCompetitor));
    if (hit) return { query: hit.prompt, competitor: topCompetitor };
  }
  for (const r of missed) {
    const counts = [...compsIn(r).entries()].sort((a, b) => b[1] - a[1]);
    if (counts.length > 0) return { query: r.prompt, competitor: counts[0][0] };
  }
  return { query: missed[0].prompt };
}

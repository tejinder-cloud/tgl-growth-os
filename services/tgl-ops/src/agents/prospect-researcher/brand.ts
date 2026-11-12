// services/tgl-ops/src/agents/prospect-researcher/brand.ts
// Rubric v2 fixes (issue #184): brand token helpers shared by Dimension 4 (prospect_named) and the large-org logic.
// Pure module: no network, no clock. It imports nothing from the rest of the prospect-researcher agent, so dim4.ts,
// rubric.ts, enrichment.ts and worker.ts can all use it without an import cycle.
import type { ProspectSignals } from "./types.js";

/** Words that never identify a business on their own. A brand made only of these is a generic prefix. */
export const NAME_STOPWORDS = new Set([
  "the", "and", "of", "in", "at", "a", "an", "dr", "dental", "dentist", "dentistry", "clinic", "clinics",
  "hospital", "hospitals", "centre", "center", "centers", "centres", "care", "health", "healthcare", "medical",
  "multispeciality", "multispecialty", "speciality", "specialty", "super", "institute", "institutes", "academy",
  "classes", "coaching", "ivf", "fertility", "pvt", "ltd", "private", "limited", "llp", "hotel", "hotels",
]);

/** Extra generic words that must not count as a distinctive brand token (descriptors, titles, honorifics). */
const EXTRA_GENERIC_WORDS = new Set([
  "prof", "mr", "mrs", "ms", "doctor", "doctors", "women", "womens", "woman", "child", "children", "kids",
  "family", "general", "advanced", "modern", "new", "city", "multi", "super", "specialist", "specialists",
  "surgery", "surgical", "clinical", "diagnostics", "nursing", "home", "homes", "poly", "polyclinic",
]);

export function nameTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function isGenericWord(token: string): boolean {
  return NAME_STOPWORDS.has(token) || EXTRA_GENERIC_WORDS.has(token);
}

/** Tokens of a name that identify the business: generic words and one-character tokens removed. */
export function distinctiveTokens(s: string): string[] {
  return nameTokens(s).filter((t) => !isGenericWord(t) && t.length >= 2);
}

/**
 * True when a brand prefix is empty or made only of generic words ("dr.", "dr", "hospital", "the clinic").
 * A generic prefix says nothing about a chain: many unrelated businesses share it.
 */
export function isGenericBrandPrefix(prefix: string | undefined | null): boolean {
  return distinctiveTokens(prefix || "").length === 0;
}

/**
 * Distinctive brand tokens for a prospect. Uses the stored brand_prefix when it is distinctive.
 * When the prefix is missing or generic (for example "dr."), falls back to the first distinctive token of the
 * company name only, so a location word later in the name never becomes a brand token.
 */
export function brandTokensFor(brandPrefix: string | undefined | null, company: string): string[] {
  const fromPrefix = distinctiveTokens(brandPrefix || "");
  if (fromPrefix.length > 0) return Array.from(new Set(fromPrefix));
  const fromCompany = distinctiveTokens(company || "");
  return fromCompany.length > 0 ? [fromCompany[0]] : [];
}

/** Brand a chain signal refers to, read from a stored evidence or reason string such as "sharing brand 'dr.'". */
function brandInEvidence(entry: string): string | null {
  const m = entry.match(/brand\s+'([^']*)'/i);
  return m ? m[1] : null;
}

export interface BrandSignalSanitization {
  signals: ProspectSignals;
  /** Plain-text list of what was removed because it rested on a generic brand prefix. */
  removed: string[];
}

/**
 * Removes chain and multi-branch signals that were derived from a generic brand prefix such as "dr.".
 * Domain-based and website-based evidence is untouched. Never mutates the input.
 */
export function sanitizeGenericBrandSignals(input: ProspectSignals, company: string): BrandSignalSanitization {
  const signals: ProspectSignals = { ...input };
  const removed: string[] = [];
  const prefix = signals.brand_prefix;

  if (prefix !== undefined && isGenericBrandPrefix(prefix)) {
    const replacement = brandTokensFor(prefix, company)[0] || "";
    removed.push(`brand_prefix '${prefix}' is generic; replaced with '${replacement || "none"}'`);
    signals.brand_prefix = replacement;
    if (typeof signals.places_brand_count === "number" && signals.places_brand_count >= 2) {
      removed.push(`places_brand_count ${signals.places_brand_count} came from generic brand '${prefix}'`);
      if (signals.branch_count === signals.places_brand_count) signals.branch_count = 1;
      signals.places_brand_count = undefined;
    }
  }

  if (Array.isArray(signals.chain_evidence) && signals.chain_evidence.length > 0) {
    const kept: string[] = [];
    for (const e of signals.chain_evidence) {
      const b = brandInEvidence(e);
      if (b !== null && isGenericBrandPrefix(b)) {
        removed.push(`chain_evidence dropped, rests on generic brand '${b}': ${e}`);
      } else {
        kept.push(e);
      }
    }
    signals.chain_evidence = kept.length > 0 ? kept : undefined;
  }

  return { signals, removed };
}

/**
 * A real multi-branch signal: a distinctive brand at 2 or more Places locations, the root domain hosting other
 * branches, or branch evidence that does not rest on a generic brand. Returns the reason, or null.
 * Category and name hints ("hospital") are NOT multi-branch signals.
 */
export function detectMultiBranchSignal(signals: ProspectSignals | undefined): string | null {
  if (!signals) return null;
  const brand = signals.brand_prefix || "";
  const count = signals.places_brand_count;
  if (typeof count === "number" && count >= 2 && !isGenericBrandPrefix(brand)) {
    return `brand '${brand}' appears at ${count} Places locations`;
  }
  if (signals.root_domain_hosts_other_branches) {
    return "root domain hosts other branches";
  }
  const evidence = (signals.chain_evidence || []).find((e) => {
    const b = brandInEvidence(e);
    return b === null || !isGenericBrandPrefix(b);
  });
  if (evidence) return `branch evidence: ${evidence}`;
  return null;
}

// services/tgl-ops/src/agents/prospect-researcher/rubric.ts
import type { ProspectSignals, DecisionMaker } from "./types.js";
import { isDecisionMakerRole } from "./sources/enrichment.js";
import { FIT_QUALIFIED_THRESHOLD } from "./threshold.js";
import {
  analyseDim4Answer as _analyseDim4Answer,
  serializeDim4Probe,
  type Dim4Probe,
  type Dim4ProbeFn,
} from "./dim4.js";

// Dimension 4 (AI visibility gap): question templates, answer analysis and the dim4_probe record live in dim4.ts.
export * from "./dim4.js";
export { FIT_QUALIFIED_THRESHOLD } from "./threshold.js";

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

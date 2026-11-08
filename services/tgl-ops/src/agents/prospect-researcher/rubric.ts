// services/tgl-ops/src/agents/prospect-researcher/rubric.ts
import type { ProspectSignals, DecisionMaker } from "./types.js";
import { isDecisionMakerRole } from "./sources/enrichment.js";

export interface RubricEvaluation {
  fitScore: number;
  qualified: boolean;
  fitReasons: string[];
  disqualified?: boolean;
  disqualificationReason?: string;
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

/**
 * Calculates 0–100 weighted fit score strictly adhering to SKILL.md Playbook F:
 * - Dimension 1: Category AI-Answer Dependence (25 pts)
 * - Dimension 2: Active Paid Budget Signals (25 pts)
 * - Dimension 3: GBP Maturity & Marketing Hiring (20 pts)
 * - Dimension 4: Scale & Growth Trajectory (15 pts)
 * - Dimension 5: Decision-Maker Reachability (15 pts: 10 email + 5 phone bonus, 0 if DM unknown)
 *
 * Emits exactly 5 distinct itemized reasons with explicit evidence for each dimension.
 * Threshold: >= 70 pts qualifies for weekly delivery batch.
 */
export function evaluateProspectRubric(params: {
  company: string;
  domain: string;
  category: string;
  city?: string;
  signals: ProspectSignals;
  decisionMaker: DecisionMaker;
}): RubricEvaluation {
  const { company, domain, category, city, signals, decisionMaker } = params;

  // First check Playbook C Disqualification (generic chain rule)
  const chainCheck = checkPlaybookCDisqualification(company, domain, signals, city);
  if (chainCheck.disqualified) {
    return {
      fitScore: 0,
      qualified: false,
      disqualified: true,
      disqualificationReason: chainCheck.reason,
      fitReasons: [
        `Dim 1 (AI Dependence): Disqualified under Playbook C (${chainCheck.reason}) (0 pts)`,
        `Dim 2 (Active Paid Budget): N/A (0 pts)`,
        `Dim 3 (GBP Maturity & Hiring): N/A (0 pts)`,
        `Dim 4 (Scale & Trajectory): Exceeds boutique retainer size limit (${chainCheck.reason}) (0 pts)`,
        `Dim 5 (DM Reachability): Disqualified entity (0 pts)`,
      ],
    };
  }

  const reasons: string[] = [];
  let score = 0;

  // 1. Dimension 1: Category AI-Answer Dependence (25 pts)
  const highAnxietyCategories = [
    "hospitals", "hospital", "cosmetic_dental", "dental",
    "ivf_fertility", "ivf", "high_ticket_coaching", "coaching"
  ];
  let dim1Score = 0;
  if (highAnxietyCategories.includes(category.toLowerCase())) {
    dim1Score = 25;
    reasons.push(`Dim 1 (AI Dependence): High-anxiety category [${category}] with high financial/physical stakes (+25 pts)`);
  } else if (["hotels", "real_estate", "law_ca"].includes(category.toLowerCase())) {
    dim1Score = 18;
    reasons.push(`Dim 1 (AI Dependence): High-consideration professional service category [${category}] (+18 pts)`);
  } else {
    dim1Score = 10;
    reasons.push(`Dim 1 (AI Dependence): Standard commercial consideration category [${category}] (+10 pts)`);
  }
  score += dim1Score;

  // 2. Dimension 2: Active Paid Budget Signals (25 pts)
  let dim2Score = 0;
  let dim2Evidence = "No active Meta Ad Library campaigns observed (0 pts)";
  if (signals.meta_ads_active && signals.meta_ad_count >= 3) {
    dim2Score += 15;
    dim2Evidence = `Active Meta Ad Library campaigns running with ${signals.meta_ad_count} creatives (+15 pts)`;
  } else if (signals.meta_ads_active) {
    dim2Score += 10;
    dim2Evidence = `Active Meta Ad Library campaign running with ${signals.meta_ad_count || 1} creative (+10 pts)`;
  }

  if (signals.gbp_reviews > 500) {
    dim2Score += 10;
    dim2Evidence += ` · Active commercial review volume indicating sustained acquisition spend (+10 pts)`;
  }
  dim2Score = Math.min(25, dim2Score);
  score += dim2Score;
  reasons.push(`Dim 2 (Paid Budget): ${dim2Evidence} [Score: ${dim2Score}/25]`);

  // 3. Dimension 3: GBP Maturity & Marketing Hiring (20 pts)
  let dim3Score = 0;
  const dim3Parts: string[] = [];
  if (signals.gbp_reviews >= 50 && signals.gbp_owner_replies) {
    dim3Score += 10;
    dim3Parts.push(`GBP maturity: ${signals.gbp_reviews} reviews with verified owner engagement (+10 pts)`);
  } else if (signals.gbp_reviews >= 50) {
    dim3Score += 5;
    dim3Parts.push(`GBP established: ${signals.gbp_reviews} reviews (+5 pts)`);
  } else {
    dim3Parts.push(`GBP nascent: ${signals.gbp_reviews} reviews (0 pts)`);
  }

  if (signals.hiring_marketing) {
    dim3Score += 10;
    dim3Parts.push(`Active marketing/admissions recruitment observed in last 45 days (+10 pts)`);
  }
  score += dim3Score;
  reasons.push(`Dim 3 (GBP & Hiring): ${dim3Parts.join(" · ")} [Score: ${dim3Score}/20]`);

  // 4. Dimension 4: Scale & Growth Trajectory (15 pts)
  let dim4Score = 0;
  const dim4Parts: string[] = [];
  if (signals.branch_count >= 2) {
    dim4Score += 10;
    dim4Parts.push(`Multi-branch footprint (${signals.branch_count} locations) (+10 pts)`);
  } else {
    dim4Parts.push(`Single location footprint (0 pts)`);
  }

  if (signals.review_surge) {
    dim4Score += 5;
    dim4Parts.push(`Recent review surge (15+ reviews in last 30 days) (+5 pts)`);
  }
  score += dim4Score;
  reasons.push(`Dim 4 (Scale & Growth): ${dim4Parts.join(" · ")} [Score: ${dim4Score}/15]`);

  // 5. Dimension 5: Decision-Maker Reachability (15 pts)
  // Playbook D role enforcement:
  // Non-DM contacts (Assistant, Consultant, etc.) are labeled "DM unknown" and score Dim 5 = 0 pts.
  let dim5Score = 0;
  const isLargeOrg = Boolean(signals.is_large_org);
  const isOwnerRun = (signals.branch_count ?? 1) < 5 && !isLargeOrg;

  const roleApproved = isDecisionMakerRole(decisionMaker.role, isLargeOrg);

  const isDMUnknown =
    !roleApproved ||
    decisionMaker.role === "DM unknown" ||
    decisionMaker.name === "DM unknown" ||
    String(decisionMaker.source || "").includes("contact found, DM unknown") ||
    String(decisionMaker.source || "").includes("contact found, dm unknown");

  if (isDMUnknown) {
    dim5Score = 0;
    reasons.push(
      `Dim 5 (DM Reachability): Contact found, DM unknown — role '${decisionMaker.role || "unknown"}' is not an approved DM for ${isLargeOrg ? "large organisation (≥50 staff)" : "small clinic (<50 staff)"} (0 pts) [Score: 0/15]`
    );
  } else {
    const hasHunterEmail = Boolean(
      decisionMaker.email &&
      decisionMaker.email.includes("@") &&
      decisionMaker.source &&
      decisionMaker.source.includes("hunter:") &&
      (decisionMaker.source.includes("deliverable") ||
        decisionMaker.source.includes("risky") ||
        decisionMaker.source.includes("status:") ||
        decisionMaker.source.includes("confidence"))
    );

    const hasPlacesPhone = Boolean(
      isOwnerRun &&
      decisionMaker.phone &&
      String(decisionMaker.phone).trim().length >= 8 &&
      decisionMaker.source &&
      decisionMaker.source.includes("places:phone")
    );

    if (hasHunterEmail && hasPlacesPhone) {
      dim5Score = 15;
      reasons.push(
        `Dim 5 (DM Reachability): Verified website email via Hunter (+10 pts) · Direct Places business phone verified (+5 pts bonus) [Score: 15/15]`
      );
    } else if (hasHunterEmail) {
      dim5Score = 10;
      if (decisionMaker.phone) {
        dim5Score += 5;
        reasons.push(
          `Dim 5 (DM Reachability): Verified website email (${decisionMaker.role}) via Hunter (+10 pts) · Direct phone verified (+5 pts bonus) [Score: 15/15]`
        );
      } else {
        reasons.push(
          `Dim 5 (DM Reachability): Verified website email (${decisionMaker.role}) via Hunter (+10 pts) [Score: 10/15]`
        );
      }
    } else if (hasPlacesPhone) {
      dim5Score = 10;
      reasons.push(
        `Dim 5 (DM Reachability): Verified business phone from Places for owner-run clinic (${decisionMaker.role} / ${decisionMaker.name}) (+10 pts) [Score: 10/15]`
      );
    } else {
      reasons.push(
        `Dim 5 (DM Reachability): Disqualified — No verified website email via Hunter or Places business phone (0/15 pts)`
      );
      return {
        fitScore: 0,
        qualified: false,
        disqualified: true,
        disqualificationReason: "No verified website email via Hunter or Places business phone",
        fitReasons: reasons,
      };
    }
  }

  score += dim5Score;

  const finalScore = Math.min(100, Math.max(0, score));
  const qualified = finalScore >= 70;

  return {
    fitScore: finalScore,
    qualified,
    fitReasons: reasons,
  };
}

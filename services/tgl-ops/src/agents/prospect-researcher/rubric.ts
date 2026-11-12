// services/tgl-ops/src/agents/prospect-researcher/rubric.ts
import type { ProspectSignals, DecisionMaker } from "./types.js";
import { isDecisionMakerRole } from "./sources/enrichment.js";
import { FIT_QUALIFIED_THRESHOLD } from "./threshold.js";
import { assessDecisionMakerEmail } from "./contact-verify.js";
import { detectMultiBranchSignal } from "./brand.js";
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
  /**
   * Issue #184: the decision maker as the rubric judged it. Identical to the input, except that `verified` is false
   * when the email failed the Dimension 5 check (free-mail domain, generic local part, or a domain that does not
   * match the prospect's website root domain). Callers store this, not the input.
   */
  decisionMaker?: DecisionMaker;
  /** Issue #184: the signals with `large_org_cap_reason` set when the large-org cap applied. Callers store this. */
  signals?: ProspectSignals;
  /** Issue #184: why the fit score was capped below the qualified threshold (real multi-branch signal). */
  largeOrgCapReason?: string;
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

/** Convenience wrapper: Dimension 4 points for one engine answer (25 absent with a competitor named, 10 not first, 0 first). */
export function scoreDim4(params: { company: string; domain: string; answer: string; brandPrefix?: string }): number {
  return _analyseDim4Answer(params).score;
}

/**
 * Calculates the 0–100 weighted fit score under rubric v2 (decisions/2026-11-10.md, SKILL.md Playbook F; fixes in issue #184):
 * - Dimension 1: Category AI-Answer Dependence (25 pts) — unchanged
 * - Dimension 2: Visible marketing spend (15 pts) — Meta ads, Google Ads, paid directory listings
 *   (Practo, Justdial, MakeMyTrip) or a site rebuilt in the last 12 months; none observed = 0
 * - Dimension 3: Google profile maturity (20 pts) — review volume (up to 10) + owner engagement (10); hiring criterion removed
 * - Dimension 4: AI visibility gap (25 pts) — scored from `dim4Probe`; no probe supplied = 0 pts, "not probed"
 * - Dimension 5: Decision-Maker Reachability (15 pts: 10 email/phone + 5 phone bonus, 0 = disqualified).
 *   An email counts only when its domain matches the prospect's website root domain and it is neither a free-mail
 *   address (gmail, yahoo, outlook, rediffmail ...) nor a generic local part (info, contact, writetous, admin ...).
 *   A failing email scores 0 and the returned decisionMaker carries verified=false.
 * - Large-org cap: when is_large_org is true from a real multi-branch signal, the fit score is capped below the
 *   qualified threshold and the reason is stored (largeOrgCapReason, signals.large_org_cap_reason, fit_reasons).
 *
 * This function is pure and never calls an engine. Use evaluateProspectRubricWithProbe to run the probe
 * only for candidates that survive Playbook C and Dimension 5.
 * Threshold: >= 65 pts qualifies.
 */
export function evaluateProspectRubric(params: {
  company: string;
  domain: string;
  category: string;
  city?: string;
  signals: ProspectSignals;
  decisionMaker: DecisionMaker;
  dim4Probe?: Dim4Probe | null;
}): RubricEvaluation {
  const { company, domain, category, city, signals, decisionMaker, dim4Probe } = params;

  // First check Playbook C Disqualification (generic chain rule)
  const chainCheck = checkPlaybookCDisqualification(company, domain, signals, city);
  if (chainCheck.disqualified) {
    return {
      fitScore: 0,
      qualified: false,
      disqualified: true,
      disqualificationReason: chainCheck.reason,
      decisionMaker,
      signals,
      fitReasons: [
        `Dim 1 (AI Dependence): Disqualified under Playbook C (${chainCheck.reason}) (0 pts)`,
        `Dim 2 (Visible Marketing Spend): N/A (0 pts)`,
        `Dim 3 (GBP Maturity): N/A (0 pts)`,
        `Dim 4 (AI Visibility Gap): Not probed, disqualified entity (0 pts)`,
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

  // 2. Dimension 2: Visible marketing spend (15 pts). Any one observed signal counts; none observed = 0.
  const spendSignals: string[] = [];
  if (signals.meta_ads_active) {
    spendSignals.push(`Meta ads active (${signals.meta_ad_count || 1} creative${(signals.meta_ad_count || 1) === 1 ? "" : "s"})`);
  }
  if (signals.google_ads_active) {
    spendSignals.push("Google Ads observed");
  }
  if (Array.isArray(signals.paid_directory_listings) && signals.paid_directory_listings.length > 0) {
    spendSignals.push(`paid directory listing (${signals.paid_directory_listings.join(", ")})`);
  }
  if (signals.site_rebuilt_last_12m) {
    spendSignals.push("website rebuilt in the last 12 months");
  }
  const dim2Score = spendSignals.length > 0 ? 15 : 0;
  score += dim2Score;
  reasons.push(
    spendSignals.length > 0
      ? `Dim 2 (Visible Marketing Spend): ${spendSignals.join(" · ")} (+15 pts) [Score: 15/15]`
      : `Dim 2 (Visible Marketing Spend): No Meta ads, Google Ads, paid directory listing or recent site work observed (0 pts) [Score: 0/15]`
  );

  // 3. Dimension 3: Google profile maturity (20 pts). The v1 hiring criterion is removed.
  let dim3Score = 0;
  const dim3Parts: string[] = [];
  const reviews = signals.gbp_reviews || 0;
  if (reviews >= 150) {
    dim3Score += 10;
    dim3Parts.push(`Review volume: ${reviews} Google reviews (+10 pts)`);
  } else if (reviews >= 50) {
    dim3Score += 5;
    dim3Parts.push(`Review volume: ${reviews} Google reviews (+5 pts)`);
  } else {
    dim3Parts.push(`Review volume: ${reviews} Google reviews, profile nascent (0 pts)`);
  }
  if (reviews >= 50 && signals.gbp_owner_replies) {
    dim3Score += 10;
    dim3Parts.push(`Owner engagement with reviews verified (+10 pts)`);
  } else {
    dim3Parts.push(`Owner engagement with reviews not observed (0 pts)`);
  }
  score += dim3Score;
  reasons.push(`Dim 3 (GBP Maturity): ${dim3Parts.join(" · ")} [Score: ${dim3Score}/20]`);

  // 4. Dimension 4: AI visibility gap (25 pts), scored from the probe result.
  let dim4Score = 0;
  if (dim4Probe) {
    dim4Score = Math.min(25, Math.max(0, dim4Probe.score));
    const where = !dim4Probe.prospect_named
      ? dim4Probe.competitor_named
        ? "competitor named and prospect absent"
        : "no business named in the answer"
      : dim4Probe.prospect_position === 1
      ? "prospect named first"
      : `prospect named but not first (position ${dim4Probe.prospect_position})`;
    reasons.push(
      `Dim 4 (AI Visibility Gap): ${dim4Probe.engine} asked "${dim4Probe.question}": ${where} (+${dim4Score} pts) [Score: ${dim4Score}/25]`
    );
  } else {
    reasons.push(`Dim 4 (AI Visibility Gap): Not probed (0 pts) [Score: 0/25]`);
  }
  score += dim4Score;

  // 5. Dimension 5: Decision-Maker Reachability (15 pts).
  // Playbook D role enforcement:
  // Non-DM contacts (Assistant, Consultant, etc.) are labeled "DM unknown" and score Dim 5 = 0 pts.
  // Issue #184: an email counts as verified only if its domain matches the prospect's website root domain and it is
  // neither a free-mail address nor a generic local part. Otherwise it scores 0 and decision_maker.verified = false.
  let dim5Score = 0;
  const isLargeOrg = Boolean(signals.is_large_org);
  const isOwnerRun = (signals.branch_count ?? 1) < 5 && !isLargeOrg;

  const emailPresent = Boolean(decisionMaker.email && decisionMaker.email.includes("@"));
  const emailCheck = emailPresent ? assessDecisionMakerEmail(decisionMaker.email, domain) : null;
  const emailOk = emailCheck ? emailCheck.ok : false;
  const emailRejection = emailPresent && !emailOk ? `email '${decisionMaker.email}' not counted: ${emailCheck?.reason || "failed verification"}` : "";
  const judgedDecisionMaker: DecisionMaker = emailPresent && !emailOk ? { ...decisionMaker, verified: false } : decisionMaker;

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
      `Dim 5 (DM Reachability): Contact found, DM unknown — role '${decisionMaker.role || "unknown"}' is not an approved DM for ${isLargeOrg ? "large organisation (≥50 staff)" : "small clinic (<50 staff)"}${emailRejection ? `; ${emailRejection}` : ""} (0 pts) [Score: 0/15]`
    );
  } else {
    const hasHunterEmail = Boolean(
      emailOk &&
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
        `Dim 5 (DM Reachability): Verified business phone from Places for owner-run clinic (${decisionMaker.role} / ${decisionMaker.name})${emailRejection ? `; ${emailRejection}` : ""} (+10 pts) [Score: 10/15]`
      );
    } else {
      reasons.push(
        `Dim 5 (DM Reachability): Disqualified — No verified website email via Hunter or Places business phone${emailRejection ? ` (${emailRejection})` : ""} (0/15 pts)`
      );
      return {
        fitScore: 0,
        qualified: false,
        disqualified: true,
        disqualificationReason: `No verified website email via Hunter or Places business phone${emailRejection ? ` (${emailRejection})` : ""}`,
        fitReasons: reasons,
        dim4Probed: false,
        decisionMaker: judgedDecisionMaker,
        signals,
      };
    }
  }

  score += dim5Score;

  // Issue #184: a large organisation identified by a real multi-branch signal never qualifies on score alone.
  // "dr." and other generic brand prefixes are not a multi-branch signal (see brand.ts), so they never trigger this.
  let finalScore = Math.min(100, Math.max(0, score));
  let largeOrgCapReason: string | undefined;
  const multiBranch = isLargeOrg ? detectMultiBranchSignal(signals) : null;
  if (multiBranch && finalScore >= FIT_QUALIFIED_THRESHOLD) {
    const cap = FIT_QUALIFIED_THRESHOLD - 1;
    largeOrgCapReason = `Large organisation from a real multi-branch signal (${multiBranch}): fit score capped at ${cap} (uncapped ${finalScore}), below the ${FIT_QUALIFIED_THRESHOLD} qualified threshold`;
    reasons.push(`Large-org cap: ${largeOrgCapReason}`);
    finalScore = cap;
  }

  // The probe record rides along as a sixth fit_reasons entry so touch 1 can quote it.
  if (dim4Probe) {
    reasons.push(serializeDim4Probe(dim4Probe));
  }

  const qualified = finalScore >= FIT_QUALIFIED_THRESHOLD;

  return {
    fitScore: finalScore,
    qualified,
    fitReasons: reasons,
    dim4Probed: Boolean(dim4Probe),
    decisionMaker: judgedDecisionMaker,
    signals: { ...signals, large_org_cap_reason: largeOrgCapReason },
    largeOrgCapReason,
  };
}

export interface ProbedRubricEvaluation extends RubricEvaluation {
  /** True when the probe function was called for this candidate. Never true for a Playbook C or Dimension 5 rejection. */
  probeCalled: boolean;
  /** The probe result, when one was obtained. */
  probe?: Dim4Probe | null;
  /** True when the candidate passed Dimension 5 but no probe result could be obtained (cap, missing engine config, engine error). */
  probeUnavailable?: boolean;
}

/**
 * Rubric v2 with Dimension 4 probe, in the cost-safe order:
 * 1. Score without a probe. A Playbook C or Dimension 5 disqualification returns here, probe never called.
 * 2. Otherwise call the probe exactly once and re-score with its result.
 * If the probe returns null the candidate is NOT scored as qualified: Dimension 4 is unknown, not zero.
 * The probe receives the brand prefix and the Places primary type so the question is specialty-specific.
 */
export async function evaluateProspectRubricWithProbe(params: {
  company: string;
  domain: string;
  category: string;
  city?: string;
  signals: ProspectSignals;
  decisionMaker: DecisionMaker;
  probe: Dim4ProbeFn;
}): Promise<ProbedRubricEvaluation> {
  const { probe, ...base } = params;

  const first = evaluateProspectRubric(base);
  if (first.disqualified) {
    return { ...first, probeCalled: false };
  }

  const result = await probe({
    company: base.company,
    domain: base.domain,
    category: base.category,
    city: base.city,
    brandPrefix: base.signals.brand_prefix,
    primaryType: base.signals.primary_place_type,
    primaryTypeLabel: base.signals.primary_place_type_label,
  });
  if (!result) {
    return { ...first, qualified: false, probeCalled: true, probe: null, probeUnavailable: true };
  }

  const scored = evaluateProspectRubric({ ...base, dim4Probe: result });
  return { ...scored, probeCalled: true, probe: result };
}

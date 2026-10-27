// services/tgl-ops/src/agents/prospect-researcher/rubric.ts
import type { ProspectSignals, DecisionMaker } from "./types.js";

export interface RubricEvaluation {
  fitScore: number;
  qualified: boolean;
  fitReasons: string[];
  disqualified?: boolean;
  disqualificationReason?: string;
}

/**
 * List of known enterprise healthcare, dental, and coaching chains disqualified
 * under Playbook C (groups with 5+ cities, 500+ beds, or publicly listed entities).
 */
const PLAYBOOK_C_ENTERPRISE_DOMAINS = new Set([
  // Hospital chains & trusts (>500 beds / multi-city enterprise)
  "apollohospitals.com",
  "apollohl.com",
  "fortishealthcare.com",
  "maxhealthcare.in",
  "medanta.org",
  "manipalhospitals.com",
  "narayanahealth.org",
  "asterdmhealthcare.com",
  "shalby.org",
  "yatharthhospitals.com",
  "rainbowhospitals.in",
  "kimshospitals.com",
  "carehospitals.com",
  "sgrh.com",
  "jaypeehospital.com",
  "artemishospitals.com",
  "columbiaasia.com",
  // Enterprise dental chains
  "clovedental.in",
  "sabkadentist.com",
  "apollowhitedental.com",
  "mydentist.co.in",
  // Enterprise coaching chains
  "allen.in",
  "allen.ac.in",
  "aakash.ac.in",
  "fiitjee.com",
  "srichaitanya.net",
  "narayanagroup.com",
  "resonance.ac.in",
  "time4education.com",
  "careerlauncher.com",
  "imsindia.com",
  "pw.live",
]);

/**
 * Checks whether an institution is disqualified under Playbook C.
 */
export function checkPlaybookCDisqualification(
  company: string,
  domain: string,
  signals?: ProspectSignals
): { disqualified: boolean; reason?: string } {
  const normDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
  const normName = company.toLowerCase();

  // 1. Direct domain match against enterprise chain list
  if (PLAYBOOK_C_ENTERPRISE_DOMAINS.has(normDomain)) {
    return {
      disqualified: true,
      reason: `Playbook C: Enterprise chain / listed entity (${normDomain}) disqualified for AEO retainer door.`,
    };
  }

  // 2. Name keywords for national enterprise groups
  const enterpriseKeywords = [
    "apollo hospital", "fortis hospital", "max super speciality", "max hospital",
    "medanta", "manipal hospital", "narayana health", "narayana hrudayalaya",
    "aster hospital", "clove dental", "sabka dentist", "apollo white",
    "allen career", "aakash institute", "fiitjee", "sri chaitanya", "narayana educational",
  ];
  for (const kw of enterpriseKeywords) {
    if (normName.includes(kw)) {
      return {
        disqualified: true,
        reason: `Playbook C: National enterprise group keyword match ('${kw}') disqualified for AEO retainer door.`,
      };
    }
  }

  // 3. Scale signals (5+ cities or 500+ beds)
  if (signals && signals.branch_count >= 5) {
    return {
      disqualified: true,
      reason: `Playbook C: Enterprise footprint with ${signals.branch_count} cities/locations exceeds single-operator retainer scope.`,
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
 * - Dimension 5: Decision-Maker Reachability (15 pts: 10 email + 5 phone bonus)
 *
 * Emits exactly 5 distinct itemized reasons with explicit evidence for each dimension.
 * Threshold: >= 70 pts qualifies for weekly delivery batch.
 */
export function evaluateProspectRubric(params: {
  company: string;
  domain: string;
  category: string;
  signals: ProspectSignals;
  decisionMaker: DecisionMaker;
}): RubricEvaluation {
  const { company, domain, category, signals, decisionMaker } = params;

  // First check Playbook C Disqualification
  const chainCheck = checkPlaybookCDisqualification(company, domain, signals);
  if (chainCheck.disqualified) {
    return {
      fitScore: 0,
      qualified: false,
      disqualified: true,
      disqualificationReason: chainCheck.reason,
      fitReasons: [
        `Dim 1 (AI Dependence): Disqualified under Playbook C (0 pts)`,
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
  let dim5Score = 0;
  const hasValidEmail = Boolean(
    decisionMaker.email &&
    decisionMaker.email.includes("@") &&
    decisionMaker.source &&
    (decisionMaker.source.includes("apollo:") || decisionMaker.source.includes("hunter:"))
  );

  if (hasValidEmail) {
    dim5Score += 10;
    let emailEvidence = `Verified work email (${decisionMaker.role}) via ${decisionMaker.source} (+10 pts)`;
    if (decisionMaker.phone) {
      dim5Score += 5;
      emailEvidence += ` · Direct phone/WhatsApp verified (+5 pts)`;
    }
    reasons.push(`Dim 5 (DM Reachability): ${emailEvidence} [Score: ${dim5Score}/15]`);
  } else {
    reasons.push(`Dim 5 (DM Reachability): Disqualified — No verified work email via Apollo/Hunter API (0/15 pts)`);
    return {
      fitScore: 0,
      qualified: false,
      disqualified: true,
      disqualificationReason: "No verified direct work email from Hunter or Apollo API",
      fitReasons: reasons,
    };
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


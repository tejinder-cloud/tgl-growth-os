// services/tgl-ops/src/agents/prospect-researcher/rubric.ts
import type { ProspectSignals, DecisionMaker } from "./types.js";

export interface RubricEvaluation {
  fitScore: number;
  qualified: boolean;
  fitReasons: string[];
}

/**
 * Calculates 0–100 weighted fit score strictly adhering to SKILL.md Playbook F:
 * - Dimension 1: Category AI-Answer Dependence (25 pts)
 * - Dimension 2: Active Paid Budget Signals (25 pts)
 * - Dimension 3: GBP Maturity & Marketing Hiring (20 pts)
 * - Dimension 4: Scale & Growth Trajectory (15 pts)
 * - Dimension 5: Decision-Maker Reachability (15 pts: 10 email + 5 phone bonus)
 *
 * Threshold: >= 70 pts qualifies for weekly delivery batch.
 */
export function evaluateProspectRubric(params: {
  category: string;
  signals: ProspectSignals;
  decisionMaker: DecisionMaker;
}): RubricEvaluation {
  const { category, signals, decisionMaker } = params;
  const reasons: string[] = [];
  let score = 0;

  // 1. Dimension 1: Category AI-Answer Dependence (25 pts)
  const highAnxietyCategories = [
    "hospitals",
    "hospital",
    "cosmetic_dental",
    "dental",
    "ivf_fertility",
    "ivf",
    "high_ticket_coaching",
    "coaching",
  ];

  if (highAnxietyCategories.includes(category.toLowerCase())) {
    score += 25;
    reasons.push("High-anxiety, AI-answer-dependent category: purchase decided by search authority (+25)");
  } else if (["hotels", "real_estate", "law_ca"].includes(category.toLowerCase())) {
    score += 18;
    reasons.push("High-consideration professional service category (+18)");
  } else {
    score += 10;
    reasons.push("Standard commercial consideration category (+10)");
  }

  // 2. Dimension 2: Active Paid Budget Signals (25 pts)
  if (signals.meta_ads_active && signals.meta_ad_count >= 3) {
    score += 15;
    reasons.push(`Active Meta Ad Library campaigns running with ${signals.meta_ad_count} creatives (+15)`);
  } else if (signals.meta_ads_active) {
    score += 10;
    reasons.push("Active Meta Ad Library campaign running (+10)");
  }

  // Google Ads / SEM presence
  if (signals.gbp_reviews > 500 || signals.meta_ads_active) {
    score += 10;
    reasons.push("Active paid digital customer acquisition presence (+10)");
  }

  // 3. Dimension 3: GBP Maturity & Marketing Hiring (20 pts)
  if (signals.gbp_reviews >= 50 && signals.gbp_owner_replies) {
    score += 10;
    reasons.push(`GBP maturity: ${signals.gbp_reviews} verified reviews with active owner engagement (+10)`);
  } else if (signals.gbp_reviews >= 50) {
    score += 5;
    reasons.push(`GBP established with ${signals.gbp_reviews} reviews (+5)`);
  }

  if (signals.hiring_marketing) {
    score += 10;
    reasons.push("Active recruitment observed for marketing/admissions staff in last 45 days (+10)");
  }

  // 4. Dimension 4: Scale & Growth Trajectory (15 pts)
  if (signals.branch_count >= 2) {
    score += 10;
    reasons.push(`Multi-branch footprint (${signals.branch_count} locations) requiring multi-location visibility (+10)`);
  }

  if (signals.review_surge) {
    score += 5;
    reasons.push("Recent surge in customer reviews indicating high transaction velocity (+5)");
  }

  // 5. Dimension 5: Decision-Maker Reachability (15 pts)
  // Work email is mandatory baseline (10 pts)
  if (decisionMaker.email && decisionMaker.email.includes("@")) {
    score += 10;
    reasons.push(`Verified direct work email (${decisionMaker.role}) (+10)`);
  } else {
    // Missing work email disqualifies immediately
    reasons.push("Disqualified: No verified corporate work email found (0)");
    return {
      fitScore: 0,
      qualified: false,
      fitReasons: reasons,
    };
  }

  // Direct corporate phone / WhatsApp is an optional +5 bonus
  if (decisionMaker.phone) {
    score += 5;
    reasons.push("Direct corporate phone / WhatsApp verified (+5 bonus)");
  }

  const finalScore = Math.min(100, Math.max(0, score));
  const qualified = finalScore >= 70;

  return {
    fitScore: finalScore,
    qualified,
    fitReasons: reasons,
  };
}

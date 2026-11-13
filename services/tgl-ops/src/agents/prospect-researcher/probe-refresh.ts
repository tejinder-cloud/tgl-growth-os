// services/tgl-ops/src/agents/prospect-researcher/probe-refresh.ts
// Issue #184: prospects that qualified on a generic Dimension 4 question are re-scored once, before new discovery.
//
// A row is refreshed when all of these hold:
//   - status "new" (qualified, waiting for the Architect's review; nothing has been sent to it),
//   - it carries a stored v2 probe,
//   - the question that probe asked is not the question the current builder would ask for this prospect
//     (for example "best hospital in <city>" for a maternity hospital or a single surgeon).
//
// The refresh re-derives the brand token and organisation size, applies the work-contact rule to the stored
// decision maker (an address that fails is removed from the row, not just ignored), then runs the normal
// cost-safe scoring: a row that fails Playbook C or Dimension 5 never reaches the probe.
// A row whose probe cannot run (cap, engine unavailable, engine error) is left exactly as it was and retried next run.
// Reviewed and handed-to-outreach rows are never touched here: the Architect has already acted on them.
import type { DecisionMaker, ProspectRecord } from "./types.js";
import { evaluateProspectRubricWithProbe } from "./rubric.js";
import { buildDim4Question, parseDim4Probe, type Dim4ProbeFn } from "./dim4.js";
import { PUBLISHED_EMAIL_SOURCE, assessPublishedEmail, assessWorkEmail } from "./contact-rules.js";
import { isCandidateOrgSizeGe50 } from "./sources/enrichment.js";
import { extractBrandToken } from "./sources/website-scraper.js";
import { minimiseDecisionMaker } from "./bench-save.js";
import { FIT_BENCH_FLOOR } from "./threshold.js";

export interface ProbeRefreshResult {
  /** Rows whose stored probe asked an outdated question. */
  eligible: number;
  /** Rows changed and to be written back. */
  touched: ProspectRecord[];
  /** Still at or above the qualified threshold on the new question: status stays "new". */
  kept: ProspectRecord[];
  /** Now between the bench floor and the threshold: status "bench". */
  benched: ProspectRecord[];
  /** Disqualified or below the bench floor: status "rejected". */
  rejected: ProspectRecord[];
  /** Left untouched because the probe was unavailable. Retried next run. */
  notProbed: ProspectRecord[];
}

/** The question the current builder asks for a stored row. */
export function currentDim4QuestionFor(p: ProspectRecord): string {
  return buildDim4Question(p.category, p.city, {
    company: p.company,
    placeType: p.signals?.place_primary_type,
    placeTypeLabel: p.signals?.place_primary_type_label,
  });
}

/** True for a qualified, unreviewed row whose stored probe asked a question the current builder would not ask. */
export function hasOutdatedProbeQuestion(p: ProspectRecord): boolean {
  if (p.deleted_at) return false;
  if (p.status !== "new") return false;
  const stored = parseDim4Probe(p.fit_reasons);
  if (!stored || typeof stored.question !== "string") return false;
  return stored.question.trim().toLowerCase() !== currentDim4QuestionFor(p).trim().toLowerCase();
}

/**
 * Applies the work-contact rule to a stored decision maker.
 * An email that fails is removed. An owner-run practice keeps its Google Places business line as the contact route;
 * anything else is left with no verified route, which Dimension 5 then disqualifies.
 */
export function applyContactRuleToStoredDecisionMaker(
  dm: DecisionMaker,
  website: string,
  ownerRun: boolean
): DecisionMaker {
  const raw: DecisionMaker = { ...dm };
  if (!raw.email) return raw;
  const check = assessWorkEmail(raw.email, website);
  if (check.ok) return raw;
  // An owner-run business's published address (13 Nov 2026 decision) is kept; it was never claimed to be a named one.
  if (ownerRun && String(raw.source || "").includes(PUBLISHED_EMAIL_SOURCE) && assessPublishedEmail(raw.email, website).ok) return raw;
  const phone = raw.phone ? String(raw.phone).trim() : "";
  if (ownerRun && phone.length >= 8) {
    return {
      ...raw,
      email: "",
      source: `places:phone (verified business line); email removed: ${check.reason}`,
      verified: true,
    };
  }
  return {
    ...raw,
    email: "",
    source: `unverified: email removed (${check.reason})`,
    verified: false,
  };
}

export async function refreshOutdatedProbes(params: {
  prospects: ProspectRecord[];
  probe: Dim4ProbeFn;
  now?: () => Date;
}): Promise<ProbeRefreshResult> {
  const now = params.now ?? (() => new Date());
  const result: ProbeRefreshResult = { eligible: 0, touched: [], kept: [], benched: [], rejected: [], notProbed: [] };

  const outdated = params.prospects.filter(hasOutdatedProbeQuestion);
  result.eligible = outdated.length;

  for (const original of outdated) {
    const p: ProspectRecord = { ...original, signals: { ...original.signals } };

    p.signals.brand_prefix = extractBrandToken(p.company, p.website).brand;
    p.signals.is_large_org = isCandidateOrgSizeGe50(
      { name: p.company, userRatingsTotal: p.signals.gbp_reviews, placesBrandCount: p.signals.places_brand_count },
      p.category
    );
    const ownerRun = !p.signals.is_large_org && (p.signals.branch_count ?? 1) < 5;
    p.decision_maker = applyContactRuleToStoredDecisionMaker(p.decision_maker, p.website, ownerRun);

    const evalRes = await evaluateProspectRubricWithProbe({
      company: p.company,
      domain: p.website,
      category: p.category,
      city: p.city,
      signals: p.signals,
      decisionMaker: p.decision_maker,
      probe: params.probe,
    });

    if (evalRes.probeUnavailable) {
      result.notProbed.push(original);
      continue;
    }

    p.fit_reasons = evalRes.fitReasons;
    p.rescored_at = now().toISOString();

    if (evalRes.disqualified) {
      p.fit_score = 0;
      p.status = "rejected";
      result.rejected.push(p);
    } else if (evalRes.qualified) {
      p.fit_score = evalRes.fitScore;
      result.kept.push(p);
    } else if (evalRes.fitScore >= FIT_BENCH_FLOOR) {
      p.fit_score = evalRes.fitScore;
      p.status = "bench";
      p.decision_maker = minimiseDecisionMaker(p.decision_maker);
      result.benched.push(p);
    } else {
      p.fit_score = evalRes.fitScore;
      p.status = "rejected";
      result.rejected.push(p);
    }
    result.touched.push(p);
  }

  return result;
}

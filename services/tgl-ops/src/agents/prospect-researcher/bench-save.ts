// services/tgl-ops/src/agents/prospect-researcher/bench-save.ts
// Gate 8 routing under rubric v2 (issue #177, Playbook F).
//
//   disqualified (Playbook C or Dimension 5)        -> rejected, never saved (as before)
//   fit score below FIT_BENCH_FLOOR (50)             -> rejected, never saved (as before)
//   FIT_BENCH_FLOOR <= score < FIT_QUALIFIED_THRESHOLD -> saved with status "bench"
//   score >= FIT_QUALIFIED_THRESHOLD (65)            -> qualified, status "new" (as before)
//
// A benched row is never added to the qualified list, never reaches the Top 25 card or CSV, and is never
// handed to outreach (the sequencer only enrols status "reviewed"). The Monday re-score and the v2 bench
// re-score (bench-rescore.ts) read these rows from the prospects table.
import type { DecisionMaker, ProspectRecord, ProspectSignals } from "./types.js";
import { FIT_BENCH_FLOOR, FIT_QUALIFIED_THRESHOLD } from "./threshold.js";
import { validateProspectRecord } from "./guardrails.js";

export type Gate8Route = "qualified" | "bench" | "rejected";

/** The slice of a rubric evaluation that routing needs. Satisfied by RubricEvaluation and ProbedRubricEvaluation. */
export interface Gate8Evaluation {
  fitScore: number;
  qualified: boolean;
  disqualified?: boolean;
  fitReasons: string[];
}

/** Pure score-band routing. A disqualified candidate is never benched, whatever its score field says. */
export function routeGate8(evaluation: Pick<Gate8Evaluation, "fitScore" | "qualified" | "disqualified">): Gate8Route {
  if (evaluation.disqualified) return "rejected";
  const score = evaluation.fitScore;
  if (typeof score !== "number" || Number.isNaN(score)) return "rejected";
  if (evaluation.qualified && score >= FIT_QUALIFIED_THRESHOLD) return "qualified";
  if (score >= FIT_BENCH_FLOOR && score < FIT_QUALIFIED_THRESHOLD) return "bench";
  return "rejected";
}

/**
 * Decision-maker data kept on a benched row: name, role, work email, work phone.
 * Anything else the enrichment step returned (verified flag, social handles, personal emails, notes) is dropped.
 * `source` is retained as a provenance tag (for example "hunter:..." or "places:phone ..."): it is not personal data,
 * and the write gate and the Dimension 5 re-score both read it to confirm the contact was verified.
 */
export function minimiseDecisionMaker(dm: DecisionMaker): DecisionMaker {
  const raw: any = dm || {};
  const phone = raw.phone ? String(raw.phone).trim() : "";
  return {
    name: String(raw.name || "").trim(),
    role: String(raw.role || "").trim(),
    email: String(raw.email || "").trim(),
    ...(phone ? { phone } : {}),
    source: String(raw.source || "").trim(),
  };
}

export interface ScoredCandidate {
  company: string;
  category: string;
  city: string;
  website: string;
  evaluation: Gate8Evaluation;
  decisionMaker: DecisionMaker;
  signals: ProspectSignals;
  sourceRefs: string[];
  now?: () => Date;
}

/** Builds the prospects row. Qualified rows keep the full enrichment payload as before; bench rows are minimised. */
export function buildScoredRecord(c: ScoredCandidate, route: "qualified" | "bench"): ProspectRecord {
  const stamp = (c.now ?? (() => new Date()))().toISOString();
  return {
    tenant_id: "tgl",
    company: c.company,
    category: c.category,
    city: c.city,
    website: c.website,
    door: "aeo",
    fit_score: c.evaluation.fitScore,
    // fitReasons already carries one entry per dimension plus the dim4_probe record when a probe ran.
    fit_reasons: [...c.evaluation.fitReasons],
    decision_maker: route === "bench" ? minimiseDecisionMaker(c.decisionMaker) : c.decisionMaker,
    signals: c.signals,
    status: route === "bench" ? "bench" : "new",
    source_refs: c.sourceRefs,
    created_at: stamp,
    rescored_at: stamp,
  };
}

export interface Gate8Lists {
  /** Qualified list for the run (card, CSV, hand-off to review). A benched row is never pushed here. */
  qualified: ProspectRecord[];
  /** Rows to be written with status "bench". Never notified, never handed to outreach. */
  benched: ProspectRecord[];
}

export interface Gate8Result {
  route: Gate8Route;
  record?: ProspectRecord;
  /** Set when the score band accepted the candidate but the Gate 9 write validation refused the row. */
  writeRejectedReason?: string;
  /** True when the record was added to one of the lists. */
  placed: boolean;
}

/** Routes one scored candidate, validates the row (Gate 9) and places it on the matching list. */
export function routeScoredCandidate(candidate: ScoredCandidate, lists: Gate8Lists): Gate8Result {
  const route = routeGate8(candidate.evaluation);
  if (route === "rejected") {
    return { route, placed: false };
  }

  const record = buildScoredRecord(candidate, route);
  const check = validateProspectRecord(record);
  if (!check.valid) {
    return { route, record, writeRejectedReason: check.reason, placed: false };
  }

  if (route === "bench") {
    lists.benched.push(record);
  } else {
    lists.qualified.push(record);
  }
  return { route, record, placed: true };
}

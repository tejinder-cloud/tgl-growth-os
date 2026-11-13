// services/tgl-ops/src/agents/prospect-researcher/bench-rescore.ts
// Rubric v2 rotation step (issue #171, decisions/2026-11-10.md): benched candidates (status nurture or bench,
// score 50 to 69 under v1) are re-scored under v2 on the next run, BEFORE new discovery.
//
// - Rows that already carry a dim4_probe were scored under v2 and are not re-probed (no repeat spend).
// - A row whose probe cannot run (cap, engine unavailable, engine error) is left untouched and retried next run.
// - Disqualified rows (Playbook C, Dimension 5 = 0) never reach the probe.
import type { ProspectRecord } from "./types.js";
import { evaluateProspectRubricWithProbe } from "./rubric.js";
import { parseDim4Probe, type Dim4ProbeFn } from "./dim4.js";
import { FIT_BENCH_FLOOR } from "./threshold.js";

export interface BenchRescoreResult {
  /** Rows eligible for re-score this run. */
  eligible: number;
  /** Rows whose status or score changed and must be written back. Includes promoted and rejected rows. */
  touched: ProspectRecord[];
  /** Re-scored at or above the qualified threshold: status "new", pending Architect review. */
  promoted: ProspectRecord[];
  /** Re-scored below the threshold but at or above the bench floor: stay nurture / bench with the v2 score. */
  stillBenched: ProspectRecord[];
  /** Re-scored below the bench floor, or disqualified: status "rejected". */
  rejected: ProspectRecord[];
  /** Left untouched because the Dimension 4 probe was unavailable. Retried next run. */
  notProbed: ProspectRecord[];
}

/** True for a row that should be re-scored under v2: nurture/bench, v1 score 50 to 69, not deleted, no v2 probe yet. */
export function isBenchedForV2Rescore(p: ProspectRecord): boolean {
  if (p.deleted_at) return false;
  if (p.status !== "nurture" && p.status !== "bench") return false;
  if (typeof p.fit_score !== "number" || p.fit_score < FIT_BENCH_FLOOR || p.fit_score > 69) return false;
  return parseDim4Probe(p.fit_reasons) === null;
}

export async function rescoreBenchedProspects(params: {
  prospects: ProspectRecord[];
  probe: Dim4ProbeFn;
  now?: () => Date;
}): Promise<BenchRescoreResult> {
  const now = params.now ?? (() => new Date());
  const result: BenchRescoreResult = {
    eligible: 0,
    touched: [],
    promoted: [],
    stillBenched: [],
    rejected: [],
    notProbed: [],
  };

  const benched = params.prospects.filter(isBenchedForV2Rescore);
  result.eligible = benched.length;

  for (const original of benched) {
    const p: ProspectRecord = { ...original, signals: { ...original.signals } };
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
      p.status = "new";
      result.promoted.push(p);
    } else if (evalRes.fitScore >= FIT_BENCH_FLOOR) {
      p.fit_score = evalRes.fitScore;
      result.stillBenched.push(p);
    } else {
      p.fit_score = evalRes.fitScore;
      p.status = "rejected";
      result.rejected.push(p);
    }
    result.touched.push(p);
  }

  return result;
}

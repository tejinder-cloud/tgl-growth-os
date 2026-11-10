// services/tgl-ops/src/agents/prospect-researcher/threshold.ts
// Single source of truth for the fit-score thresholds. Kept in its own module so rubric.ts and guardrails.ts
// can both import it without creating an import cycle (rubric -> enrichment -> guardrails).

/** Rubric v2 (decisions/2026-11-10.md): qualified at 65 or above. Was 70 under v1. */
export const FIT_QUALIFIED_THRESHOLD = 65;

/** Playbook F: below this score a scored (non-disqualified) candidate is rejected; between this and the threshold it is benched. */
export const FIT_BENCH_FLOOR = 50;

/** Rubric version stamped on re-scored rows and probe records. */
export const RUBRIC_VERSION = "v2";

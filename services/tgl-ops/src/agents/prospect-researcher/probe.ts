// services/tgl-ops/src/agents/prospect-researcher/probe.ts
// Rubric v2 Dimension 4 probe: ask ONE engine (Gemini) ONE buyer question per candidate, record the cost
// under prospect-researcher in usage_costs, and stop for the day once the agent's daily cap is reached.
//
// Cost rules (decisions/2026-11-10.md, issue #171):
// - One probe per candidate that has passed Dimension 5. Never for rejected candidates: the caller
//   (evaluateProspectRubricWithProbe) only reaches this function after Playbook C and Dimension 5 pass.
// - Every completed probe is recorded with recordApiSpend under agent "prospect-researcher".
// - The cap is checked before each call. The first refusal halts probing for the rest of the run; every
//   candidate not probed is counted and reported as a shortfall. The cap can be overshot by at most one probe.
import { askEngine, loadEngineConfig } from "../aeo-audit-engine/engines.js";
import type { AskOptions, EngineAnswer, EngineConfig } from "../aeo-audit-engine/types.js";
import { getAgentCostCap, getAgentTodaySpend, recordApiSpend } from "../../lib/cost-cap.js";
import { analyseDim4Answer, buildDim4Question, type Dim4Probe, type Dim4ProbeFn } from "./dim4.js";
import { RUBRIC_VERSION } from "./threshold.js";

export const PROBE_AGENT = "prospect-researcher";
export const PROBE_ENGINE = "gemini" as const;
export const PROBE_API_NAME = "gemini-dim4-probe";

export interface ProbeDeps {
  askEngine: (cfg: EngineConfig, prompt: string, opts?: AskOptions) => Promise<EngineAnswer>;
  loadEngineConfig: (engine: "gemini") => { config?: EngineConfig; missing: string[] };
  getSpendUsd: () => Promise<number>;
  getCapUsd: () => Promise<number>;
  recordSpend: (usd: number, details: string) => void;
  now: () => Date;
}

export interface ProbeStats {
  /** Candidates handed to the probe (all passed Dimension 5). */
  requested: number;
  /** Engine calls that returned an answer. */
  completed: number;
  /** Engine calls that threw. */
  failed: number;
  /** Candidates not probed because the daily cap was reached. */
  skippedCap: number;
  /** Candidates not probed because the engine is not configured (or test mode blocks live calls). */
  skippedUnavailable: number;
  costUsd: number;
  capUsd?: number;
  spendUsdAtHalt?: number;
  haltedReason?: string;
}

export interface ProbeGovernor {
  probe: Dim4ProbeFn;
  stats: ProbeStats;
  /** Plain-text shortfall line for the run log and standup, or null when every candidate was probed. */
  shortfallReport(): string | null;
}

export function createDim4ProbeGovernor(
  options?: { testMode?: boolean },
  deps?: Partial<ProbeDeps>
): ProbeGovernor {
  const testMode = options?.testMode === true;
  const d: ProbeDeps = {
    askEngine: deps?.askEngine ?? askEngine,
    loadEngineConfig: deps?.loadEngineConfig ?? ((engine) => loadEngineConfig(engine)),
    getSpendUsd: deps?.getSpendUsd ?? (() => getAgentTodaySpend(PROBE_AGENT, undefined, options)),
    getCapUsd: deps?.getCapUsd ?? (() => getAgentCostCap(PROBE_AGENT)),
    recordSpend:
      deps?.recordSpend ??
      ((usd, details) =>
        recordApiSpend({ agent: PROBE_AGENT, apiName: PROBE_API_NAME, totalCostUsd: usd, details, options })),
    now: deps?.now ?? (() => new Date()),
  };

  const stats: ProbeStats = { requested: 0, completed: 0, failed: 0, skippedCap: 0, skippedUnavailable: 0, costUsd: 0 };
  let engineConfig: EngineConfig | undefined;
  let capHalted = false;
  let unavailable = false;

  const probe: Dim4ProbeFn = async ({ company, domain, category, city }) => {
    stats.requested++;

    if (capHalted) {
      stats.skippedCap++;
      return null;
    }
    if (unavailable) {
      stats.skippedUnavailable++;
      return null;
    }

    // Tests never reach a live engine unless they inject their own askEngine.
    if (testMode && !deps?.askEngine) {
      unavailable = true;
      stats.haltedReason = "test mode: live engine calls are disabled";
      stats.skippedUnavailable++;
      return null;
    }

    if (!engineConfig) {
      const loaded = d.loadEngineConfig(PROBE_ENGINE);
      if (!loaded.config) {
        unavailable = true;
        stats.haltedReason = `${PROBE_ENGINE} not configured, missing: ${loaded.missing.join(", ")}`;
        stats.skippedUnavailable++;
        return null;
      }
      engineConfig = loaded.config;
    }

    const [spend, cap] = await Promise.all([d.getSpendUsd(), d.getCapUsd()]);
    if (spend >= cap) {
      capHalted = true;
      stats.capUsd = cap;
      stats.spendUsdAtHalt = spend;
      stats.haltedReason = `daily cap reached (spend $${spend.toFixed(4)} of $${cap.toFixed(2)})`;
      stats.skippedCap++;
      return null;
    }

    const question = buildDim4Question(category, city || "");
    let answer: EngineAnswer;
    try {
      answer = await d.askEngine(engineConfig, question, { country: "IN" });
    } catch (err: any) {
      stats.failed++;
      console.warn(`[Dim 4 Probe Error on ${company}]: ${err?.message || err}`);
      return null;
    }

    stats.completed++;
    stats.costUsd = Number((stats.costUsd + answer.costUsd).toFixed(6));
    d.recordSpend(answer.costUsd, `Dim 4 probe (${answer.engine} ${answer.model}): "${question}" for ${company}`);

    const analysis = analyseDim4Answer({ company, domain, answer: answer.text });
    const record: Dim4Probe = {
      rubric_version: RUBRIC_VERSION as "v2",
      engine: answer.engine,
      model: answer.model,
      question,
      answer: answer.text,
      names_found: analysis.namesFound,
      prospect_named: analysis.prospectNamed,
      prospect_position: analysis.prospectPosition,
      competitor_named: analysis.competitorNamed,
      score: analysis.score,
      date: d.now().toISOString(),
      cost_usd: answer.costUsd,
    };
    return record;
  };

  const shortfallReport = (): string | null => {
    const notProbed = stats.skippedCap + stats.skippedUnavailable + stats.failed;
    if (notProbed === 0) return null;
    const parts: string[] = [];
    if (stats.skippedCap > 0) {
      parts.push(
        `${stats.skippedCap} not probed because the daily cap was reached` +
          (stats.capUsd !== undefined ? ` ($${(stats.spendUsdAtHalt ?? 0).toFixed(4)} of $${stats.capUsd.toFixed(2)})` : "")
      );
    }
    if (stats.skippedUnavailable > 0) {
      parts.push(`${stats.skippedUnavailable} not probed, engine unavailable (${stats.haltedReason || "unknown"})`);
    }
    if (stats.failed > 0) {
      parts.push(`${stats.failed} engine call(s) failed`);
    }
    return `Dim 4 probe shortfall: ${notProbed} of ${stats.requested} candidate(s) not scored (${parts.join("; ")}). They are not written and will be retried on the next run.`;
  };

  return { probe, stats, shortfallReport };
}

// services/tgl-ops/src/agents/aeo-audit-engine/tracker.ts
// Citation Tracker (plan Day 17): every day, ask each configured engine every active prompt for each eligible
// brand; store runs → answers → citations, and the day's engine spend per brand in usage_costs (SPEC §11, §14).
import { askEngine, computeCostUsd, loadEngineConfig } from "./engines.js";
import { analyzeAnswer, analyzeCitation } from "./analyze.js";
import type { RunKind, TrackerStore } from "./store.js";
import { API_ENGINES, type EngineConfig, type EngineId } from "./types.js";

export const AGENT = "aeo-audit-engine";
const LABEL: Record<EngineId, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };

export interface TrackerDeps {
  store: TrackerStore;
  runDate: string;                       // IST date, YYYY-MM-DD
  usdInr: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  engines?: EngineId[];
  brandId?: string;
  /** Return false to stop before the next engine batch (daily cost cap). */
  canSpend?: () => Promise<boolean>;
  onSpend?: (engine: EngineId, model: string, usd: number, detail: string) => void;
  /** "audit" = first audit after a setup submission: unverified brands allowed, not limited to one per day. Default "daily". */
  kind?: RunKind;
  /** Free searches per calendar month by engine (Gemini grounding: AEO_GEMINI_FREE_SEARCHES_PER_MONTH). Omitted = none. */
  freeSearchesPerMonth?: Partial<Record<EngineId, number>>;
  /** Daily job: only these brands (cadence by plan). Omitted = all eligible. */
  onlyBrandIds?: Set<string>;
}

export interface EngineOutcome { brand: string; brandId?: string; engine: EngineId; status: "succeeded" | "partial" | "failed" | "skipped"; ok: number; total: number; mentioned: number; usd: number; note?: string }
export interface TrackerSummary { brands: number; outcomes: EngineOutcome[]; notConfigured: { engine: EngineId; missing: string[] }[]; stoppedByCap: boolean; usd: number }

export async function runTracker(d: TrackerDeps): Promise<TrackerSummary> {
  const configs: EngineConfig[] = [];
  const notConfigured: TrackerSummary["notConfigured"] = [];
  for (const e of d.engines ?? API_ENGINES) {
    const { config, missing } = loadEngineConfig(e, d.env);
    if (config) configs.push(config); else notConfigured.push({ engine: e, missing });
  }

  const kind: RunKind = d.kind ?? "daily";
  const brands = (await d.store.loadEligibleBrands(d.brandId, { includeUnverified: kind === "audit" }))
    .filter((b) => !d.onlyBrandIds || d.onlyBrandIds.has(b.id));
  // Remaining free allowance this month, shared by every brand in this run (the allowance is per provider account).
  const freeLeft: Partial<Record<EngineId, number>> = {};
  for (const cfg of configs) {
    const allowance = d.freeSearchesPerMonth?.[cfg.engine] ?? 0;
    if (allowance > 0) freeLeft[cfg.engine] = Math.max(0, allowance - (await d.store.monthSearches(cfg.engine, d.runDate)));
  }
  const outcomes: EngineOutcome[] = [];
  let stoppedByCap = false;

  for (const b of brands) {
    if (!b.prompts.length) continue;
    // Engines run in parallel; prompts run one after another within an engine (gentle on rate limits).
    const results = await Promise.all(configs.map(async (cfg): Promise<EngineOutcome> => {
      // Audits ask only what this engine hasn't answered today (new prompts after a setup change, or a retry) — never pay twice.
      // Never pay twice in a day: a run of either kind still going for this engine is left to finish, and only
      // prompts not yet answered today (by the first audit or an earlier run) are asked.
      if (d.store.hasRunningRun && await d.store.hasRunningRun(b.id, d.runDate, cfg.engine)) {
        return { brand: b.name, brandId: b.id, engine: cfg.engine, ok: 0, total: 0, mentioned: 0, usd: 0, status: "skipped", note: "already running" };
      }
      if (kind === "daily" && await d.store.hasCompletedRun(b.id, d.runDate, cfg.engine)) return { brand: b.name, brandId: b.id, engine: cfg.engine, ok: 0, total: 0, mentioned: 0, usd: 0, status: "skipped", note: "already ran today" };
      const answered = await d.store.answeredPromptIds(b.id, d.runDate, cfg.engine);
      const todo = b.prompts.filter((p) => !answered.has(p.id));
      const base = { brand: b.name, brandId: b.id, engine: cfg.engine, ok: 0, total: todo.length, mentioned: 0, usd: 0 };
      if (!todo.length) return { ...base, status: "skipped", note: "all prompts already answered today" };
      if (d.canSpend && !(await d.canSpend())) { stoppedByCap = true; return { ...base, status: "skipped", note: "daily cost cap" }; }

      let runId: string;
      try {
        runId = await d.store.startRun(b, d.runDate, cfg.engine, kind);
      } catch (err: any) {
        // A unique index stops two processes (cron + a redeploy's catch-up) running the same brand × engine × day.
        if (/duplicate key|unique/i.test(String(err?.message))) return { ...base, status: "skipped", note: "already running" };
        return { ...base, status: "failed", ok: 0, note: String(err?.message ?? err).slice(0, 300) };
      }
      let firstError: string | null = null;
      let tokensIn = 0, tokensOut = 0, searches = 0, freeSearches = 0, pageActions = 0, costSource = "computed";
      for (const p of todo) {
        try {
          const ans = await askEngine(cfg, p.text, { country: b.country, city: b.city ?? undefined, fetchImpl: d.fetchImpl });
          const left = freeLeft[cfg.engine] ?? 0;
          if (left > 0 && ans.usage.searches > 0 && ans.costSource === "computed") {
            const free = Math.min(left, ans.usage.searches);
            freeLeft[cfg.engine] = left - free;
            ans.usage = { ...ans.usage, searches: ans.usage.searches - free, freeSearches: free };
            ans.costUsd = computeCostUsd(cfg, ans.usage);
          }
          const a = analyzeAnswer(ans.text, b.lens);
          const cites = ans.citations.map((c) => analyzeCitation(c, b.lens)).filter((c): c is NonNullable<typeof c> => !!c);
          await d.store.saveAnswer(b, runId, p.id, ans, a, cites);
          base.ok++; if (a.mentioned) base.mentioned++;
          base.usd += ans.costUsd; tokensIn += ans.usage.inputTokens; tokensOut += ans.usage.outputTokens; searches += ans.usage.searches;
          freeSearches += ans.usage.freeSearches ?? 0; pageActions += ans.usage.pageActions ?? 0;
          if (ans.costSource === "provider") costSource = "provider";
          d.onSpend?.(cfg.engine, cfg.model, ans.costUsd, `${b.name} · prompt ${p.id}`);
        } catch (err: any) {
          firstError ??= String(err?.message ?? err).slice(0, 500);
        }
      }
      const status = base.ok === base.total ? "succeeded" : base.ok > 0 ? "partial" : "failed";
      await d.store.finishRun(runId, status, firstError);
      if (base.ok > 0) {
        await d.store.recordUsageCost(b, d.runDate, cfg.engine, {
          calls: base.ok, usd: base.usd, inr: base.usd * d.usdInr,
          detail: { model: cfg.model, input_tokens: tokensIn, output_tokens: tokensOut, searches, ...(freeSearches ? { free_searches: freeSearches } : {}), ...(pageActions ? { page_actions: pageActions } : {}), cost_source: costSource, usd_inr_rate: d.usdInr, run_id: runId },
        });
      }
      return { ...base, status, note: firstError ?? undefined };
    }));
    outcomes.push(...results);
  }

  return { brands: brands.length, outcomes, notConfigured, stoppedByCap, usd: outcomes.reduce((s, o) => s + o.usd, 0) };
}

/** One line for logs/<date>/aeo-audit-engine.md and Slack. Avoids the word "cost" so the ledger's log parser doesn't double-count (spend is recorded directly). */
export function summaryLine(s: TrackerSummary, time: string): string {
  const ran = s.outcomes.filter((o) => o.status !== "skipped");
  const per = ran.map((o) => `${LABEL[o.engine]} ${o.ok}/${o.total}`).join(", ") || "nothing to run";
  const mentioned = ran.reduce((n, o) => n + o.mentioned, 0), answers = ran.reduce((n, o) => n + o.ok, 0);
  const missing = s.notConfigured.length ? ` · not configured: ${s.notConfigured.map((n) => LABEL[n.engine]).join(", ")}` : "";
  const cap = s.stoppedByCap ? " · stopped by daily cap" : "";
  return `- ${time} IST — Citation Tracker: ${s.brands} brand(s) · ${per} · brand named in ${mentioned}/${answers} answers · engine spend $${s.usd.toFixed(4)}${missing}${cap}`;
}

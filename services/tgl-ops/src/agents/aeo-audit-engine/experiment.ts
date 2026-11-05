// Gemini cost experiment (Architect decision 4 Nov 2026, point 2): would a cheaper Gemini model give the same
// picture? For one brand, ask today's tracked questions with each candidate model and compare with today's
// stored Gemini answers: brand named?, competitors named, cited sites, search queries, tokens.
// Nothing is written to answers/runs (no effect on the dashboard); results go to public.experiments.
// Enable with AEO_GEMINI_EXPERIMENT_MODELS="gemini-2.5-flash-lite,gemini-3.5-flash-lite" (+ optional AEO_GEMINI_EXPERIMENT_BRAND).
import type { SupabaseClient } from "@supabase/supabase-js";
import { askEngine, loadEngineConfig } from "./engines.js";
import { analyzeAnswer, analyzeCitation } from "./analyze.js";
import { supabaseStore } from "./store.js";
import type { EngineAnswer } from "./types.js";

export type ExperimentRow = {
  prompt: string; baseline: { mentioned: boolean; competitors: string[]; domains: string[] } | null;
  candidates: Record<string, { mentioned: boolean; competitors: string[]; domains: string[]; searches: number; inTok: number; outTok: number; error?: string }>;
};

/** Agreement with the stored answer, per candidate (pure; tested). */
export function summarise(rows: ExperimentRow[], models: string[]) {
  return Object.fromEntries(models.map((m) => {
    const both = rows.filter((r) => r.baseline && r.candidates[m] && !r.candidates[m].error);
    const sameMention = both.filter((r) => r.baseline!.mentioned === r.candidates[m].mentioned).length;
    const overlap = both.map((r) => {
      const a = new Set(r.baseline!.domains), b = new Set(r.candidates[m].domains);
      const inter = [...a].filter((d) => b.has(d)).length, uni = new Set([...a, ...b]).size;
      return uni ? inter / uni : 1;
    });
    const c = rows.map((r) => r.candidates[m]).filter((x) => x && !x.error);
    return [m, {
      compared: both.length, sameBrandMention: sameMention,
      avgSiteOverlap: overlap.length ? Number((overlap.reduce((s, x) => s + x, 0) / overlap.length).toFixed(2)) : null,
      searches: c.reduce((s, x) => s + x.searches, 0), inputTokens: c.reduce((s, x) => s + x.inTok, 0), outputTokens: c.reduce((s, x) => s + x.outTok, 0),
      errors: rows.filter((r) => r.candidates[m]?.error).length,
    }];
  }));
}

export async function runGeminiExperiment(sb: SupabaseClient, runDate: string): Promise<string | null> {
  const models = (process.env.AEO_GEMINI_EXPERIMENT_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!models.length) return null;
  const { data: done } = await sb.from("experiments").select("id").eq("name", "gemini_cost").eq("run_date", runDate).limit(1);
  if (done?.length) return null;                                    // once a day, survives restarts
  const base = loadEngineConfig("gemini").config;
  if (!base) return "gemini not configured";
  const store = supabaseStore(sb);
  const brandName = process.env.AEO_GEMINI_EXPERIMENT_BRAND?.trim() || "The Growth Lab";
  const brands = await store.loadEligibleBrands(undefined, { includeUnverified: true });
  const brand = brands.find((b) => b.name === brandName) ?? brands[0];
  if (!brand) return "no brand";
  const { data: stored } = await sb.from("answers").select("prompt_id, text, created_at, runs!inner(engine, run_date, status)")
    .eq("brand_id", brand.id).eq("runs.engine", "gemini").eq("runs.run_date", runDate).in("runs.status", ["succeeded", "partial"]).order("created_at", { ascending: false });
  if (!stored?.length) return null;                                 // wait for today's Gemini run
  const latest = new Map<string, string>();
  for (const a of stored ?? []) if (!latest.has(a.prompt_id)) latest.set(a.prompt_id, a.text ?? "");
  const { data: storedCites } = await sb.from("citations").select("domain, answers!inner(prompt_id, runs!inner(engine, run_date))")
    .eq("brand_id", brand.id).eq("answers.runs.engine", "gemini").eq("answers.runs.run_date", runDate);
  const baseDomains = new Map<string, Set<string>>();
  for (const c of (storedCites ?? []) as any[]) { const k = c.answers.prompt_id; if (!baseDomains.has(k)) baseDomains.set(k, new Set()); baseDomains.get(k)!.add(c.domain); }

  const domainsOf = (a: EngineAnswer) => [...new Set(a.citations.map((c) => analyzeCitation(c, brand.lens)?.domain).filter(Boolean) as string[])].sort();
  const rows: ExperimentRow[] = [];
  for (const p of brand.prompts) {
    const text = latest.get(p.id);
    const row: ExperimentRow = { prompt: p.text, baseline: text != null ? { ...pick(analyzeAnswer(text, brand.lens)), domains: [...(baseDomains.get(p.id) ?? [])].sort() } : null, candidates: {} };
    for (const m of models) {
      try {
        const ans = await askEngine({ ...base, model: m }, p.text, { timeoutMs: 120_000 });
        row.candidates[m] = { ...pick(analyzeAnswer(ans.text, brand.lens)), domains: domainsOf(ans), searches: ans.usage.searches, inTok: ans.usage.inputTokens, outTok: ans.usage.outputTokens };
      } catch (e: any) {
        row.candidates[m] = { mentioned: false, competitors: [], domains: [], searches: 0, inTok: 0, outTok: 0, error: String(e?.message ?? e).slice(0, 200) };
      }
    }
    rows.push(row);
  }
  const summary = { baselineModel: base.model, ...summarise(rows, models) };
  await sb.from("experiments").insert({ name: "gemini_cost", run_date: runDate, brand_id: brand.id, summary, rows });
  return JSON.stringify(summary);
}

function pick(a: { mentioned: boolean; competitorsMentioned: string[] }) {
  return { mentioned: a.mentioned, competitors: a.competitorsMentioned };
}

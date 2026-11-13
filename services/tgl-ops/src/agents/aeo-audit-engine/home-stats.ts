// Home page "Client Zero" figures (site/pages/home.md section 3), read from the Citation Tracker's own tables.
// Only The Growth Lab's brand (tenant 'tgl'), only counts and dates. Nothing else leaves this module.
//
// Definitions (all from daily tracker runs with status 'succeeded'):
//   questions_tracked   active prompts for the TGL brand
//   engines_checked     distinct engines in the latest run date that has at least one stored answer
//   times_named_latest  answers on that date where mentioned = true, summed across engines
//   first_run_figure    the same count on the first run date that has at least one stored answer
//   first_run_date      that first date
//   last_run_date       the latest date
// A day with runs but no stored answers (setup not yet verified) is not a run for these figures.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HomeStats, HomeStatsProvider } from "../../routes/home-stats.js";

export interface HomeStatsSource {
  /** TGL brand id, or null when the brand row does not exist. */
  tglBrandId(): Promise<string | null>;
  activePromptCount(brandId: string): Promise<number>;
  /** Succeeded daily runs, oldest first. */
  dailyRuns(brandId: string): Promise<Array<{ id: string; run_date: string; engine: string }>>;
  /** Answers for the given run ids: how many, and how many name the brand. */
  answerCounts(runIds: string[]): Promise<{ total: number; named: number }>;
}

function byDate(runs: Array<{ id: string; run_date: string; engine: string }>): Map<string, typeof runs> {
  const m = new Map<string, typeof runs>();
  for (const r of runs) {
    const list = m.get(r.run_date) ?? [];
    list.push(r);
    m.set(r.run_date, list);
  }
  return m;
}

/** Pure computation over the source; exported for tests. Returns null when there is no run with answers. */
export async function computeHomeStats(src: HomeStatsSource): Promise<HomeStats | null> {
  const brandId = await src.tglBrandId();
  if (!brandId) return null;
  const runs = await src.dailyRuns(brandId);
  if (!runs.length) return null;
  const dates = [...byDate(runs).entries()]; // insertion order = oldest first
  let first: { date: string; named: number } | null = null;
  for (const [date, list] of dates) {
    const c = await src.answerCounts(list.map((r) => r.id));
    if (c.total > 0) { first = { date, named: c.named }; break; }
  }
  if (!first) return null;
  let latest: { date: string; named: number; engines: number } | null = null;
  for (let i = dates.length - 1; i >= 0; i--) {
    const [date, list] = dates[i];
    if (date === first.date) { latest = { date, named: first.named, engines: new Set(list.map((r) => r.engine)).size }; break; }
    const c = await src.answerCounts(list.map((r) => r.id));
    if (c.total > 0) { latest = { date, named: c.named, engines: new Set(list.map((r) => r.engine)).size }; break; }
  }
  if (!latest) return null;
  return {
    questions_tracked: await src.activePromptCount(brandId),
    engines_checked: latest.engines,
    times_named_latest: latest.named,
    first_run_figure: first.named,
    first_run_date: first.date,
    last_run_date: latest.date,
  };
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`[Home Stats] ${what}: ${res.error.message}`);
  return res.data;
}

export function supabaseHomeStatsSource(sb: SupabaseClient): HomeStatsSource {
  return {
    async tglBrandId() {
      const rows = must(await sb.from("brands").select("id").eq("tenant_id", "tgl").order("created_at").limit(1), "load TGL brand") as any[];
      return rows[0]?.id ?? null;
    },
    async activePromptCount(brandId) {
      const r = await sb.from("prompts").select("id", { count: "exact", head: true }).eq("brand_id", brandId).eq("status", "active");
      if (r.error) throw new Error(`[Home Stats] count prompts: ${r.error.message}`);
      return r.count ?? 0;
    },
    async dailyRuns(brandId) {
      return must(
        await sb.from("runs").select("id, run_date, engine").eq("brand_id", brandId).eq("kind", "daily").eq("status", "succeeded").order("run_date", { ascending: true }),
        "load daily runs",
      ) as any[];
    },
    async answerCounts(runIds) {
      if (!runIds.length) return { total: 0, named: 0 };
      const total = await sb.from("answers").select("id", { count: "exact", head: true }).in("run_id", runIds);
      if (total.error) throw new Error(`[Home Stats] count answers: ${total.error.message}`);
      const named = await sb.from("answers").select("id", { count: "exact", head: true }).in("run_id", runIds).eq("mentioned", true);
      if (named.error) throw new Error(`[Home Stats] count named answers: ${named.error.message}`);
      return { total: total.count ?? 0, named: named.count ?? 0 };
    },
  };
}

/** Provider for setHomeStatsProvider: Supabase-backed, 10-minute cache so a page view never fans out into queries. */
export function supabaseHomeStatsProvider(sb: SupabaseClient, ttlMs = 10 * 60 * 1000): HomeStatsProvider {
  let cached: { at: number; value: HomeStats | null } | null = null;
  const src = supabaseHomeStatsSource(sb);
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const value = await computeHomeStats(src);
    cached = { at: Date.now(), value };
    return value;
  };
}

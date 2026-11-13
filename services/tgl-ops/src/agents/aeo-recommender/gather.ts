import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSite } from "../aeo-strategist/evidence.js";
import type { PromptEvidence, RecEvidence, SiteEvidence } from "./types.js";

const must = <T>(r: { data: T | null; error: any }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data as T; };

/** Whole-word, case-insensitive (same rule as the tracker and dashboard). */
export function containsName(text: string, names: string[]): boolean {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return names.some((raw) => {
    const n = raw.toLowerCase().trim();
    if (n.length < 3) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9\\u0900-\\u097F])${esc}(?=$|[^a-z0-9\\u0900-\\u097F])`).test(t);
  });
}

/** Per-prompt evidence from answer rows (pure; tested). */
export function promptEvidence(
  prompts: { id: string; text: string; language: string; journey_phase: string }[],
  answers: { prompt_id: string; engine: string; mentioned: boolean | null; competitors_mentioned: string[] | null; text: string | null; created_at: string }[],
  brandNames: string[],
): PromptEvidence[] {
  return prompts.map((p, i) => {
    const mine = answers.filter((a) => a.prompt_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latestByEngine = new Map<string, (typeof mine)[number]>();
    for (const a of mine) if (!latestByEngine.has(a.engine)) latestByEngine.set(a.engine, a);
    const latest = [...latestByEngine.values()];
    const unnamed = latest.find((a) => !a.mentioned && a.text);
    return {
      ref: `P${i + 1}`, id: p.id, text: p.text, language: p.language, stage: p.journey_phase, branded: containsName(p.text, brandNames),
      enginesAsked: latest.map((a) => a.engine).sort(), enginesNamed: latest.filter((a) => a.mentioned).map((a) => a.engine).sort(),
      competitorsNamed: [...new Set(latest.flatMap((a) => a.competitors_mentioned ?? []))].sort(),
      excerpt: unnamed?.text ? unnamed.text.replace(/\s+/g, " ").slice(0, 500) : null,
    };
  });
}

export async function gatherRecEvidence(sb: SupabaseClient, brandId: string, opts: { days?: number; fetchImpl?: typeof fetch } = {}): Promise<RecEvidence | null> {
  const days = opts.days ?? 7;
  const brand = must(await sb.from("brands").select("id, tenant_id, name, primary_domain, site_platform, languages").eq("id", brandId).single(), "brand") as any;
  const last = must(await sb.from("v_visibility_daily").select("run_date").eq("brand_id", brandId).order("run_date", { ascending: false }).limit(1), "last run") as any[];
  if (!last.length) return null;
  const to = last[0].run_date as string;
  // The window never starts before the first measured day — "Measured 4 Nov – 10 Nov" for one day of answers overstates it.
  const first = must(await sb.from("v_visibility_daily").select("run_date").eq("brand_id", brandId).order("run_date", { ascending: true }).limit(1), "first run") as any[];
  const windowStart = new Date(Date.parse(to + "T00:00:00Z") - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const from = first[0]?.run_date > windowStart ? first[0].run_date as string : windowStart;

  const [market, comps, variants, prompts, vis, sites, urls] = await Promise.all([
    sb.from("products_icps").select("product, icp, location").eq("brand_id", brandId).order("created_at").limit(1),
    sb.from("competitors").select("name").eq("brand_id", brandId).eq("status", "active"),
    sb.from("brand_variants").select("name").eq("brand_id", brandId),
    sb.from("prompts").select("id, text, language, journey_phase").eq("brand_id", brandId).eq("status", "active").order("created_at"),
    sb.from("v_visibility_daily").select("answers, mentioned").eq("brand_id", brandId).gte("run_date", from),
    sb.rpc("citation_summary", { p_brand: brandId, p_from: from }),
    sb.rpc("citation_urls", { p_brand: brandId, p_from: from, p_limit: 100 }),
  ]);
  const promptRows = must(prompts, "prompts") as any[];
  const ids = promptRows.map((p) => p.id);
  const answers: any[] = [];
  for (let page = 0; ids.length && page < 10; page++) {
    const rows = must(await sb.from("answers").select("prompt_id, created_at, mentioned, competitors_mentioned, text, runs!inner(engine, run_date, status)")
      .eq("brand_id", brandId).in("prompt_id", ids).gte("runs.run_date", from).in("runs.status", ["succeeded", "partial"]).order("created_at").range(page * 500, page * 500 + 499), "answers") as any[];
    answers.push(...rows.map((a) => ({ ...a, engine: a.runs.engine })));
    if (rows.length < 500) break;
  }
  const names = [brand.name, ...((must(variants, "variants") as any[]) ?? []).map((v) => v.name), ...(brand.primary_domain ? [brand.primary_domain] : [])];
  const urlRows = (must(urls, "urls") as any[]) ?? [];
  const siteRows = ((must(sites, "sites") as any[]) ?? []);
  const gap: SiteEvidence[] = siteRows
    .filter((s) => !s.owned && s.without_you > 0)
    .sort((a, b) => b.competitor_not_you - a.competitor_not_you || b.without_you - a.without_you || a.domain.localeCompare(b.domain))
    .slice(0, 20)
    .map((s, i) => ({
      ref: `S${i + 1}`, domain: s.domain, channelType: s.channel_type, answers: s.answers, withoutYou: s.without_you, namedYou: s.named_you,
      competitorNotYou: s.competitor_not_you, competitors: s.competitors ?? [], urls: urlRows.filter((u) => u.domain === s.domain).slice(0, 3).map((u) => u.url),
    }));
  const visRows = (must(vis, "visibility") as any[]) ?? [];
  const site = await fetchSite(brand.primary_domain, opts.fetchImpl).catch(() => null);
  return {
    brandId, tenantId: brand.tenant_id, name: brand.name, domain: brand.primary_domain, platform: brand.site_platform, languages: brand.languages ?? [],
    market: ((must(market, "market") as any[]) ?? [])[0] ?? null, competitors: ((must(comps, "competitors") as any[]) ?? []).map((c) => c.name),
    from, to, totalAnswers: visRows.reduce((n, r) => n + r.answers, 0), namedAnswers: visRows.reduce((n, r) => n + r.mentioned, 0),
    prompts: promptEvidence(promptRows, answers, names), sites: gap,
    ownCited: siteRows.filter((s) => s.owned).reduce((n, s) => n + s.answers, 0), site,
  };
}

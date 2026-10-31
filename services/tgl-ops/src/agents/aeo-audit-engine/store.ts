// services/tgl-ops/src/agents/aeo-audit-engine/store.ts
// Everything the tracker reads/writes, behind one interface so tests use an in-memory store
// and production uses Supabase with the service role (RLS is bypassed; tenant_id is set explicitly on every row).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswerAnalysis, BrandLens, CitationAnalysis, EngineAnswer, EngineId } from "./types.js";

export interface TrackedBrand {
  id: string;
  tenantId: string;
  name: string;
  country: string;
  city: string | null;
  lens: BrandLens;
  prompts: { id: string; text: string; language: string }[];
}

export interface TrackerStore {
  loadEligibleBrands(brandId?: string): Promise<TrackedBrand[]>;
  hasCompletedRun(brandId: string, runDate: string, engine: EngineId): Promise<boolean>;
  startRun(b: TrackedBrand, runDate: string, engine: EngineId): Promise<string>;
  saveAnswer(b: TrackedBrand, runId: string, promptId: string, ans: EngineAnswer, a: AnswerAnalysis, cites: CitationAnalysis[]): Promise<void>;
  finishRun(runId: string, status: "succeeded" | "partial" | "failed", error: string | null): Promise<void>;
  recordUsageCost(b: TrackedBrand, runDate: string, engine: EngineId, row: { calls: number; usd: number; inr: number; detail: Record<string, unknown> }): Promise<void>;
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const ACTIVE_PAID = ["active", "past_due"];

export function supabaseStore(sb: SupabaseClient): TrackerStore {
  return {
    async loadEligibleBrands(brandId) {
      // Tenant zero ('tgl') always runs; other brands run once TGL has verified their setup (SPEC §3).
      let q = sb.from("brands").select("id, tenant_id, name, primary_domain, setup_status").or("setup_status.eq.verified,tenant_id.eq.tgl");
      if (brandId) q = q.eq("id", brandId);
      const brands = must(await q, "load brands") as any[];
      if (!brands.length) return [];
      const ids = brands.map((b) => b.id);
      const tenantIds = [...new Set(brands.map((b) => b.tenant_id as string))];

      const [tenants, subs, variants, domains, comps, prompts, pis] = await Promise.all([
        sb.from("tenants").select("id, country, parent_tenant_id").in("id", tenantIds),
        sb.from("subscriptions").select("tenant_id, plan, status, trial_ends_at").eq("product", "truevisible"),
        sb.from("brand_variants").select("brand_id, name").in("brand_id", ids),
        sb.from("domains").select("brand_id, domain").in("brand_id", ids),
        sb.from("competitors").select("brand_id, name, domain").in("brand_id", ids).eq("status", "active"),
        sb.from("prompts").select("id, brand_id, text, language").in("brand_id", ids).eq("status", "active").order("created_at"),
        sb.from("products_icps").select("brand_id, location, created_at").in("brand_id", ids).order("created_at"),
      ]);
      const T = must(tenants, "tenants") as any[], S = must(subs, "subscriptions") as any[], V = must(variants, "variants") as any[];
      const D = must(domains, "domains") as any[], C = must(comps, "competitors") as any[], P = must(prompts, "prompts") as any[], PI = must(pis, "products_icps") as any[];

      const now = Date.now();
      const entitled = (tenantId: string) => {
        const t = T.find((x) => x.id === tenantId);
        const payers = [tenantId, t?.parent_tenant_id].filter(Boolean);
        return S.some((s) => payers.includes(s.tenant_id) && (
          s.plan === "internal" ||
          (s.plan === "trial" && s.status === "trialing" && s.trial_ends_at && Date.parse(s.trial_ends_at) > now) ||
          (s.plan !== "trial" && ACTIVE_PAID.includes(s.status))
        ));
      };

      return brands.filter((b) => entitled(b.tenant_id)).map((b) => {
        const doms = D.filter((d) => d.brand_id === b.id).map((d) => d.domain as string);
        if (b.primary_domain && !doms.includes(b.primary_domain)) doms.unshift(b.primary_domain);
        const loc = PI.find((p) => p.brand_id === b.id)?.location as string | undefined;
        return {
          id: b.id, tenantId: b.tenant_id, name: b.name,
          country: T.find((t) => t.id === b.tenant_id)?.country || "IN",
          city: loc && /^[\p{L} .'-]{2,40}$/u.test(loc) ? loc : null,
          lens: {
            name: b.name,
            variants: V.filter((v) => v.brand_id === b.id).map((v) => v.name),
            domains: doms,
            competitors: C.filter((c) => c.brand_id === b.id).map((c) => ({ name: c.name, domain: c.domain })),
          },
          prompts: P.filter((p) => p.brand_id === b.id).map((p) => ({ id: p.id, text: p.text, language: p.language })),
        };
      });
    },

    async hasCompletedRun(brandId, runDate, engine) {
      const rows = must(await sb.from("runs").select("id").eq("brand_id", brandId).eq("run_date", runDate).eq("engine", engine)
        .eq("kind", "daily").in("status", ["succeeded", "partial"]).limit(1), "check runs") as any[];
      return rows.length > 0;
    },

    async startRun(b, runDate, engine) {
      // A run left 'running' for 2h+ (process died mid-run) is marked failed so today's run can be retried.
      await sb.from("runs").update({ status: "failed", error: "abandoned (process stopped mid-run)", finished_at: new Date().toISOString() })
        .eq("brand_id", b.id).eq("run_date", runDate).eq("engine", engine).eq("status", "running")
        .lt("started_at", new Date(Date.now() - 2 * 3600_000).toISOString());
      const row = must(await sb.from("runs").insert({ tenant_id: b.tenantId, brand_id: b.id, run_date: runDate, engine, kind: "daily", status: "running", started_at: new Date().toISOString() })
        .select("id").single(), "start run") as any;
      return row.id as string;
    },

    async saveAnswer(b, runId, promptId, ans, a, cites) {
      const row = must(await sb.from("answers").insert({
        tenant_id: b.tenantId, brand_id: b.id, run_id: runId, prompt_id: promptId,
        text: ans.text, mentioned: a.mentioned, position: a.position, sentiment: null, competitors_mentioned: a.competitorsMentioned,
        raw: { model: ans.model, usage: ans.usage, cost_usd: ans.costUsd, cost_source: ans.costSource, citations: ans.citations },
      }).select("id").single(), "save answer") as any;
      if (cites.length) {
        must(await sb.from("citations").insert(cites.map((c) => ({
          tenant_id: b.tenantId, brand_id: b.id, answer_id: row.id, domain: c.domain, url: c.url,
          channel_type: c.channelType, content_type: null, brand_mentioned: c.brandMentioned, competitors_mentioned: c.competitorsMentioned,
        }))), "save citations");
      }
    },

    async finishRun(runId, status, error) {
      must(await sb.from("runs").update({ status, error, finished_at: new Date().toISOString() }).eq("id", runId), "finish run");
    },

    async recordUsageCost(b, runDate, engine, row) {
      must(await sb.from("usage_costs").insert({
        tenant_id: b.tenantId, brand_id: b.id, product: "truevisible", cost_date: runDate, category: "engine_api",
        engine, units: row.calls, amount_inr: Number(row.inr.toFixed(4)), detail: { ...row.detail, usd: row.usd },
      }), "usage cost");
    },
  };
}

// services/tgl-ops/src/agents/aeo-strategist/apply.ts — turn a reviewer's ticks into database changes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Proposal, Selection, SetupSnapshot } from "./types.js";

export interface ApplyPlan {
  market: NonNullable<Proposal["market"]> | null;
  competitorsAdd: Proposal["competitorsAdd"];
  competitorsRemove: Proposal["competitorsRemove"];
  promptsRetire: Proposal["promptsRetire"];
  promptsAdd: Proposal["promptsAdd"];
}

/** Only ticked items; prompt adds trimmed so active prompts never exceed the plan limit. */
export function planApply(s: SetupSnapshot, p: Proposal, sel: Selection): ApplyPlan {
  const pick = <T>(list: T[], prefix: string) => list.filter((_, i) => sel.has(`${prefix}:${i}`));
  const promptsRetire = pick(p.promptsRetire, "pr");
  const room = Math.max(0, s.promptLimit - (s.prompts.length - promptsRetire.length));
  return {
    market: p.market && sel.has("mk:0") ? p.market : null,
    competitorsAdd: pick(p.competitorsAdd, "ca"),
    competitorsRemove: pick(p.competitorsRemove, "cr"),
    promptsRetire,
    promptsAdd: pick(p.promptsAdd, "pa").slice(0, room),
  };
}

export const EMPTY_PLAN: ApplyPlan = { market: null, competitorsAdd: [], competitorsRemove: [], promptsRetire: [], promptsAdd: [] };

export function planSize(a: ApplyPlan): number {
  return (a.market ? 1 : 0) + a.competitorsAdd.length + a.competitorsRemove.length + a.promptsRetire.length + a.promptsAdd.length;
}

export function describePlan(a: ApplyPlan): string {
  const lines: string[] = [];
  if (a.market) lines.push(`market → ${(["product", "icp", "location"] as const).filter((k) => a.market![k]).map((k) => `${k}: ${a.market![k]}`).join(", ")}`);
  if (a.competitorsAdd.length) lines.push(`+ competitors: ${a.competitorsAdd.map((c) => c.name).join(", ")}`);
  if (a.competitorsRemove.length) lines.push(`− competitors: ${a.competitorsRemove.map((c) => c.name).join(", ")}`);
  if (a.promptsRetire.length) lines.push(`− ${a.promptsRetire.length} prompt(s)`);
  if (a.promptsAdd.length) lines.push(`+ ${a.promptsAdd.length} prompt(s)`);
  return lines.join(" · ") || "no changes";
}

function must(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

/** Applies the plan and marks the setup verified. Service role: tenant_id set explicitly on every row. */
export async function applyAndVerify(sb: SupabaseClient, s: SetupSnapshot, a: ApplyPlan, actor: string): Promise<void> {
  const now = new Date().toISOString();
  if (a.market && s.market) {
    const patch: Record<string, string> = {};
    for (const k of ["product", "icp", "location"] as const) if (a.market[k]) patch[k] = a.market[k]!;
    must(await sb.from("products_icps").update(patch).eq("id", s.market.id), "update market");
  }
  if (a.competitorsRemove.length) {
    must(await sb.from("competitors").update({ status: "rejected" }).in("id", a.competitorsRemove.map((c) => c.id)), "remove competitors");
  }
  if (a.competitorsAdd.length) {
    must(await sb.from("competitors").upsert(
      a.competitorsAdd.map((c) => ({ tenant_id: s.tenantId, brand_id: s.brandId, name: c.name, domain: c.domain, source: "setup_agent", status: "active", verified_at: now })),
      { onConflict: "brand_id,name" }
    ), "add competitors");
  }
  if (a.promptsRetire.length) {
    must(await sb.from("prompts").update({ status: "retired", retired_at: now }).in("id", a.promptsRetire.map((x) => x.id)), "retire prompts");
  }
  if (a.promptsAdd.length) {
    must(await sb.from("prompts").insert(a.promptsAdd.map((x) => ({
      tenant_id: s.tenantId, brand_id: s.brandId, product_icp_id: s.market?.id ?? null,
      text: x.text, language: x.language, journey_phase: x.journey_phase, status: "active", source: "setup_agent",
    }))), "add prompts");
  }
  must(await sb.from("competitors").update({ verified_at: now }).eq("brand_id", s.brandId).eq("status", "active").is("verified_at", null), "verify competitors");
  if (s.market) must(await sb.from("products_icps").update({ verified_at: now }).eq("id", s.market.id), "verify market");
  must(await sb.from("brands").update({ setup_status: "verified", setup_verified_at: now, setup_verified_by: actor, setup_note: null }).eq("id", s.brandId), "verify brand");
}

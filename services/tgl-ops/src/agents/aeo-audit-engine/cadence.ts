// Tracking cadence by plan (Architect decision 7 Nov 2026):
//   internal (TGL, client zero) → daily · trial → daily for 7 days from the first verified run ·
//   Track / Managed / Managed Plus → weekly (Mondays) + a monthly deep run on the 1st · anything else → none.
// First audits after a setup submission run regardless (first-audit queue).
import type { SupabaseClient } from "@supabase/supabase-js";

export type Sub = { tenant_id: string; plan: string; status: string; trial_started_at: string | null; trial_ends_at: string | null };
export type Cadence = "daily" | "weekly" | "none";
export const TRIAL_DAYS = 7;
const PAID = new Set(["track", "managed", "managed_plus", "truevisible", "managed_aeo", "agency", "agency_seat", "agency_managed_aeo"]);

export function cadenceFor(sub: Sub | null, now = Date.now()): Cadence {
  if (!sub) return "none";
  if (sub.plan === "internal") return "daily";
  if (sub.plan === "trial") {
    if (sub.status !== "trialing") return "none";
    if (!sub.trial_started_at) return "none";                   // not started: only the first audit runs
    return sub.trial_ends_at && Date.parse(sub.trial_ends_at) > now ? "daily" : "none";
  }
  return PAID.has(sub.plan) && (sub.status === "active" || sub.status === "past_due") ? "weekly" : "none";
}

/** Should a brand with this cadence run today? `lastRunDate` = its last completed daily-kind run. Pure; tested. */
export function dueToday(c: Cadence, today: string, lastRunDate: string | null): { run: boolean; deep: boolean } {
  if (c === "none") return { run: false, deep: false };
  if (c === "daily") return { run: true, deep: false };
  const deep = today.endsWith("-01");
  const monday = new Date(today + "T00:00:00Z").getUTCDay() === 1;
  const overdue = !lastRunDate || Date.parse(today) - Date.parse(lastRunDate) >= 7 * 86_400_000;   // missed a Monday (outage, new subscriber)
  return { run: monday || deep || overdue, deep };
}

/** Brand ids due today, and which are deep runs. */
export async function brandsDueToday(sb: SupabaseClient, today: string): Promise<{ due: Set<string>; deep: Set<string> }> {
  const [{ data: brands }, { data: subs }, { data: last }, { data: tenants }] = await Promise.all([
    sb.from("brands").select("id, tenant_id").eq("onboarding_step", 4),
    sb.from("subscriptions").select("tenant_id, plan, status, trial_started_at, trial_ends_at, created_at").eq("product", "truevisible").is("brand_id", null).order("created_at", { ascending: false }),
    sb.from("runs").select("brand_id, run_date").eq("kind", "daily").in("status", ["succeeded", "partial"]).order("run_date", { ascending: false }).limit(5000),
    sb.from("tenants").select("id, kind, parent_tenant_id"),
  ]);
  // An agency's client brands follow the agency's subscription (SPEC §9: the agency is TGL's customer).
  const parentOf = new Map(((tenants ?? []) as any[]).filter((t) => t.kind === "agency_client" && t.parent_tenant_id).map((t) => [t.id as string, t.parent_tenant_id as string]));
  const subOf = new Map<string, Sub>();
  for (const s of (subs ?? []) as any[]) if (!subOf.has(s.tenant_id)) subOf.set(s.tenant_id, s);
  const lastOf = new Map<string, string>();
  for (const r of (last ?? []) as any[]) if (!lastOf.has(r.brand_id)) lastOf.set(r.brand_id, r.run_date);
  const due = new Set<string>(), deep = new Set<string>();
  for (const b of (brands ?? []) as any[]) {
    const billing = parentOf.get(b.tenant_id) ?? b.tenant_id;
    const d = dueToday(cadenceFor(subOf.get(billing) ?? null), today, lastOf.get(b.id) ?? null);
    if (d.run) due.add(b.id);
    if (d.run && d.deep) deep.add(b.id);
  }
  return { due, deep };
}

/** After a completed run: start the 7-day trial clock if this tenant's trial hasn't started (brand must be verified). */
export async function startTrialClock(sb: SupabaseClient, brandId: string, now = new Date()): Promise<boolean> {
  const { data: b } = await sb.from("brands").select("tenant_id, setup_status").eq("id", brandId).single();
  if (!b || b.setup_status !== "verified") return false;
  const ends = new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
  const { data } = await sb.from("subscriptions").update({ trial_started_at: now.toISOString(), trial_ends_at: ends })
    .eq("tenant_id", b.tenant_id).eq("product", "truevisible").eq("plan", "trial").eq("status", "trialing").is("trial_started_at", null).select("tenant_id");
  return !!data?.length;
}

// services/tgl-ops/src/agents/aeo-audit-engine/setup-profile.ts
// Handles verified brand setup profiles from the TrueVisible setup-check queue (Day 19).
// Enforces the Iron Law of Honesty: the engine reads brands/prompts/competitors/products_icps
// from Supabase only. A missing, unconfigured, or unverified row means "Audit refused" with the reason.
// Zero fallback constants or seed registries.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../prospect-researcher/db.js";

// "prospect_unverified" is never stored: it marks a free first audit for a prospect that has no setup profile
// (decisions/2026-11-12.md). Such an audit is posted for the Architect's review and is never sent by the service.
export type SetupStatus = "verified" | "pending_verification" | "needs_changes" | "prospect_unverified";

export interface VerifiedPrompt {
  id: string;
  text: string;
  language: string;
  journey_phase?: "awareness" | "consideration" | "decision";
}

export interface VerifiedBrandProfile {
  brandId: string;
  tenantId: string;
  name: string;
  primaryDomain: string;
  domains: string[];
  variants: string[];
  setupStatus: SetupStatus;
  setupVerifiedAt?: string;
  setupVerifiedBy?: string;
  setupNote?: string | null;
  market?: {
    product?: string;
    icp?: string;
    location?: string;
  };
  competitors: Array<{ name: string; domain: string | null }>;
  prompts: VerifiedPrompt[];
}

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/**
 * Loads and verifies a brand's setup profile strictly from Supabase.
 * Refuses to run if:
 * 1. Supabase client is not configured or unavailable.
 * 2. The profile is not found in the TrueVisible setup queue (brands table).
 * 3. The brand's setup_status is not 'verified'.
 * 4. The brand has fewer than 5 verified active buyer prompts.
 */
export async function loadVerifiedBrandProfile(
  domainOrName: string,
  options?: { supabase?: SupabaseClient | null; testMode?: boolean }
): Promise<VerifiedBrandProfile> {
  const key = normKey(domainOrName);
  const sb = options?.supabase !== undefined ? options.supabase : getSupabase();

  if (!sb) {
    throw new Error(
      `Supabase client is not configured. Audit refused.`
    );
  }

  const { data: brand, error: brandErr } = await sb
    .from("brands")
    .select("id, tenant_id, name, primary_domain, setup_status, setup_verified_at, setup_verified_by, setup_note")
    .or(`primary_domain.eq.${key},name.ilike.%${domainOrName}%`)
    .maybeSingle();

  if (brandErr || !brand) {
    throw new Error(
      `Brand setup profile for "${domainOrName}" was not found in TrueVisible setup queue. Audit refused.`
    );
  }

  if (brand.setup_status !== "verified") {
    throw new Error(
      `Brand setup profile for "${domainOrName}" is not verified (status: ${brand.setup_status}). Audit refused.`
    );
  }

  const [promptsRes, compsRes, variantsRes, domainsRes, marketRes] = await Promise.all([
    sb.from("prompts").select("id, text, language, journey_phase").eq("brand_id", brand.id).eq("status", "active"),
    sb.from("competitors").select("name, domain").eq("brand_id", brand.id).eq("status", "active"),
    sb.from("brand_variants").select("name").eq("brand_id", brand.id),
    sb.from("domains").select("domain").eq("brand_id", brand.id),
    sb.from("products_icps").select("product, icp, location").eq("brand_id", brand.id).limit(1).maybeSingle(),
  ]);

  const prompts: VerifiedPrompt[] = promptsRes.data || [];
  if (prompts.length < 5) {
    throw new Error(
      `Brand setup profile for "${domainOrName}" has fewer than 5 verified buyer prompts (${prompts.length}/5). Audit refused.`
    );
  }

  const competitors = (compsRes.data || []).map((c: any) => ({ name: c.name, domain: c.domain }));
  const variants = (variantsRes.data || []).map((v: any) => v.name);
  const domains = (domainsRes.data || []).map((d: any) => d.domain);
  if (brand.primary_domain && !domains.includes(brand.primary_domain)) {
    domains.unshift(brand.primary_domain);
  }

  return {
    brandId: brand.id,
    tenantId: brand.tenant_id,
    name: brand.name,
    primaryDomain: brand.primary_domain || key,
    domains,
    variants,
    setupStatus: brand.setup_status,
    setupVerifiedAt: brand.setup_verified_at,
    setupVerifiedBy: brand.setup_verified_by,
    setupNote: brand.setup_note,
    market: marketRes.data || undefined,
    competitors,
    prompts,
  };
}

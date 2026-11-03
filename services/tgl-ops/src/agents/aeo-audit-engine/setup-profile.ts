// services/tgl-ops/src/agents/aeo-audit-engine/setup-profile.ts
// Handles verified brand setup profiles from the TrueVisible setup-check queue (Day 19).
// Enforces the Iron Law of Honesty: if a brand's setup profile is not verified,
// the engine must refuse to run and say so, never guess or fall back to generic prompts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../prospect-researcher/db.js";

export type SetupStatus = "verified" | "pending_verification" | "needs_changes";

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

/**
 * Tenant Zero (The Growth Lab) Verified Brand Setup Profile.
 * Reflects TGL's authentic business as an AI-native growth operator for coaching institutes,
 * with high-intent buyer queries and real market competitors (LeadSquared, Digital Pundit, Classplus, Brandingo).
 */
export const TGL_VERIFIED_PROFILE: VerifiedBrandProfile = {
  brandId: "brand_tgl_zero",
  tenantId: "tgl",
  name: "The Growth Lab",
  primaryDomain: "thegrowthlab.co.in",
  domains: ["thegrowthlab.co.in"],
  variants: ["the growth lab", "tgl", "growth lab"],
  setupStatus: "verified",
  setupVerifiedAt: "2026-10-31T10:00:00.000Z",
  setupVerifiedBy: "architect",
  market: {
    product: "AI growth operator for coaching institutes",
    icp: "owners and directors of coaching and training institutes",
    location: "Chandigarh, India",
  },
  competitors: [
    { name: "LeadSquared", domain: "leadsquared.com" },
    { name: "Digital Pundit", domain: "digitalpundit.in" },
    { name: "Classplus", domain: "classplusapp.com" },
    { name: "Brandingo", domain: null },
  ],
  prompts: [
    {
      id: "p_tgl_1",
      text: "Best AI lead qualification and WhatsApp automation for coaching institutes",
      language: "en",
      journey_phase: "decision",
    },
    {
      id: "p_tgl_2",
      text: "How to scale student admissions from Meta ads without hiring more counsellors",
      language: "en",
      journey_phase: "consideration",
    },
    {
      id: "p_tgl_3",
      text: "Top AI growth operator for coaching institutes in India",
      language: "en",
      journey_phase: "awareness",
    },
    {
      id: "p_tgl_4",
      text: "The Growth Lab reviews and case studies for coaching admissions",
      language: "en",
      journey_phase: "decision",
    },
    {
      id: "p_tgl_5",
      text: "Best agencies to improve lead quality and counselling conversion for test prep institutes",
      language: "en",
      journey_phase: "consideration",
    },
  ],
};

/**
 * In-memory registry of brand profiles for local development, testing, and fixture runs.
 */
const profileRegistry = new Map<string, VerifiedBrandProfile>();

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

// Seed tenant zero
profileRegistry.set("thegrowthlab.co.in", { ...TGL_VERIFIED_PROFILE });
profileRegistry.set("the growth lab", { ...TGL_VERIFIED_PROFILE });
profileRegistry.set("tgl", { ...TGL_VERIFIED_PROFILE });

/**
 * Registers or updates a brand profile in the local registry (useful for testing verification states).
 */
export function registerBrandProfile(profile: VerifiedBrandProfile): void {
  profileRegistry.set(normKey(profile.primaryDomain), profile);
  profileRegistry.set(normKey(profile.name), profile);
  for (const d of profile.domains) {
    profileRegistry.set(normKey(d), profile);
  }
}

/**
 * Updates setup status for a brand profile in the registry (e.g. for testing refusal vs approval).
 */
export function setBrandSetupStatus(domainOrName: string, status: SetupStatus): void {
  const profile = profileRegistry.get(normKey(domainOrName));
  if (profile) {
    profile.setupStatus = status;
    if (status === "verified" && !profile.setupVerifiedAt) {
      profile.setupVerifiedAt = new Date().toISOString();
      profile.setupVerifiedBy = "architect";
    }
  }
}

/**
 * Clears and resets the registry back to default (tenant zero verified).
 */
export function resetBrandProfileRegistry(): void {
  profileRegistry.clear();
  profileRegistry.set("thegrowthlab.co.in", { ...TGL_VERIFIED_PROFILE });
  profileRegistry.set("the growth lab", { ...TGL_VERIFIED_PROFILE });
  profileRegistry.set("tgl", { ...TGL_VERIFIED_PROFILE });
}

/**
 * Loads and verifies a brand's setup profile.
 * Refuses to run if:
 * 1. The profile is not found in the TrueVisible setup queue.
 * 2. The brand's setup_status is not 'verified'.
 * 3. The brand has fewer than 5 verified active buyer prompts.
 */
export async function loadVerifiedBrandProfile(
  domainOrName: string,
  options?: { supabase?: SupabaseClient | null; testMode?: boolean }
): Promise<VerifiedBrandProfile> {
  const key = normKey(domainOrName);
  const sb = options?.supabase !== undefined ? options.supabase : getSupabase();

  if (sb && !options?.testMode) {
    try {
      const { data: brand, error: brandErr } = await sb
        .from("brands")
        .select("id, tenant_id, name, primary_domain, setup_status, setup_verified_at, setup_verified_by, setup_note")
        .or(`primary_domain.eq.${key},name.ilike.%${domainOrName}%`)
        .single();

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
    } catch (err: any) {
      if (err.message?.includes("Audit refused")) {
        throw err;
      }
      // If DB read failed unexpectedly and we're not explicitly testMode, rethrow
      if (!options?.testMode && !err.message?.includes("fetch failed")) {
        throw err;
      }
    }
  }

  // Registry / Fixture fallback for test mode or offline runs
  const profile = profileRegistry.get(key);
  if (!profile) {
    throw new Error(
      `Brand setup profile for "${domainOrName}" is not registered in TrueVisible setup queue. Audit refused.`
    );
  }

  if (profile.setupStatus !== "verified") {
    throw new Error(
      `Brand setup profile for "${domainOrName}" is not verified (status: ${profile.setupStatus}). Audit refused.`
    );
  }

  if (!profile.prompts || profile.prompts.length < 5) {
    throw new Error(
      `Brand setup profile for "${domainOrName}" has fewer than 5 verified buyer prompts (${profile.prompts?.length || 0}/5). Audit refused.`
    );
  }

  return { ...profile };
}

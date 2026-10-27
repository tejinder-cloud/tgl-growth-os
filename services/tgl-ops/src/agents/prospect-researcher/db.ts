// services/tgl-ops/src/agents/prospect-researcher/db.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import type { ProspectRecord } from "./types.js";
import { validateProspectRecord } from "./guardrails.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rmrauejublipukulnjou.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    return supabaseClient;
  }
  return null;
}

/**
 * Loads all known prospects strictly from Supabase `prospects` table.
 * Zero local JSON files: returns empty array if no Supabase credentials configured.
 */
export async function loadAllProspects(options?: { testMode?: boolean }): Promise<ProspectRecord[]> {
  const isTest = options?.testMode === true || isTestMode();
  const sb = getSupabase();

  if (!sb || isTest) {
    return [];
  }

  try {
    const { data, error } = await sb
      .from("prospects")
      .select("*")
      .eq("tenant_id", "tgl")
      .is("deleted_at", null);

    if (error) {
      console.warn(`[Supabase Query Warning]:`, error.message);
      return [];
    }

    if (Array.isArray(data)) {
      return data as ProspectRecord[];
    }
  } catch (err: any) {
    console.warn(`[Supabase Query Error]:`, err.message || err);
  }

  return [];
}

/**
 * Upserts qualified prospect records directly into Supabase `public.prospects`.
 * Zero local JSON file writes.
 * If SUPABASE_SERVICE_ROLE_KEY is missing, logs notice and writes nowhere.
 */
export async function upsertProspectRecords(
  newRecords: ProspectRecord[],
  options?: { testMode?: boolean }
): Promise<{ upsertedCount: number; persistedToSupabase: boolean }> {
  if (newRecords.length === 0) {
    return { upsertedCount: 0, persistedToSupabase: false };
  }

  const isTest = options?.testMode === true || isTestMode();
  const sb = getSupabase();

  if (!sb || isTest) {
    console.warn(
      `[Supabase Notice] SUPABASE_SERVICE_ROLE_KEY not configured. DRY RUN — no keys, nothing sourced, writing nowhere.`
    );
    return { upsertedCount: 0, persistedToSupabase: false };
  }

  // Hard Write-Path Gate (Iron Law):
  // Filter out any record missing Places place_id, DNS pass, Apollo/Hunter email status, or 5-dim reasons
  const validRecords: ProspectRecord[] = [];
  for (const r of newRecords) {
    const val = validateProspectRecord(r);
    if (!val.valid) {
      console.warn(`[Write Gate Rejected] Candidate '${r.company}' (${r.website}) dropped: ${val.reason}`);
      continue;
    }
    validRecords.push(r);
  }

  if (validRecords.length === 0) {
    console.warn(`[Write Gate Notice] 0 of ${newRecords.length} records passed all write validation gates. Zero rows written.`);
    return { upsertedCount: 0, persistedToSupabase: false };
  }

  try {
    const payload = validRecords.map((r) => ({
      tenant_id: r.tenant_id,
      company: r.company,
      category: r.category,
      city: r.city,
      website: r.website,
      door: r.door,
      fit_score: r.fit_score,
      fit_reasons: r.fit_reasons,
      decision_maker: r.decision_maker,
      signals: r.signals,
      status: r.status,
      source_refs: r.source_refs,
      created_at: r.created_at,
      rescored_at: r.rescored_at,
    }));

    const { error } = await sb.from("prospects").upsert(payload, {
      onConflict: "tenant_id,door,website",
    });

    if (error) {
      console.error(`[Supabase Upsert Error]:`, error.message);
      return { upsertedCount: 0, persistedToSupabase: false };
    }

    return {
      upsertedCount: validRecords.length,
      persistedToSupabase: true,
    };
  } catch (err: any) {
    console.error(`[Supabase Execution Failure]:`, err.message || err);
    return { upsertedCount: 0, persistedToSupabase: false };
  }
}

/**
 * Updates the status of prospects in Supabase.
 */
export async function updateProspectStatus(
  filter: { city?: string; category?: string; websites?: string[] },
  newStatus: "new" | "reviewed" | "rejected" | "handed_to_outreach",
  options?: { testMode?: boolean }
): Promise<number> {
  const isTest = options?.testMode === true || isTestMode();
  const sb = getSupabase();

  if (!sb || isTest) {
    return 0;
  }

  try {
    let query = sb
      .from("prospects")
      .update({ status: newStatus })
      .eq("tenant_id", "tgl");

    if (filter.city) {
      query = query.eq("city", filter.city);
    }
    if (filter.category) {
      query = query.eq("category", filter.category);
    }
    const { count, error } = await query;
    if (error) {
      console.warn(`[Supabase Status Update Warning]:`, error.message);
      return 0;
    }
    return count || 1;
  } catch (err: any) {
    console.warn(`[Supabase Status Update Error]:`, err.message || err);
    return 0;
  }
}

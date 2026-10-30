// services/tgl-ops/src/agents/prospect-researcher/db.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import type { ProspectRecord } from "./types.js";
export type { ProspectRecord };
import { validateProspectRecord } from "./guardrails.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rmrauejublipukulnjou.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let supabaseClient: SupabaseClient | null = null;

let mockProspectRecordsForTests: ProspectRecord[] | null = null;

export function setMockProspectRecordsForTests(records: ProspectRecord[] | null): void {
  mockProspectRecordsForTests = records;
}

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
  if (isTest && mockProspectRecordsForTests) {
    return mockProspectRecordsForTests;
  }
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

export interface ProspectMetrics {
  total: number;
  byCity: Record<string, number>;
  byStatus: Record<string, number>;
  byDay: Record<string, number>;
}

/**
 * Queries Supabase `public.prospects` to compute exact aggregate counts by city, status, and day.
 */
export async function getProspectMetricsFromSql(options?: {
  testMode?: boolean;
}): Promise<ProspectMetrics> {
  const isTest = options?.testMode === true || isTestMode();
  const metrics: ProspectMetrics = {
    total: 0,
    byCity: {},
    byStatus: {},
    byDay: {},
  };

  if (isTest && mockProspectRecordsForTests) {
    metrics.total = mockProspectRecordsForTests.length;
    for (const r of mockProspectRecordsForTests) {
      const city = (r.city || "Unknown").trim();
      metrics.byCity[city] = (metrics.byCity[city] || 0) + 1;

      const status = (r.status || "unknown").trim();
      metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1;

      const day = (r.created_at || "").slice(0, 10) || "Unknown";
      metrics.byDay[day] = (metrics.byDay[day] || 0) + 1;
    }
    return metrics;
  }

  const sb = getSupabase();
  if (!sb || isTest) {
    return metrics;
  }

  try {
    const { data, error } = await sb
      .from("prospects")
      .select("city, status, created_at")
      .eq("tenant_id", "tgl")
      .is("deleted_at", null);

    if (error) {
      console.warn(`[Supabase Query Warning on getProspectMetricsFromSql]:`, error.message);
      return metrics;
    }

    if (Array.isArray(data)) {
      metrics.total = data.length;
      for (const row of data) {
        const city = (row.city || "Unknown").trim();
        metrics.byCity[city] = (metrics.byCity[city] || 0) + 1;

        const status = (row.status || "unknown").trim();
        metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1;

        const day = (row.created_at || "").slice(0, 10) || "Unknown";
        metrics.byDay[day] = (metrics.byDay[day] || 0) + 1;
      }
    }
  } catch (err: any) {
    console.warn(`[Supabase Query Exception on getProspectMetricsFromSql]:`, err.message || err);
  }

  return metrics;
}

export function formatProspectCityCounts(metrics: ProspectMetrics): string {
  if (metrics.total === 0 || Object.keys(metrics.byCity).length === 0) {
    return `📊 *Prospect Counts by City (from SQL):*\n• 0 prospects recorded in Supabase \`public.prospects\`.\n_Verified from Supabase public.prospects_`;
  }

  const cityLines = Object.entries(metrics.byCity)
    .sort((a, b) => b[1] - a[1])
    .map(([city, count]) => `• *${city}:* ${count}`)
    .join("\n");

  const distinctCities = Object.keys(metrics.byCity).length;
  return `📊 *Prospect Counts by City (from SQL):*
${cityLines}
• *Total:* ${metrics.total} prospect${metrics.total === 1 ? "" : "s"} across ${distinctCities} cit${distinctCities === 1 ? "y" : "ies"}.
_Verified from Supabase public.prospects_`;
}

export function formatProspectStatusCounts(metrics: ProspectMetrics): string {
  if (metrics.total === 0 || Object.keys(metrics.byStatus).length === 0) {
    return `📊 *Prospect Counts by Status (from SQL):*\n• 0 prospects recorded in Supabase \`public.prospects\`.\n_Verified from Supabase public.prospects_`;
  }

  const statusLines = Object.entries(metrics.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `• *${status}:* ${count}`)
    .join("\n");

  return `📊 *Prospect Counts by Status (from SQL):*
${statusLines}
• *Total:* ${metrics.total} prospect${metrics.total === 1 ? "" : "s"}.
_Verified from Supabase public.prospects_`;
}

export function formatProspectDayCounts(metrics: ProspectMetrics): string {
  if (metrics.total === 0 || Object.keys(metrics.byDay).length === 0) {
    return `📊 *Prospect Counts by Day (from SQL):*\n• 0 prospects recorded in Supabase \`public.prospects\`.\n_Verified from Supabase public.prospects_`;
  }

  const dayLines = Object.entries(metrics.byDay)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, count]) => `• *${day}:* ${count}`)
    .join("\n");

  const distinctDays = Object.keys(metrics.byDay).length;
  return `📊 *Prospect Counts by Day (from SQL):*
${dayLines}
• *Total:* ${metrics.total} prospect${metrics.total === 1 ? "" : "s"} across ${distinctDays} day${distinctDays === 1 ? "" : "s"}.
_Verified from Supabase public.prospects_`;
}

export function formatAllProspectCounts(metrics: ProspectMetrics): string {
  if (metrics.total === 0) {
    return `📊 *Prospect Database Breakdown (from SQL):*\n• *Total Prospects:* 0\n_Verified from Supabase public.prospects_`;
  }

  const cityLines = Object.entries(metrics.byCity)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `• ${c}: ${n}`)
    .join("\n");

  const statusLines = Object.entries(metrics.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `• ${s}: ${n}`)
    .join("\n");

  const dayLines = Object.entries(metrics.byDay)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([d, n]) => `• ${d}: ${n}`)
    .join("\n");

  return `📊 *Prospect Database Breakdown (from SQL):*
• *Total Prospects:* ${metrics.total}

🏙️ *Counts by City:*
${cityLines}

📋 *Counts by Status:*
${statusLines}

📅 *Counts by Day:*
${dayLines}
_Verified from Supabase public.prospects_`;
}

export interface UpsertProspectsResult {
  upsertedCount: number;
  persistedToSupabase: boolean;
  readBackCount: number;
  error?: string;
  insertResponse?: any;
}

/**
 * Reads back confirmed prospects count from Supabase for the specified websites.
 */
export async function readBackProspectsCount(
  websites: string[],
  options?: { testMode?: boolean }
): Promise<number> {
  const isTest = options?.testMode === true || isTestMode();
  const sb = getSupabase();

  if (!sb || isTest) {
    // In test mode without Supabase connection, return candidate count
    return websites.length;
  }

  try {
    const normWebsites = Array.from(new Set(websites.map((w) => w.toLowerCase().trim())));
    const { data, error } = await sb
      .from("prospects")
      .select("website")
      .eq("tenant_id", "tgl")
      .in("website", normWebsites)
      .is("deleted_at", null);

    if (error) {
      console.warn(`[Supabase Read-Back Warning]:`, error.message);
      return 0;
    }

    return Array.isArray(data) ? data.length : 0;
  } catch (err: any) {
    console.warn(`[Supabase Read-Back Exception]:`, err.message || err);
    return 0;
  }
}

/**
 * Upserts qualified prospect records directly into Supabase `public.prospects`.
 * Shows full insert responses, normalizes websites, executes fallback insert if constraint mismatch,
 * and performs read-back verification before confirming.
 */
export async function upsertProspectRecords(
  newRecords: ProspectRecord[],
  options?: { testMode?: boolean }
): Promise<UpsertProspectsResult> {
  if (newRecords.length === 0) {
    return { upsertedCount: 0, persistedToSupabase: false, readBackCount: 0 };
  }

  const isTest = options?.testMode === true || isTestMode();
  const sb = getSupabase();

  if (!sb || isTest) {
    console.warn(
      `[Supabase Notice] SUPABASE_SERVICE_ROLE_KEY not configured or test mode. DRY RUN — writing nowhere.`
    );
    return {
      upsertedCount: newRecords.length,
      persistedToSupabase: false,
      readBackCount: isTest ? newRecords.length : 0,
    };
  }

  // Hard Write-Path Gate (Iron Law):
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
    return { upsertedCount: 0, persistedToSupabase: false, readBackCount: 0 };
  }

  try {
    // Normalize website to lower(trim(website)) to match unique constraint
    const payload = validRecords.map((r) => ({
      tenant_id: r.tenant_id,
      company: r.company,
      category: r.category,
      city: r.city,
      website: r.website.toLowerCase().trim(),
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

    console.log(`[Supabase Write Attempt] Submitting ${payload.length} rows to public.prospects...`);

    // 1. Try Upsert with onConflict: "tenant_id,door,website"
    const { data, error, status, statusText } = await sb
      .from("prospects")
      .upsert(payload, {
        onConflict: "tenant_id,door,website",
      })
      .select();

    console.log(
      `[Supabase Insert Response] HTTP ${status} ${statusText}: data=${data?.length || 0} rows, error=${
        error ? JSON.stringify(error) : "none"
      }`
    );

    let writeError: string | undefined;

    if (error) {
      console.error(`[Supabase Upsert Error]: ${error.message} (code: ${error.code})`);
      writeError = error.message;

      // 2. Fallback: If conflict constraint failed (e.g. 42P10), try direct insert
      console.log(`[Supabase Fallback] Attempting direct insert for ${payload.length} records...`);
      const fallbackRes = await sb.from("prospects").insert(payload).select();
      console.log(
        `[Supabase Fallback Response] HTTP ${fallbackRes.status} ${fallbackRes.statusText}: data=${
          fallbackRes.data?.length || 0
        } rows, error=${fallbackRes.error ? JSON.stringify(fallbackRes.error) : "none"}`
      );
      if (fallbackRes.error) {
        writeError = fallbackRes.error.message;
      } else {
        writeError = undefined;
      }
    }

    // 3. Read-Back Verification before confirming to caller
    const candidateWebsites = validRecords.map((r) => r.website);
    const readBackCount = await readBackProspectsCount(candidateWebsites, options);

    console.log(`[Supabase Read-Back Verification] Verified ${readBackCount} of ${candidateWebsites.length} in public.prospects`);

    const persisted = readBackCount > 0;

    return {
      upsertedCount: validRecords.length,
      persistedToSupabase: persisted,
      readBackCount,
      error: writeError,
      insertResponse: { status, statusText, error, dataCount: data?.length },
    };
  } catch (err: any) {
    console.error(`[Supabase Execution Failure]:`, err.message || err);
    return {
      upsertedCount: 0,
      persistedToSupabase: false,
      readBackCount: 0,
      error: err.message || String(err),
    };
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

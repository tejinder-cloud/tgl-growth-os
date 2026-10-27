// services/tgl-ops/src/agents/prospect-researcher/db.ts
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import type { ProspectRecord } from "./types.js";
import { validateProspectRecord } from "./guardrails.js";

const PROSPECTS_STATE_PATH = "logs/.state/prospects.json";
const PROSPECTS_TEST_STATE_PATH = "logs/.test/.state/prospects.json";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rmrauejublipukulnjou.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    return supabaseClient;
  }
  return null;
}

function getLocalProspectsPath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, PROSPECTS_TEST_STATE_PATH);
  }
  return path.join(config.repoRoot, PROSPECTS_STATE_PATH);
}

/**
 * Loads all known prospects from local state and/or Supabase.
 */
export async function loadAllProspects(options?: { testMode?: boolean }): Promise<ProspectRecord[]> {
  const isTest = options?.testMode === true || isTestMode();
  const localFile = getLocalProspectsPath(isTest);

  const map = new Map<string, ProspectRecord>();

  // 1. Read local file state
  if (fs.existsSync(localFile)) {
    try {
      const raw = fs.readFileSync(localFile, "utf8");
      const list: ProspectRecord[] = JSON.parse(raw);
      for (const p of list) {
        const key = `${p.tenant_id}:${p.door}:${p.website.toLowerCase().trim()}`;
        map.set(key, p);
      }
    } catch {
      // ignore
    }
  }

  // 2. Query Supabase if credentials available
  const sb = getSupabase();
  if (sb && !isTest) {
    try {
      const { data, error } = await sb
        .from("prospects")
        .select("*")
        .eq("tenant_id", "tgl")
        .is("deleted_at", null);

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const key = `${row.tenant_id}:${row.door}:${row.website.toLowerCase().trim()}`;
          map.set(key, row as ProspectRecord);
        }
      }
    } catch (err: any) {
      console.warn(`[Supabase Query Warning]:`, err.message);
    }
  }

  return Array.from(map.values());
}

/**
 * Upserts qualified prospect records into Supabase `prospects` and persists to local state.
 */
export async function upsertProspectRecords(
  newRecords: ProspectRecord[],
  options?: { testMode?: boolean }
): Promise<{ upsertedCount: number; persistedToSupabase: boolean }> {
  if (newRecords.length === 0) {
    return { upsertedCount: 0, persistedToSupabase: false };
  }

  const isTest = options?.testMode === true || isTestMode();
  const localFile = getLocalProspectsPath(isTest);
  const dir = path.dirname(localFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

  // Load existing
  const all = await loadAllProspects(options);
  const map = new Map<string, ProspectRecord>();
  for (const p of all) {
    const key = `${p.tenant_id}:${p.door}:${p.website.toLowerCase().trim()}`;
    map.set(key, p);
  }

  // Upsert new valid records
  for (const n of validRecords) {
    const key = `${n.tenant_id}:${n.door}:${n.website.toLowerCase().trim()}`;
    map.set(key, n);
  }

  const merged = Array.from(map.values());
  fs.writeFileSync(localFile, JSON.stringify(merged, null, 2) + "\n", "utf8");

  // Upsert to Supabase
  let persistedToSupabase = false;
  const sb = getSupabase();
  if (sb && !isTest) {
    try {
      const payload = newRecords.map((r) => ({
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

      if (!error) {
        persistedToSupabase = true;
      } else {
        console.warn(`[Supabase Upsert Warning]:`, error.message);
      }
    } catch (err: any) {
      console.warn(`[Supabase Execution Warning]:`, err.message);
    }
  }

  return {
    upsertedCount: newRecords.length,
    persistedToSupabase,
  };
}

/**
 * Updates the status of prospects in both Supabase and local state.
 */
export async function updateProspectStatus(
  filter: { city?: string; category?: string; websites?: string[] },
  newStatus: "new" | "reviewed" | "rejected" | "handed_to_outreach",
  options?: { testMode?: boolean }
): Promise<number> {
  const isTest = options?.testMode === true || isTestMode();
  const localFile = getLocalProspectsPath(isTest);

  let updatedCount = 0;
  const all = await loadAllProspects(options);
  const updatedList = all.map((p) => {
    let match = true;
    if (filter.city && p.city.toLowerCase() !== filter.city.toLowerCase()) {
      match = false;
    }
    if (filter.category && p.category.toLowerCase() !== filter.category.toLowerCase()) {
      match = false;
    }
    if (filter.websites && filter.websites.length > 0) {
      if (!filter.websites.includes(p.website.toLowerCase())) {
        match = false;
      }
    }
    if (match) {
      updatedCount++;
      return { ...p, status: newStatus };
    }
    return p;
  });

  if (fs.existsSync(path.dirname(localFile))) {
    fs.writeFileSync(localFile, JSON.stringify(updatedList, null, 2) + "\n", "utf8");
  }

  const sb = getSupabase();
  if (sb && !isTest) {
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
      await query;
    } catch (err: any) {
      console.warn(`[Supabase Status Update Warning]:`, err.message);
    }
  }

  return updatedCount;
}

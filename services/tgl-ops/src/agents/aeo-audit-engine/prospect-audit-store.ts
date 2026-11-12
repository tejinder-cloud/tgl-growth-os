// services/tgl-ops/src/agents/aeo-audit-engine/prospect-audit-store.ts
// The record of prospect audits under review (table prospect_audits). The PDF is stored with the row so the
// Architect's "Send on email" works whenever he taps it, including after a redeploy.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ProspectAuditStatus = "ready" | "sending" | "sent" | "send_failed" | "refined";

export interface ProspectAuditRow {
  id: string;
  site_lead_id: string | null;
  refined_from: string | null;
  source: "site_lead" | "architect" | "outreach";
  business_name: string;
  domain: string;
  category_phrase: string;
  phrase_from: "architect" | "name" | "industry" | "website";
  city: string | null;
  prompts: string[];
  total_mentions: number;
  total_queries: number;
  summary: Record<string, unknown>;
  cost_usd: number;
  pdf_filename: string;
  pdf_base64: string;
  contact_name: string | null;
  contact_email: string | null;
  slack_channel: string | null;
  slack_ts: string | null;
  slack_file_id: string | null;
  status: ProspectAuditStatus;
  sent_to: string | null;
  sent_at: string | null;
  email_id: string | null;
  send_error: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

export type NewProspectAudit = Omit<ProspectAuditRow, "id" | "status" | "sent_to" | "sent_at" | "email_id" | "send_error" | "decided_by" | "decided_at" | "slack_channel" | "slack_ts" | "slack_file_id">;

export interface ProspectAuditStore {
  insert(row: NewProspectAudit): Promise<string>;
  get(id: string): Promise<ProspectAuditRow | null>;
  update(id: string, patch: Partial<ProspectAuditRow>): Promise<void>;
  /**
   * Moves a row from one of `from` to `to` in a single statement and reports whether this call made the move.
   * Two taps on "Send on email" cannot both win: only one finds the row still "ready".
   */
  claim(id: string, from: ProspectAuditStatus[], to: ProspectAuditStatus, patch?: Partial<ProspectAuditRow>): Promise<boolean>;
}

export function supabaseProspectAuditStore(sb: SupabaseClient): ProspectAuditStore {
  const table = () => sb.from("prospect_audits");
  return {
    async insert(row) {
      const { data, error } = await table().insert(row).select("id").single();
      if (error || !data) throw new Error(`prospect_audits insert: ${error?.message || "no row returned"}`);
      return (data as any).id as string;
    },
    async get(id) {
      const { data, error } = await table().select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`prospect_audits read: ${error.message}`);
      return (data as ProspectAuditRow) || null;
    },
    async update(id, patch) {
      const { error } = await table().update(patch).eq("id", id);
      if (error) throw new Error(`prospect_audits update: ${error.message}`);
    },
    async claim(id, from, to, patch) {
      const { data, error } = await table().update({ ...(patch || {}), status: to }).eq("id", id).in("status", from).select("id");
      if (error) throw new Error(`prospect_audits claim: ${error.message}`);
      return Array.isArray(data) && data.length === 1;
    },
  };
}

let cached: ProspectAuditStore | null | undefined;
/** The Supabase-backed store, or null when the database is not configured. */
export function defaultProspectAuditStore(): ProspectAuditStore | null {
  if (cached !== undefined) return cached;
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  cached = url && key ? supabaseProspectAuditStore(createClient(url, key, { auth: { persistSession: false } })) : null;
  return cached;
}

/** In-memory store for tests. */
export function memoryProspectAuditStore(): ProspectAuditStore & { rows: Map<string, ProspectAuditRow> } {
  const rows = new Map<string, ProspectAuditRow>();
  let n = 0;
  return {
    rows,
    async insert(row) {
      const id = `audit-${++n}`;
      rows.set(id, { ...row, id, status: "ready", sent_to: null, sent_at: null, email_id: null, send_error: null, decided_by: null, decided_at: null, slack_channel: null, slack_ts: null, slack_file_id: null });
      return id;
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (!r) throw new Error(`no row ${id}`);
      rows.set(id, { ...r, ...patch });
    },
    async claim(id, from, to, patch) {
      const r = rows.get(id);
      if (!r || !from.includes(r.status)) return false;
      rows.set(id, { ...r, ...(patch || {}), status: to });
      return true;
    },
  };
}

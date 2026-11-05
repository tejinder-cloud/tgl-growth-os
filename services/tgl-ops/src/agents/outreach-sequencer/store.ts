// services/tgl-ops/src/agents/outreach-sequencer/store.ts
// Touch ledger in Supabase public.outreach_touches (see services/tgl-ops/sql/outreach_touches.sql).
// Reads degrade to "no history" with a warning; writes only happen in live mode (the sequencer enforces that).
import { getSupabase } from "../prospect-researcher/db.js";
import type { AuditVars, TouchRecord } from "./types.js";

const TABLE = "outreach_touches";

function toRow(r: TouchRecord) {
  return {
    tenant_id: "tgl",
    prospect_key: r.prospectKey,
    touch_no: r.touchNo,
    channel: r.channel,
    status: r.status,
    sent_at: r.sentAt,
    ghl_message_id: r.ghlMessageId ?? null,
    error: r.error ?? null,
    audit: r.audit ?? null,
  };
}

function fromRow(row: any): TouchRecord {
  return {
    prospectKey: row.prospect_key,
    touchNo: row.touch_no,
    channel: row.channel,
    status: row.status,
    sentAt: row.sent_at,
    ghlMessageId: row.ghl_message_id ?? undefined,
    error: row.error ?? undefined,
    audit: (row.audit as AuditVars | null) ?? undefined,
  };
}

export async function loadTouchHistory(keys: string[]): Promise<Record<string, TouchRecord[]>> {
  const out: Record<string, TouchRecord[]> = {};
  const sb = getSupabase();
  if (!sb || keys.length === 0) return out;
  try {
    const { data, error } = await sb.from(TABLE).select("*").eq("tenant_id", "tgl").in("prospect_key", keys);
    if (error) {
      console.warn(`[Outreach Store] history read failed: ${error.message}`);
      return out;
    }
    for (const row of data || []) {
      const rec = fromRow(row);
      (out[rec.prospectKey] ||= []).push(rec);
    }
  } catch (err: any) {
    console.warn(`[Outreach Store] history read exception: ${err?.message || err}`);
  }
  return out;
}

export async function recordTouchRow(rec: TouchRecord): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured; refusing to send without a ledger to record it in");
  const { error } = await sb.from(TABLE).insert(toRow(rec));
  if (error) throw new Error(`outreach_touches insert failed: ${error.message}`);
}

export async function countSentSince(sinceIso: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return Number.MAX_SAFE_INTEGER; // fail closed: no ledger, no sending
  const { count, error } = await sb
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", "tgl")
    .eq("status", "sent")
    .gte("touch_no", 1)
    .gte("sent_at", sinceIso);
  if (error) {
    console.warn(`[Outreach Store] count failed: ${error.message}`);
    return Number.MAX_SAFE_INTEGER;
  }
  return count || 0;
}

export async function findProspectKeyByContact(c: { email?: string; phone?: string }): Promise<{ key: string; company: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const clauses: string[] = [];
  if (c.email) clauses.push(`decision_maker->>email.eq.${c.email.replace(/[,()]/g, "")}`);
  if (c.phone) clauses.push(`decision_maker->>phone.eq.${c.phone.replace(/[,()]/g, "")}`);
  if (clauses.length === 0) return null;
  const { data, error } = await sb
    .from("prospects")
    .select("id, website, company")
    .eq("tenant_id", "tgl")
    .is("deleted_at", null)
    .or(clauses.join(","))
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row: any = data[0];
  return { key: row.id || String(row.website).toLowerCase().trim(), company: row.company };
}

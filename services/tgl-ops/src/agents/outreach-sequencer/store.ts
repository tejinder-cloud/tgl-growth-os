// services/tgl-ops/src/agents/outreach-sequencer/store.ts
// Prospect persistence for the sequencer. Sequence state lives in prospects.signals.outreach
// (no schema change). The store is an interface so the worker and webhook are testable without Supabase.
import { getSupabase } from "../prospect-researcher/db.js";
import type { ProspectRecord } from "../prospect-researcher/types.js";
import type { OutreachState } from "./types.js";

export type OutreachProspect = ProspectRecord & { id: string };

export type OutreachProspectStatus = "reviewed" | "handed_to_outreach" | "rejected";

export interface ProspectStore {
  /** status = reviewed, door aeo, fit_score >= 70, not deleted, no outreach state yet. */
  loadEnrollable(limit: number): Promise<OutreachProspect[]>;
  /** Every prospect carrying an outreach state (any state), for scheduling and the daily cap. */
  loadSequenced(): Promise<OutreachProspect[]>;
  findByGhlContactId(contactId: string): Promise<OutreachProspect | null>;
  findByEmail(email: string): Promise<OutreachProspect | null>;
  /** Merges state into signals.outreach on a fresh read, optionally changing status. */
  saveState(id: string, state: OutreachState, status?: OutreachProspectStatus): Promise<void>;
}

export function getOutreachState(p: ProspectRecord): OutreachState | undefined {
  const s = (p.signals as any)?.outreach;
  return s && typeof s === "object" ? (s as OutreachState) : undefined;
}

export const MIN_FIT_SCORE = 70;

/**
 * Enrolled only with an email address: every touch goes by email while WhatsApp is off (13 Nov 2026), so a
 * phone-only prospect would only collect failed sends and a pause alert. Phone-only prospects wait for the
 * WhatsApp flow.
 */
export function isEnrollable(p: OutreachProspect): boolean {
  const email = String(p.decision_maker?.email || "").trim();
  return p.status === "reviewed" && p.door === "aeo" && p.fit_score >= MIN_FIT_SCORE && !getOutreachState(p) && /\S+@\S+\.\S+/.test(email);
}

export function createSupabaseStore(): ProspectStore {
  function sb() {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing)");
    return client;
  }

  async function loadByStatuses(statuses: string[]): Promise<OutreachProspect[]> {
    const { data, error } = await sb()
      .from("prospects")
      .select("*")
      .eq("tenant_id", "tgl")
      .in("status", statuses)
      .is("deleted_at", null);
    if (error) throw new Error(`Supabase prospects query failed: ${error.message}`);
    return (data || []) as OutreachProspect[];
  }

  async function sequenced(): Promise<OutreachProspect[]> {
    const rows = await loadByStatuses(["handed_to_outreach", "rejected"]);
    return rows.filter((p) => !!getOutreachState(p));
  }

  return {
    async loadEnrollable(limit) {
      const rows = await loadByStatuses(["reviewed"]);
      return rows
        .filter(isEnrollable)
        .sort((a, b) => b.fit_score - a.fit_score)
        .slice(0, limit);
    },

    loadSequenced: sequenced,

    async findByGhlContactId(contactId) {
      const rows = await sequenced();
      return rows.find((p) => getOutreachState(p)?.ghl_contact_id === contactId) || null;
    },

    async findByEmail(email) {
      const needle = email.trim().toLowerCase();
      const rows = await sequenced();
      return rows.find((p) => (p.decision_maker?.email || "").toLowerCase() === needle) || null;
    },

    async saveState(id, state, status) {
      const client = sb();
      const { data, error } = await client
        .from("prospects")
        .select("signals")
        .eq("id", id)
        .eq("tenant_id", "tgl")
        .single();
      if (error) throw new Error(`Supabase read before save failed: ${error.message}`);
      const signals = { ...((data as any)?.signals || {}), outreach: state };
      const patch: Record<string, unknown> = { signals };
      if (status) patch.status = status;
      const upd = await client.from("prospects").update(patch).eq("id", id).eq("tenant_id", "tgl");
      if (upd.error) throw new Error(`Supabase save outreach state failed: ${upd.error.message}`);
    },
  };
}

/** In-memory store for tests. */
export function createMemoryStore(initial: OutreachProspect[]): ProspectStore & { rows: OutreachProspect[] } {
  const rows = initial;
  const sequenced = () => rows.filter((p) => !!getOutreachState(p));
  return {
    rows,
    async loadEnrollable(limit) {
      return rows
        .filter(isEnrollable)
        .sort((a, b) => b.fit_score - a.fit_score)
        .slice(0, limit);
    },
    async loadSequenced() {
      return sequenced();
    },
    async findByGhlContactId(contactId) {
      return sequenced().find((p) => getOutreachState(p)?.ghl_contact_id === contactId) || null;
    },
    async findByEmail(email) {
      const needle = email.trim().toLowerCase();
      return sequenced().find((p) => (p.decision_maker?.email || "").toLowerCase() === needle) || null;
    },
    async saveState(id, state, status) {
      const row = rows.find((p) => p.id === id);
      if (!row) throw new Error(`No prospect ${id}`);
      row.signals = { ...(row.signals as any), outreach: state } as any;
      if (status) row.status = status as any;
    },
  };
}

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
  /** status = handed_to_outreach with an outreach state of active or paused. */
  loadRunning(): Promise<OutreachProspect[]>;
  findByGhlContactId(contactId: string): Promise<OutreachProspect | null>;
  findByEmail(email: string): Promise<OutreachProspect | null>;
  /** Merges state into signals.outreach on a fresh read, optionally changing status. */
  saveState(id: string, state: OutreachState, status?: OutreachProspectStatus): Promise<void>;
}

export function getOutreachState(p: ProspectRecord): OutreachState | undefined {
  const s = (p.signals as any)?.outreach;
  return s && typeof s === "object" ? (s as OutreachState) : undefined;
}

const MIN_FIT_SCORE = 70;

export function createSupabaseStore(): ProspectStore {
  function sb() {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing)");
    return client;
  }

  async function loadByStatus(status: string): Promise<OutreachProspect[]> {
    const { data, error } = await sb()
      .from("prospects")
      .select("*")
      .eq("tenant_id", "tgl")
      .eq("status", status)
      .is("deleted_at", null);
    if (error) throw new Error(`Supabase prospects query failed: ${error.message}`);
    return (data || []) as OutreachProspect[];
  }

  return {
    async loadEnrollable(limit) {
      const rows = await loadByStatus("reviewed");
      return rows
        .filter((p) => p.door === "aeo" && p.fit_score >= MIN_FIT_SCORE && !getOutreachState(p))
        .sort((a, b) => b.fit_score - a.fit_score)
        .slice(0, limit);
    },

    async loadRunning() {
      const rows = await loadByStatus("handed_to_outreach");
      return rows.filter((p) => {
        const st = getOutreachState(p)?.state;
        return st === "active" || st === "paused";
      });
    },

    async findByGhlContactId(contactId) {
      const rows = await loadByStatus("handed_to_outreach");
      return rows.find((p) => getOutreachState(p)?.ghl_contact_id === contactId) || null;
    },

    async findByEmail(email) {
      const needle = email.trim().toLowerCase();
      const rows = await loadByStatus("handed_to_outreach");
      return (
        rows.find((p) => (p.decision_maker?.email || "").toLowerCase() === needle && getOutreachState(p)) || null
      );
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
  return {
    rows,
    async loadEnrollable(limit) {
      return rows
        .filter((p) => p.status === "reviewed" && p.door === "aeo" && p.fit_score >= MIN_FIT_SCORE && !getOutreachState(p))
        .sort((a, b) => b.fit_score - a.fit_score)
        .slice(0, limit);
    },
    async loadRunning() {
      return rows.filter((p) => {
        const st = getOutreachState(p)?.state;
        return p.status === "handed_to_outreach" && (st === "active" || st === "paused");
      });
    },
    async findByGhlContactId(contactId) {
      return rows.find((p) => getOutreachState(p)?.ghl_contact_id === contactId) || null;
    },
    async findByEmail(email) {
      const needle = email.trim().toLowerCase();
      return rows.find((p) => (p.decision_maker?.email || "").toLowerCase() === needle && getOutreachState(p)) || null;
    },
    async saveState(id, state, status) {
      const row = rows.find((p) => p.id === id);
      if (!row) throw new Error(`No prospect ${id}`);
      row.signals = { ...(row.signals as any), outreach: state } as any;
      if (status) row.status = status as any;
    },
  };
}

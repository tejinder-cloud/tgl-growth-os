// services/tgl-ops/src/agents/sales-desk/store.ts
// Persistence for the Sales Desk. State lives in prospects.signals.sales_desk (no schema change).
// The store is an interface so the worker is testable without Supabase.
import { getSupabase } from "../prospect-researcher/db.js";
import type { SalesDeskState, SalesProspect } from "./types.js";

export interface SalesStore {
  /** Prospect whose outreach state carries this GHL contact id, or null. */
  findByGhlContactId(contactId: string): Promise<SalesProspect | null>;
  /** Prospects that already have sales_desk state (pending, drafted or sent proposals). */
  loadWithState(): Promise<SalesProspect[]>;
  /** Merges state into signals.sales_desk on a fresh read. */
  saveState(id: string, state: SalesDeskState): Promise<void>;
}

export function getSalesState(p: SalesProspect): SalesDeskState {
  const s = (p.signals as any)?.sales_desk;
  if (s && typeof s === "object") {
    const st = s as SalesDeskState;
    return { ...st, dossier_appointment_ids: Array.isArray(st.dossier_appointment_ids) ? st.dossier_appointment_ids : [] };
  }
  return { dossier_appointment_ids: [] };
}

export function ghlContactIdOf(p: SalesProspect): string | undefined {
  const id = (p.signals as any)?.outreach?.ghl_contact_id;
  return typeof id === "string" && id ? id : undefined;
}

const ACTIVE_STATUSES = ["reviewed", "handed_to_outreach"];

export function createSupabaseSalesStore(): SalesStore {
  function sb() {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing)");
    return client;
  }

  async function load(): Promise<SalesProspect[]> {
    const { data, error } = await sb()
      .from("prospects")
      .select("*")
      .eq("tenant_id", "tgl")
      .in("status", ACTIVE_STATUSES)
      .is("deleted_at", null);
    if (error) throw new Error(`Supabase prospects query failed: ${error.message}`);
    return (data || []) as SalesProspect[];
  }

  return {
    async findByGhlContactId(contactId) {
      const rows = await load();
      return rows.find((p) => ghlContactIdOf(p) === contactId) || null;
    },
    async loadWithState() {
      const rows = await load();
      return rows.filter((p) => !!(p.signals as any)?.sales_desk);
    },
    async saveState(id, state) {
      const client = sb();
      const { data, error } = await client.from("prospects").select("signals").eq("id", id).eq("tenant_id", "tgl").single();
      if (error) throw new Error(`Supabase read before save failed: ${error.message}`);
      const signals = { ...((data as any)?.signals || {}), sales_desk: state };
      const upd = await client.from("prospects").update({ signals }).eq("id", id).eq("tenant_id", "tgl");
      if (upd.error) throw new Error(`Supabase save sales_desk state failed: ${upd.error.message}`);
    },
  };
}

/** In-memory store for tests. */
export function createMemorySalesStore(initial: SalesProspect[]): SalesStore & { rows: SalesProspect[] } {
  const rows = initial;
  return {
    rows,
    async findByGhlContactId(contactId) {
      return rows.find((p) => ghlContactIdOf(p) === contactId) || null;
    },
    async loadWithState() {
      return rows.filter((p) => !!(p.signals as any)?.sales_desk);
    },
    async saveState(id, state) {
      const row = rows.find((p) => p.id === id);
      if (!row) throw new Error(`No prospect ${id}`);
      row.signals = { ...(row.signals || {}), sales_desk: state };
    },
  };
}

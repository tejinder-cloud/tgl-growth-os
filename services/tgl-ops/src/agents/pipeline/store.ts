// services/tgl-ops/src/agents/pipeline/store.ts
// Deals in Supabase (public.deals), behind an interface so the service is testable without a database.
import { getSupabase } from "../prospect-researcher/db.js";
import type { Deal, Stage } from "./stages.js";

export type NewDeal = Omit<Deal, "id">;

export interface DealStore {
  get(id: string): Promise<Deal | null>;
  findOpenByEmail(email: string): Promise<Deal | null>;
  findOpenByProspect(prospectId: string): Promise<Deal | null>;
  findByBooking(bookingId: string): Promise<Deal | null>;
  create(d: NewDeal): Promise<Deal>;
  update(id: string, patch: Partial<Deal>): Promise<Deal>;
  /** Call booked, the call's end has passed, not yet asked about. */
  listCallsToAsk(before: string): Promise<Deal[]>;
  counts(): Promise<{ proposalsSent: number; won: number }>;
}

const OPEN: Stage[] = ["in_outreach", "audit_requested", "replied", "call_booked", "call_done", "proposal_sent"];

export function createSupabaseDealStore(): DealStore {
  function sb() {
    const c = getSupabase();
    if (!c) throw new Error("Supabase is not configured");
    return c;
  }
  const one = async (q: any): Promise<Deal | null> => {
    const { data, error } = await q.limit(1);
    if (error) throw new Error(`Reading deals failed: ${error.message}`);
    return (data && data[0]) || null;
  };
  return {
    async get(id) {
      return one(sb().from("deals").select("*").eq("id", id));
    },
    async findOpenByEmail(email) {
      return one(sb().from("deals").select("*").eq("tenant_id", "tgl").ilike("contact_email", email.trim()).in("stage", OPEN));
    },
    async findOpenByProspect(prospectId) {
      return one(sb().from("deals").select("*").eq("tenant_id", "tgl").eq("prospect_id", prospectId).in("stage", OPEN));
    },
    async findByBooking(bookingId) {
      return one(sb().from("deals").select("*").eq("tenant_id", "tgl").eq("booking_id", bookingId));
    },
    async create(d) {
      const { data, error } = await sb().from("deals").insert({ ...d, tenant_id: "tgl" }).select("*").single();
      if (error) throw new Error(`Saving the deal failed: ${error.message}`);
      return data as Deal;
    },
    async update(id, patch) {
      const { data, error } = await sb().from("deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
      if (error) throw new Error(`Updating the deal failed: ${error.message}`);
      return data as Deal;
    },
    async listCallsToAsk(before) {
      const { data, error } = await sb().from("deals").select("*").eq("tenant_id", "tgl").eq("stage", "call_booked").is("call_prompted_at", null).lte("call_at", before);
      if (error) throw new Error(`Reading deals failed: ${error.message}`);
      return (data || []) as Deal[];
    },
    async counts() {
      const { data, error } = await sb().from("deals").select("stage, history").eq("tenant_id", "tgl");
      if (error) throw new Error(`Counting deals failed: ${error.message}`);
      let proposalsSent = 0;
      let won = 0;
      for (const d of (data || []) as Deal[]) {
        if ((d.history || []).some((h) => h.stage === "proposal_sent")) proposalsSent++;
        if (d.stage === "won") won++;
      }
      return { proposalsSent, won };
    },
  };
}

export function createMemoryDealStore(): DealStore & { rows: Deal[] } {
  const rows: Deal[] = [];
  const open = (d: Deal) => OPEN.includes(d.stage);
  return {
    rows,
    async get(id) {
      return rows.find((r) => r.id === id) || null;
    },
    async findOpenByEmail(email) {
      return rows.find((r) => open(r) && (r.contact_email || "").toLowerCase() === email.trim().toLowerCase()) || null;
    },
    async findOpenByProspect(pid) {
      return rows.find((r) => open(r) && r.prospect_id === pid) || null;
    },
    async findByBooking(bid) {
      return rows.find((r) => r.booking_id === bid) || null;
    },
    async create(d) {
      const row = { ...d, id: `d${rows.length + 1}` } as Deal;
      rows.push(row);
      return row;
    },
    async update(id, patch) {
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, patch);
      return r;
    },
    async listCallsToAsk(before) {
      return rows.filter((r) => r.stage === "call_booked" && !r.call_prompted_at && r.call_at && r.call_at <= before);
    },
    async counts() {
      return { proposalsSent: rows.filter((r) => r.history.some((h) => h.stage === "proposal_sent")).length, won: rows.filter((r) => r.stage === "won").length };
    },
  };
}

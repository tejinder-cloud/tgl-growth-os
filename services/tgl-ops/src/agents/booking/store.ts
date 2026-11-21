// services/tgl-ops/src/agents/booking/store.ts
// Bookings rows and the calendar's refresh token. An interface, so the service is testable without Supabase.
import { getSupabase } from "../prospect-researcher/db.js";

export interface BookingRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "pending" | "booked" | "cancelled";
  guest_name: string;
  guest_email: string;
  company: string;
  note?: string | null;
  prospect_id?: string | null;
  event_id?: string | null;
  meet_url?: string | null;
}

export type NewBooking = Omit<BookingRow, "id" | "status" | "event_id" | "meet_url">;

export class SlotTakenError extends Error {
  constructor() {
    super("slot already taken");
  }
}

export interface BookingStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  /** Holds the slot; throws SlotTakenError when another live booking already holds it. */
  insertPending(b: NewBooking): Promise<string>;
  markBooked(id: string, eventId: string, meetUrl: string): Promise<void>;
  release(id: string): Promise<void>;
  countBooked(): Promise<number>;
  /** Booked rows starting at or after `fromIso`. */
  listUpcomingBooked(fromIso: string): Promise<BookingRow[]>;
}

export function createSupabaseBookingStore(): BookingStore {
  function sb() {
    const c = getSupabase();
    if (!c) throw new Error("Supabase is not configured");
    return c;
  }
  return {
    async getRefreshToken() {
      const { data, error } = await sb().rpc("svc_booking_refresh_token");
      if (error) throw new Error(`Reading the calendar sign-in failed: ${error.message}`);
      return data ? String(data) : null;
    },
    async setRefreshToken(token) {
      const { error } = await sb().rpc("svc_set_booking_refresh_token", { p_token: token });
      if (error) throw new Error(`Saving the calendar sign-in failed: ${error.message}`);
    },
    async insertPending(b) {
      const { data, error } = await sb().from("bookings").insert({ ...b, tenant_id: "tgl", status: "pending" }).select("id").single();
      if (error) {
        if (error.code === "23505") throw new SlotTakenError();
        throw new Error(`Saving the booking failed: ${error.message}`);
      }
      return String((data as any).id);
    },
    async markBooked(id, eventId, meetUrl) {
      const { error } = await sb().from("bookings").update({ status: "booked", event_id: eventId, meet_url: meetUrl || null }).eq("id", id);
      if (error) throw new Error(`Confirming the booking row failed: ${error.message}`);
    },
    async release(id) {
      await sb().from("bookings").update({ status: "cancelled" }).eq("id", id);
    },
    async countBooked() {
      const { count, error } = await sb().from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", "tgl").eq("status", "booked");
      if (error) throw new Error(`Counting bookings failed: ${error.message}`);
      return count || 0;
    },
    async listUpcomingBooked(fromIso) {
      const { data, error } = await sb().from("bookings").select("*").eq("tenant_id", "tgl").eq("status", "booked").gte("starts_at", fromIso);
      if (error) throw new Error(`Reading bookings failed: ${error.message}`);
      return (data || []) as BookingRow[];
    },
  };
}

export function createMemoryBookingStore(): BookingStore & { rows: BookingRow[]; token: string | null } {
  const self = {
    rows: [] as BookingRow[],
    token: null as string | null,
    async getRefreshToken() {
      return self.token;
    },
    async setRefreshToken(t: string) {
      self.token = t;
    },
    async insertPending(b: NewBooking) {
      if (self.rows.some((r) => r.starts_at === b.starts_at && r.status !== "cancelled")) throw new SlotTakenError();
      const id = `b${self.rows.length + 1}`;
      self.rows.push({ ...b, id, status: "pending" });
      return id;
    },
    async markBooked(id: string, eventId: string, meetUrl: string) {
      const r = self.rows.find((x) => x.id === id)!;
      Object.assign(r, { status: "booked", event_id: eventId, meet_url: meetUrl });
    },
    async release(id: string) {
      const r = self.rows.find((x) => x.id === id);
      if (r) r.status = "cancelled";
    },
    async countBooked() {
      return self.rows.filter((r) => r.status === "booked").length;
    },
    async listUpcomingBooked(fromIso: string) {
      return self.rows.filter((r) => r.status === "booked" && new Date(r.starts_at).getTime() >= new Date(fromIso).getTime());
    },
  };
  return self;
}

// services/tgl-ops/src/lib/events.ts
// The record of what the system did (25 Nov 2026): one row per event in the ops_events table, read by the
// dashboard. Recording is best-effort: a failed write is logged and never stops the job that called it.
// In test mode events go to memory, so tests can check them and nothing reaches the database.
import { isTestMode } from "../config.js";

export type EventKind = "run" | "sent" | "held" | "reply" | "bounce" | "approved" | "rejected" | "card" | "check" | "booked" | "error";

export interface OpsEvent {
  agent: string;
  kind: EventKind;
  /** One plain sentence. Business names are fine; never a person's email address or phone number. */
  summary: string;
  prospectId?: string | null;
  detail?: Record<string, unknown>;
  /** ISO time; the database sets it when omitted. */
  at?: string;
}

export interface StoredEvent extends OpsEvent {
  at: string;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s-]{8,}\d)/g;

/** Strips email addresses and phone numbers from a sentence, so a summary never carries personal contact data. */
export function cleanSummary(text: string): string {
  return String(text || "").replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(/\s+/g, " ").trim().slice(0, 500);
}

let memory: StoredEvent[] = [];
let writer: ((row: Record<string, unknown>) => Promise<void>) | null = null;

export function testEvents(): StoredEvent[] {
  return memory;
}
export function resetEventsForTests(): void {
  memory = [];
}
/** Tests can route writes through their own function to check the row shape. */
export function setEventWriterForTests(fn: ((row: Record<string, unknown>) => Promise<void>) | null): void {
  writer = fn;
}

export async function recordEvent(e: OpsEvent): Promise<void> {
  const row = {
    tenant_id: "tgl",
    agent: e.agent,
    kind: e.kind,
    summary: cleanSummary(e.summary),
    prospect_id: e.prospectId || null,
    detail: e.detail || {},
    ...(e.at ? { at: e.at } : {}),
  };
  try {
    if (writer) return await writer(row);
    if (isTestMode()) {
      memory.push({ agent: row.agent, kind: row.kind as EventKind, summary: row.summary, prospectId: row.prospect_id, detail: row.detail, at: e.at || new Date().toISOString() });
      return;
    }
    const { getSupabase } = await import("../agents/prospect-researcher/db.js");
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from("ops_events").insert(row);
    if (error) console.warn("[Events] not recorded:", error.message);
  } catch (err) {
    console.warn("[Events] not recorded:", (err as Error)?.message || err);
  }
}

/** Events since a time, newest first. Null when they could not be read. */
export async function listEvents(sinceIso: string, limit = 200): Promise<StoredEvent[] | null> {
  if (isTestMode()) return memory.filter((e) => e.at >= sinceIso).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  try {
    const { getSupabase } = await import("../agents/prospect-researcher/db.js");
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from("ops_events").select("at, agent, kind, summary, prospect_id, detail").eq("tenant_id", "tgl").gte("at", sinceIso).order("at", { ascending: false }).limit(limit);
    if (error) {
      console.warn("[Events] could not be read:", error.message);
      return null;
    }
    return ((data || []) as any[]).map((r) => ({ at: r.at, agent: r.agent, kind: r.kind, summary: r.summary, prospectId: r.prospect_id, detail: r.detail || {} }));
  } catch (err) {
    console.warn("[Events] could not be read:", (err as Error)?.message || err);
    return null;
  }
}

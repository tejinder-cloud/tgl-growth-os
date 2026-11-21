// services/tgl-ops/src/agents/booking/service.ts
// The booking page's logic. "Booked" is only ever reported after Google Calendar confirmed the event.
import crypto from "node:crypto";
import { freeSlots, isOfferedSlot, SLOT_MINUTES, type Busy, type DaySlots } from "./slots.js";
import { SlotTakenError, type BookingStore } from "./store.js";
import type { CalendarRead, CreatedEvent, NewEvent } from "./google.js";

export interface CalendarPort {
  read(timeMin: string, timeMax: string): Promise<CalendarRead>;
  createEvent(ev: NewEvent): Promise<CreatedEvent>;
}

export interface OutreachLink {
  /** A prospect in an outreach sequence with this email, if any. */
  find(email: string): Promise<{ id: string; company: string; auditLine?: string } | null>;
  /** Stops further outreach emails: the call is booked. */
  stop(id: string, at: Date): Promise<void>;
}

export interface BookingDeps {
  now: () => Date;
  store: BookingStore;
  /** Null when the calendar is not connected yet. */
  calendar: () => Promise<CalendarPort | null>;
  holidays: Set<string>;
  outreach?: OutreachLink;
  notify: (text: string) => Promise<void>;
  hostName: string;
}

export interface BookingInput {
  start: string;
  name: string;
  email: string;
  company: string;
  note?: string;
  /** Honeypot: real visitors never fill it. */
  website?: string;
}

export type BookingOutcome =
  | { ok: true; start: string; end: string; meetUrl: string }
  | { ok: false; status: number; error: "invalid" | "not_open" | "slot_taken" | "calendar_failed"; message: string; days?: DaySlots[] };

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const LOOKAHEAD_DAYS = 21;

function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validate(input: BookingInput): { ok: true; v: Required<Omit<BookingInput, "website">> } | { ok: false; message: string } {
  const name = clean(input.name, 80);
  const email = clean(input.email, 160).toLowerCase();
  const company = clean(input.company, 120);
  const note = String(input.note ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
  if (!name) return { ok: false, message: "Please enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, message: "Please enter a valid work email." };
  if (!company) return { ok: false, message: "Please enter your business name." };
  if (!Number.isFinite(new Date(String(input.start)).getTime())) return { ok: false, message: "Please pick a time." };
  return { ok: true, v: { start: new Date(String(input.start)).toISOString(), name, email, company, note } };
}

function window(now: Date): { min: string; max: string } {
  return { min: now.toISOString(), max: new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000).toISOString() };
}

export function istLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) + " IST";
}

export function createBookingService(deps: BookingDeps) {
  // One booking at a time in this process; the database's unique index guards across processes.
  let chain: Promise<unknown> = Promise.resolve();

  async function slots(): Promise<{ open: boolean; days: DaySlots[] }> {
    const cal = await deps.calendar();
    if (!cal) return { open: false, days: [] };
    const now = deps.now();
    const w = window(now);
    return { open: true, days: freeSlots(now, (await cal.read(w.min, w.max)).busy, deps.holidays) };
  }

  async function bookNow(input: BookingInput): Promise<BookingOutcome> {
    if (clean(input.website, 200)) return { ok: false, status: 400, error: "invalid", message: "Please try again." };
    const checked = validate(input);
    if (!checked.ok) return { ok: false, status: 400, error: "invalid", message: checked.message };
    const v = checked.v;

    const cal = await deps.calendar();
    if (!cal) return { ok: false, status: 503, error: "not_open", message: "Booking is not open yet. Please reply to the email instead." };

    const now = deps.now();
    const w = window(now);
    const busy = (await cal.read(w.min, w.max)).busy;
    if (!isOfferedSlot(v.start, now, busy, deps.holidays)) {
      return { ok: false, status: 409, error: "slot_taken", message: "That time was just taken. Please pick another.", days: freeSlots(now, busy, deps.holidays) };
    }

    const end = new Date(new Date(v.start).getTime() + SLOT_MINUTES * 60000).toISOString();
    const prospect = deps.outreach ? await deps.outreach.find(v.email).catch(() => null) : null;

    let id: string;
    try {
      id = await deps.store.insertPending({
        starts_at: v.start,
        ends_at: end,
        guest_name: v.name,
        guest_email: v.email,
        company: v.company,
        note: v.note || null,
        prospect_id: prospect?.id || null,
      });
    } catch (err) {
      if (err instanceof SlotTakenError) {
        return { ok: false, status: 409, error: "slot_taken", message: "That time was just taken. Please pick another.", days: freeSlots(now, busy, deps.holidays) };
      }
      throw err;
    }

    let created: CreatedEvent;
    try {
      created = await cal.createEvent({
        start: v.start,
        end,
        summary: `${v.company} and The Growth Lab: 20-minute call`,
        description: [`Booked by ${v.name} (${v.email}) for ${v.company}.`, v.note ? `Note: ${v.note}` : "", `Host: ${deps.hostName}, The Growth Lab.`].filter(Boolean).join("\n\n"),
        guestEmail: v.email,
        guestName: v.name,
        requestId: crypto.randomUUID(),
      });
    } catch (err) {
      await deps.store.release(id).catch(() => {});
      await deps.notify(`Booking failed: ${v.name}, ${v.company}, ${istLabel(v.start)}. Google Calendar did not confirm: ${(err as Error).message}. The visitor was told it did not go through.`).catch(() => {});
      return { ok: false, status: 502, error: "calendar_failed", message: "We could not confirm that booking. Please try again, or reply to the email." };
    }

    // Google has confirmed and sent the invite, so the booking is real even if our own row update fails.
    await deps.store.markBooked(id, created.eventId, created.meetUrl).catch(async (err) => {
      await deps.notify(`Booking row not updated for ${v.company} (${istLabel(v.start)}): ${(err as Error).message}. The calendar event exists.`).catch(() => {});
    });

    // After-effects never change the answer: the event exists and the guest has Google's invite.
    if (prospect && deps.outreach) await deps.outreach.stop(prospect.id, now).catch(() => {});
    const lines = [
      `Call booked: ${v.name}, ${v.company}, ${istLabel(v.start)}.`,
      `Email: ${v.email}.`,
      v.note ? `Note: ${v.note}` : "",
      prospect ? `From outreach. ${prospect.auditLine || ""} Outreach emails to them have stopped.`.trim() : "Not from an outreach sequence.",
      created.meetUrl ? `Meet: ${created.meetUrl}` : "",
    ].filter(Boolean);
    await deps.notify(lines.join("\n")).catch(() => {});

    return { ok: true, start: v.start, end, meetUrl: created.meetUrl };
  }

  /**
   * Marks upcoming bookings cancelled when the guest declined or the event was removed from the calendar, and
   * tells #revenue. Keeps "calls booked" true. Returns how many were cancelled.
   */
  async function sync(): Promise<number> {
    const cal = await deps.calendar();
    if (!cal) return 0;
    const now = deps.now();
    const upcoming = await deps.store.listUpcomingBooked(now.toISOString());
    if (upcoming.length === 0) return 0;
    const last = Math.max(...upcoming.map((b) => new Date(b.ends_at).getTime()));
    const read = await cal.read(now.toISOString(), new Date(last + 60000).toISOString());
    let n = 0;
    for (const b of upcoming) {
      if (!b.event_id) continue;
      const why = read.declined.includes(b.event_id) ? "the guest declined" : !read.present.includes(b.event_id) ? "the event was removed from the calendar" : "";
      if (!why) continue;
      await deps.store.release(b.id);
      n++;
      await deps.notify(`Booking cancelled: ${b.guest_name}, ${b.company}, ${istLabel(b.starts_at)}. ${why[0].toUpperCase()}${why.slice(1)}; the slot is open again.`).catch(() => {});
    }
    return n;
  }

  function book(input: BookingInput): Promise<BookingOutcome> {
    const run = chain.then(() => bookNow(input));
    chain = run.catch(() => {});
    return run;
  }

  return { slots, book, sync };
}

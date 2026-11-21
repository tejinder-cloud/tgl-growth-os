// services/tgl-ops/src/agents/booking/slots.ts
// Which 20-minute call slots are offered. Pure functions: no clock, no network.
// Rules (Architect, 21 Nov 2026): Monday to Friday only, never on a listed holiday, 15:00 to 17:00 IST,
// at least 3 hours' notice, the next 10 working days, nothing that overlaps a busy time on the calendar.
import fs from "node:fs";
import path from "node:path";

export const SLOT_MINUTES = 20;
/** Slot starts in IST, as minutes after midnight: 15:00, 15:30, 16:00, 16:30. */
export const SLOT_STARTS_IST = [15 * 60, 15 * 60 + 30, 16 * 60, 16 * 60 + 30];
export const MIN_NOTICE_MINUTES = 3 * 60;
export const WORKING_DAYS_AHEAD = 10;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface Busy {
  start: string;
  end: string;
}

export interface DaySlots {
  /** YYYY-MM-DD in IST */
  date: string;
  /** ISO instants (UTC) of free slot starts */
  slots: string[];
}

/** YYYY-MM-DD of an instant, in IST. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC instant of an IST wall-clock time on an IST date. */
export function istInstant(date: string, minutesAfterMidnight: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutesAfterMidnight) - IST_OFFSET_MS);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/** The next `count` working days (Mon-Fri, not a holiday), starting today in IST. */
export function workingDays(now: Date, holidays: Set<string>, count = WORKING_DAYS_AHEAD): string[] {
  const out: string[] = [];
  let date = istDate(now);
  for (let guard = 0; out.length < count && guard < 60; guard++) {
    if (!isWeekend(date) && !holidays.has(date)) out.push(date);
    date = addDays(date, 1);
  }
  return out;
}

function overlaps(start: number, end: number, busy: Busy[]): boolean {
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return bs < end && be > start;
  });
}

/** Free slots for each of the next working days. Days with no free slot are kept, with an empty list. */
export function freeSlots(now: Date, busy: Busy[], holidays: Set<string>): DaySlots[] {
  const earliest = now.getTime() + MIN_NOTICE_MINUTES * 60 * 1000;
  return workingDays(now, holidays).map((date) => ({
    date,
    slots: SLOT_STARTS_IST.map((m) => istInstant(date, m))
      .filter((s) => s.getTime() >= earliest)
      .filter((s) => !overlaps(s.getTime(), s.getTime() + SLOT_MINUTES * 60 * 1000, busy))
      .map((s) => s.toISOString()),
  }));
}

/** True when `startIso` is one of the slots offered right now. A booking is accepted only for such a slot. */
export function isOfferedSlot(startIso: string, now: Date, busy: Busy[], holidays: Set<string>): boolean {
  const t = new Date(startIso).getTime();
  if (!Number.isFinite(t)) return false;
  const iso = new Date(t).toISOString();
  return freeSlots(now, busy, holidays).some((d) => d.slots.includes(iso));
}

export function loadHolidays(file?: string): Set<string> {
  const candidates = file
    ? [file]
    : [path.resolve(__dirname, "../../assets/booking-holidays.json"), path.join(process.cwd(), "src/assets/booking-holidays.json"), path.join(process.cwd(), "dist/assets/booking-holidays.json")];
  for (const f of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
      return new Set((parsed.holidays || []).map((h: any) => String(h.date)).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
    } catch {
      // try the next location
    }
  }
  throw new Error("booking-holidays.json not found or not valid");
}

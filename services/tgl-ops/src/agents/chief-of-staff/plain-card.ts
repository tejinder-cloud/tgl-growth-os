// services/tgl-ops/src/agents/chief-of-staff/plain-card.ts
// Pure (no network, no disk) builders for the plain-English Chief of Staff cards:
// the 09:00 status card ("morning") and the 21:00 standup ("evening").
// Every line is a sentence a non-technical owner can read. Plain text and bold only.
import type { PlanEntry } from "../../lib/plan.js";
import type { RevenueMetrics } from "../../lib/revenue.js";

/** Calendar day 1 of the 90-day plan. */
export const PLAN_START_DATE = "2026-10-29";
export const PROGRAMME_DAYS = 90;

export type CardMode = "morning" | "evening";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseIso(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Whole calendar days from a to b (both YYYY-MM-DD). Negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b) - parseIso(a)) / 86400000);
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(parseIso(dateStr) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

/** "2026-11-11" -> "11 Nov" */
export function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}`;
}

/**
 * The plan day that is due on a calendar date: 29 Oct 2026 is day 1, so
 * the due day is (calendar days since 29 Oct 2026) + 1. Never below 0.
 */
export function planDayDueOn(dateStr: string, startDate: string = PLAN_START_DATE): number {
  return Math.max(0, daysBetween(startDate, dateStr) + 1);
}

export interface PaceResult {
  /** due day minus current day: positive = behind, negative = ahead, 0 = on track */
  delta: number;
  phrase: string;
}

export function computePace(dueDay: number, currentDay: number): PaceResult {
  const delta = dueDay - currentDay;
  if (delta === 0) return { delta, phrase: "on track" };
  const n = Math.abs(delta);
  const unit = n === 1 ? "day" : "days";
  return delta > 0
    ? { delta, phrase: `${n} ${unit} behind` }
    : { delta, phrase: `${n} ${unit} ahead` };
}

export interface NextGate {
  name: string;
  day: number;
  date: string; // YYYY-MM-DD
}

function findExplicitDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

/**
 * Next gate on the plan: the first entry (by day) not yet completed whose title names a Gate.
 * Expected date: an explicit date written in the entry (e.g. "11 Nov 2026"), otherwise the
 * calendar date on which that plan day falls (29 Oct 2026 is day 1).
 */
export function findNextGate(entries: PlanEntry[], startDate: string = PLAN_START_DATE): NextGate | null {
  const sorted = [...entries].sort((a, b) => a.day - b.day);
  for (const e of sorted) {
    if (e.status === "completed") continue;
    const m = (e.title || "").match(/\bGate\s+(\d+)\b/i);
    if (!m) continue;
    const text = [e.brief, e.architect_hour, ...(e.definition_of_done || [])].join(" ");
    const date = e.date || findExplicitDate(text) || addDays(startDate, e.day - 1);
    return { name: `Gate ${m[1]}`, day: e.day, date };
  }
  return null;
}

export interface LogLike {
  agent: string;
  content: string;
}

export interface TrackerSummary {
  ran: boolean;
  answers: number;
  named: number;
}

/** Reads the Citation Tracker line(s) of the aeo-audit-engine log. Prefers lines naming TGL. */
export function parseTrackerSummary(logs: LogLike[]): TrackerSummary {
  const lines: string[] = [];
  for (const l of logs) {
    for (const line of l.content.split("\n")) {
      if (/Citation Tracker/i.test(line)) lines.push(line);
    }
  }
  const tgl = lines.filter((x) => /\bTGL\b|growth\s*lab/i.test(x));
  const use = tgl.length > 0 ? tgl : lines;
  let answers = 0;
  let named = 0;
  let ran = false;
  for (const line of use) {
    const m = line.match(/named in (\d+)\s*\/\s*(\d+)\s*answers/i);
    if (m) {
      ran = true;
      named += Number(m[1]);
      answers += Number(m[2]);
    }
  }
  return { ran, answers, named };
}

export interface ResearcherSummary {
  ran: boolean;
  candidates: number;
  qualified: number;
}

/** Sums every prospect-researcher run in the supplied logs. */
export function parseResearcherSummary(logs: LogLike[]): ResearcherSummary {
  let rawCandidates = 0;
  let qualifiedOutOf = 0;
  let qualified = 0;
  let ran = false;
  for (const l of logs) {
    if (l.agent !== "prospect-researcher") continue;
    for (const line of l.content.split("\n")) {
      const raw = line.match(/Raw Candidates[^:\n]*:\s*(\d+)/i);
      if (raw) {
        ran = true;
        rawCandidates += Number(raw[1]);
      }
      const q = line.match(/Qualified Accounts:\**\s*(\d+)\s*\/\s*(\d+)/i);
      if (q) {
        ran = true;
        qualified += Number(q[1]);
        qualifiedOutOf += Number(q[2]);
      }
    }
  }
  // Candidates come from the raw funnel count; the "x / y" denominator is only a fallback.
  return { ran, candidates: rawCandidates > 0 ? rawCandidates : qualifiedOutOf, qualified };
}

/** Rupee amount, never a dash: whole rupees from Rs 100, paise below that. */
export function formatRupees(amount: number): string {
  const n = isNaN(amount) || amount < 0 ? 0 : amount;
  if (n >= 100 || n === 0) return `₹${Math.round(n)}`;
  return `₹${n.toFixed(2)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function humanizeAgent(name: string): string {
  return name.replace(/[-_]+/g, " ").trim();
}


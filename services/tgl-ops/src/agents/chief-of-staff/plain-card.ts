// services/tgl-ops/src/agents/chief-of-staff/plain-card.ts
// Pure (no network, no disk) builders for the plain-English Chief of Staff cards:
// the 09:00 status card ("morning") and the 21:00 standup ("evening").
// Every line is a sentence a non-technical owner can read. Plain text and bold only.
import type { PlanEntry } from "../../lib/plan.js";
import type { RevenueMetrics } from "../../lib/revenue.js";

/** Calendar day 1 of the plan: PROJECT-PLAN.md is dated 23 October 2026 and runs 68 days. */
export const PLAN_START_DATE = "2026-10-23";
export const PROGRAMME_DAYS = 68;

export type CardMode = "morning" | "evening";

/**
 * The revenue target the Architect set on 12 Nov 2026 (decisions/2026-11-12.md): revenue first, and by 26 Nov
 * 15 audit conversations and 1 paid Managed AEO retainer. While it is open the card leads with it, straight
 * after the greeting, so the first number read each day is the one the company is being run on.
 */
export const REVENUE_TARGET = { since: "2026-11-12", due: "2026-11-26", conversations: 15, retainers: 1 } as const;

/** Prospect audits since the target was set. Counted per business, test rows left out. Null when not readable. */
export interface RevenueProgress {
  /** Businesses an audit was produced for (website requests and requests typed in Slack). */
  auditsRequested: number;
  /** Businesses whose audit the Architect sent on email. */
  auditsSent: number;
}

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
 * The plan day that is due on a calendar date: 23 Oct 2026 is day 1, so
 * the due day is (calendar days since 23 Oct 2026) + 1. Never below 0.
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
 * calendar date on which that plan day falls (23 Oct 2026 is day 1).
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

export function buildActivitySentences(params: {
  logs: LogLike[];
  mergedPrTitles: string[];
  cardsApproved: number;
}): string {
  const tracker = parseTrackerSummary(params.logs);
  const researcher = parseResearcherSummary(params.logs);
  const out: string[] = [];

  out.push(
    tracker.ran
      ? `The citation tracker collected ${plural(tracker.answers, "answer", "answers")} and our brand was named in ${tracker.named} of them.`
      : "The citation tracker did not report a run."
  );

  out.push(
    researcher.ran
      ? `The prospect researcher looked at ${plural(researcher.candidates, "candidate", "candidates")} and ${researcher.qualified} qualified.`
      : "The prospect researcher did not report a run."
  );

  const titles = params.mergedPrTitles;
  const shown = titles.slice(0, 3).map((t) => `"${t.replace(/"/g, "'")}"`);
  const more = titles.length > 3 ? ` and ${titles.length - 3} more` : "";
  const prPart =
    titles.length === 0
      ? "No pull requests were merged"
      : `${plural(titles.length, "pull request was", "pull requests were")} merged (${shown.join(", ")}${more})`;
  const cardPart =
    params.cardsApproved === 0
      ? "no cards were approved"
      : `${plural(params.cardsApproved, "card was", "cards were")} approved`;
  out.push(`${prPart}, and ${cardPart}.`);

  return out.join(" ");
}

export interface RoutineLike {
  agent: string;
  schedule: string;
}

function cronTime(schedule: string): string | null {
  const parts = (schedule || "").trim().split(/\s+/);
  if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  return `${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}`;
}

export function buildScheduleSentence(routines: RoutineLike[], activeIssues: { number: number; title: string }[]): string {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const r of routines) {
    const t = cronTime(r.schedule);
    const phrase = `the ${humanizeAgent(r.agent)}${t ? ` at ${t}` : ""}`;
    if (!seen.has(phrase)) {
      seen.add(phrase);
      phrases.push(phrase);
    }
  }
  const parts: string[] = [];
  if (phrases.length === 0) {
    parts.push("No scheduled runs are due.");
  } else {
    const shown = phrases.slice(0, 6);
    const more = phrases.length > 6 ? `, and ${phrases.length - 6} more` : "";
    parts.push(`These runs are scheduled: ${shown.join(", ")}${more}.`);
  }
  if (activeIssues.length === 0) {
    parts.push("No issue is in progress.");
  } else {
    const shown = activeIssues.slice(0, 2).map((i) => `#${i.number} "${i.title.replace(/"/g, "'")}"`);
    const more = activeIssues.length > 2 ? ` and ${activeIssues.length - 2} more` : "";
    parts.push(`${activeIssues.length === 1 ? "The active issue is" : "The active issues are"} ${shown.join(" and ")}${more}.`);
  }
  return parts.join(" ");
}

export interface MoneyInput {
  revenue: RevenueMetrics;
  spendRupees: number;
  /** Audits produced since the revenue target was set (prospect_audits). When readable, it is the audit-request
   * figure, so the Money line and the revenue line never disagree. The GHL count only sees website requests. */
  revenueProgress?: RevenueProgress | null;
}

export function buildMoneySentence(m: MoneyInput, mode: CardMode): string {
  const r = m.revenue;
  const spendLabel = mode === "morning" ? "Yesterday's spend was" : "Today's spend was";
  return (
    `${plural(m.revenueProgress ? m.revenueProgress.auditsRequested : r.auditRequests, "audit request", "audit requests")}, ` +
    `${plural(r.diagnosticCallsBooked, "call booked", "calls booked")}, ` +
    `${plural(r.proposalsSent, "proposal", "proposals")}, ` +
    `${plural(r.retainersWon, "retainer", "retainers")}, ` +
    `${formatRupees(r.rupeesInvoiced)} invoiced. ${spendLabel} ${formatRupees(m.spendRupees)}.`
  );
}

export interface NeedItem {
  /** The action, in plain words. May contain one Slack link: <url|text>. */
  action: string;
  /** The expected outcome, one sentence, no trailing full stop needed. */
  outcome: string;
}

function link(url: string | undefined, text: string): string {
  return url ? `<${url}|${text}>` : text;
}

export interface NeedsSource {
  openApprovals: { title: string; permalink?: string; ageHours?: number }[];
  blockedIssues?: { number: number; title: string; label: string; url: string }[];
  /** Open proposals from agents (issues labelled as proposals) awaiting the Architect's decision. */
  openProposals?: { number: number; title: string; agent?: string; url?: string }[];
  /** Agents at or over 80% of their daily cost cap. */
  agentCostStatuses?: { agent: string; percentage: number; isOverCap?: boolean; isOver80Percent?: boolean }[];
  /** Plan entries carried forward (not done on their day). */
  carriedForwardPlanEntries?: { day: number; title: string; agent?: string }[];
  /** Review cards that have waited more than two hours. */
  olderReviewCards?: { title: string; agent?: string; ageHours?: number; permalink?: string }[];
  /** Plan entries, the current plan day and the day due today, used for the "go" item. */
  planEntries?: PlanEntry[];
  currentDay?: number;
  dueDay?: number;
}

/** At most three asks a day (24 Nov 2026): the first three matter, the rest is noise. */
const MAX_NEEDS = 3;
/** An approval card older than this is stale work, not a decision waiting on the Architect. */
export const STALE_CARD_HOURS = 7 * 24;

/** One entry per title, newest first; cards older than a week are left out. */
export function freshApprovals<T extends { title: string; ageHours?: number }>(list: T[]): T[] {
  const sorted = [...list].sort((a, b) => (a.ageHours ?? 0) - (b.ageHours ?? 0));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of sorted) {
    if ((a.ageHours ?? 0) > STALE_CARD_HOURS) continue;
    const key = a.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function buildNeedsItems(src: NeedsSource): NeedItem[] {
  const items: NeedItem[] = [];
  const approvals = freshApprovals(src.openApprovals || []);
  const approvalTitles = new Set(approvals.map((a) => a.title.trim().toLowerCase()));

  for (const a of approvals) {
    items.push({
      action: `Approve or reject ${link(a.permalink, `"${a.title.replace(/"/g, "'")}"`)} in #approvals`,
      outcome: "the work is released and the agent moves on to its next task",
    });
  }

  // A review card is the same Slack message as an approval card; list it only if it is not already listed.
  for (const r of freshApprovals(src.olderReviewCards || []).filter((x) => !approvalTitles.has(x.title.trim().toLowerCase()))) {
    const wait = r.ageHours !== undefined ? `, waiting ${Math.round(r.ageHours)}h` : "";
    items.push({
      action: `Approve or reject the review card ${link(r.permalink, `"${r.title.replace(/"/g, "'")}"`)}${r.agent ? ` from @${r.agent}` : ""}${wait}`,
      outcome: "the agent's work is released",
    });
  }

  for (const b of src.blockedIssues || []) {
    const ref = link(b.url, `#${b.number} "${b.title.replace(/"/g, "'")}"`);
    if (b.label === "status:needs-brief") {
      items.push({
        action: `Write the missing brief on ${ref}`,
        outcome: "the agent can start building it",
      });
    } else {
      items.push({
        action: `Clear the blocker on ${ref}`,
        outcome: "the agent restarts the stalled work",
      });
    }
  }

  for (const p of src.openProposals || []) {
    const ref = link(p.url, `#${p.number} "${p.title.replace(/"/g, "'")}"`);
    items.push({
      action: `Decide on open proposal ${ref}${p.agent ? ` from @${p.agent}` : ""}`,
      outcome: "the agent either builds it or records it as rejected so nobody re-proposes it",
    });
  }

  for (const c of src.agentCostStatuses || []) {
    if (!(c.isOverCap || c.isOver80Percent || c.percentage >= 80)) continue;
    items.push({
      action: c.isOverCap
        ? `@${c.agent} has stopped at ${Math.round(c.percentage)}% of its daily cost cap; raise the cap in config/agents.yaml or let it resume tomorrow`
        : `@${c.agent} is at ${Math.round(c.percentage)}% of its daily cost cap; decide whether to raise it before it stops`,
      outcome: c.isOverCap ? "its paused work restarts" : "today's remaining runs finish without a stop",
    });
  }

  for (const e of src.carriedForwardPlanEntries || []) {
    items.push({
      action: `Day ${e.day} (${e.title.replace(/"/g, "'")}) was carried forward${e.agent ? ` by @${e.agent}` : ""}; say "day ${e.day}" in #architect to re-run it or "skip" to drop it`,
      outcome: "the plan stops carrying it",
    });
  }

  // The 68-day plan no longer drives the day (24 Nov 2026), so there is no "go" item for the next plan day.

  return items.slice(0, MAX_NEEDS);
}

export function renderNeedsSection(items: NeedItem[]): string {
  if (items.length === 0) {
    return "*Needs you:*\nNothing else needs you.";
  }
  const lines = items.map((it, i) => `${i + 1}. ${it.action} → ${it.outcome.replace(/\.$/, "")}.`);
  return ["*Needs you:*", ...lines].join("\n");
}

/** Outreach numbers for the card, from the prospects table. Null when they could not be read. */
export interface OutreachStats {
  /** Emails and messages actually sent (not dry runs) on the activity day, IST. */
  sent: number;
  /** Replies received on the activity day. */
  replies: number;
  /** Businesses whose sequence is running. */
  active: number;
  /** Businesses whose sequence is paused (failed audit, held by the claim check, bounce). */
  paused: number;
  /** Sends allowed on the next sending day (the warm-up cap). */
  nextCap: number;
}

export function buildOutreachLine(stats: OutreachStats | null | undefined, mode: CardMode): string {
  if (!stats) return "*Outreach:* the outreach numbers could not be read.";
  const day = mode === "morning" ? "yesterday" : "today";
  const next = mode === "morning" ? "today" : "tomorrow";
  return (
    `*Outreach:* ${plural(stats.sent, "email", "emails")} sent ${day}, ${plural(stats.replies, "reply", "replies")}. ` +
    `${plural(stats.active, "business is", "businesses are")} in a sequence${stats.paused ? `, ${stats.paused} paused` : ""}. ` +
    `Daily limit ${next}: ${stats.nextCap}.`
  );
}

/** Only what went wrong; null when nothing did. */
export function buildProblemsLine(logs: LogLike[]): string | null {
  const problems: string[] = [];
  if (!parseTrackerSummary(logs).ran) problems.push("The citation tracker did not report a run.");
  if (!parseResearcherSummary(logs).ran) problems.push("The prospect researcher did not report a run.");
  return problems.length ? `*Problems:* ${problems.join(" ")}` : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function renderBriefGreeting(mode: CardMode, dateStr: string): string {
  const weekday = WEEKDAYS[new Date(parseIso(dateStr)).getUTCDay()];
  return `${mode === "morning" ? "Good morning." : "Good evening."} Brief for ${weekday} ${formatShortDate(dateStr)}.`;
}

export interface PlainCardInput {
  mode: CardMode;
  /** IST date of the card, YYYY-MM-DD */
  dateStr: string;
  currentDay: number;
  planEntries: PlanEntry[];
  activityLogs: LogLike[];
  mergedPrTitles: string[];
  cardsApproved: number;
  scheduledRoutines: RoutineLike[];
  activeIssues: { number: number; title: string }[];
  revenue: RevenueMetrics;
  spendRupees: number;
  needs: NeedItem[];
  /** Audit counts toward the revenue target. Omitted or null: the line says the counts could not be read. */
  revenueProgress?: RevenueProgress | null;
  /** Outreach numbers. Omitted or null: the line says they could not be read. */
  outreach?: OutreachStats | null;
}

/**
 * The revenue-target line. Calls booked and retainers come from the same pipeline figures as the Money line;
 * audit counts come from the prospect-audit record. Every number is a count; nothing is projected.
 */
export function buildRevenueTargetLine(input: Pick<PlainCardInput, "dateStr" | "revenue" | "revenueProgress">): string {
  const t = REVENUE_TARGET;
  const left = daysBetween(input.dateStr, t.due);
  const when = left > 1 ? `${left} days left` : left === 1 ? "1 day left" : left === 0 ? "due today" : `${plural(-left, "day", "days")} past the date`;
  const p = input.revenueProgress;
  const audits = p
    ? `${plural(p.auditsRequested, "audit requested", "audits requested")}, ${plural(p.auditsSent, "audit sent", "audits sent")}`
    : "audit counts could not be read";
  const r = input.revenue;
  return (
    `*Revenue target (by ${formatShortDate(t.due)}):* ${t.conversations} conversations and ${plural(t.retainers, "paid retainer", "paid retainers")}. ` +
    `So far: ${audits}, ${plural(r.diagnosticCallsBooked, "call booked", "calls booked")} of ${t.conversations}, ` +
    `${plural(r.retainersWon, "retainer", "retainers")} of ${t.retainers}. ${when.charAt(0).toUpperCase()}${when.slice(1)}.`
  );
}

export function renderGreetingLine(input: Pick<PlainCardInput, "mode" | "dateStr" | "currentDay" | "planEntries">): string {
  const due = planDayDueOn(input.dateStr);
  const pace = computePace(due, input.currentDay);
  const gate = findNextGate(input.planEntries);
  const gateText = gate ? ` (Next gate: ${gate.name} at Day ${gate.day}, originally due ${formatShortDate(gate.date)})` : "";
  const hello = input.mode === "morning" ? "Good morning." : "Good evening.";
  return `${hello} Day ${input.currentDay} of ${PROGRAMME_DAYS} — ${pace.phrase}${gateText}.`;
}

/**
 * Renders the card (shape since 24 Nov 2026, modelled on the My LabOS brief): greeting, outreach, money,
 * problems only when something went wrong, and at most three asks. Plain text and bold only; no emojis.
 * The 68-day pace, the expired revenue-target line and the list of scheduled runs are no longer shown.
 */
export function renderPlainCard(input: PlainCardInput): string {
  const lines: string[] = [];
  lines.push(renderBriefGreeting(input.mode, input.dateStr));
  lines.push(buildOutreachLine(input.outreach, input.mode));
  lines.push(`*Money:* ${buildMoneySentence({ revenue: input.revenue, spendRupees: input.spendRupees, revenueProgress: input.revenueProgress }, input.mode)}`);
  const problems = buildProblemsLine(input.activityLogs);
  if (problems) lines.push(problems);
  lines.push(renderNeedsSection(input.needs));
  return lines.join("\n");
}

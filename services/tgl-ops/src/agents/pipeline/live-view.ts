// services/tgl-ops/src/agents/pipeline/live-view.ts
// The data behind the private pages (24 Nov 2026; rebuilt 25 Nov as one model for Overview, Outreach and Build).
// Everything is counted from records the service keeps: prospects, their outreach touches, deals, the spend
// table. What each part of the system did today comes from those records too, not from log files, so "did not
// run" is never shown for something that did. Nothing is estimated; a part that could not be read says so.
// buildLiveView is pure, so every number is tested without a database.
import { plainError } from "../../lib/plain-error.js";
import { cleanBusinessName } from "../outreach-sequencer/names.js";
import { categoryLabel } from "../outreach-sequencer/sequence.js";
import type { Deal } from "./stages.js";
export { esc } from "./shell.js";

export interface LiveProspect {
  id: string;
  company: string;
  city?: string | null;
  category?: string | null;
  status: string;
  fit_score?: number | null;
  created_at?: string | null;
  decision_maker?: { name?: string; email?: string; phone?: string } | null;
  signals?: {
    outreach?: {
      state?: string;
      next_touch?: number;
      next_due_at?: string;
      pause_reason?: string;
      last_reply_at?: string;
      last_reply_intent?: string;
      touches?: { n: number; channel?: string; sent_at?: string; dry_run?: boolean; via?: string }[];
    };
    /** The AI check run in advance for a phone-only business (preaudit.ts). */
    preaudit?: { mentions?: number; total_queries?: number; audited_at?: string; weakest_competitor?: string; competitor_mentions?: Record<string, number> };
  } | null;
}

export interface AgentLine {
  agent: string;
  /** The last entry the agent wrote in today's log, e.g. "Run, 09:30 IST (Ludhiana, hotels)". */
  last: string;
}

export interface Spend {
  todayInr: number;
  monthInr: number;
  /** Rupees this month per product ("truevisible", "tgl_ops"). */
  byProduct: Record<string, number>;
}

export interface LiveInput {
  now: Date;
  prospects: LiveProspect[];
  deals: Deal[];
  /** Today's agent log entries; used only for the citation tracker, which keeps no other record here. */
  agents: AgentLine[] | null;
  spend: Spend | null;
  /** Emails allowed today (the warm-up cap). */
  capToday: number;
  /** Today's rows from ops_events, newest first (25 Nov 2026); null when they could not be read. */
  events?: FeedEvent[] | null;
}

export interface FeedEvent { at: string; agent: string; kind: string; summary: string }

export interface OutboxRow { company: string; city: string; what: string; sentAt: string; today: boolean }
export interface QueueRow { company: string; city: string; type: string; fit: number }
export interface CallRow extends QueueRow {
  /** The advance AI check in one sentence, or "" when it has not run yet. */
  check: string;
}
export interface Problem { text: string; names: string[] }
export interface Stage { label: string; count: number; /** Added today, when the records say; null when unknown. */ today: number | null }
export interface Activity {
  name: string;
  /** Time of the last thing it did today (ISO), or null. */
  at: string | null;
  what: string;
  state: "done" | "waiting" | "problem";
}

export interface LiveView {
  generatedAt: string;
  today: { sent: number; cap: number; replies: number; callsBooked: number; nextCall: string | null };
  journey: Stage[];
  stuck: { approval: number; nextInLine: number; whatsapp: number; paused: number };
  waiting: string[];
  problems: Problem[];
  activity: Activity[];
  outbox: OutboxRow[];
  nextInLine: QueueRow[];
  /** Approved, no email, a phone: they get the WhatsApp first message once Meta approves (no cold calls). */
  calls: CallRow[];
  paused: Problem[];
  spend: Spend | null;
  /** Today's events, newest first; null when the record could not be read. */
  feed: FeedEvent[] | null;
}

export function istDate(iso: string | Date): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

const CALL_STAGES = new Set(["call_booked", "call_done", "proposal_sent", "won"]);

export const TOUCH_NAMES: Record<number, string> = { 1: "First email", 2: "WhatsApp note", 3: "Report email", 4: "Follow-up", 5: "Last note" };

function hasEmail(p: LiveProspect): boolean {
  return /\S+@\S+\.\S+/.test(p.decision_maker?.email || "");
}
function hasPhone(p: LiveProspect): boolean {
  return (p.decision_maker?.phone || "").replace(/\D/g, "").length >= 8;
}

/** "Named in 0 of 15 AI answers; Kochar's House of Smiles named in 7 (checked 25 Nov)." Only stored facts. */
export function checkLine(company: string, a: NonNullable<NonNullable<LiveProspect["signals"]>["preaudit"]> | undefined): string {
  if (!a || typeof a.mentions !== "number" || !a.total_queries) return "";
  const comp = a.weakest_competitor && a.competitor_mentions?.[a.weakest_competitor] !== undefined ? `; ${a.weakest_competitor} named in ${a.competitor_mentions[a.weakest_competitor]}` : "";
  const when = a.audited_at ? ` (checked ${dayOnly(a.audited_at).replace(/^\w+, /, "")})` : "";
  return `Named in ${a.mentions} of ${a.total_queries} AI answers${comp}${when}.`;
}

export function pauseGroup(reason: string | undefined): string {
  const r = String(reason || "").replace(/^touch \d+: /, "");
  if (!r) return "Paused, no reason recorded";
  if (/held by the last check/i.test(r)) return "Held before sending: the email named something the audit does not support";
  if (/bounced/i.test(r)) return "Paused: an email bounced, so the address needs checking";
  return `Paused: ${plainError(r.replace(/^audit or one-pager failed: /i, ""))}`;
}

function latest(isos: string[]): string | null {
  return isos.length ? isos.reduce((a, b) => (a > b ? a : b)) : null;
}
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "06:07 IST, Citation Tracker: 1 brand(s) ..." -> time and text, from the last log entry. */
function citationActivity(agents: AgentLine[] | null, now: Date, minutes: number, events?: FeedEvent[] | null): Activity {
  const name = "Citation tracker";
  // The events record first; the log file only until events exist for today.
  const ev = (events || []).find((e) => e.agent === "aeo-audit-engine" && e.kind === "run");
  if (ev) return { name, at: ev.at, what: ev.summary, state: "done" };
  if (!agents) return { name, at: null, what: "Today's log could not be read.", state: "problem" };
  const line = agents.find((a) => a.agent === "aeo-audit-engine")?.last;
  if (!line) {
    return minutes > 8 * 60 ? { name, at: null, what: "No run recorded today (it runs at 06:00).", state: "problem" } : { name, at: null, what: "Runs at 06:00.", state: "waiting" };
  }
  const m = line.match(/(\d{1,2}):(\d{2})\s*IST/);
  let at: string | null = null;
  if (m) {
    const d = new Date(`${istDate(now)}T${m[1].padStart(2, "0")}:${m[2]}:00+05:30`);
    if (!Number.isNaN(d.getTime())) at = d.toISOString();
  }
  const named = line.match(/named in (\d+)\/(\d+) answers/i);
  const brands = line.match(/(\d+) brand\(s\)/);
  const what = named ? `Checked ${brands ? `${brands[1]} ${brands[1] === "1" ? "brand" : "brands"}` : "brands"}: named in ${named[1]} of ${named[2]} AI answers.` : line.replace(/^.*?IST\s*[—–-]\s*/, "");
  return { name, at, what, state: "done" };
}

export function buildLiveView(input: LiveInput): LiveView {
  const today = istDate(input.now);
  const minutes = istMinutes(input.now);
  const all = input.prospects;
  const qualified = all.filter((p) => p.status !== "bench");
  const live = qualified.filter((p) => p.status !== "rejected");
  const sentRows: OutboxRow[] = [];
  let sentToday = 0;
  let repliesToday = 0;
  let contacted = 0;
  let contactedToday = 0;
  let replied = 0;
  const replyTimes: string[] = [];
  const groups = new Map<string, string[]>();

  for (const p of qualified) {
    const o = p.signals?.outreach;
    if (!o) continue;
    const name = cleanBusinessName(p.company);
    const real = (o.touches || []).filter((t) => !t.dry_run && t.sent_at);
    for (const t of real) {
      const isToday = istDate(t.sent_at as string) === today;
      sentRows.push({ company: name, city: p.city || "", what: TOUCH_NAMES[t.n] || `Message ${t.n}`, sentAt: t.sent_at as string, today: isToday });
      if (isToday) sentToday++;
    }
    if (real.length) {
      contacted++;
      const first = real.reduce((a, b) => ((a.sent_at as string) < (b.sent_at as string) ? a : b));
      if (istDate(first.sent_at as string) === today) contactedToday++;
    }
    if (o.last_reply_at || o.state === "replied") replied++;
    if (o.last_reply_at && istDate(o.last_reply_at) === today) {
      repliesToday++;
      replyTimes.push(o.last_reply_at);
    }
    // A business the Architect rejected stays paused for good; that is not a problem to report.
    if (o.state === "paused" && p.status !== "rejected") {
      const g = pauseGroup(o.pause_reason);
      groups.set(g, [...(groups.get(g) || []), name]);
    }
  }

  const approved = live.filter((p) => p.status === "reviewed" || p.status === "handed_to_outreach");
  const awaitingApproval = live.filter((p) => p.status === "new").length;
  const notContacted = approved.filter((p) => p.status === "reviewed" && !p.signals?.outreach);
  const byFit = (a: LiveProspect, b: LiveProspect) => (b.fit_score || 0) - (a.fit_score || 0);
  const queueRow = (p: LiveProspect): QueueRow => ({ company: cleanBusinessName(p.company), city: p.city || "", type: categoryLabel(p.category || ""), fit: Number(p.fit_score || 0) });
  const nextInLine = notContacted.filter(hasEmail).sort(byFit).map(queueRow);
  const calls: CallRow[] = notContacted
    .filter((p) => !hasEmail(p) && hasPhone(p))
    .sort(byFit)
    .map((p) => ({ ...queueRow(p), check: checkLine(cleanBusinessName(p.company), p.signals?.preaudit) }));

  const activeDeals = input.deals.filter((d) => !(d.prospect_id && all.some((p) => p.id === d.prospect_id && p.status === "rejected")));
  const callDeals = activeDeals.filter((d) => CALL_STAGES.has(d.stage)).length;
  const won = activeDeals.filter((d) => d.stage === "won").length;
  const upcoming = activeDeals
    .filter((d) => d.stage === "call_booked" && d.call_at && Date.parse(d.call_at) > input.now.getTime())
    .map((d) => ({ at: d.call_at as string, company: cleanBusinessName(d.company) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const replyDeals = activeDeals.filter((d) => d.stage === "replied").length;

  const foundToday = qualified.filter((p) => p.created_at && istDate(p.created_at) === today);
  const journey: Stage[] = [
    { label: "Found", count: qualified.length, today: foundToday.length },
    { label: "Approved", count: approved.length, today: null },
    { label: "Contacted", count: contacted, today: contactedToday },
    { label: "Replied", count: replied, today: repliesToday },
    { label: "Call booked", count: callDeals, today: null },
    { label: "Won", count: won, today: null },
  ];

  const waiting: string[] = [];
  if (awaitingApproval) waiting.push(`Approve or reject ${plural(awaitingApproval, "new business", "new businesses")} in #revenue.`);
  if (replyDeals) waiting.push(`Answer ${plural(replyDeals, "reply", "replies")} (open the pipeline).`);
  if (upcoming[0]) waiting.push(`Prepare for your next call: ${upcoming[0].company}, ${fmt(upcoming[0].at)}.`);

  // What each part of the system did today, from its own records.
  const activity: Activity[] = [];
  const createdToday = all.filter((p) => p.created_at && istDate(p.created_at) === today);
  const cities = [...new Set(foundToday.map((p) => p.city).filter(Boolean))] as string[];
  activity.push(
    createdToday.length
      ? { name: "Prospect researcher", at: latest(createdToday.map((p) => p.created_at as string)), what: `Found ${plural(foundToday.length, "business", "businesses")} that fit${cities.length ? ` (${cities.join(", ")})` : ""}.`, state: "done" }
      : minutes > 11 * 60
        ? { name: "Prospect researcher", at: null, what: "No new businesses saved today (it runs at 09:30).", state: "problem" }
        : { name: "Prospect researcher", at: null, what: "Runs at 09:30.", state: "waiting" }
  );
  const sendTimes = sentRows.filter((r) => r.today).map((r) => r.sentAt);
  activity.push(
    sentToday
      ? { name: "Outreach", at: latest(sendTimes), what: `Sent ${plural(sentToday, "email", "emails")}${sentToday >= input.capToday ? ", today's limit reached" : ` of ${input.capToday} allowed today`}.`, state: "done" }
      : { name: "Outreach", at: null, what: input.capToday === 0 ? "No sending today." : nextInLine.length ? "Nothing sent yet today; it sends on the half hour from 09:30." : "Nothing to send: no approved business with an email is waiting.", state: "waiting" }
  );
  const checkedToday = all.filter((p) => p.signals?.preaudit?.audited_at && istDate(p.signals.preaudit.audited_at) === today);
  activity.push(
    checkedToday.length
      ? { name: "Advance AI checks", at: latest(checkedToday.map((p) => p.signals?.preaudit?.audited_at as string)), what: `Checked ${plural(checkedToday.length, "phone-only business", "phone-only businesses")}.`, state: "done" }
      : { name: "Advance AI checks", at: null, what: minutes < 11 * 60 + 30 ? "Runs at 11:00." : calls.length ? "None ran today." : "Nothing to check.", state: "waiting" }
  );
  activity.push(citationActivity(input.agents, input.now, minutes, input.events));
  activity.push(
    repliesToday
      ? { name: "Replies", at: latest(replyTimes), what: `${plural(repliesToday, "reply", "replies")} came in today.`, state: "done" }
      : { name: "Replies", at: null, what: "No replies today.", state: "waiting" }
  );

  const paused: Problem[] = [...groups.entries()].map(([text, names]) => ({ text, names }));
  const failures = (input.events || []).filter((e) => e.kind === "error").map((e) => ({ text: e.summary, names: [] as string[] }));
  const problems: Problem[] = [...paused, ...activity.filter((a) => a.state === "problem").map((a) => ({ text: `${a.name}: ${a.what}`, names: [] })), ...failures];

  sentRows.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const pausedCount = paused.reduce((n, g) => n + g.names.length, 0);

  return {
    generatedAt: input.now.toISOString(),
    today: { sent: sentToday, cap: input.capToday, replies: repliesToday, callsBooked: upcoming.length, nextCall: upcoming[0] ? `${upcoming[0].company}, ${fmt(upcoming[0].at)}` : null },
    journey,
    stuck: { approval: awaitingApproval, nextInLine: nextInLine.length, whatsapp: calls.length, paused: pausedCount },
    waiting,
    problems,
    activity,
    outbox: sentRows.slice(0, 60),
    nextInLine,
    calls,
    paused,
    spend: input.spend,
    feed: input.events === undefined ? null : input.events,
  };
}

function istMinutes(now: Date): number {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export function timeOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export function dayOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

const AGENT_NAMES: Record<string, string> = {
  "aeo-audit-engine": "Citation tracker and audits",
  "prospect-researcher": "Prospect researcher",
  "outreach-sequencer": "Outreach",
  "chief-of-staff": "Chief of staff",
  "web-builder": "Web builder",
  "creative-director": "Creative director",
};

export function agentName(key: string): string {
  if (AGENT_NAMES[key]) return AGENT_NAMES[key];
  const words = key.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** "Tick 2026-11-24T08:00:00.000Z (live)" reads "Tick 1:30 pm IST (live)". */
export function readableTimes(text: string): string {
  return String(text || "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g, (iso) => `${timeOnly(iso)} IST`);
}

export const PRODUCT_NAMES: Record<string, string> = { truevisible: "TrueVisible", tgl_ops: "Research and audits" };

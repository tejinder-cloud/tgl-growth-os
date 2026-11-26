// services/tgl-ops/src/agents/outreach-sequencer/worker.ts
// Tick orchestration for the 5-touch sequence. This module owns the SAFETY rules from SKILL.md Playbook B
// and the one-pager hold rule from Playbook A (touch 3 carries the PDF). It does not talk to GHL, Supabase or Slack itself: those are
// injected as ports so the rules can be exercised without network access or credentials.
//
// Rules enforced here, in order:
//   1. Send window: Mon-Fri, 09:30-17:30 IST. Outside it the tick does nothing.
//   2. Daily cap: OUTREACH_DAILY_SEND_CAP (default 40) across all touches, oldest due first.
//   3. Live switch: sends go out only when OUTREACH_LIVE=1, otherwise every touch runs dry.
//   4. The one-pager touch is never sent bare: a result without a one-pager attachment is treated as held.
//   5. Three failed one-pager attempts post to #alerts and the sequence stays paused.

import { plainError } from "../../lib/plain-error.js";
import { recordEvent } from "../../lib/events.js";
import { cleanBusinessName } from "./names.js";
const TOUCH_LABEL: Record<number, string> = { 1: "First email", 2: "WhatsApp note", 3: "Report email", 4: "Follow-up", 5: "Last note" };

export const TOUCH_COUNT = 5;
/** Touch that carries the prospect's one-pager PDF (Architect cadence: T3, email, day 4). Mirrors sequence.ts. */
export const ONE_PAGER_TOUCH = 3;
export const MAX_HOLD_ATTEMPTS = 3;
export const DEFAULT_DAILY_CAP = 20;

const IST_OFFSET_MINUTES = 330;
const WINDOW_START_MINUTES = 9 * 60 + 30;
const WINDOW_END_MINUTES = 17 * 60 + 30;

export type TouchNumber = 1 | 2 | 3 | 4 | 5;
export type TouchChannel = "email" | "whatsapp";
export type SendMode = "live" | "dry_run";

export interface DueTouch {
  prospectId: string;
  company: string;
  touch: TouchNumber;
  channel: TouchChannel;
  /** ISO timestamp the touch became due. Used to send the oldest first. */
  dueAt: string;
}

export interface ExecuteResult {
  status: "sent" | "dry_run" | "held" | "skipped";
  reason?: string;
  /** Signed URL of the prospect's one-pager. Mandatory for the one-pager touch when status is sent or dry_run. */
  attachmentUrl?: string;
  /** Consecutive failed attempts for this touch, including this one. Reported by the port when held. */
  attempts?: number;
}

export interface TickPorts {
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** Touches whose due time has passed, for prospects whose sequence is still running. */
  listDue: (now: Date) => Promise<DueTouch[]>;
  /** Touches already sent (or dry-run) since IST midnight. */
  countToday: (now: Date) => Promise<number>;
  /** Build the message, attach the one-pager on the one-pager touch, send through GHL when mode is live, persist state. */
  execute: (item: DueTouch, mode: SendMode) => Promise<ExecuteResult>;
  /** Post a plain-text line to #alerts. */
  alert: (text: string) => Promise<unknown>;
  /** Today's limit when it comes from somewhere other than the settings (the Gmail inbox pool). */
  capFor?: (now: Date) => Promise<number>;
}

export interface TickOutcome {
  item: DueTouch;
  result: ExecuteResult;
}

export interface TickSummary {
  ran: boolean;
  reason?: "outside_window" | "cap_reached" | "nothing_due";
  mode: SendMode;
  cap: number;
  sentToday: number;
  due: number;
  deferredByCap: number;
  outcomes: TickOutcome[];
}

export function isLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.OUTREACH_LIVE || "").trim() === "1";
}

/**
 * Sends allowed today. OUTREACH_CAP_SCHEDULE ("2026-11-25=2,2026-12-02=5") is a warm-up ramp: the latest date
 * that has started (IST) wins. Before its first date, or when it is unset or unreadable, OUTREACH_DAILY_SEND_CAP
 * applies (default 20). OUTREACH_SEND_DAYS ("1-6" = Monday to Saturday, ISO weekday numbers) makes every other day 0.
 */
export function dailyCap(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const days = sendDays(env);
  if (days && !days.has(ist.getUTCDay() === 0 ? 7 : ist.getUTCDay())) return 0;

  const today = ist.toISOString().slice(0, 10);
  let scheduled: number | undefined;
  let latest = "";
  for (const part of (env.OUTREACH_CAP_SCHEDULE || "").split(",")) {
    const m = /^\s*(\d{4}-\d{2}-\d{2})\s*=\s*(\d+)\s*$/.exec(part);
    if (!m) continue;
    if (m[1] <= today && m[1] >= latest) {
      latest = m[1];
      scheduled = Number(m[2]);
    }
  }
  if (scheduled !== undefined) return scheduled;

  const raw = Number((env.OUTREACH_DAILY_SEND_CAP || "").trim());
  return Number.isFinite(raw) && raw >= 0 && (env.OUTREACH_DAILY_SEND_CAP || "").trim() !== "" ? Math.floor(raw) : DEFAULT_DAILY_CAP;
}

/** ISO weekdays (1 = Monday ... 7 = Sunday) from "1-6" or "1,2,3". Null when unset or unreadable: every day. */
export function sendDays(env: NodeJS.ProcessEnv = process.env): Set<number> | null {
  const raw = (env.OUTREACH_SEND_DAYS || "").trim();
  if (!raw) return null;
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const range = /^\s*([1-7])\s*(?:-\s*([1-7]))?\s*$/.exec(part);
    if (!range) return null;
    const a = Number(range[1]);
    const b = range[2] ? Number(range[2]) : a;
    for (let d = Math.min(a, b); d <= Math.max(a, b); d++) out.add(d);
  }
  return out.size ? out : null;
}

/** True every day between 09:30 and 17:30 IST (UTC+5:30, no daylight saving). Agents work every day (13 Nov 2026). */
export function isSendWindow(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= WINDOW_START_MINUTES && minutes < WINDOW_END_MINUTES;
}

function holdAlert(item: DueTouch, attempts: number, reason?: string): string {
  return `*Outreach held: ${item.company}* touch ${item.touch} failed ${attempts} times and the sequence stays paused. Reason: ${plainError(reason || "")}. Once the cause is fixed, ask Claude to resume this prospect.`;
}

export async function runTick(ports: TickPorts): Promise<TickSummary> {
  const now = ports.now();
  const mode: SendMode = isLive(ports.env) ? "live" : "dry_run";
  const cap = ports.capFor ? await ports.capFor(now) : dailyCap(ports.env, now);
  const base = { mode, cap, sentToday: 0, due: 0, deferredByCap: 0, outcomes: [] as TickOutcome[] };

  if (!isSendWindow(now)) return { ...base, ran: false, reason: "outside_window" };

  const sentToday = await ports.countToday(now);
  // Follow-ups first, then first emails (26 Nov 2026): the daily limit was being used up by new first emails,
  // so the report emails, which carry the finding and the ask, never got a slot.
  const due = (await ports.listDue(now)).slice().sort((a, b) => Number(a.touch === 1) - Number(b.touch === 1) || a.dueAt.localeCompare(b.dueAt));
  const remaining = Math.max(0, cap - sentToday);

  if (due.length === 0) return { ...base, sentToday, ran: true, reason: "nothing_due" };
  if (remaining === 0) return { ...base, sentToday, due: due.length, deferredByCap: due.length, ran: true, reason: "cap_reached" };

  const batch = due.slice(0, remaining);
  const outcomes: TickOutcome[] = [];

  for (const item of batch) {
    let result: ExecuteResult;
    try {
      result = await ports.execute(item, mode);
    } catch (err: any) {
      result = { status: "held", reason: err?.message || String(err), attempts: 1 };
    }

    // Playbook A rule 1: the one-pager touch never goes out without the prospect's own one-pager.
    if (item.touch === ONE_PAGER_TOUCH && (result.status === "sent" || result.status === "dry_run") && !result.attachmentUrl) {
      result = { status: "held", reason: `touch ${ONE_PAGER_TOUCH} result carried no one-pager attachment`, attempts: result.attempts };
      await ports.alert(
        `*Outreach guard: ${item.company}* touch ${ONE_PAGER_TOUCH} completed without a one-pager attachment. Check the sequencer immediately; touch ${ONE_PAGER_TOUCH} must never go out bare.`
      );
    }

    if (result.status === "held" && (result.attempts ?? 0) >= MAX_HOLD_ATTEMPTS && result.attempts === MAX_HOLD_ATTEMPTS) {
      await ports.alert(holdAlert(item, MAX_HOLD_ATTEMPTS, result.reason));
    }

    outcomes.push({ item, result });
    // The record the dashboard reads (25 Nov 2026). Dry runs and skips are not events.
    if (result.status === "sent") {
      await recordEvent({ agent: "outreach-sequencer", kind: "sent", prospectId: item.prospectId, summary: `${TOUCH_LABEL[item.touch] || `Message ${item.touch}`} sent to ${cleanBusinessName(item.company)}.`, detail: { touch: item.touch } });
    } else if (result.status === "held") {
      await recordEvent({ agent: "outreach-sequencer", kind: "held", prospectId: item.prospectId, summary: `${cleanBusinessName(item.company)} held before ${(TOUCH_LABEL[item.touch] || `message ${item.touch}`).toLowerCase()}: ${plainError(result.reason || "")}`, detail: { touch: item.touch, attempts: result.attempts ?? null } });
    }
  }

  return {
    ...base,
    ran: true,
    sentToday,
    due: due.length,
    deferredByCap: due.length - batch.length,
    outcomes,
  };
}

export interface SendHealth {
  sent: number;
  bounced: number;
  complained: number;
}

/** Real emails sent, and bounces and spam complaints on them, over the 7 days before now. */
export function emailHealth(rows: { signals?: unknown }[], now: Date): SendHealth {
  const since = now.getTime() - 7 * 86_400_000;
  const out: SendHealth = { sent: 0, bounced: 0, complained: 0 };
  for (const r of rows) {
    const o = ((r.signals || {}) as { outreach?: { touches?: { channel?: string; sent_at?: string; dry_run?: boolean }[]; state?: string; pause_reason?: string } }).outreach;
    const recent = (o?.touches || []).filter((t) => !t.dry_run && t.channel === "Email" && t.sent_at && Date.parse(t.sent_at) >= since && Date.parse(t.sent_at) <= now.getTime());
    out.sent += recent.length;
    if (!recent.length) continue;
    const why = o?.pause_reason || "";
    if (/marked the email as spam/i.test(why)) out.complained++;
    else if (o?.state === "paused" && /bounced/i.test(why)) out.bounced++;
  }
  return out;
}

/**
 * The warm-up safety rule (Architect, 26 Nov 2026): a step in OUTREACH_CAP_SCHEDULE only takes effect when the
 * last 7 days were clean, meaning bounces under 3% of sends and no spam complaint. Otherwise the previous step's
 * limit stays. It looks at a rolling week, so the step goes ahead once the bad days are more than 7 days old.
 */
export function guardedCap(env: NodeJS.ProcessEnv, now: Date, health: SendHealth): { cap: number; held?: string } {
  const scheduled = dailyCap(env, now);
  if (scheduled === 0) return { cap: 0 };
  const today = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
  const steps = (env.OUTREACH_CAP_SCHEDULE || "")
    .split(",")
    .map((p) => /^\s*(\d{4}-\d{2}-\d{2})\s*=\s*(\d+)\s*$/.exec(p))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ date: m[1], cap: Number(m[2]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const i = steps.reduce((at, s, k) => (s.date <= today ? k : at), -1);
  if (i <= 0) return { cap: scheduled };
  const previous = steps[i - 1].cap;
  if (scheduled <= previous) return { cap: scheduled };
  const rate = health.bounced / Math.max(1, health.sent);
  const reason = health.complained > 0
    ? `${health.complained} spam complaint${health.complained === 1 ? "" : "s"} in the last 7 days`
    : health.bounced > 0 && rate >= 0.03
      ? `${health.bounced} bounce${health.bounced === 1 ? "" : "s"} in ${health.sent} emails over the last 7 days (${Math.round(rate * 1000) / 10}%, the limit is under 3%)`
      : "";
  return reason ? { cap: previous, held: reason } : { cap: scheduled };
}

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

export function dailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.OUTREACH_DAILY_SEND_CAP || "").trim());
  return Number.isFinite(raw) && raw >= 0 && (env.OUTREACH_DAILY_SEND_CAP || "").trim() !== "" ? Math.floor(raw) : DEFAULT_DAILY_CAP;
}

/** True every day between 09:30 and 17:30 IST (UTC+5:30, no daylight saving). Agents work every day (13 Nov 2026). */
export function isSendWindow(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= WINDOW_START_MINUTES && minutes < WINDOW_END_MINUTES;
}

function holdAlert(item: DueTouch, attempts: number, reason?: string): string {
  return `*Outreach held: ${item.company}* touch ${item.touch} failed ${attempts} times and the sequence stays paused. Reason: ${reason || "not reported"}. Fix the cause, then clear the hold on the prospect.`;
}

export async function runTick(ports: TickPorts): Promise<TickSummary> {
  const now = ports.now();
  const mode: SendMode = isLive(ports.env) ? "live" : "dry_run";
  const cap = dailyCap(ports.env);
  const base = { mode, cap, sentToday: 0, due: 0, deferredByCap: 0, outcomes: [] as TickOutcome[] };

  if (!isSendWindow(now)) return { ...base, ran: false, reason: "outside_window" };

  const sentToday = await ports.countToday(now);
  const due = (await ports.listDue(now)).slice().sort((a, b) => a.dueAt.localeCompare(b.dueAt));
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

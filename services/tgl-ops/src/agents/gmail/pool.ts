// services/tgl-ops/src/agents/gmail/pool.ts
// Cold email from several free Gmail inboxes in rotation (Architect, 26 Nov 2026: no Google Workspace or Zoho;
// two more Gmail accounts beside calls.thegrowthlab@gmail.com). Each inbox warms up from its own start date:
// 5 a day in its first week, then 10, 15, 20, and 25 from week five (OUTREACH_INBOX_RAMP overrides). A business's
// follow-ups come from the inbox that sent its first email, so the thread stays together. An inbox whose bounces
// climb pauses itself. Pure functions first (tested without Google), live wiring at the end.

export interface InboxRow {
  email: string;
  status: "active" | "paused";
  /** YYYY-MM-DD, the day its warm-up started. */
  warm_start: string;
  paused_reason?: string | null;
}

export const DEFAULT_RAMP = [5, 10, 15, 20, 25];

export function rampFrom(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = (env.OUTREACH_INBOX_RAMP || "").trim();
  if (!raw) return DEFAULT_RAMP;
  const steps = raw.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);
  return steps.length ? steps.map((n) => Math.min(n, 50)) : DEFAULT_RAMP;
}

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Today's limit for one inbox: by whole weeks since its warm-up started; 0 when paused or not started. */
export function inboxCap(inbox: InboxRow, today: string, ramp: number[] = DEFAULT_RAMP): number {
  if (inbox.status !== "active") return 0;
  const days = dayNum(today) - dayNum(inbox.warm_start);
  if (!Number.isFinite(days) || days < 0) return 0;
  return ramp[Math.min(Math.floor(days / 7), ramp.length - 1)];
}

/** How many emails the whole pool may send today, after what each inbox already sent. */
export function poolRemaining(inboxes: InboxRow[], sentToday: Record<string, number>, today: string, ramp: number[] = DEFAULT_RAMP): number {
  return inboxes.reduce((n, i) => n + Math.max(0, inboxCap(i, today, ramp) - (sentToday[i.email] || 0)), 0);
}

/** The day's total allowance (sent plus remaining), the figure the daily cap uses. */
export function poolCapacity(inboxes: InboxRow[], today: string, ramp: number[] = DEFAULT_RAMP): number {
  return inboxes.reduce((n, i) => n + inboxCap(i, today, ramp), 0);
}

/**
 * The inbox to send from: the one that wrote to this business before, when it is active and has room today;
 * otherwise the active inbox with the most room left. Null when no inbox has room.
 */
export function pickInbox(inboxes: InboxRow[], sentToday: Record<string, number>, today: string, previous?: string, ramp: number[] = DEFAULT_RAMP): InboxRow | null {
  const room = (i: InboxRow) => inboxCap(i, today, ramp) - (sentToday[i.email] || 0);
  const prev = previous ? inboxes.find((i) => i.email === previous.toLowerCase()) : undefined;
  if (prev && room(prev) > 0) return prev;
  const open = inboxes.filter((i) => room(i) > 0).sort((a, b) => room(b) - room(a) || a.email.localeCompare(b.email));
  return open[0] || null;
}

export interface InboxHealth {
  sent: number;
  bounced: number;
}

/** True when an inbox should stop: at least 2 bounces and more than 5% of its last 7 days' sends. */
export function shouldPause(h: InboxHealth): boolean {
  return h.bounced >= 2 && h.bounced / Math.max(1, h.sent) > 0.05;
}

interface TouchLike {
  sent_at?: string;
  dry_run?: boolean;
  inbox?: string;
}
interface ProspectLike {
  signals?: unknown;
}
type OutreachLike = { touches?: TouchLike[]; state?: string; pause_reason?: string };
function outreachOf(r: ProspectLike | undefined): OutreachLike | undefined {
  return ((r?.signals || {}) as { outreach?: OutreachLike }).outreach;
}

function istDay(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}

/** Emails each inbox sent today (IST), from the touches saved on prospects. */
export function sentTodayByInbox(rows: ProspectLike[], today: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const t of outreachOf(r)?.touches || []) {
      if (t.dry_run || !t.sent_at || !t.inbox || istDay(t.sent_at) !== today) continue;
      out[t.inbox] = (out[t.inbox] || 0) + 1;
    }
  }
  return out;
}

/** The inbox that last wrote to a business, if any. */
export function lastInbox(row: ProspectLike | undefined): string | undefined {
  const touches = (outreachOf(row)?.touches || []).filter((t) => !t.dry_run && t.inbox && t.sent_at);
  return touches.length ? touches[touches.length - 1].inbox : undefined;
}

/** Sends and bounces per inbox over the last 7 days. A bounce is counted against the inbox that last wrote. */
export function healthByInbox(rows: ProspectLike[], now: Date): Record<string, InboxHealth> {
  const since = now.getTime() - 7 * 86_400_000;
  const out: Record<string, InboxHealth> = {};
  for (const r of rows) {
    const recent = (outreachOf(r)?.touches || []).filter((t) => !t.dry_run && t.inbox && t.sent_at && Date.parse(t.sent_at) >= since);
    for (const t of recent) (out[t.inbox as string] ||= { sent: 0, bounced: 0 }).sent++;
    const o = outreachOf(r);
    if (o?.state === "paused" && /bounced/i.test(o.pause_reason || "") && recent.length) {
      (out[recent[recent.length - 1].inbox as string] ||= { sent: 0, bounced: 0 }).bounced++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

export async function loadInboxes(): Promise<InboxRow[]> {
  const { getSupabase } = await import("../prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("outreach_inboxes").select("email, status, warm_start, paused_reason").eq("tenant_id", "tgl").order("created_at");
  if (error) throw new Error(`inboxes could not be read: ${error.message}`);
  return ((data || []) as InboxRow[]).map((i) => ({ ...i, email: i.email.toLowerCase() }));
}

export async function pauseInbox(email: string, reason: string): Promise<void> {
  const { getSupabase } = await import("../prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("outreach_inboxes").update({ status: "paused", paused_reason: reason }).eq("email", email.toLowerCase()).eq("tenant_id", "tgl");
}

/** Saves a connected inbox: its Google sign-in to Vault, and the row (a new inbox starts warming today). */
export async function saveInbox(email: string, refreshToken: string, warmStart: string): Promise<void> {
  const { getSupabase } = await import("../prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const addr = email.toLowerCase();
  const tok = await sb.rpc("svc_set_inbox_token", { p_email: addr, p_token: refreshToken });
  if (tok.error) throw new Error(`the sign-in could not be stored: ${tok.error.message}`);
  const existing = await sb.from("outreach_inboxes").select("email").eq("email", addr).maybeSingle();
  const row: Record<string, unknown> = existing.data ? { connected_at: new Date().toISOString(), status: "active", paused_reason: null } : { email: addr, tenant_id: "tgl", warm_start: warmStart, connected_at: new Date().toISOString(), status: "active" };
  const res = existing.data ? await sb.from("outreach_inboxes").update(row).eq("email", addr) : await sb.from("outreach_inboxes").insert(row);
  if (res.error) throw new Error(`the inbox could not be saved: ${res.error.message}`);
}

/** A token provider for one inbox: its own Vault sign-in, or the bookings sign-in for the bookings account. */
export function inboxTokenProvider(email: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): () => Promise<string | null> {
  let cached: { token: string; at: number } | null = null;
  return async () => {
    const { accessToken, configIssues, loadGoogleBookingConfig } = await import("../booking/google.js");
    const cfg = loadGoogleBookingConfig(env);
    if (configIssues(cfg).length > 0) return null;
    let refresh: string | null = null;
    if (email.toLowerCase() === cfg.calendarEmail) {
      const { bookingStore } = await import("../booking/live.js");
      refresh = await bookingStore().getRefreshToken();
    } else {
      const { getSupabase } = await import("../prospect-researcher/db.js");
      const sb = getSupabase();
      const { data } = sb ? await sb.rpc("svc_inbox_token", { p_email: email.toLowerCase() }) : { data: null };
      refresh = data ? String(data) : null;
    }
    if (!refresh) return null;
    if (!cached || Date.now() - cached.at > 45 * 60 * 1000) cached = { token: await accessToken(cfg, refresh, fetchImpl), at: Date.now() };
    return cached.token;
  };
}

/** "Tejinder Singh <inbox>" for any inbox in the pool. */
export function fromFor(email: string, env: NodeJS.ProcessEnv = process.env): string {
  const name = (env.OUTREACH_SENDER_NAME || "").trim() || "Tejinder Singh";
  return `${name} <${email}>`;
}

export interface PoolSenderDeps {
  inboxes: () => Promise<InboxRow[]>;
  sentToday: () => Promise<Record<string, number>>;
  today: () => string;
  /** The inbox that wrote to this business before. */
  previousFor: (prospectId: string) => string | undefined;
  /** Sends through one inbox. */
  sendVia: (inbox: string, input: import("../outreach-sequencer/email.js").OutreachEmail) => Promise<{ messageId: string }>;
  ramp?: number[];
}

/** Picks the inbox (same one as before for a business, when it has room), sends, and says which inbox it used. */
export function createPoolSender(deps: PoolSenderDeps) {
  return {
    async send(input: import("../outreach-sequencer/email.js").OutreachEmail): Promise<{ messageId: string; inbox: string }> {
      const inbox = pickInbox(await deps.inboxes(), await deps.sentToday(), deps.today(), deps.previousFor(input.prospectId), deps.ramp);
      if (!inbox) throw new Error("no sending inbox has room today");
      const sent = await deps.sendVia(inbox.email, input);
      return { messageId: sent.messageId, inbox: inbox.email };
    },
  };
}

/** Before a first email: a reason the address cannot receive mail, or null. Format first, then the domain's mail servers. */
export async function addressProblem(email: string, resolveMx?: (domain: string) => Promise<{ exchange: string }[]>): Promise<string | null> {
  const m = /^[^\s@]+@([^\s@]+\.[a-z]{2,})$/i.exec(email.trim());
  if (!m) return `the address ${email} is not a valid email address`;
  const lookup = resolveMx || (async (d: string) => (await import("node:dns")).promises.resolveMx(d));
  try {
    const mx = await lookup(m[1].toLowerCase());
    return mx.some((r) => r.exchange && r.exchange !== ".") ? null : `the domain ${m[1]} does not receive email`;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Only a definite "no such domain / no mail servers" holds the email; a lookup hiccup lets it go.
    return code === "ENOTFOUND" || code === "ENODATA" ? `the domain ${m[1]} does not receive email` : null;
  }
}

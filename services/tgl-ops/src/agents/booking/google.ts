// services/tgl-ops/src/agents/booking/google.ts
// Google sign-in (one time, by the Architect, for the bookings calendar) and the two calendar calls the booking
// page needs: busy times and creating the event with a Meet link. Every call takes an injectable fetch.
import crypto from "node:crypto";
import type { Busy } from "./slots.js";

// One sign-in for the bookings account covers the calendar and, since 24 Nov 2026, outreach email through Gmail
// (send, and read the inbox for replies and bounces).
export const BOOKING_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
export const CALLBACK_PATH = "/book/oauth/callback";

export interface GoogleBookingConfig {
  clientId: string;
  clientSecret: string;
  /** The only Google account allowed to connect, e.g. calls.thegrowthlab@gmail.com */
  calendarEmail: string;
  /** Public base URL of this service, no trailing slash. */
  publicUrl: string;
}

export function loadGoogleBookingConfig(env: NodeJS.ProcessEnv = process.env): GoogleBookingConfig {
  return {
    clientId: (env.GOOGLE_BOOKING_CLIENT_ID || "").trim(),
    clientSecret: (env.GOOGLE_BOOKING_CLIENT_SECRET || "").trim(),
    calendarEmail: (env.BOOKING_CALENDAR_EMAIL || "").trim().toLowerCase(),
    publicUrl: (env.BOOKING_PUBLIC_URL || env.OUTREACH_PUBLIC_URL || "").trim().replace(/\/+$/, ""),
  };
}

export function configIssues(cfg: GoogleBookingConfig): string[] {
  const issues: string[] = [];
  if (!cfg.clientId) issues.push("GOOGLE_BOOKING_CLIENT_ID is not set");
  if (!cfg.clientSecret) issues.push("GOOGLE_BOOKING_CLIENT_SECRET is not set");
  if (!cfg.calendarEmail) issues.push("BOOKING_CALENDAR_EMAIL is not set");
  if (!cfg.publicUrl) issues.push("BOOKING_PUBLIC_URL (or OUTREACH_PUBLIC_URL) is not set");
  return issues;
}

// --- sign-in state: signed and short-lived, so a callback cannot be forged or replayed later ---

const STATE_TTL_MS = 10 * 60 * 1000;

export function makeState(secret: string, now: Date = new Date()): string {
  const payload = `${now.getTime()}.${crypto.randomBytes(12).toString("hex")}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyState(state: string, secret: string, now: Date = new Date()): boolean {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const age = now.getTime() - Number(parts[0]);
  return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_MS;
}

export function authUrl(cfg: GoogleBookingConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.publicUrl + CALLBACK_PATH,
    response_type: "code",
    scope: BOOKING_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: cfg.calendarEmail,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** Reads the email claim from an ID token received straight from Google's token endpoint over TLS. */
export function emailFromIdToken(idToken: string): string {
  const part = String(idToken || "").split(".")[1];
  if (!part) return "";
  try {
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return claims.email_verified === false ? "" : String(claims.email || "").toLowerCase();
  } catch {
    return "";
  }
}

export interface ExchangeResult {
  refreshToken: string;
  email: string;
  scopes: string[];
}

export async function exchangeCode(cfg: GoogleBookingConfig, code: string, fetchImpl: typeof fetch = fetch, redirectPath: string = CALLBACK_PATH): Promise<ExchangeResult> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.publicUrl + redirectPath,
      grant_type: "authorization_code",
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${body.error || "unknown"}`);
  return {
    refreshToken: String(body.refresh_token || ""),
    email: emailFromIdToken(body.id_token),
    scopes: String(body.scope || "").split(/\s+/).filter(Boolean),
  };
}

export async function accessToken(cfg: GoogleBookingConfig, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Google token refresh failed (${res.status}): ${body.error || "no access token"}`);
  return String(body.access_token);
}

// --- calendar ---

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface CalendarRead {
  busy: Busy[];
  /** Event ids of our bookings that are still on the calendar. */
  present: string[];
  /** Event ids of our bookings whose guest declined. */
  declined: string[];
}

/**
 * Reads the bookings calendar between two instants. An event counts as busy unless it is cancelled, marked
 * "free", or is one of our bookings that the guest declined (so a declined slot opens again).
 */
export async function readCalendar(token: string, timeMin: string, timeMax: string, fetchImpl: typeof fetch = fetch): Promise<CalendarRead> {
  const out: CalendarRead = { busy: [], present: [], declined: [] };
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await fetchImpl(`${CAL}?${q.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Calendar read failed (${res.status}): ${body?.error?.message || "unknown"}`);
    for (const ev of body.items || []) {
      if (ev.status === "cancelled") continue;
      const ours = ev.extendedProperties?.private?.tgl_booking === "1";
      if (ours) out.present.push(String(ev.id));
      if (ev.transparency === "transparent") continue;
      if (ours && (ev.attendees || []).some((a: any) => !a.self && !a.organizer && a.responseStatus === "declined")) {
        out.declined.push(String(ev.id));
        continue;
      }
      const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00+05:30` : "");
      const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00+05:30` : "");
      if (start && end) out.busy.push({ start, end });
    }
    pageToken = body.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

export async function listBusy(token: string, timeMin: string, timeMax: string, fetchImpl: typeof fetch = fetch): Promise<Busy[]> {
  return (await readCalendar(token, timeMin, timeMax, fetchImpl)).busy;
}

export interface NewEvent {
  start: string;
  end: string;
  summary: string;
  description: string;
  guestEmail: string;
  guestName: string;
  requestId: string;
}

export interface CreatedEvent {
  eventId: string;
  htmlLink: string;
  meetUrl: string;
}

/** Creates the event with a Meet link and sends Google's invite to the guest. Throws unless Google confirms. */
export async function createEvent(token: string, ev: NewEvent, fetchImpl: typeof fetch = fetch): Promise<CreatedEvent> {
  const q = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  const res = await fetchImpl(`${CAL}?${q.toString()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.summary,
      description: ev.description,
      start: { dateTime: ev.start, timeZone: "Asia/Kolkata" },
      end: { dateTime: ev.end, timeZone: "Asia/Kolkata" },
      attendees: [{ email: ev.guestEmail, displayName: ev.guestName }],
      conferenceData: { createRequest: { requestId: ev.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 15 }] },
      extendedProperties: { private: { tgl_booking: "1" } },
      guestsCanModify: false,
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) throw new Error(`Google Calendar create failed (${res.status}): ${body?.error?.message || "no event id"}`);
  const meet = (body.conferenceData?.entryPoints || []).find((e: any) => e.entryPointType === "video");
  return { eventId: String(body.id), htmlLink: String(body.htmlLink || ""), meetUrl: String(meet?.uri || body.hangoutLink || "") };
}

export async function deleteEvent(token: string, eventId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(`${CAL}/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

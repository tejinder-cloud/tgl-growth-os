// services/tgl-ops/src/agents/booking/live.ts
// Real wiring for the booking service: Supabase store, Google Calendar, outreach link, #revenue.
import { postLine } from "../../lib/post.js";
import { createSupabaseStore, getOutreachState } from "../outreach-sequencer/store.js";
import { accessToken, createEvent, listBusy, loadGoogleBookingConfig, configIssues } from "./google.js";
import { loadHolidays } from "./slots.js";
import { createBookingService, type BookingDeps, type CalendarPort, type OutreachLink } from "./service.js";
import { createSupabaseBookingStore, type BookingStore } from "./store.js";

export function revenueChannel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SALES_DESK_CHANNEL_ID || "#revenue").trim();
}

export function makeCalendarProvider(store: BookingStore, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): () => Promise<CalendarPort | null> {
  let cached: { token: string; at: number } | null = null;
  return async () => {
    const cfg = loadGoogleBookingConfig(env);
    if (configIssues(cfg).length > 0) return null;
    const refresh = await store.getRefreshToken();
    if (!refresh) return null;
    if (!cached || Date.now() - cached.at > 45 * 60 * 1000) {
      cached = { token: await accessToken(cfg, refresh, fetchImpl), at: Date.now() };
    }
    const token = cached.token;
    return {
      listBusy: (min, max) => listBusy(token, min, max, fetchImpl),
      createEvent: (ev) => createEvent(token, ev, fetchImpl),
    };
  };
}

function outreachLink(): OutreachLink {
  const prospects = createSupabaseStore();
  return {
    async find(email) {
      const p = await prospects.findByEmail(email);
      if (!p) return null;
      const a = getOutreachState(p)?.audit;
      const auditLine = a ? `Their AI check: named in ${a.mentions} of ${a.total_queries} answers.` : undefined;
      return { id: p.id, company: p.company, auditLine };
    },
    async stop(id, at) {
      const p = (await prospects.loadSequenced()).find((r) => r.id === id);
      const s = p ? getOutreachState(p) : undefined;
      if (!p || !s || s.state !== "active") return;
      await prospects.saveState(id, { ...s, state: "replied", last_reply_intent: "meeting_request", last_reply_at: at.toISOString(), pause_reason: "call booked" });
    },
  };
}

let service: ReturnType<typeof createBookingService> | null = null;
let store: BookingStore | null = null;

export function bookingStore(): BookingStore {
  if (!store) store = createSupabaseBookingStore();
  return store;
}

export function bookingService(): ReturnType<typeof createBookingService> {
  if (!service) {
    const s = bookingStore();
    const deps: BookingDeps = {
      now: () => new Date(),
      store: s,
      calendar: makeCalendarProvider(s),
      holidays: loadHolidays(),
      outreach: outreachLink(),
      notify: async (text) => {
        await postLine({ channel: revenueChannel(), text });
      },
      hostName: (process.env.OUTREACH_SENDER_NAME || "Tejinder Singh").trim(),
    };
    service = createBookingService(deps);
  }
  return service;
}

export function setBookingServiceForTests(svc: ReturnType<typeof createBookingService> | null, st?: BookingStore | null): void {
  service = svc;
  if (st !== undefined) store = st;
}

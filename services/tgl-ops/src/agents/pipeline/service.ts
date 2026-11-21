// services/tgl-ops/src/agents/pipeline/service.ts
// Moves deals between stages. Automatic signals (outreach, audit form, reply, booking) only move a deal forward;
// the Architect's taps after a call decide the rest. Every move is recorded in the deal's history.
import { canAdvance, isClosed, money, STAGE_LABEL, type Currency, type Deal, type Stage } from "./stages.js";
import type { DealStore } from "./store.js";

export interface PipelineDeps {
  store: DealStore;
  now: () => Date;
  notify: (text: string) => Promise<void>;
  /** Posts the "how did the call go" card. */
  askAfterCall: (deal: Deal) => Promise<void>;
  /** Hands a won deal to Finance; returns one line on what Finance did. */
  onWon: (deal: Deal) => Promise<string>;
}

export interface Contact {
  company: string;
  name?: string | null;
  email?: string | null;
  city?: string | null;
}

/** Minutes after a call's start when the Architect is asked how it went (20-minute call plus 10). */
export const ASK_AFTER_MINUTES = 30;

export type ActionResult = { ok: true; deal: Deal; line: string } | { ok: false; message: string };

export function createPipeline(deps: PipelineDeps) {
  const at = () => deps.now().toISOString();
  const step = (d: Deal, stage: Stage, by: string, note?: string) => [...(d.history || []), { stage, at: at(), by, ...(note ? { note } : {}) }];

  async function find(c: Contact, ids: { prospectId?: string | null; bookingId?: string | null }): Promise<Deal | null> {
    if (ids.prospectId) {
      const d = await deps.store.findOpenByProspect(ids.prospectId);
      if (d) return d;
    }
    if (c.email) return deps.store.findOpenByEmail(c.email);
    return null;
  }

  /** Creates the deal, or moves the open one forward. Never moves a deal backward or reopens a closed one. */
  async function signal(stage: Stage, source: Deal["source"], c: Contact, ids: { prospectId?: string | null; siteLeadId?: string | null; bookingId?: string | null }, extra: Partial<Deal> = {}): Promise<Deal> {
    const existing = await find(c, ids);
    const links: Partial<Deal> = {
      ...(ids.prospectId ? { prospect_id: ids.prospectId } : {}),
      ...(ids.siteLeadId ? { site_lead_id: ids.siteLeadId } : {}),
      ...(ids.bookingId ? { booking_id: ids.bookingId } : {}),
    };
    if (!existing) {
      return deps.store.create({
        company: c.company,
        contact_name: c.name || null,
        contact_email: c.email ? c.email.trim().toLowerCase() : null,
        city: c.city || null,
        source,
        prospect_id: ids.prospectId || null,
        site_lead_id: ids.siteLeadId || null,
        booking_id: ids.bookingId || null,
        stage,
        history: [{ stage, at: at(), by: "system" }],
        ...extra,
      });
    }
    if (!canAdvance(existing.stage, stage)) {
      // Still keep new links and details (a booking id, a call time) without changing the stage.
      return Object.keys(links).length || Object.keys(extra).length ? deps.store.update(existing.id, { ...links, ...(existing.stage === stage ? extra : {}) }) : existing;
    }
    return deps.store.update(existing.id, { ...links, ...extra, stage, history: step(existing, stage, "system") });
  }

  return {
    outreachStarted: (c: Contact, prospectId: string) => signal("in_outreach", "outreach", c, { prospectId }),
    auditRequested: (c: Contact, siteLeadId: string) => signal("audit_requested", "site", c, { siteLeadId }),
    replied: (c: Contact, prospectId?: string) => signal("replied", "outreach", c, { prospectId }),
    callBooked: (c: Contact, bookingId: string, callAt: string, prospectId?: string | null) =>
      signal("call_booked", prospectId ? "outreach" : "booking", c, { bookingId, prospectId }, { call_at: callAt, call_prompted_at: null, no_show: false }),

    /** A cancelled booking returns the deal to the stage it had before the booking. */
    async bookingCancelled(bookingId: string): Promise<Deal | null> {
      const d = await deps.store.findByBooking(bookingId);
      if (!d || d.stage !== "call_booked") return d;
      const before = [...d.history].reverse().find((h) => h.stage !== "call_booked")?.stage || "replied";
      return deps.store.update(d.id, { stage: before, booking_id: null, call_at: null, history: step(d, before, "system", "booking cancelled") });
    },

    /** Asks about every call that has ended. Each call is asked about once. */
    async askAboutEndedCalls(): Promise<number> {
      const before = new Date(deps.now().getTime() - ASK_AFTER_MINUTES * 60000).toISOString();
      let n = 0;
      for (const d of await deps.store.listCallsToAsk(before)) {
        await deps.askAfterCall(d);
        await deps.store.update(d.id, { call_prompted_at: at() });
        n++;
      }
      return n;
    },

    async callHappened(id: string, by: string): Promise<ActionResult> {
      const d = await deps.store.get(id);
      if (!d) return { ok: false, message: "That deal was not found." };
      if (d.stage !== "call_booked") return { ok: false, message: `This deal is at "${STAGE_LABEL[d.stage]}", so it cannot be marked as call done.` };
      const u = await deps.store.update(id, { stage: "call_done", history: step(d, "call_done", by) });
      return { ok: true, deal: u, line: `Call done, marked by ${by}.` };
    },

    async noShow(id: string, by: string): Promise<ActionResult> {
      const d = await deps.store.get(id);
      if (!d) return { ok: false, message: "That deal was not found." };
      if (d.stage !== "call_booked") return { ok: false, message: `This deal is at "${STAGE_LABEL[d.stage]}", so it cannot be marked as a no-show.` };
      const u = await deps.store.update(id, { stage: "replied", no_show: true, booking_id: null, history: step(d, "replied", by, "no-show") });
      return { ok: true, deal: u, line: `No-show, marked by ${by}. The deal is back at "Replied"; they can book again from the same link.` };
    },

    async proposalSent(id: string, amount: number, currency: Currency, by: string): Promise<ActionResult> {
      const d = await deps.store.get(id);
      if (!d) return { ok: false, message: "That deal was not found." };
      if (isClosed(d.stage)) return { ok: false, message: `This deal is already ${STAGE_LABEL[d.stage].toLowerCase()}.` };
      if (!(amount > 0) || !Number.isFinite(amount)) return { ok: false, message: "Enter the amount a month as a number above zero." };
      const u = await deps.store.update(id, { stage: "proposal_sent", amount, currency, history: step(d, "proposal_sent", by, money(amount, currency)) });
      return { ok: true, deal: u, line: `Proposal sent: ${money(amount, currency)}, marked by ${by}.` };
    },

    async won(id: string, by: string): Promise<ActionResult> {
      const d = await deps.store.get(id);
      if (!d) return { ok: false, message: "That deal was not found." };
      if (d.stage !== "proposal_sent") return { ok: false, message: `This deal is at "${STAGE_LABEL[d.stage]}". Mark the proposal as sent first, with its amount.` };
      const u = await deps.store.update(id, { stage: "won", history: step(d, "won", by) });
      let finance: string;
      try {
        finance = await deps.onWon(u);
      } catch (err) {
        finance = `Finance could not draft the invoice: ${(err as Error).message}`;
      }
      await deps.notify(`Deal won: ${u.company}, ${money(Number(u.amount), (u.currency || "INR") as Currency)}. ${finance}`).catch(() => {});
      return { ok: true, deal: u, line: `Won, marked by ${by}. ${finance}` };
    },

    async lost(id: string, reason: string, by: string): Promise<ActionResult> {
      const d = await deps.store.get(id);
      if (!d) return { ok: false, message: "That deal was not found." };
      if (isClosed(d.stage)) return { ok: false, message: `This deal is already ${STAGE_LABEL[d.stage].toLowerCase()}.` };
      const why = reason.trim().slice(0, 300);
      if (!why) return { ok: false, message: "Add a short reason." };
      const u = await deps.store.update(id, { stage: "lost", lost_reason: why, history: step(d, "lost", by, why) });
      return { ok: true, deal: u, line: `Lost, marked by ${by}: ${why}` };
    },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;

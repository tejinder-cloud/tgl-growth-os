// services/tgl-ops/src/test-d10b-outreach-wiring.ts
// Offline checks for the Outreach Sequencer composition root (PLAN-D10b). No network, no credentials: the store is
// in memory and GHL, the audit engine, Supabase Storage, Slack and the log sink are fakes.
// Templates are the real files in agents/outreach-sequencer/templates.
import assert from "node:assert/strict";
import type { GhlClient, SendMessageInput } from "./agents/outreach-sequencer/ghl.js";
import {
  createOutreachRuntime,
  renderSequencePreview,
  templatePlaceholders,
  tickCron,
  whatsappEnabled,
} from "./agents/outreach-sequencer/live.js";
import { createMemoryStore, getOutreachState, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import { loadTemplates, resolveTemplatesDir } from "./agents/outreach-sequencer/templates.js";
import type { AuditSummary, OutreachState } from "./agents/outreach-sequencer/types.js";

// 2026-03-09 is a Monday. 10:00 IST = 04:30 UTC.
const MON_1000_IST = new Date("2026-03-09T04:30:00Z");
const SAT_0800_IST = new Date("2026-03-14T02:30:00Z");

const AUDIT: AuditSummary = {
  visibility_percent: 20,
  mentions: 3,
  total_queries: 15,
  mentions_by_engine: { chatgpt: 1, gemini: 1, perplexity: 1 },
  top_competitors: ["Smile Studio", "Dental Arts", "City Dental"],
  top_cited_domains: ["practo.com", "justdial.com", "smilestudio.example"],
  audited_at: "2026-03-08T06:00:00.000Z",
  competitor_mentions: { "Smile Studio": 9, "Dental Arts": 6, "City Dental": 4 },
  weakest_query: "Best dental implant clinic in Pune",
} as AuditSummary;

const BOOKING = "https://example.test/book";

function fixtureProspect(id: string, over: { phone?: string; audit?: AuditSummary; nextTouch?: number } = {}): OutreachProspect {
  const state = {
    state: "active",
    enrolled_at: "2026-03-09T00:00:00.000Z",
    next_touch: over.nextTouch ?? 1,
    next_due_at: "2026-03-09T00:00:00.000Z",
    touches: [],
    audit_attempts: 0,
    send_failures: 0,
    audit: over.audit,
    onepager_path: over.audit ? "tgl/fixture/onepager.pdf" : undefined,
  } as unknown as OutreachState;
  return {
    id,
    tenant_id: "tgl",
    company: "Bright Smile Dental",
    website: "https://brightsmile.example",
    category: "dental_clinic",
    city: "Pune",
    door: "aeo",
    status: "handed_to_outreach",
    fit_score: 82,
    fit_reasons: [],
    decision_maker: { name: "Asha Rao", email: "asha@brightsmile.example", phone: over.phone },
    signals: { outreach: state },
  } as unknown as OutreachProspect;
}

class FakeGhl implements GhlClient {
  upserts = 0;
  sent: SendMessageInput[] = [];
  async upsertContact() {
    this.upserts++;
    return { contactId: "ghl-contact-1" };
  }
  async sendMessage(input: SendMessageInput) {
    this.sent.push(input);
    return { messageId: `msg-${this.sent.length}` };
  }
  async addTags() {}
  async addNote() {}
}

function harness(rows: OutreachProspect[], env: NodeJS.ProcessEnv, now: Date = MON_1000_IST) {
  const store = createMemoryStore(rows);
  const ghl = new FakeGhl();
  const logs: Array<{ date: string; md: string }> = [];
  const alerts: string[] = [];
  let audits = 0;
  const runtime = createOutreachRuntime({
    env,
    now: () => now,
    store,
    ghl,
    alert: async (t) => {
      alerts.push(t);
    },
    writeLog: async (date, md) => {
      logs.push({ date, md });
    },
    audit: async () => {
      audits++;
      return AUDIT;
    },
    storeOnePager: async () => "tgl/bright-smile/onepager.pdf",
    signUrl: async (p) => `https://storage.example.test/${p}?token=t`,
  });
  return { runtime, store, ghl, logs, alerts, audits: () => audits };
}

async function main() {
  // Real templates load from agents/outreach-sequencer/templates
  const templates = loadTemplates(resolveTemplatesDir());
  assert.equal(templates.size, 5);
  const placeholders = templatePlaceholders(templates);
  assert.ok(placeholders.size > 0, "templates use placeholders");

  // Env helpers
  assert.equal(whatsappEnabled({}), false);
  assert.equal(whatsappEnabled({ GHL_WA_PHONE_ID: "  " }), false);
  assert.equal(whatsappEnabled({ GHL_WA_PHONE_ID: "wa-1" }), true);
  assert.equal(tickCron({}), "30 9-16 * * *");
  assert.equal(tickCron({ OUTREACH_TICK_CRON: "0 10 * * 1-5" }), "0 10 * * 1-5");

  // Unit: all five touches render for a fixture prospect, WhatsApp on
  const view = {
    id: "fx",
    company: "Bright Smile Dental",
    category: "dental_clinic",
    city: "Pune",
    email: "asha@brightsmile.example",
    phone: "+919800000000",
    decisionMakerName: "Asha Rao",
  };
  {
    const r = renderSequencePreview(templates, view, AUDIT, { senderName: "The Growth Lab", bookingLink: BOOKING, whatsappEnabled: true });
    assert.equal(r.failures, 0, r.markdown);
    assert.equal(r.rendered, 5);
    assert.equal((r.markdown.match(/^#### Touch \d of 5/gm) || []).length, 5);
    assert.ok(r.markdown.includes("Bright Smile Dental"));
    assert.ok(/#### Touch 2 of 5: WhatsApp/.test(r.markdown), "touch 2 goes on WhatsApp when enabled");
    assert.ok(/#### Touch 4 of 5: WhatsApp/.test(r.markdown), "touch 4 goes on WhatsApp when enabled");
    assert.ok(/#### Touch 3 of 5: Email[\s\S]*Attachment: prospect one-pager PDF/.test(r.markdown), "touch 3 carries the one-pager");
    assert.equal((r.markdown.match(/\bSTOP\b/g) || []).length >= 5, true, "every touch carries an opt-out line");
    assert.equal(/\p{Extended_Pictographic}/u.test(r.markdown), false, "no emojis");
  }

  // Unit: WhatsApp off, or no phone: touch 2 is skipped (13 Nov 2026), the other four go by email
  {
    const off = renderSequencePreview(templates, view, AUDIT, { senderName: "The Growth Lab", bookingLink: BOOKING, whatsappEnabled: false });
    assert.equal(off.failures, 0, off.markdown);
    assert.equal(/: WhatsApp,/.test(off.markdown), false);
    assert.equal((off.markdown.match(/^Subject: /gm) || []).length, 4, "four email subjects");
    assert.ok(/#### Touch 2 of 5: skipped/.test(off.markdown), "touch 2 is skipped, never turned into an email");
    const noPhone = renderSequencePreview(templates, { ...view, phone: undefined }, AUDIT, { senderName: "The Growth Lab", bookingLink: BOOKING, whatsappEnabled: true });
    assert.equal(noPhone.failures, 0, noPhone.markdown);
    assert.equal(/: WhatsApp,/.test(noPhone.markdown), false);
  }

  // Unit: a placeholder with no stored data fails the touch instead of being guessed
  if (placeholders.has("booking_link")) {
    const r = renderSequencePreview(templates, view, AUDIT, { senderName: "The Growth Lab", whatsappEnabled: true });
    assert.ok(r.failures > 0);
    assert.ok(r.markdown.includes("RENDER FAILED"));
  }

  // Preflight flags a missing booking link only when a template uses it
  {
    const h = harness([], {});
    assert.equal(h.runtime.preflight().length, placeholders.has("booking_link") ? 1 : 0);
    const live = harness([], { OUTREACH_LIVE: "1", OUTREACH_BOOKING_LINK: BOOKING });
    assert.ok(live.runtime.preflight().some((i) => i.includes("GHL_API_KEY")), "live without GHL credentials is flagged");
  }

  // Dry-run tick: renders the touches for the test prospect (touch 2 skipped while WhatsApp is off), builds the audit,
  // touches nothing in GHL
  {
    const h = harness([fixtureProspect("p1", { phone: "+919800000000" })], { OUTREACH_TEST_PROSPECT_ID: "p1", OUTREACH_BOOKING_LINK: BOOKING });
    const res = await h.runtime.tick();
    assert.deepEqual(res.issues, []);
    assert.equal(res.previewed?.rendered, 4);
    assert.equal(res.previewed?.failures, 0);
    assert.equal(res.summary?.mode, "dry_run");
    assert.equal(res.summary?.outcomes[0].result.status, "dry_run");
    assert.equal(h.ghl.sent.length, 0, "dry run never sends");
    assert.equal(h.ghl.upserts, 0, "dry run never touches GHL");
    assert.ok(h.audits() >= 1);

    const previewLog = h.logs.find((l) => l.md.includes("preview:p1"));
    assert.ok(previewLog, "preview written to the log");
    assert.equal(previewLog!.date, "2026-03-09");
    assert.equal((previewLog!.md.match(/^#### Touch \d of 5/gm) || []).length, 5);
    assert.ok(h.logs.some((l) => l.md.includes("### Tick") && l.md.includes("dry run")));

    const state = getOutreachState(h.store.rows[0])!;
    assert.equal(state.next_touch, 1, "dry run does not advance the sequence");
    assert.ok(state.audit, "audit cached for the next tick");
    assert.equal(state.onepager_path, "tgl/bright-smile/onepager.pdf");
    assert.equal(state.touches.filter((t) => t.dry_run).length, 1);

    // Second tick the same day does not repeat the preview
    await h.runtime.tick();
    assert.equal(h.logs.filter((l) => l.md.includes("preview:p1")).length, 1);
  }

  // Outside the send window: nothing runs, nothing is previewed
  {
    const h = harness([fixtureProspect("p1")], { OUTREACH_TEST_PROSPECT_ID: "p1", OUTREACH_BOOKING_LINK: BOOKING }, SAT_0800_IST);
    const res = await h.runtime.tick();
    assert.equal(res.summary?.ran, false);
    assert.equal(res.previewed, undefined);
    assert.equal(h.logs.length, 0);
  }

  // WhatsApp gating on the due list: touch 2, prospect with a phone
  {
    const rows = () => [fixtureProspect("p2", { phone: "+919800000000", audit: AUDIT, nextTouch: 2 })];
    const off = harness(rows(), { OUTREACH_BOOKING_LINK: BOOKING });
    const a = await off.runtime.tick();
    assert.equal(a.summary?.outcomes[0].item.channel, "email", "GHL_WA_PHONE_ID unset falls back to email");
    const on = harness(rows(), { OUTREACH_BOOKING_LINK: BOOKING, GHL_WA_PHONE_ID: "wa-1" });
    const b = await on.runtime.tick();
    assert.equal(b.summary?.outcomes[0].item.channel, "whatsapp");
    assert.equal(on.ghl.sent.length, 0, "still dry run");
  }

  // Live: OUTREACH_LIVE=1 sends touch 1 by email through GHL and advances the sequence
  {
    const h = harness([fixtureProspect("p3", { audit: AUDIT })], {
      OUTREACH_LIVE: "1",
      OUTREACH_BOOKING_LINK: BOOKING,
      GHL_API_KEY: "k",
      GHL_LOCATION_ID: "loc",
    });
    const res = await h.runtime.tick();
    assert.deepEqual(res.issues, []);
    assert.equal(res.summary?.mode, "live");
    assert.equal(res.summary?.outcomes[0].result.status, "sent");
    assert.equal(h.ghl.upserts, 1);
    assert.equal(h.ghl.sent.length, 1);
    assert.equal(h.ghl.sent[0].channel, "Email");
    assert.equal(h.ghl.sent[0].contactId, "ghl-contact-1");
    assert.ok(h.ghl.sent[0].subject);
    const state = getOutreachState(h.store.rows[0])!;
    assert.equal(state.next_touch, 2);
    assert.equal(state.ghl_contact_id, "ghl-contact-1");
    assert.equal(h.alerts.length, 0);
  }

  // Live with a preflight problem sends nothing and alerts once
  {
    const h = harness([fixtureProspect("p4", { audit: AUDIT })], { OUTREACH_LIVE: "1", OUTREACH_BOOKING_LINK: BOOKING });
    const res = await h.runtime.tick();
    assert.equal(res.summary, null);
    assert.equal(h.ghl.sent.length, 0);
    assert.equal(h.alerts.length, 1);
  }

  console.log("test-d10b-outreach-wiring: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

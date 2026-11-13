// services/tgl-ops/src/test-day10-execute.ts
// Offline checks for the per-touch executor. No network, no credentials.
import assert from "node:assert/strict";
import { makeExecute, type ExecutorPorts, type OutboundMessage, type ProspectView } from "./agents/outreach-sequencer/execute.js";
import type { AuditSummary, OutreachState } from "./agents/outreach-sequencer/types.js";
import type { DueTouch } from "./agents/outreach-sequencer/worker.js";

const AUDIT: AuditSummary = {
  visibility_percent: 20,
  mentions: 3,
  total_queries: 15,
  mentions_by_engine: { chatgpt: 1, gemini: 1, perplexity: 1 },
  top_competitors: ["Rival Dental"],
  top_cited_domains: ["example-directory.test"],
  audited_at: "2026-03-09T04:30:00Z",
};

function baseState(over: Partial<OutreachState> = {}): OutreachState {
  return {
    state: "active",
    enrolled_at: "2026-03-09T04:30:00Z",
    next_touch: 1,
    next_due_at: "2026-03-09T04:30:00Z",
    touches: [],
    ...over,
  };
}

function item(touch: DueTouch["touch"]): DueTouch {
  return { prospectId: "p1", company: "Test Dental", touch, channel: "email", dueAt: "2026-03-09T04:30:00Z" };
}

function harness(opts: { state?: OutreachState | null; phone?: string; whatsapp?: boolean; buildFails?: boolean; sendFails?: boolean } = {}) {
  let state: OutreachState | undefined = opts.state === null ? undefined : opts.state || baseState();
  const sent: OutboundMessage[] = [];
  const log = { builds: 0, upserts: 0 };
  const prospect = (): ProspectView => ({
    id: "p1",
    company: "Test Dental",
    category: "dental_clinic",
    city: "Chandigarh",
    phone: opts.phone,
    decisionMakerName: "Dr. Test",
    outreach: state,
  });
  const ports: ExecutorPorts = {
    now: () => new Date("2026-03-12T05:00:00Z"),
    senderName: "Tejinder",
    whatsappEnabled: opts.whatsapp ?? false,
    loadProspect: async () => (state ? prospect() : opts.state === null ? prospect() : null),
    saveState: async (_id, s) => {
      state = s;
    },
    buildOnePager: async () => {
      log.builds++;
      if (opts.buildFails) throw new Error("pdf upload failed");
      return { audit: AUDIT, path: "p1/onepager.pdf" };
    },
    signOnePagerUrl: async (path) => `https://example.test/${path}?sig=1`,
    upsertContact: async () => {
      log.upserts++;
      return "ghl-1";
    },
    sendMessage: async (m) => {
      if (opts.sendFails) throw new Error("ghl 500");
      sent.push(m);
      return { messageId: `m${sent.length}` };
    },
  };
  return { ports, sent, log, getState: () => state as OutreachState };
}

async function main() {
  // Not enrolled, inactive, stale: skipped and nothing sent
  {
    const h = harness({ state: null });
    assert.equal((await makeExecute(h.ports)(item(1), "live")).status, "skipped");
    const r = harness({ state: baseState({ state: "replied" }) });
    assert.equal((await makeExecute(r.ports)(item(1), "live")).status, "skipped");
    const s = harness({ state: baseState({ next_touch: 3 }) });
    assert.equal((await makeExecute(s.ports)(item(1), "live")).status, "skipped");
    assert.equal(h.sent.length + r.sent.length + s.sent.length, 0);
  }

  // Touch 1 live: sends email, advances to touch 2 with the business-day offset
  {
    const h = harness();
    const res = await makeExecute(h.ports)(item(1), "live");
    assert.equal(res.status, "sent");
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].channel, "Email");
    assert.equal(h.sent[0].attachmentUrl, undefined);
    assert.equal(h.sent[0].contactId, "ghl-1");
    const st = h.getState();
    assert.equal(st.next_touch, 2);
    assert.equal(st.touches.length, 1);
    assert.equal(st.touches[0].dry_run, false);
    assert.equal(st.next_due_at, "2026-03-11T04:30:00.000Z", "2 business days after Monday is Wednesday");
    assert.equal(h.log.builds, 0, "touch 1 needs no audit");
  }

  // Dry run: nothing sent, no GHL contact, sequence not advanced, dry-run record kept once
  {
    const h = harness();
    const ex = makeExecute(h.ports);
    assert.equal((await ex(item(1), "dry_run")).status, "dry_run");
    assert.equal((await ex(item(1), "dry_run")).status, "dry_run");
    assert.equal(h.sent.length, 0);
    assert.equal(h.log.upserts, 0);
    const st = h.getState();
    assert.equal(st.next_touch, 1);
    assert.equal(st.touches.length, 1);
    assert.equal(st.touches[0].dry_run, true);
  }

  // Touch 3 live: builds the audit once, attaches the signed one-pager URL, message quotes the audit
  {
    const h = harness({ state: baseState({ next_touch: 3 }) });
    const res = await makeExecute(h.ports)(item(3), "live");
    assert.equal(res.status, "sent");
    assert.equal(res.attachmentUrl, "https://example.test/p1/onepager.pdf?sig=1");
    assert.equal(h.sent[0].attachmentUrl, res.attachmentUrl);
    assert.ok(h.sent[0].message.text.includes("3 of 15"), "figures come from the audit summary");
    assert.equal(h.getState().audit?.mentions, 3);
    assert.equal(h.getState().next_touch, 4);
  }

  // Cached audit is reused: no second build
  {
    const h = harness({ state: baseState({ next_touch: 3, audit: AUDIT, onepager_path: "p1/onepager.pdf" }) });
    await makeExecute(h.ports)(item(3), "live");
    assert.equal(h.log.builds, 0);
    assert.equal(h.sent.length, 1);
  }

  // Touch 3 audit failure: held, nothing sent; third failure pauses the sequence
  {
    const h = harness({ state: baseState({ next_touch: 3 }), buildFails: true });
    const ex = makeExecute(h.ports);
    const r1 = await ex(item(3), "live");
    assert.equal(r1.status, "held");
    assert.equal(r1.attempts, 1);
    const r2 = await ex(item(3), "live");
    assert.equal(r2.attempts, 2);
    assert.equal(h.getState().state, "active");
    const r3 = await ex(item(3), "live");
    assert.equal(r3.attempts, 3);
    assert.equal(h.getState().state, "paused");
    assert.ok(h.getState().pause_reason?.includes("pdf upload failed"));
    assert.equal(h.sent.length, 0, "touch 3 is never sent bare");
    assert.equal((await ex(item(3), "live")).status, "skipped", "paused sequences are skipped");
  }

  // Touch 2 (and 4): WhatsApp only with a phone and WhatsApp enabled, otherwise email; touch 2 needs no audit
  {
    const withWa = harness({ state: baseState({ next_touch: 2 }), phone: "+919800000000", whatsapp: true });
    await makeExecute(withWa.ports)(item(2), "live");
    assert.equal(withWa.sent[0].channel, "WhatsApp");
    assert.equal(withWa.log.builds, 0, "touch 2 does not trigger the paid audit");
    // Without WhatsApp, touch 2 is skipped and the sequence moves on to touch 3 on its own date (13 Nov 2026).
    const noWa = harness({ state: baseState({ next_touch: 2 }), phone: "+919800000000", whatsapp: false });
    const skipped = await makeExecute(noWa.ports)(item(2), "live");
    assert.equal(skipped.status, "skipped");
    assert.equal(noWa.sent.length, 0, "touch 2 is never sent as an email");
    assert.equal(noWa.getState().next_touch, 3);
    assert.equal(noWa.getState().state, "active");
    const dry = harness({ state: baseState({ next_touch: 2 }), phone: "+919800000000", whatsapp: false });
    assert.equal((await makeExecute(dry.ports)(item(2), "dry_run")).status, "skipped");
    assert.equal(dry.getState().next_touch, 2, "a dry run never advances");
    const t4 = harness({ state: baseState({ next_touch: 4, audit: AUDIT, onepager_path: "p1/onepager.pdf" }), phone: "+919800000000", whatsapp: true });
    await makeExecute(t4.ports)(item(4), "live");
    assert.equal(t4.sent[0].channel, "WhatsApp");
    assert.ok(t4.sent[0].message.text.includes("3 of 15"), "touch 4 quotes the audit");
  }

  // GHL send failure: held with attempt count, contact id not lost, sequence not advanced
  {
    const h = harness({ sendFails: true });
    const r = await makeExecute(h.ports)(item(1), "live");
    assert.equal(r.status, "held");
    assert.equal(r.attempts, 1);
    assert.equal(h.getState().next_touch, 1);
    assert.equal(h.getState().touches.length, 0);
  }

  // Touch 5 completes the sequence
  {
    const h = harness({ state: baseState({ next_touch: 5 }) });
    const r = await makeExecute(h.ports)(item(5), "live");
    assert.equal(r.status, "sent");
    assert.equal(h.getState().state, "completed");
    assert.equal(h.getState().next_touch, 6);
  }

  console.log("test-day10-execute: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

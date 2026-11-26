// Offline checks for WhatsApp replies (Build day 14, 26 Nov 2026): the webhook's locks, reading Meta's messages,
// and what each kind of reply does. Nothing reaches Meta, Slack or the database.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { handleDeliveryFailure, handleWhatsAppMessage, NOT_NOW_REPLY, OPT_OUT_REPLY, parseWebhook, reportCaption, verifyMetaSignature, waIntent, type InboundMessage, type WaProspect, type WaReplyPorts } from "./agents/outreach-sequencer/whatsapp-replies.js";
import { createApp } from "./app.js";
import { setWhatsAppPortsForTests } from "./routes/whatsapp-webhook.js";
import * as webhook from "./routes/whatsapp-webhook.js";
import { uploadMedia, sendDocument } from "./agents/whatsapp/graph.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;
const CHECK = { visibility_percent: 0, mentions: 0, total_queries: 15, mentions_by_engine: { gemini: 0, chatgpt: 0, perplexity: 0 }, top_competitors: ["Fortis Mohali"], top_cited_domains: ["justdial.com"], audited_at: "2026-11-25T05:30:00Z", weakest_competitor: "Fortis Mohali", competitor_mentions: { "Fortis Mohali": 10 } };

function biz(over: Partial<WaProspect> = {}): WaProspect {
  return { id: "p1", company: "Shivalik Hospital | Best in Mohali", website: "https://shivalik.example", city: "Chandigarh Tricity", category: "hospitals", status: "reviewed", door: "aeo", fit_score: 80, decision_maker: { email: "", phone: "098765 43210" }, signals: { preaudit: CHECK as any, whatsapp: { first_touch_at: "2026-11-26T06:00:00Z" } }, ...over };
}
function msg(text: string, over: Partial<InboundMessage> = {}): InboundMessage {
  return { id: `wamid.${Math.random()}`, from: "919876543210", at: "2026-11-26T08:00:00Z", type: "text", text, ...over };
}

function fakePorts(p: WaProspect | null, over: Partial<WaReplyPorts> = {}) {
  const log = { saved: [] as any[], texts: [] as any[], reports: [] as any[], notes: [] as string[], replied: 0, events: [] as any[] };
  let current = p ? JSON.parse(JSON.stringify(p)) : null;
  const ports: WaReplyPorts = {
    now: () => new Date("2026-11-26T08:01:00Z"),
    findByMobile: async (from) => (current && from === "919876543210" ? current : null),
    saveWhatsApp: async (_id, patch) => { log.saved.push(patch); current.signals = { ...current.signals, whatsapp: { ...(current.signals.whatsapp || {}), ...patch } }; },
    sendText: async (to, text) => { log.texts.push({ to, text }); return { messageId: "t1" }; },
    sendReport: async (to, prospect, audit, caption) => { log.reports.push({ to, company: prospect.company, mentions: audit.mentions, caption }); return { messageId: "d1" }; },
    notify: async (text) => void log.notes.push(text),
    replied: async () => void log.replied++,
    record: async (e) => void log.events.push(e),
    bookingLink: "https://ops.example/book",
    ...over,
  };
  return { ports, log };
}

async function main() {
  // Signature.
  const raw = Buffer.from('{"entry":[]}');
  const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, sig, "s3cret"), true);
  assert.equal(verifyMetaSignature(raw, sig, "other"), false);
  assert.equal(verifyMetaSignature(raw, undefined, "s3cret"), false);
  assert.equal(verifyMetaSignature(raw, sig, ""), false, "no secret: never trusted");

  // Reading Meta's body: text, the template's button, interactive, and failed deliveries.
  const body = { entry: [{ changes: [{ value: {
    messages: [
      { id: "m1", from: "919876543210", timestamp: "1764144000", type: "text", text: { body: "What does it cost?" } },
      { id: "m2", from: "919876543210", timestamp: "1764144001", type: "button", button: { text: "Yes, send it", payload: "Yes, send it" } },
      { id: "m3", from: "919876543210", timestamp: "1764144002", type: "interactive", interactive: { button_reply: { title: "Not now" } } },
      { id: "m4", from: "919876543210", type: "image", image: { id: "x" } },
    ],
    statuses: [{ status: "read", recipient_id: "91" }, { status: "failed", recipient_id: "919876543210", errors: [{ title: "Message undeliverable" }] }],
  } }] }] };
  const parsed = parseWebhook(body);
  assert.deepEqual(parsed.messages.map((m) => [m.id, m.type, m.text]), [["m1", "text", "What does it cost?"], ["m2", "button", "Yes, send it"], ["m3", "interactive", "Not now"], ["m4", "image", ""]]);
  assert.equal(parsed.messages[0].at, "2025-11-26T08:00:00.000Z");
  assert.deepEqual(parsed.failures, [{ to: "919876543210", reason: "Message undeliverable" }]);
  assert.deepEqual(parseWebhook({}), { messages: [], failures: [] });

  // Intents.
  const intent = (t: string) => waIntent(msg(t));
  for (const t of ["Yes, send it", "yes", "YES!", "Haan", "ok", "send it"]) assert.equal(intent(t), "yes", t);
  assert.equal(intent("Not now"), "not_now");
  for (const t of ["STOP", "stop", "Unsubscribe", "please remove me from your list"]) assert.equal(intent(t), "opt_out", t);
  assert.equal(intent("What does it cost?"), "other");
  assert.equal(intent("yes but how much does it cost?"), "other", "a question with yes in it is a question");
  assert.equal(waIntent(msg("", { type: "image" })), "media");

  // YES: the report goes out once, the deal moves, #revenue hears.
  {
    const { ports, log } = fakePorts(biz());
    assert.equal(await handleWhatsAppMessage(msg("Yes, send it"), ports), "report_sent");
    assert.equal(log.reports.length, 1);
    assert.equal(log.reports[0].to, "919876543210");
    assert.equal(log.reports[0].caption, "Here is the one-page result for Shivalik Hospital: the questions we asked and what each assistant said. If it helps, I can take you through it in 20 minutes: https://ops.example/book");
    assert.equal(log.replied, 1);
    assert.ok(log.saved.some((s) => s.report_sent_at));
    assert.ok(log.notes[0].startsWith("*WhatsApp: Shivalik Hospital said YES.*"));
    assert.deepEqual(log.events.map((e) => e.kind), ["reply", "sent"]);
    assert.equal(await handleWhatsAppMessage(msg("yes"), ports), "report_already_sent");
    assert.equal(log.reports.length, 1, "never sent twice");
  }
  // The same message twice is handled once.
  {
    const { ports, log } = fakePorts(biz());
    const m = msg("Yes, send it");
    await handleWhatsAppMessage(m, ports);
    assert.equal(await handleWhatsAppMessage(m, ports), "duplicate");
    assert.equal(log.reports.length, 1);
  }
  // No stored check: nothing invented, the Architect is asked.
  {
    const { ports, log } = fakePorts(biz({ signals: { whatsapp: { first_touch_at: "x" } } }));
    assert.equal(await handleWhatsAppMessage(msg("yes"), ports), "report_missing");
    assert.equal(log.reports.length, 0);
    assert.match(log.notes[0], /no stored AI check/);
  }
  // A failed report send says why in one line.
  {
    const { ports, log } = fakePorts(biz(), { sendReport: async () => { throw new Error('HTTP 400: {"error":{"message":"Re-engagement message"}}'); } });
    assert.equal(await handleWhatsAppMessage(msg("yes"), ports), "report_failed");
    assert.match(log.notes[0], /could not be sent \(Re-engagement message\)/);
    assert.ok(!log.saved.some((s) => s.report_sent_at), "not marked as sent");
  }
  // Not now and STOP.
  {
    const { ports, log } = fakePorts(biz());
    assert.equal(await handleWhatsAppMessage(msg("Not now"), ports), "not_now");
    assert.deepEqual(log.texts, [{ to: "919876543210", text: NOT_NOW_REPLY }]);
    assert.equal(log.replied, 0, "Not now is not a deal");
  }
  {
    const { ports, log } = fakePorts(biz());
    assert.equal(await handleWhatsAppMessage(msg("STOP"), ports), "opted_out");
    assert.deepEqual(log.texts, [{ to: "919876543210", text: OPT_OUT_REPLY }]);
    assert.ok(log.saved.some((s) => s.opted_out === true));
    assert.equal(await handleWhatsAppMessage(msg("Actually yes send it"), ports), "after_opt_out");
    assert.equal(log.reports.length, 0, "nothing sent after an opt-out");
  }
  // A question goes to #revenue with the text; nothing automatic is sent.
  {
    const { ports, log } = fakePorts(biz());
    assert.equal(await handleWhatsAppMessage(msg("What does it cost?"), ports), "routed");
    assert.equal(log.texts.length + log.reports.length, 0);
    assert.equal(log.replied, 1);
    assert.equal(log.notes[0], '*WhatsApp reply from Shivalik Hospital*, Chandigarh Tricity: "What does it cost?"\nThey are in Replied on the pipeline. Answer from the WhatsApp app on your phone within 24 hours.');
    assert.ok(!EMOJI.test(log.notes.join(" ")));
  }
  // An unknown number: shown with only its last 4 digits; nothing sent back.
  {
    const { ports, log } = fakePorts(null);
    assert.equal(await handleWhatsAppMessage(msg("hello"), ports), "unknown_sender");
    assert.ok(log.notes[0].includes("ending 3210") && !log.notes[0].includes("9876543210"));
    assert.equal(log.texts.length, 0);
  }
  // Failed delivery is recorded.
  {
    const { ports, log } = fakePorts(biz());
    await handleDeliveryFailure({ to: "919876543210", reason: "Message undeliverable" }, ports);
    assert.equal(log.events[0].summary, "WhatsApp message to Shivalik Hospital was not delivered: Message undeliverable.");
  }
  assert.ok(!reportCaption("X").includes("undefined"));

  // The route: verification, signature lock, and handling after the 200.
  const env = { ...process.env };
  process.env.WHATSAPP_VERIFY_TOKEN = "vt";
  const server = createApp("x").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/whatsapp/webhook`;
  try {
    const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "12345");
    assert.equal((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);

    const payload = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "r1", from: "919876543210", timestamp: "1764144000", type: "text", text: { body: "Not now" } }] } }] }] });
    delete process.env.WHATSAPP_APP_SECRET;
    assert.equal((await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: payload })).status, 503, "no secret: refused");
    process.env.WHATSAPP_APP_SECRET = "s3cret";
    assert.equal((await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" }, body: payload })).status, 401);
    const { ports, log } = fakePorts(biz());
    setWhatsAppPortsForTests(async () => ports);
    const good = `sha256=${createHmac("sha256", "s3cret").update(payload).digest("hex")}`;
    const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": good }, body: payload });
    assert.equal(r.status, 200);
    await webhook.lastProcessing;
    assert.deepEqual(log.texts, [{ to: "919876543210", text: NOT_NOW_REPLY }]);
  } finally {
    server.close();
    setWhatsAppPortsForTests(null);
    process.env = env;
  }

  // Media upload and document send reach Meta in the right shape.
  const calls: any[] = [];
  const fake: any = async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(url.endsWith("/media") ? { id: "media1" } : { messages: [{ id: "wamid.d" }] }), { status: 200 }); };
  const ctx = { token: "t", businessId: "b", graph: "https://graph.example/v23.0", fetchImpl: fake };
  assert.equal(await uploadMedia(ctx, "PN", Buffer.from("%PDF-1.4"), "application/pdf", "r.pdf"), "media1");
  assert.ok(calls[0].init.body instanceof FormData);
  const sent = await sendDocument(ctx, "PN", "919876543210", "media1", "r.pdf", "caption");
  assert.equal(sent.messageId, "wamid.d");
  assert.deepEqual(JSON.parse(calls[1].init.body).document, { id: "media1", filename: "r.pdf", caption: "caption" });

  console.log("test-whatsapp-replies: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });

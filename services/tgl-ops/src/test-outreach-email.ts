// services/tgl-ops/src/test-outreach-email.ts
// Offline checks for outreach email through the service's own provider (13 Nov 2026 decision): sending,
// the signed webhook, replies, bounces, complaints, the unsubscribe link, and the live runtime with
// OUTREACH_EMAIL_VIA=resend. No network and no credentials: the provider is a fake fetch, the store is in
// memory, Slack is captured. Binds an ephemeral localhost port only.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import {
  addressOf,
  createResendSender,
  emailConfigIssues,
  fetchReceivedEmail,
  loadEmailConfig,
  stripQuotedReply,
  unsubscribeToken,
  unsubscribeTokenValid,
  unsubscribeUrl,
  verifySvixSignature,
} from "./agents/outreach-sequencer/email.js";
import type { GhlClient } from "./agents/outreach-sequencer/ghl.js";
import { buildInboundDeps, createOutreachRuntime } from "./agents/outreach-sequencer/live.js";
import { createMemoryStore, getOutreachState, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import type { AuditSummary, OutreachState } from "./agents/outreach-sequencer/types.js";
import { setOutreachInboundDeps } from "./routes/outreach.js";

const WEBHOOK_SECRET = `whsec_${Buffer.from("outreach-email-test-key").toString("base64")}`;
const LINK_SECRET = "outreach-email-link-secret";
const ENV: NodeJS.ProcessEnv = {
  OUTREACH_EMAIL_VIA: "resend",
  RESEND_API_KEY: "re_test",
  OUTREACH_EMAIL_FROM: "Tejinder Singh <tejinder@team.example.test>",
  OUTREACH_FORWARD_REPLIES_TO: "architect@example.test",
  RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
  OUTREACH_WEBHOOK_SECRET: LINK_SECRET,
  OUTREACH_PUBLIC_URL: "https://ops.example.test/",
  OUTREACH_BOOKING_LINK: "https://example.test/book",
};

// 2026-03-09 is a Monday. 10:00 IST = 04:30 UTC.
const MON_1000_IST = new Date("2026-03-09T04:30:00Z");

const AUDIT = {
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

function prospect(id: string, over: { nextTouch?: number; email?: string; touches?: unknown[] } = {}): OutreachProspect {
  const state = {
    state: "active",
    enrolled_at: "2026-03-09T00:00:00.000Z",
    next_touch: over.nextTouch ?? 1,
    next_due_at: "2026-03-09T00:00:00.000Z",
    touches: over.touches ?? [],
    audit_attempts: 0,
    send_failures: 0,
    audit: AUDIT,
    onepager_path: "tgl/fixture/onepager.pdf",
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
    decision_maker: { name: "Asha Rao", email: over.email ?? "asha@brightsmile.example" },
    signals: { outreach: state },
  } as unknown as OutreachProspect;
}

interface Call {
  url: string;
  method: string;
  body: any;
}

/** Fake provider: records every request; answers sends, received-email reads and the one-pager download. */
function fakeProvider(received: Record<string, unknown> = {}, opts: { failSend?: boolean } = {}) {
  const calls: Call[] = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith("/emails") && method === "POST") {
      if (opts.failSend) return new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 });
      return new Response(JSON.stringify({ id: `re-${calls.filter((c) => c.url.endsWith("/emails")).length}` }), { status: 200 });
    }
    const m = /\/emails\/receiving\/([^/?]+)$/.exec(url);
    if (m) {
      const hit = received[decodeURIComponent(m[1])];
      return hit ? new Response(JSON.stringify(hit), { status: 200 }) : new Response("{}", { status: 404 });
    }
    if (url.startsWith("https://storage.example.test/")) return new Response(Buffer.from("%PDF-1.4 fixture"), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls, sends: () => calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST") };
}

function sign(body: string, secret = WEBHOOK_SECRET, at = new Date(), id = "msg_test") {
  const ts = String(Math.floor(at.getTime() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
}

async function main() {
  // ---- addresses and configuration -------------------------------------------------------------
  assert.equal(addressOf("Tejinder Singh <Tejinder@Team.Example.Test>"), "tejinder@team.example.test");
  assert.equal(addressOf("asha@brightsmile.example"), "asha@brightsmile.example");
  assert.equal(addressOf("not an address"), "");

  const cfg = loadEmailConfig(ENV);
  assert.equal(cfg.via, "resend");
  assert.equal(cfg.replyTo, "tejinder@team.example.test", "reply-to defaults to the sender address");
  assert.equal(cfg.publicUrl, "https://ops.example.test");
  assert.deepEqual(emailConfigIssues(cfg), []);
  assert.equal(loadEmailConfig({}).via, "ghl", "GoHighLevel stays the carrier until the variable is set");
  assert.equal(loadEmailConfig({ RAILWAY_PUBLIC_DOMAIN: "svc.up.railway.app" }).publicUrl, "https://svc.up.railway.app");
  assert.equal(emailConfigIssues(loadEmailConfig({ OUTREACH_EMAIL_VIA: "resend" })).length, 4, "every missing piece is named");

  // ---- unsubscribe token -----------------------------------------------------------------------
  const token = unsubscribeToken("p1", LINK_SECRET);
  assert.equal(unsubscribeTokenValid("p1", token, LINK_SECRET), true);
  assert.equal(unsubscribeTokenValid("p2", token, LINK_SECRET), false, "a token works for one prospect only");
  assert.equal(unsubscribeTokenValid("p1", token, "other-secret"), false);
  assert.equal(unsubscribeTokenValid("p1", "", LINK_SECRET), false);
  assert.equal(unsubscribeUrl("p1", cfg), `https://ops.example.test/outreach/unsubscribe?p=p1&t=${token}`);
  assert.equal(unsubscribeUrl("p1", { publicUrl: "", unsubscribeSecret: LINK_SECRET }), undefined);

  // ---- webhook signature -----------------------------------------------------------------------
  {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
    const now = new Date("2026-03-09T04:30:00Z");
    const h = sign(body, WEBHOOK_SECRET, now);
    const headers = { id: h["svix-id"], timestamp: h["svix-timestamp"], signature: h["svix-signature"] };
    assert.equal(verifySvixSignature(body, headers, WEBHOOK_SECRET, now), true);
    assert.equal(verifySvixSignature(`${body} `, headers, WEBHOOK_SECRET, now), false, "a changed body fails");
    assert.equal(verifySvixSignature(body, headers, `whsec_${Buffer.from("another-key").toString("base64")}`, now), false);
    assert.equal(verifySvixSignature(body, headers, WEBHOOK_SECRET, new Date(now.getTime() + 6 * 60 * 1000)), false, "a stale timestamp fails");
    assert.equal(verifySvixSignature(body, { ...headers, signature: `v1,AAAA ${headers.signature}` }, WEBHOOK_SECRET, now), true, "any listed signature may match");
    assert.equal(verifySvixSignature(body, { ...headers, signature: headers.signature.replace("v1,", "v2,") }, WEBHOOK_SECRET, now), false);
    assert.equal(verifySvixSignature(body, { id: headers.id, timestamp: headers.timestamp }, WEBHOOK_SECRET, now), false);
    assert.equal(verifySvixSignature(body, headers, "", now), false);
  }

  // ---- quoted history is dropped before intent is read -----------------------------------------
  assert.equal(
    stripQuotedReply("Yes, send it over.\n\nOn Mon, 9 Mar 2026 at 10:02, Tejinder Singh <t@x.test> wrote:\n> Reply STOP and I will not write again."),
    "Yes, send it over."
  );
  assert.equal(stripQuotedReply("Sounds good\n\n-----Original Message-----\nFrom: Tejinder\nReply STOP"), "Sounds good");
  assert.equal(stripQuotedReply("Thanks.\n> quoted\n> Reply STOP\nSee you Thursday"), "Thanks.\nSee you Thursday");
  assert.equal(stripQuotedReply("STOP"), "STOP");

  // ---- sending ---------------------------------------------------------------------------------
  {
    const p = fakeProvider();
    const sender = createResendSender(cfg, p.impl);
    const sent = await sender.send({
      prospectId: "p1",
      to: "Asha Rao <asha@brightsmile.example>",
      subject: "Your AI visibility report",
      text: "Hello Asha,\n\nLine two.\nLine three.",
      attachmentUrl: "https://storage.example.test/tgl/onepager.pdf?token=t",
      attachmentFilename: "Bright-Smile-Dental-ai-visibility-report.pdf",
    });
    assert.equal(sent.messageId, "re-1", "the message id comes from the provider's response");
    const body = p.sends()[0].body;
    assert.equal(body.from, "Tejinder Singh <tejinder@team.example.test>");
    assert.deepEqual(body.to, ["asha@brightsmile.example"]);
    assert.equal(body.reply_to, "tejinder@team.example.test");
    assert.equal(body.html, "<p>Hello Asha,</p>\n<p>Line two.<br>Line three.</p>", "plain paragraphs, no tracking pixel");
    assert.ok(body.headers["List-Unsubscribe"].includes("<mailto:tejinder@team.example.test?subject=STOP>"));
    assert.ok(body.headers["List-Unsubscribe"].includes(`<https://ops.example.test/outreach/unsubscribe?p=p1&t=${token}>`));
    assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.equal(body.attachments.length, 1);
    assert.equal(body.attachments[0].filename, "Bright-Smile-Dental-ai-visibility-report.pdf");
    assert.equal(Buffer.from(body.attachments[0].content, "base64").toString(), "%PDF-1.4 fixture", "the PDF is attached as a file, not linked");
    assert.equal(JSON.stringify(body).includes("storage.example.test"), false, "the signed storage URL never reaches the prospect");

    await assert.rejects(() => sender.send({ prospectId: "p1", to: "", subject: "s", text: "t" }), /no valid work email/);
    assert.equal(p.sends().length, 1, "nothing is sent without an address");

    const failing = fakeProvider({}, { failSend: true });
    await assert.rejects(() => createResendSender(cfg, failing.impl).send({ prospectId: "p1", to: "a@b.example", subject: "s", text: "t" }), /HTTP 403/);
  }

  // ---- reading a received email ----------------------------------------------------------------
  {
    const p = fakeProvider({
      e1: { id: "e1", from: "Asha Rao <ASHA@brightsmile.example>", to: ["tejinder@team.example.test"], subject: "Re: report", text: null, html: "<p>Yes please</p><p>&gt; old line</p>", message_id: "<m1@mail>", headers: {} },
      e2: { id: "e2", from: "asha@brightsmile.example", to: ["tejinder@team.example.test"], subject: "Automatic reply", text: "I am away until Monday.", headers: { "Auto-Submitted": "auto-replied" } },
    });
    const one = await fetchReceivedEmail("e1", cfg, p.impl);
    assert.equal(one.from, "asha@brightsmile.example");
    assert.equal(one.text, "Yes please", "html is used when there is no text part, and quoted lines are dropped");
    assert.equal(one.messageId, "<m1@mail>");
    assert.equal(one.automated, false);
    assert.equal((await fetchReceivedEmail("e2", cfg, p.impl)).automated, true);
    await assert.rejects(() => fetchReceivedEmail("missing", cfg, p.impl), /HTTP 404/);
  }

  // ---- live runtime: email leaves from this service, GoHighLevel is never touched --------------
  {
    const store = createMemoryStore([prospect("p1", { nextTouch: 3 })]);
    const p = fakeProvider();
    let ghlCalls = 0;
    const ghl = {
      async upsertContact() {
        ghlCalls++;
        return { contactId: "x" };
      },
      async sendMessage() {
        ghlCalls++;
        return { messageId: "x" };
      },
      async addTags() {
        ghlCalls++;
      },
      async addNote() {
        ghlCalls++;
      },
    } as GhlClient;
    const runtime = createOutreachRuntime({
      env: { ...ENV, OUTREACH_LIVE: "1" },
      now: () => MON_1000_IST,
      store,
      ghl,
      fetchImpl: p.impl,
      alert: async () => undefined,
      writeLog: async () => undefined,
      audit: async () => AUDIT,
      storeOnePager: async () => "tgl/bright-smile/onepager.pdf",
      signUrl: async (path) => `https://storage.example.test/${path}?token=t`,
    });
    assert.deepEqual(runtime.preflight(), [], "live with own email needs no GHL key");
    const result = await runtime.tick();
    assert.equal(result.summary?.outcomes[0]?.result.status, "sent");
    assert.equal(ghlCalls, 0, "no GHL contact, no GHL message");
    assert.equal(p.sends().length, 1);
    assert.deepEqual(p.sends()[0].body.to, ["asha@brightsmile.example"]);
    assert.equal(p.sends()[0].body.attachments.length, 1, "touch 3 carries the one-pager");
    assert.equal(p.sends()[0].body.attachments[0].filename, "Bright-Smile-Dental-ai-visibility-report.pdf");
    const state = getOutreachState(store.rows[0])!;
    assert.equal(state.next_touch, 4, "the sequence advanced");
    assert.equal(state.touches.at(-1)?.message_id, "re-1");
    assert.equal(state.touches.at(-1)?.via, "resend");
    assert.equal(state.ghl_contact_id, undefined, "no empty GHL contact id is stored");
  }

  // A provider refusal holds the touch; nothing is recorded as sent.
  {
    const store = createMemoryStore([prospect("p1")]);
    const p = fakeProvider({}, { failSend: true });
    const runtime = createOutreachRuntime({
      env: { ...ENV, OUTREACH_LIVE: "1" },
      now: () => MON_1000_IST,
      store,
      fetchImpl: p.impl,
      alert: async () => undefined,
      writeLog: async () => undefined,
      audit: async () => AUDIT,
      storeOnePager: async () => "x.pdf",
      signUrl: async (path) => `https://storage.example.test/${path}`,
    });
    const result = await runtime.tick();
    assert.equal(result.summary?.outcomes[0]?.result.status, "held");
    assert.ok(/send failed: Resend send failed: HTTP 403/.test(result.summary?.outcomes[0]?.result.reason || ""));
    const state = getOutreachState(store.rows[0])!;
    assert.equal(state.next_touch, 1);
    assert.equal(state.touches.filter((t) => !t.dry_run).length, 0);
    assert.equal(state.send_failures, 1);
  }

  // Dry run sends nothing through the provider.
  {
    const store = createMemoryStore([prospect("p1")]);
    const p = fakeProvider();
    const runtime = createOutreachRuntime({
      env: { ...ENV },
      now: () => MON_1000_IST,
      store,
      fetchImpl: p.impl,
      alert: async () => undefined,
      writeLog: async () => undefined,
      audit: async () => AUDIT,
      storeOnePager: async () => "x.pdf",
      signUrl: async (path) => `https://storage.example.test/${path}`,
    });
    const result = await runtime.tick();
    assert.equal(result.summary?.mode, "dry_run");
    assert.equal(p.calls.length, 0, "a dry run makes no provider request at all");
  }

  // Live preflight names what is missing; with WhatsApp on, GHL is still required for that channel.
  {
    const store = createMemoryStore([]);
    const base = { now: () => MON_1000_IST, store, alert: async () => undefined, writeLog: async () => undefined };
    const missing = createOutreachRuntime({ ...base, env: { OUTREACH_LIVE: "1", OUTREACH_EMAIL_VIA: "resend", OUTREACH_BOOKING_LINK: "https://example.test/book" } }).preflight();
    assert.ok(missing.some((i) => i.includes("RESEND_API_KEY")));
    assert.ok(missing.some((i) => i.includes("RESEND_WEBHOOK_SECRET")));
    assert.equal(missing.some((i) => i.includes("GHL_API_KEY")), false);
    const withWa = createOutreachRuntime({ ...base, env: { ...ENV, OUTREACH_LIVE: "1", GHL_WA_PHONE_ID: "wa-1" } }).preflight();
    assert.ok(withWa.some((i) => i.includes("GHL_API_KEY")));
    const viaGhl = createOutreachRuntime({ ...base, env: { OUTREACH_LIVE: "1", OUTREACH_BOOKING_LINK: "https://example.test/book" } }).preflight();
    assert.ok(viaGhl.some((i) => i.includes("GHL_API_KEY")), "unchanged when the variable is not set");
  }

  // ---- the webhook route and the unsubscribe link, on the real app ------------------------------
  const sentTouch = [{ n: 1, channel: "Email", sent_at: "2026-03-09T04:30:00.000Z", dry_run: false, via: "resend" }];
  const store = createMemoryStore([
    prospect("p-reply", { nextTouch: 2, touches: sentTouch, email: "asha@brightsmile.example" }),
    prospect("p-quoted", { nextTouch: 2, touches: sentTouch, email: "ravi@clinic.example" }),
    prospect("p-away", { nextTouch: 2, touches: sentTouch, email: "away@clinic.example" }),
    prospect("p-stop", { nextTouch: 2, touches: sentTouch, email: "stop@clinic.example" }),
    prospect("p-bounce", { nextTouch: 2, touches: sentTouch, email: "gone@clinic.example" }),
    prospect("p-spam", { nextTouch: 2, touches: sentTouch, email: "angry@clinic.example" }),
    prospect("p-unsub", { nextTouch: 2, touches: sentTouch, email: "unsub@clinic.example" }),
  ]);
  const byId = (id: string) => store.rows.find((r) => r.id === id)!;
  const provider = fakeProvider({
    "e-reply": { id: "e-reply", from: "Asha Rao <asha@brightsmile.example>", to: ["tejinder@team.example.test"], subject: "Re: Your AI visibility report", text: "Yes, interested. Can we talk Thursday?", message_id: "<r1@mail>", headers: {} },
    "e-quoted": { id: "e-quoted", from: "ravi@clinic.example", to: ["tejinder@team.example.test"], subject: "Re: report", text: "Please send the details.\n\nOn Mon, 9 Mar 2026, Tejinder Singh wrote:\n> Reply STOP and I will not write again.", message_id: "<r2@mail>", headers: {} },
    "e-away": { id: "e-away", from: "away@clinic.example", to: ["tejinder@team.example.test"], subject: "Automatic reply", text: "Thank you for your email. We will respond shortly.", message_id: "<r3@mail>", headers: { "auto-submitted": "auto-replied" } },
    "e-stop": { id: "e-stop", from: "stop@clinic.example", to: ["tejinder@team.example.test"], subject: "Re: report", text: "STOP", message_id: "<r4@mail>", headers: {} },
    "e-daemon": { id: "e-daemon", from: "MAILER-DAEMON@mx.example", to: ["tejinder@team.example.test"], subject: "Undelivered Mail Returned to Sender", text: "Delivery failed.", message_id: "<r5@mail>", headers: { "auto-submitted": "auto-generated" } },
    "e-stranger": { id: "e-stranger", from: "someone@elsewhere.example", to: ["tejinder@team.example.test"], subject: "Hello", text: "What do you charge?", message_id: "<r6@mail>", headers: {} },
  });
  const notes: string[] = [];
  const deps = { ...buildInboundDeps({ env: ENV, store, fetchImpl: provider.impl }), notify: async (_channel: string, text: string) => void notes.push(text) };
  assert.ok(deps.sender, "a sender is built for forwarding");
  assert.equal(deps.forwardTo, "architect@example.test");
  assert.equal(deps.ghl, undefined, "no GHL client is built for the inbound path");

  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.OUTREACH_WEBHOOK_SECRET = LINK_SECRET;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const event = (payload: unknown, headers?: Record<string, string>) => {
    const body = JSON.stringify(payload);
    return fetch(`${base}/outreach/resend-events`, { method: "POST", headers: { "content-type": "application/json", ...(headers || sign(body)) }, body });
  };
  const received = (emailId: string) => ({ type: "email.received", created_at: "2026-03-09T05:00:00.000Z", data: { email_id: emailId } });

  try {
    setOutreachInboundDeps(null);
    assert.equal((await event(received("e-reply"))).status, 503, "mounted, refuses until wired");

    setOutreachInboundDeps(deps);
    const bad = await event(received("e-reply"), { "svix-id": "msg_test", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" });
    assert.equal(bad.status, 401, "a bad signature is refused");
    assert.equal(getOutreachState(byId("p-reply"))!.state, "active", "and changes nothing");
    assert.equal(notes.length, 0);

    // A real reply: sequence stops, one card, forwarded to the Architect with Reply-To set to the prospect.
    const ok = await event(received("e-reply"));
    assert.equal(ok.status, 200);
    const okJson = (await ok.json()) as any;
    assert.equal(okJson.status, "routed");
    assert.equal(okJson.reply.intent, "meeting_request");
    assert.equal(okJson.forwarded, true);
    assert.equal(getOutreachState(byId("p-reply"))!.state, "replied");
    assert.equal(notes.length, 1);
    assert.ok(notes[0].startsWith("*Prospect reply: Bright Smile Dental*"));
    const fwd = provider.sends().at(-1)!.body;
    assert.deepEqual(fwd.to, ["architect@example.test"]);
    assert.equal(fwd.reply_to, "asha@brightsmile.example");
    assert.ok(fwd.text.includes("Yes, interested. Can we talk Thursday?"));

    // The provider retries: no second card, no second forward.
    const sendsBefore = provider.sends().length;
    const dup = await event(received("e-reply"));
    assert.equal(((await dup.json()) as any).status, "duplicate");
    assert.equal(notes.length, 1);
    assert.equal(provider.sends().length, sendsBefore);

    // Our own "Reply STOP" line in the quoted history is not read as the prospect opting out.
    const quoted = (await (await event(received("e-quoted"))).json()) as any;
    assert.equal(quoted.reply.intent, "positive_interest");
    assert.equal(getOutreachState(byId("p-quoted"))!.state, "replied");

    // An auto-reply defers the next touch; it does not end the sequence.
    const dueBefore = getOutreachState(byId("p-away"))!.next_due_at;
    const away = (await (await event(received("e-away"))).json()) as any;
    assert.equal(away.reply.intent, "out_of_office");
    assert.equal(getOutreachState(byId("p-away"))!.state, "active");
    assert.ok(getOutreachState(byId("p-away"))!.next_due_at > dueBefore);

    // STOP by email.
    const stop = (await (await event(received("e-stop"))).json()) as any;
    assert.equal(stop.reply.sequenceAction, "opted_out");
    assert.equal(getOutreachState(byId("p-stop"))!.state, "opted_out");
    assert.equal(byId("p-stop").status, "rejected");

    // Machine mail from an address we never wrote to is dropped; a person we do not know still reaches the desk.
    const notesBefore = notes.length;
    assert.equal(((await (await event(received("e-daemon"))).json()) as any).status, "ignored");
    assert.equal(notes.length, notesBefore);
    const stranger = (await (await event(received("e-stranger"))).json()) as any;
    assert.equal(stranger.status, "routed");
    assert.equal(stranger.matched, false);
    assert.ok(notes.at(-1)!.includes("*Prospect reply (unmatched)*"));
    assert.ok(notes.at(-1)!.includes("From: someone@elsewhere.example"));
    assert.equal(notes.at(-1)!.includes("GHL contact"), false);

    // Bounce pauses; complaint ends for good.
    const bounce = (await (await event({ type: "email.bounced", data: { email_id: "s1", to: ["gone@clinic.example"] } })).json()) as any;
    assert.equal(bounce.status, "bounced");
    assert.equal(getOutreachState(byId("p-bounce"))!.state, "paused");
    assert.ok(getOutreachState(byId("p-bounce"))!.pause_reason!.includes("bounced"));
    assert.ok(notes.at(-1)!.startsWith("*Outreach paused: Bright Smile Dental*"));
    const cardsAfterBounce = notes.length;
    assert.equal(((await (await event({ type: "email.bounced", data: { email_id: "s1", to: ["gone@clinic.example"] } })).json()) as any).status, "duplicate");
    assert.equal(notes.length, cardsAfterBounce, "a repeated bounce posts nothing");

    const spam = (await (await event({ type: "email.complained", data: { email_id: "s2", to: ["angry@clinic.example"] } })).json()) as any;
    assert.equal(spam.status, "complained");
    assert.equal(getOutreachState(byId("p-spam"))!.state, "opted_out");
    assert.equal(byId("p-spam").status, "rejected");

    assert.equal(((await (await event({ type: "email.delivered", data: { email_id: "s3", to: ["asha@brightsmile.example"] } })).json()) as any).status, "ignored");
    assert.equal(((await (await event({ type: "email.bounced", data: { email_id: "s4", to: ["nobody@unknown.example"] } })).json()) as any).status, "ignored");

    // Unsubscribe link: opening it changes nothing; confirming it stops the sequence, once.
    const link = `${base}/outreach/unsubscribe?p=p-unsub&t=${unsubscribeToken("p-unsub", LINK_SECRET)}`;
    const view = await fetch(link);
    assert.equal(view.status, 200);
    assert.ok((await view.text()).includes("Stop emails"));
    assert.equal(getOutreachState(byId("p-unsub"))!.state, "active", "a scanner opening the link does not unsubscribe anyone");

    const forged = await fetch(`${base}/outreach/unsubscribe?p=p-reply&t=${unsubscribeToken("p-unsub", LINK_SECRET)}`, { method: "POST" });
    assert.equal(forged.status, 403, "a token cannot be reused for another prospect");

    const cardsBefore = notes.length;
    const done = await fetch(link, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    assert.equal(done.status, 200);
    assert.ok((await done.text()).includes("We will not write to you again."));
    assert.equal(getOutreachState(byId("p-unsub"))!.state, "opted_out");
    assert.equal(byId("p-unsub").status, "rejected");
    assert.equal(notes.length, cardsBefore + 1);
    await fetch(link, { method: "POST" });
    assert.equal(notes.length, cardsBefore + 1, "a second click posts nothing");

    for (const n of notes) assert.equal(/\p{Extended_Pictographic}/u.test(n), false, "no emojis");

    // No secret configured: refuse.
    delete process.env.RESEND_WEBHOOK_SECRET;
    assert.equal((await event(received("e-reply"))).status, 503);
  } finally {
    setOutreachInboundDeps(null);
    server.close();
  }

  console.log("test-outreach-email: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

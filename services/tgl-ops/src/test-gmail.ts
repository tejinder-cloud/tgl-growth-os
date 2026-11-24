// services/tgl-ops/src/test-gmail.ts
// Offline checks for outreach email through Gmail (24 Nov 2026): the MIME message, the send call, the
// warm-up cap, the runtime choosing Gmail, and the inbox poll (replies routed, personal mail ignored,
// bounces pause the sequence, nothing handled twice). No network: Gmail is a fake fetch, Slack is captured.
import assert from "node:assert/strict";
import { BOOKING_SCOPES } from "./agents/booking/google.js";
import { bouncedAddresses, buildMime, createGmailSender, encodeHeader, GMAIL_SCOPES, toBase64Url } from "./agents/gmail/gmail.js";
import { pollGmailInbox } from "./agents/gmail/inbox.js";
import { emailConfigIssues, loadEmailConfig } from "./agents/outreach-sequencer/email.js";
import { createMemoryStore, getOutreachState, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import type { OutreachState } from "./agents/outreach-sequencer/types.js";
import { dailyCap, sendDays } from "./agents/outreach-sequencer/worker.js";

const OWN = "calls.thegrowthlab@gmail.com";

function prospect(id: string, email: string, over: Partial<OutreachState> = {}): OutreachProspect {
  const state = { state: "active", enrolled_at: "2026-11-20T00:00:00.000Z", next_touch: 2, next_due_at: "2026-11-30T00:00:00.000Z", touches: [{ n: 1, sent_at: "2026-11-20T05:00:00.000Z" }], ...over } as unknown as OutreachState;
  return {
    id,
    tenant_id: "tgl",
    company: `Clinic ${id}`,
    website: "https://clinic.example",
    category: "dental_clinic",
    city: "Mohali",
    door: "aeo",
    status: "handed_to_outreach",
    fit_score: 80,
    fit_reasons: [],
    decision_maker: { name: "Owner", email },
    signals: { outreach: state },
  } as unknown as OutreachProspect;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

async function main() {
  // --- scopes: one sign-in covers calendar and Gmail ---
  for (const s of GMAIL_SCOPES) assert.ok(BOOKING_SCOPES.includes(s), `booking sign-in asks for ${s}`);
  assert.ok(BOOKING_SCOPES.includes("https://www.googleapis.com/auth/calendar.events"), "calendar scope kept");

  // --- MIME ---
  assert.equal(encodeHeader("Plain subject"), "Plain subject");
  assert.match(encodeHeader("Rapport: café"), /^=\?UTF-8\?B\?.+\?=$/);
  const plain = buildMime({ from: `Tejinder Singh <${OWN}>`, to: "a@b.example", subject: "Hi", text: "Hello\n\nThere", html: "<p>Hello</p>", headers: { "List-Unsubscribe": "<mailto:x@y.z>" } }, "seed");
  assert.match(plain, /\r\nContent-Type: multipart\/alternative; boundary="alt_seed"\r\n/);
  assert.match(plain, /List-Unsubscribe: <mailto:x@y\.z>/);
  assert.ok(plain.includes(Buffer.from("Hello\n\nThere").toString("base64")), "text part is base64 of the body");
  const withPdf = buildMime({ from: OWN, to: "a@b.example", subject: "Report", text: "t", html: "h", attachment: { filename: "r.pdf", bytes: Buffer.from("%PDF-1.4") } }, "s2");
  assert.match(withPdf, /multipart\/mixed; boundary="mix_s2"/);
  assert.match(withPdf, /Content-Disposition: attachment; filename="r\.pdf"/);
  assert.ok(withPdf.includes(Buffer.from("%PDF-1.4").toString("base64")));
  assert.ok(!toBase64Url("??>>").match(/[+/=]/), "base64url has no + / =");

  // --- sender ---
  const calls: { url: string; body?: any }[] = [];
  const fakeFetch = (async (url: any, init?: any) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.startsWith("https://files.example/")) return new Response(Buffer.from("%PDF-1.4 fake"), { status: 200 });
    if (u.endsWith("/messages/send")) return new Response(JSON.stringify({ id: "g-1", threadId: "t-1" }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const sender = createGmailSender({ from: `Tejinder Singh <${OWN}>`, publicUrl: "https://ops.example", unsubscribeSecret: "s" }, async () => "tok", fakeFetch);
  const sent = await sender.send({ prospectId: "p1", to: "Owner <owner@clinic.example>", subject: "Your AI visibility report: Clinic", text: "Hello", attachmentUrl: "https://files.example/x.pdf", attachmentFilename: "Clinic-report.pdf" });
  assert.equal(sent.messageId, "g-1");
  const raw = decodeRaw(calls.find((c) => c.url.endsWith("/messages/send"))!.body.raw);
  assert.match(raw, /^From: Tejinder Singh <calls\.thegrowthlab@gmail\.com>/m);
  assert.match(raw, /^To: owner@clinic\.example/m);
  assert.match(raw, /List-Unsubscribe: <mailto:calls\.thegrowthlab@gmail\.com\?subject=STOP>, <https:\/\/ops\.example\/outreach\/unsubscribe\?p=p1&t=/);
  assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.match(raw, /filename="Clinic-report\.pdf"/);
  await assert.rejects(() => createGmailSender({ from: OWN, publicUrl: "", unsubscribeSecret: "" }, async () => null, fakeFetch).send({ prospectId: "p", to: "a@b.example", subject: "s", text: "t" }), /not connected/);
  const denied = (async () => new Response(JSON.stringify({ error: { message: "Request had insufficient authentication scopes." } }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(() => createGmailSender({ from: OWN, publicUrl: "", unsubscribeSecret: "" }, async () => "tok", denied).send({ prospectId: "p", to: "a@b.example", subject: "s", text: "t" }), /Gmail permission missing: sign in again at \/book\/connect/);

  // --- config ---
  const gcfg = loadEmailConfig({ OUTREACH_EMAIL_VIA: "gmail", OUTREACH_WEBHOOK_SECRET: "x", OUTREACH_PUBLIC_URL: "https://ops.example" });
  assert.equal(gcfg.via, "gmail");
  assert.deepEqual(emailConfigIssues(gcfg), [], "Gmail needs no Resend key or webhook secret");
  assert.equal(loadEmailConfig({ OUTREACH_EMAIL_VIA: "resend" }).via, "resend");
  assert.equal(loadEmailConfig({}).via, "ghl");

  // --- warm-up cap and send days ---
  const ramp = { OUTREACH_DAILY_SEND_CAP: "5", OUTREACH_CAP_SCHEDULE: "2026-11-25=2, 2026-12-02=5", OUTREACH_SEND_DAYS: "1-6" };
  const at = (iso: string) => new Date(iso);
  assert.equal(dailyCap(ramp, at("2026-11-24T05:00:00Z")), 5, "before the ramp starts: the plain cap");
  assert.equal(dailyCap(ramp, at("2026-11-25T05:00:00Z")), 2, "week 1: 2 a day");
  assert.equal(dailyCap(ramp, at("2026-11-28T05:00:00Z")), 2, "Saturday still sends");
  assert.equal(dailyCap(ramp, at("2026-11-29T05:00:00Z")), 0, "Sunday: nothing");
  assert.equal(dailyCap(ramp, at("2026-12-02T05:00:00Z")), 5, "week 2: 5 a day");
  assert.equal(dailyCap(ramp, at("2026-11-24T19:00:00Z")), 2, "00:30 IST on the 25th already counts as the 25th");
  assert.equal(dailyCap({ OUTREACH_DAILY_SEND_CAP: "5" }), 5, "no schedule: unchanged behaviour");
  assert.equal(sendDays({ OUTREACH_SEND_DAYS: "1,3,5" })?.size, 3);
  assert.equal(sendDays({ OUTREACH_SEND_DAYS: "weekdays" }), null, "unreadable: every day");

  // --- bounce parsing ---
  const notice = "Address not found\nYour message wasn't delivered to owner@gone.example because the address couldn't be found.\nFrom: calls.thegrowthlab@gmail.com\nmailer-daemon@googlemail.com";
  assert.deepEqual(bouncedAddresses(notice, OWN), ["owner@gone.example"]);

  // --- inbox poll ---
  const store = createMemoryStore([prospect("p1", "owner@clinic.example"), prospect("p2", "owner@gone.example"), prospect("p3", "done@clinic.example", { state: "replied", last_reply_message_id: "<old@mail>", last_reply_at: "2026-11-24T06:00:00.000Z" } as any)]);
  const posts: string[] = [];
  const now = Date.parse("2026-11-24T07:00:00Z");
  const messages: Record<string, any> = {
    m1: { id: "m1", threadId: "t1", internalDate: String(now - 60_000), payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Owner <owner@clinic.example>" }, { name: "Subject", value: "Re: Your AI visibility" }, { name: "Message-ID", value: "<r1@mail>" }], parts: [{ mimeType: "text/plain", body: { data: b64url("Yes please, send the report.\n\nOn Mon, Tejinder wrote:\n> Reply STOP") } }] } },
    m2: { id: "m2", threadId: "t2", internalDate: String(now - 60_000), payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Friend <friend@personal.example>" }, { name: "Subject", value: "Dinner" }], body: { data: b64url("See you at 8") } } },
    m3: { id: "m3", threadId: "t3", internalDate: String(now - 60_000), payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }, { name: "Subject", value: "Delivery Status Notification (Failure)" }], body: { data: b64url(notice) } } },
    m4: { id: "m4", threadId: "t4", internalDate: String(Date.parse("2026-11-24T05:00:00Z")), payload: { mimeType: "text/plain", headers: [{ name: "From", value: "done@clinic.example" }, { name: "Message-ID", value: "<older@mail>" }], body: { data: b64url("Thanks") } } },
  };
  const gmailFetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/messages?")) return new Response(JSON.stringify({ messages: Object.keys(messages).map((id) => ({ id })) }), { status: 200 });
    const id = /\/messages\/([^?]+)\?format=full/.exec(u)?.[1];
    if (id && messages[id]) return new Response(JSON.stringify(messages[id]), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const seen = new Set<string>();
  const deps = { token: async () => "tok", ownAddress: OWN, store, fetchImpl: gmailFetch, seen, notify: async (_c: string, t: string) => void posts.push(t), salesDeskChannel: "#revenue", now: () => new Date(now) };

  const first = await pollGmailInbox(deps as any);
  assert.equal(first.connected, true);
  assert.equal(first.replies.length, 1, "only the prospect's reply is routed");
  assert.equal(first.replies[0].reply?.intent, "positive_interest", "intent read from their words, not the quoted email");
  assert.equal(getOutreachState(store.rows[0])?.state, "replied", "sequence stopped on reply");
  assert.equal(first.bounces.length, 1);
  assert.equal(getOutreachState(store.rows[1])?.state, "paused", "bounced address paused");
  assert.equal(getOutreachState(store.rows[2])?.last_reply_message_id, "<old@mail>", "an older message from a replied prospect is not routed again");
  assert.ok(!posts.some((p) => /friend@personal|Dinner|See you/.test(p)), "personal mail never reaches Slack");
  assert.equal(posts.filter((p) => /Prospect reply: Clinic p1/.test(p)).length, 1);
  assert.equal(posts.filter((p) => /bounced/.test(p)).length, 1);

  // Second poll in the same process: nothing new. After a restart (empty seen): still nothing posted twice.
  const before = posts.length;
  await pollGmailInbox(deps as any);
  await pollGmailInbox({ ...deps, seen: new Set<string>() } as any);
  assert.equal(posts.length, before, "nothing is posted twice, even after a restart");

  // Not connected: no calls, no posts.
  const off = await pollGmailInbox({ ...deps, token: async () => null } as any);
  assert.equal(off.connected, false);

  console.log("test-gmail: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

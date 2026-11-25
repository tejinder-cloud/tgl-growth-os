// services/tgl-ops/src/agents/gmail/gmail.ts
// Outreach email from the Architect's Gmail account (calls.thegrowthlab@gmail.com) through the Gmail API,
// replacing Resend for cold email (Resend's acceptable use policy forbids cold outreach; decision 24 Nov 2026).
// The same Google sign-in as the booking calendar carries the Gmail permissions, so one refresh token covers both.
// Sending builds a plain MIME message by hand; reading lists recent inbox mail so replies and bounces can be matched.
// fetch and node:crypto only; no new dependency.
import { randomBytes } from "node:crypto";
import { addressOf, textToHtml, unsubscribeUrl, type EmailSender, type OutreachEmail, type OutreachEmailConfig } from "../outreach-sequencer/email.js";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE];

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Returns a fresh access token for the connected Google account, or null when nothing is connected. */
export type TokenProvider = () => Promise<string | null>;

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

/** RFC 2047 encoded-word for a header value that is not plain ASCII. */
export function encodeHeader(value: string): string {
  const v = String(value || "").replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function b64(text: string | Buffer): string {
  return wrap76((typeof text === "string" ? Buffer.from(text, "utf8") : text).toString("base64"));
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface MimeInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  attachment?: { filename: string; bytes: Buffer; contentType?: string };
}

/** A complete RFC 2822 message: text and HTML alternatives, plus an optional attachment. CRLF line ends. */
export function buildMime(m: MimeInput, boundarySeed: string = randomBytes(8).toString("hex")): string {
  const alt = `alt_${boundarySeed}`;
  const mixed = `mix_${boundarySeed}`;
  const head = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    "MIME-Version: 1.0",
    ...Object.entries(m.headers || {}).map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]+/g, " ")}`),
  ];
  const alternative = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.text),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.html),
    `--${alt}--`,
  ];
  if (!m.attachment) {
    return [...head, `Content-Type: multipart/alternative; boundary="${alt}"`, "", ...alternative, ""].join("\r\n");
  }
  const name = m.attachment.filename.replace(/["\r\n]/g, "");
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    ...alternative,
    `--${mixed}`,
    `Content-Type: ${m.attachment.contentType || "application/pdf"}; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.attachment.bytes),
    `--${mixed}--`,
    "",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function gmailCall(token: string, path: string, fetchImpl: typeof fetch, init?: { method?: string; body?: unknown }): Promise<any> {
  const res = await fetchImpl(`${API}${path}`, {
    method: init?.method || "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(body?.error?.message || `HTTP ${res.status}`);
    if (res.status === 403 && /insufficient|scope|permission/i.test(msg)) {
      throw new Error(`Gmail permission missing: sign in again at /book/connect and allow sending and reading email (${msg})`);
    }
    if (res.status === 401) throw new Error(`Gmail sign-in expired: sign in again at /book/connect (${msg})`);
    throw new Error(`Gmail ${init?.method || "GET"} ${path.split("?")[0]} failed: ${msg}`);
  }
  return body;
}

export async function sendRaw(token: string, raw: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; threadId: string }> {
  const body = await gmailCall(token, "/messages/send", fetchImpl, { method: "POST", body: { raw: toBase64Url(raw) } });
  if (!body.id) throw new Error("Gmail send returned no message id");
  return { id: String(body.id), threadId: String(body.threadId || "") };
}

export async function listMessageIds(token: string, query: string, fetchImpl: typeof fetch = fetch, max = 50): Promise<string[]> {
  const q = new URLSearchParams({ q: query, maxResults: String(max) });
  const body = await gmailCall(token, `/messages?${q.toString()}`, fetchImpl);
  return (body.messages || []).map((m: any) => String(m.id));
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  messageId: string;
  /** Milliseconds since epoch, from Gmail's internalDate. */
  receivedAt: number;
  text: string;
  automated: boolean;
}

function decodeB64Url(data: string): string {
  return Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** The first text/plain part, else the first text/html part converted to text. */
export function bodyText(payload: any): string {
  let plain = "";
  let html = "";
  const walk = (p: any) => {
    if (!p || (plain && html)) return;
    const type = String(p.mimeType || "").toLowerCase();
    if (type === "text/plain" && !plain && p.body?.data) plain = decodeB64Url(p.body.data);
    else if (type === "text/html" && !html && p.body?.data) html = decodeB64Url(p.body.data);
    for (const part of p.parts || []) walk(part);
  };
  walk(payload);
  return plain || (html ? htmlToText(html) : "");
}

export async function getMessage(token: string, id: string, fetchImpl: typeof fetch = fetch): Promise<GmailMessage> {
  const m = await gmailCall(token, `/messages/${encodeURIComponent(id)}?format=full`, fetchImpl);
  const headers: Record<string, string> = {};
  for (const h of m.payload?.headers || []) headers[String(h.name).toLowerCase()] = String(h.value);
  const autoSubmitted = (headers["auto-submitted"] || "").toLowerCase();
  return {
    id: String(m.id),
    threadId: String(m.threadId || ""),
    from: addressOf(headers["from"] || ""),
    subject: headers["subject"] || "",
    messageId: headers["message-id"] || String(m.id),
    receivedAt: Number(m.internalDate) || 0,
    text: bodyText(m.payload),
    automated:
      (autoSubmitted !== "" && autoSubmitted !== "no") ||
      "x-autoreply" in headers ||
      "x-autorespond" in headers ||
      /^(bulk|junk|list|auto_reply)$/i.test(headers["precedence"] || ""),
  };
}

// ---------------------------------------------------------------------------
// Bounces
// ---------------------------------------------------------------------------

export function isBounceSender(address: string): boolean {
  return /^(mailer-daemon|postmaster)@/i.test(address);
}

/** Addresses mentioned in a delivery-failure notice, excluding the mail system's own. Lower case, no repeats. */
export function bouncedAddresses(text: string, ownAddress = ""): string[] {
  const found = String(text || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const own = ownAddress.toLowerCase();
  const out: string[] = [];
  for (const raw of found) {
    const a = raw.toLowerCase();
    if (a === own || isBounceSender(a) || (/@(googlemail|google)\.com$/.test(a) && /daemon|postmaster|noreply/.test(a))) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The sender used by the outreach runtime
// ---------------------------------------------------------------------------

export interface GmailSenderConfig extends Pick<OutreachEmailConfig, "publicUrl" | "unsubscribeSecret"> {
  /** "Tejinder Singh <calls.thegrowthlab@gmail.com>". Gmail always sends as the signed-in account. */
  from: string;
}

export function createGmailSender(cfg: GmailSenderConfig, token: TokenProvider, fetchImpl: typeof fetch = fetch): EmailSender {
  const fromAddress = addressOf(cfg.from);

  async function deliver(input: MimeInput): Promise<{ messageId: string }> {
    const t = await token();
    if (!t) throw new Error("Gmail is not connected: sign in at /book/connect with the bookings account");
    const sent = await sendRaw(t, buildMime(input), fetchImpl);
    return { messageId: sent.id };
  }

  return {
    async send(email: OutreachEmail) {
      const to = addressOf(email.to);
      if (!to) throw new Error("prospect has no valid work email");
      if (!fromAddress) throw new Error("the Gmail sender address is not set (BOOKING_CALENDAR_EMAIL)");

      const headers: Record<string, string> = {};
      const link = unsubscribeUrl(email.prospectId, cfg);
      const mailto = `<mailto:${fromAddress}?subject=STOP>`;
      headers["List-Unsubscribe"] = link ? `${mailto}, <${link}>` : mailto;
      if (link) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      if (email.inReplyTo) {
        headers["In-Reply-To"] = email.inReplyTo;
        headers["References"] = email.inReplyTo;
      }

      let attachment: MimeInput["attachment"];
      if (email.attachmentUrl) {
        const file = await fetchImpl(email.attachmentUrl);
        if (!file.ok) throw new Error(`one-pager download failed: HTTP ${file.status}`);
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.length === 0) throw new Error("one-pager download was empty");
        attachment = { filename: email.attachmentFilename || "ai-visibility-report.pdf", bytes };
      }

      return deliver({ from: cfg.from, to, subject: email.subject, text: email.text, html: email.html || textToHtml(email.text), headers, attachment });
    },

    async forward(input) {
      const to = addressOf(input.to);
      if (!to) throw new Error("forward address is not valid");
      const replyTo = addressOf(input.replyTo);
      return deliver({
        from: cfg.from,
        to,
        subject: input.subject,
        text: input.text,
        html: textToHtml(input.text),
        headers: replyTo ? { "Reply-To": replyTo } : {},
      });
    },
  };
}

// services/tgl-ops/src/agents/outreach-sequencer/email.ts
// Outreach email through the service's own provider (Resend), with no GoHighLevel in the path
// (Architect decision, 13 Nov 2026). Sending, signed inbound webhooks, reading a received email,
// and the unsubscribe token. fetch and node:crypto only; no new dependency.
//
// Environment read here:
//   OUTREACH_EMAIL_VIA           "resend" sends email touches from this service; anything else keeps GoHighLevel
//   RESEND_API_KEY               provider key (already used for audit and report emails)
//   OUTREACH_EMAIL_FROM          sender, e.g. "Tejinder Singh <tejinder@team.thegrowthlab.co.in>"
//   OUTREACH_REPLY_TO            address prospects reply to; must be on a domain with receiving switched on.
//                                Defaults to the sender address.
//   OUTREACH_FORWARD_REPLIES_TO  the Architect's own mailbox; every prospect reply is forwarded there with
//                                Reply-To set to the prospect, so he answers from his normal mail
//   RESEND_WEBHOOK_SECRET        signing secret of the Resend webhook ("whsec_...")
//   OUTREACH_WEBHOOK_SECRET      also signs the unsubscribe link
//   OUTREACH_PUBLIC_URL          public base URL of this service; defaults to https://$RAILWAY_PUBLIC_DOMAIN
import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailVia = "resend" | "ghl";

export interface OutreachEmailConfig {
  via: EmailVia;
  apiKey: string;
  from: string;
  replyTo: string;
  forwardTo?: string;
  webhookSecret: string;
  unsubscribeSecret: string;
  publicUrl: string;
  apiBase: string;
}

/** "Name <a@b.c>" or "a@b.c" -> "a@b.c" (lower case). Empty string when there is no address. */
export function addressOf(value: string): string {
  const raw = String(value || "").trim();
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
  const addr = angled ? angled[1] : raw;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr) ? addr.toLowerCase() : "";
}

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): OutreachEmailConfig {
  const from = (env.OUTREACH_EMAIL_FROM || "").trim();
  const railway = (env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  const publicUrl = ((env.OUTREACH_PUBLIC_URL || "").trim() || (railway ? `https://${railway}` : "")).replace(/\/+$/, "");
  return {
    via: (env.OUTREACH_EMAIL_VIA || "").trim().toLowerCase() === "resend" ? "resend" : "ghl",
    apiKey: (env.RESEND_API_KEY || "").trim(),
    from,
    replyTo: addressOf(env.OUTREACH_REPLY_TO || "") || addressOf(from),
    forwardTo: addressOf(env.OUTREACH_FORWARD_REPLIES_TO || "") || undefined,
    webhookSecret: (env.RESEND_WEBHOOK_SECRET || "").trim(),
    unsubscribeSecret: (env.OUTREACH_WEBHOOK_SECRET || "").trim(),
    publicUrl,
    apiBase: ((env.RESEND_API_BASE || "").trim() || "https://api.resend.com").replace(/\/+$/, ""),
  };
}

/** Problems that would make a live send through this service fail, or leave replies unread. Empty when clean. */
export function emailConfigIssues(cfg: OutreachEmailConfig): string[] {
  const issues: string[] = [];
  if (!cfg.apiKey) issues.push("OUTREACH_EMAIL_VIA=resend but RESEND_API_KEY is not set");
  if (!addressOf(cfg.from)) issues.push("OUTREACH_EMAIL_VIA=resend but OUTREACH_EMAIL_FROM is not a valid sender address");
  if (!cfg.webhookSecret) issues.push("RESEND_WEBHOOK_SECRET is not set, so replies and STOP requests could not be received");
  if (!cfg.unsubscribeSecret || !cfg.publicUrl) issues.push("the unsubscribe link cannot be built (OUTREACH_WEBHOOK_SECRET and OUTREACH_PUBLIC_URL or RAILWAY_PUBLIC_DOMAIN)");
  return issues;
}

// ---------------------------------------------------------------------------
// Unsubscribe token
// ---------------------------------------------------------------------------

export function unsubscribeToken(prospectId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${prospectId}`).digest("hex").slice(0, 40);
}

export function unsubscribeTokenValid(prospectId: string, token: string, secret: string): boolean {
  if (!prospectId || !token || !secret) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(unsubscribeToken(prospectId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(prospectId: string, cfg: Pick<OutreachEmailConfig, "publicUrl" | "unsubscribeSecret">): string | undefined {
  if (!cfg.publicUrl || !cfg.unsubscribeSecret) return undefined;
  return `${cfg.publicUrl}/outreach/unsubscribe?p=${encodeURIComponent(prospectId)}&t=${unsubscribeToken(prospectId, cfg.unsubscribeSecret)}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface OutreachEmail {
  prospectId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Signed URL of the one-pager PDF. Downloaded and attached as a file; the prospect never sees the URL. */
  attachmentUrl?: string;
  attachmentFilename?: string;
}

export interface EmailSender {
  send(email: OutreachEmail): Promise<{ messageId: string }>;
  /** Forward a prospect's reply to the Architect's mailbox. Reply-To is the prospect. */
  forward(input: { to: string; replyTo: string; subject: string; text: string }): Promise<{ messageId: string }>;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain paragraphs. No tracking pixel, no images, no styling: it should read as a person's email. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function createResendSender(cfg: OutreachEmailConfig, fetchImpl: typeof fetch = fetch): EmailSender {
  async function post(payload: Record<string, unknown>): Promise<string> {
    if (!cfg.apiKey) throw new Error("RESEND_API_KEY is not set");
    const res = await fetchImpl(`${cfg.apiBase}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let parsed: any = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    if (!res.ok) throw new Error(`Resend send failed: HTTP ${res.status} ${raw.slice(0, 300)}`);
    const id = parsed?.id;
    if (!id) throw new Error("Resend send returned no message id");
    return String(id);
  }

  return {
    async send(email) {
      const to = addressOf(email.to);
      if (!to) throw new Error("prospect has no valid work email");
      if (!addressOf(cfg.from)) throw new Error("OUTREACH_EMAIL_FROM is not a valid sender address");

      const headers: Record<string, string> = {};
      const link = unsubscribeUrl(email.prospectId, cfg);
      const mailto = cfg.replyTo ? `<mailto:${cfg.replyTo}?subject=STOP>` : "";
      if (link) {
        headers["List-Unsubscribe"] = [mailto, `<${link}>`].filter(Boolean).join(", ");
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      } else if (mailto) {
        headers["List-Unsubscribe"] = mailto;
      }

      const payload: Record<string, unknown> = {
        from: cfg.from,
        to: [to],
        subject: email.subject,
        text: email.text,
        html: email.html || textToHtml(email.text),
        headers,
      };
      if (cfg.replyTo) payload.reply_to = cfg.replyTo;

      if (email.attachmentUrl) {
        const file = await fetchImpl(email.attachmentUrl);
        if (!file.ok) throw new Error(`one-pager download failed: HTTP ${file.status}`);
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.length === 0) throw new Error("one-pager download was empty");
        payload.attachments = [{ filename: email.attachmentFilename || "ai-visibility-report.pdf", content: bytes.toString("base64") }];
      }

      return { messageId: await post(payload) };
    },

    async forward(input) {
      const to = addressOf(input.to);
      if (!to) throw new Error("forward address is not valid");
      const payload: Record<string, unknown> = {
        from: cfg.from,
        to: [to],
        subject: input.subject,
        text: input.text,
        html: textToHtml(input.text),
      };
      const replyTo = addressOf(input.replyTo);
      if (replyTo) payload.reply_to = replyTo;
      return { messageId: await post(payload) };
    },
  };
}

// ---------------------------------------------------------------------------
// Inbound: webhook signature and the received email
// ---------------------------------------------------------------------------

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

/**
 * Resend signs webhooks the Svix way: HMAC-SHA256 over "<id>.<timestamp>.<raw body>", keyed with the base64
 * part of the "whsec_" secret, base64 output, sent as space-separated "v1,<signature>" entries.
 */
export function verifySvixSignature(rawBody: string, headers: SvixHeaders, secret: string, now: Date = new Date()): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > SVIX_TOLERANCE_SECONDS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = Buffer.from(createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest("base64"));
  for (const entry of headers.signature.split(/\s+/)) {
    const comma = entry.indexOf(",");
    if (comma < 0 || entry.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(entry.slice(comma + 1));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  messageId?: string;
  /** True when the headers mark the message as machine-sent (auto-reply, list mail). */
  automated: boolean;
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

/**
 * Keeps what the person wrote and drops the quoted history under it, so intent is read from their words
 * and not from our own email (which contains "Reply STOP").
 */
export function stripQuotedReply(text: string): string {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^On .+wrote:$/i.test(t)) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(t)) break;
    if (/^_{5,}$/.test(t)) break;
    if (/^From:\s.+/i.test(t) && kept.some((k) => k.trim() !== "")) break;
    if (t.startsWith(">")) continue;
    kept.push(line);
  }
  // A long "On <date> ... wrote:" can wrap over two lines.
  const joined = kept.join("\n").replace(/\nOn [^\n]*\n[^\n]*wrote:\s*$/i, "");
  return joined.replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchReceivedEmail(id: string, cfg: OutreachEmailConfig, fetchImpl: typeof fetch = fetch): Promise<ReceivedEmail> {
  if (!cfg.apiKey) throw new Error("RESEND_API_KEY is not set");
  const res = await fetchImpl(`${cfg.apiBase}/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Resend received-email read failed: HTTP ${res.status} ${raw.slice(0, 200)}`);
  let d: any;
  try {
    d = JSON.parse(raw);
  } catch {
    throw new Error("Resend received-email read returned invalid JSON");
  }
  const body = typeof d.text === "string" && d.text.trim() ? d.text : typeof d.html === "string" ? htmlToText(d.html) : "";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.headers || {})) headers[k.toLowerCase()] = String(v);
  const autoSubmitted = (headers["auto-submitted"] || "").toLowerCase();
  const automated = (autoSubmitted !== "" && autoSubmitted !== "no") || "x-autoreply" in headers || "x-autorespond" in headers || /^(bulk|junk|list|auto_reply)$/i.test(headers["precedence"] || "");
  const to = Array.isArray(d.to) ? d.to : d.to ? [d.to] : [];
  return {
    id: String(d.id || id),
    from: addressOf(String(d.from || "")),
    to: to.map((t: unknown) => addressOf(String(t))).filter(Boolean),
    subject: String(d.subject || ""),
    text: stripQuotedReply(body),
    messageId: d.message_id ? String(d.message_id) : undefined,
    automated,
  };
}

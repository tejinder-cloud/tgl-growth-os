// services/tgl-ops/src/routes/outreach.ts
// POST /outreach/resend-events and /outreach/unsubscribe are at the bottom of this file.
// POST /outreach/ghl-reply : GoHighLevel inbound-message webhook. Routes the reply to the Sales Desk with an
// intent label (SKILL.md Playbook D). Fails closed: no configured secret, wrong secret, or no wired
// dependencies all refuse the request and change nothing.
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { loadEmailConfig, unsubscribeTokenValid, verifySvixSignature } from "../agents/outreach-sequencer/email.js";
import { handleResendEvent, handleUnsubscribe, type InboundDeps } from "../agents/outreach-sequencer/inbound.js";
import { handleReply, type ReplyDeps } from "../agents/outreach-sequencer/reply.js";

export const OUTREACH_SECRET_HEADER = "x-outreach-secret";

let replyDeps: ReplyDeps | null = null;

/** Composition root hook: index.ts supplies the real store and GHL client once at boot. */
export function setOutreachReplyDeps(deps: ReplyDeps | null): void {
  replyDeps = deps;
}

let inboundDeps: InboundDeps | null = null;

/** Composition root hook for the email provider's webhook and the unsubscribe link. */
export function setOutreachInboundDeps(deps: InboundDeps | null): void {
  inboundDeps = deps;
}

export function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const outreachRouter = Router();

outreachRouter.post("/ghl-reply", async (req: Request, res: Response) => {
  const expected = (process.env.OUTREACH_WEBHOOK_SECRET || "").trim();
  if (!expected) {
    res.status(503).json({ error: "outreach webhook secret not configured" });
    return;
  }
  const header = req.headers[OUTREACH_SECRET_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!secretsMatch(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!replyDeps) {
    res.status(503).json({ error: "outreach reply handler not wired" });
    return;
  }

  try {
    const result = await handleReply(req.body, replyDeps);
    res.status(200).json(result);
  } catch (err: any) {
    // 500 lets GHL retry. Duplicate deliveries are ignored by message id inside handleReply.
    console.error("[Outreach Reply] handler failed:", err?.message || err);
    res.status(500).json({ error: "reply handling failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /outreach/resend-events : the email provider's signed webhook (a reply was received, an email bounced,
// a recipient complained). Fails closed like /ghl-reply: no secret, a bad signature or a stale timestamp
// refuse the request and change nothing.
// ---------------------------------------------------------------------------

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

outreachRouter.post("/resend-events", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const secret = (process.env.RESEND_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    res.status(503).json({ error: "email webhook secret not configured" });
    return;
  }
  const raw = (req.rawBody ?? Buffer.alloc(0)).toString("utf8");
  const ok = verifySvixSignature(raw, { id: header(req, "svix-id"), timestamp: header(req, "svix-timestamp"), signature: header(req, "svix-signature") }, secret);
  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!inboundDeps) {
    res.status(503).json({ error: "outreach inbound handler not wired" });
    return;
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  try {
    const result = await handleResendEvent(event, inboundDeps);
    res.status(200).json(result);
  } catch (err: any) {
    // 500 lets the provider retry. Duplicate replies are ignored by message id inside handleReply.
    console.error("[Outreach Inbound] handler failed:", err?.message || err);
    res.status(500).json({ error: "inbound handling failed" });
  }
});

// ---------------------------------------------------------------------------
// /outreach/unsubscribe?p=<prospect id>&t=<token>
// GET shows a confirm button and changes nothing, because mail scanners open every link in an email.
// POST unsubscribes; it is also what a mail client's one-click "Unsubscribe" sends.
// ---------------------------------------------------------------------------

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f1e7;color:#1c1a17;margin:0;padding:48px 20px}main{max-width:440px;margin:0 auto}h1{font-size:22px;margin:0 0 12px}p{font-size:16px;line-height:1.5;margin:0 0 20px}button{font:inherit;font-weight:600;padding:12px 20px;border:2px solid #1c1a17;border-radius:6px;background:#1c1a17;color:#f6f1e7;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;
}

function unsubscribeParams(req: Request): { id: string; valid: boolean } {
  const id = String(req.query.p || "").trim();
  const token = String(req.query.t || "").trim();
  const secret = loadEmailConfig().unsubscribeSecret;
  return { id, valid: unsubscribeTokenValid(id, token, secret) };
}

outreachRouter.get("/unsubscribe", (req: Request, res: Response) => {
  const { id, valid } = unsubscribeParams(req);
  if (!valid) {
    res.status(403).type("html").send(page("Link not valid", "<h1>This link is not valid</h1><p>Reply STOP to the email you received and we will not write again.</p>"));
    return;
  }
  const action = `/outreach/unsubscribe?p=${encodeURIComponent(id)}&t=${encodeURIComponent(String(req.query.t))}`;
  res
    .status(200)
    .type("html")
    .send(page("Stop emails from The Growth Lab", `<h1>Stop emails from The Growth Lab?</h1><p>Confirm and we will not write to you again.</p><form method="post" action="${action}"><button type="submit">Stop emails</button></form>`));
});

outreachRouter.post("/unsubscribe", async (req: Request, res: Response) => {
  const { id, valid } = unsubscribeParams(req);
  if (!valid) {
    res.status(403).type("html").send(page("Link not valid", "<h1>This link is not valid</h1><p>Reply STOP to the email you received and we will not write again.</p>"));
    return;
  }
  if (!inboundDeps) {
    res.status(503).type("html").send(page("Try again", "<h1>We could not record that just now</h1><p>Reply STOP to the email you received and we will not write again.</p>"));
    return;
  }
  try {
    // The confirmation is shown only after the stop has been saved.
    await handleUnsubscribe(id, inboundDeps);
    res.status(200).type("html").send(page("Done", "<h1>Done</h1><p>We will not write to you again.</p>"));
  } catch (err: any) {
    console.error("[Outreach Unsubscribe] failed:", err?.message || err);
    res.status(500).type("html").send(page("Try again", "<h1>We could not record that just now</h1><p>Reply STOP to the email you received and we will not write again.</p>"));
  }
});

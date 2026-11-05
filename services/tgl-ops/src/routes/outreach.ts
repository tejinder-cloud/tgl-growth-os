// services/tgl-ops/src/routes/outreach.ts
// POST /outreach/ghl-reply : GoHighLevel inbound-message webhook. Routes the reply to the Sales Desk with an
// intent label (SKILL.md Playbook D). Fails closed: no configured secret, wrong secret, or no wired
// dependencies all refuse the request and change nothing.
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { handleReply, type ReplyDeps } from "../agents/outreach-sequencer/reply.js";

export const OUTREACH_SECRET_HEADER = "x-outreach-secret";

let replyDeps: ReplyDeps | null = null;

/** Composition root hook: index.ts supplies the real store and GHL client once at boot. */
export function setOutreachReplyDeps(deps: ReplyDeps | null): void {
  replyDeps = deps;
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

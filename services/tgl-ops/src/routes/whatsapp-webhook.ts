// services/tgl-ops/src/routes/whatsapp-webhook.ts
// The WhatsApp webhook (Build day 14, 26 Nov 2026). Meta calls GET once to confirm the address (with the verify
// token we set), then POSTs every incoming message and delivery status, signed with the app secret. An unsigned or
// wrongly signed POST is refused; nothing in it is read. Messages are handled after Meta gets its 200, so a slow
// step never makes Meta retry.
//
// GET  /whatsapp/webhook   hub.mode=subscribe, hub.verify_token=WHATSAPP_VERIFY_TOKEN, hub.challenge -> challenge
// POST /whatsapp/webhook   X-Hub-Signature-256 checked with WHATSAPP_APP_SECRET
import { Router, type Request, type Response } from "express";
import { handleDeliveryFailure, handleWhatsAppMessage, liveReplyPorts, parseWebhook, verifyMetaSignature, type WaReplyPorts } from "../agents/outreach-sequencer/whatsapp-replies.js";

export const whatsappWebhookRouter = Router();

let portsFor: () => Promise<WaReplyPorts> = () => liveReplyPorts();
/** Tests pass their own ports; null restores the live wiring. */
export function setWhatsAppPortsForTests(fn: (() => Promise<WaReplyPorts>) | null): void {
  portsFor = fn || (() => liveReplyPorts());
}

whatsappWebhookRouter.get("/", (req: Request, res: Response) => {
  const token = (process.env.WHATSAPP_VERIFY_TOKEN || "").trim();
  if (token && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === token) {
    res.status(200).type("text/plain").send(String(req.query["hub.challenge"] || ""));
    return;
  }
  res.status(403).end();
});

/** Resolves when the messages in the last POST have been handled (tests wait on it). */
export let lastProcessing: Promise<void> = Promise.resolve();

whatsappWebhookRouter.post("/", (req: Request & { rawBody?: Buffer }, res: Response) => {
  const secret = (process.env.WHATSAPP_APP_SECRET || "").trim();
  if (!secret) {
    console.warn("[WhatsApp Webhook] WHATSAPP_APP_SECRET is not set; message refused");
    res.status(503).end();
    return;
  }
  const raw = req.rawBody || Buffer.alloc(0);
  if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, secret)) {
    res.status(401).end();
    return;
  }
  let body: any;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).end();
    return;
  }
  res.status(200).end();
  const { messages, failures } = parseWebhook(body);
  lastProcessing = (async () => {
    if (!messages.length && !failures.length) return;
    const ports = await portsFor();
    for (const m of messages) {
      await handleWhatsAppMessage(m, ports).catch((err) => console.error("[WhatsApp Webhook] message failed:", (err as Error)?.message || err));
    }
    for (const f of failures) {
      await handleDeliveryFailure(f, ports).catch(() => {});
    }
  })().catch((err) => console.error("[WhatsApp Webhook] processing failed:", (err as Error)?.message || err));
});

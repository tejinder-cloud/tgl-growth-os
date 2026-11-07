// POST /billing/razorpay — Razorpay webhook (TrueVisible Track subscriptions). Fails closed without the secret.
import { Router, type Request, type Response } from "express";
import { getSupabase } from "../agents/prospect-researcher/db.js";
import { handleRazorpayEvent, validWebhook } from "../agents/aeo-billing/razorpay.js";

export const billingRouter = Router();

billingRouter.post("/razorpay", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const raw = req.rawBody ?? Buffer.alloc(0);
  if (!validWebhook(raw, req.header("x-razorpay-signature") ?? undefined, process.env.RAZORPAY_WEBHOOK_SECRET?.trim())) {
    res.status(401).json({ ok: false });
    return;
  }
  const sb = getSupabase();
  if (!sb) { res.status(503).json({ ok: false }); return; }
  try {
    const result = await handleRazorpayEvent(sb, JSON.parse(raw.toString("utf8")));
    console.log("[Billing] Razorpay", result);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[Billing] webhook failed:", err?.message ?? err);
    res.status(500).json({ ok: false });                               // Razorpay retries
  }
});

// Razorpay webhooks for TrueVisible Track (plan Day 26). Verifies X-Razorpay-Signature over the raw body with
// RAZORPAY_WEBHOOK_SECRET, then keeps public.subscriptions and public.invoices in step with Razorpay.
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function validWebhook(raw: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Total paid (incl. GST) → ex-GST and GST parts (pure; tested). */
export function splitGst(totalMinor: number, gstRate: number): { amount: number; gst: number } {
  const amount = Math.round(totalMinor / (1 + gstRate / 100));
  return { amount, gst: totalMinor - amount };
}

const STATUS: Record<string, string> = {
  "subscription.activated": "active", "subscription.charged": "active", "subscription.resumed": "active",
  "subscription.pending": "past_due", "subscription.halted": "past_due", "subscription.paused": "past_due",
  "subscription.cancelled": "cancelled", "subscription.completed": "expired",
};

export async function handleRazorpayEvent(sb: SupabaseClient, ev: any): Promise<string> {
  const event = String(ev?.event ?? "");
  const s = ev?.payload?.subscription?.entity;
  if (!s?.id || !STATUS[event]) return "ignored";
  // Find the tenant: an existing paid subscription row, else the checkout the app recorded (covers a lost browser confirm).
  let { data: sub } = await sb.from("subscriptions").select("id, tenant_id, gst_rate, currency").eq("razorpay_subscription_id", s.id).maybeSingle();
  if (!sub) {
    const { data: co } = await sb.from("billing_checkouts").select("tenant_id, billing_interval, currency, price_minor, gst_rate").eq("razorpay_subscription_id", s.id).maybeSingle();
    if (!co) return "unknown subscription";
    if (STATUS[event] !== "active") return "not active yet";
    const { data: latest } = await sb.from("subscriptions").select("id").eq("tenant_id", co.tenant_id).eq("product", "truevisible").is("brand_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) return "no subscription row";
    await sb.from("subscriptions").update({ plan: "track", status: "active", price_minor: co.price_minor, currency: co.currency, gst_rate: co.gst_rate, billing_interval: co.billing_interval, razorpay_subscription_id: s.id }).eq("id", latest.id);
    await sb.from("billing_checkouts").update({ status: "active" }).eq("razorpay_subscription_id", s.id);
    sub = { id: latest.id, tenant_id: co.tenant_id, gst_rate: co.gst_rate, currency: co.currency };
  }
  const patch: Record<string, unknown> = { status: STATUS[event] };
  if (s.current_end) patch.current_period_end = new Date(Number(s.current_end) * 1000).toISOString();
  await sb.from("subscriptions").update(patch).eq("id", sub.id);

  const pay = ev?.payload?.payment?.entity;
  if (event === "subscription.charged" && pay?.id && pay.amount) {
    const { amount, gst } = splitGst(Number(pay.amount), Number(sub.gst_rate ?? 0));
    const iso = (u: any) => (u ? new Date(Number(u) * 1000).toISOString().slice(0, 10) : null);
    await sb.from("invoices").upsert({
      tenant_id: sub.tenant_id, subscription_id: sub.id, amount_minor: amount, gst_minor: gst, currency: pay.currency ?? sub.currency, status: "paid",
      issued_at: new Date().toISOString(), paid_at: new Date((pay.created_at ?? Date.now() / 1000) * 1000).toISOString(),
      razorpay_payment_id: pay.id, razorpay_invoice_id: pay.invoice_id ?? null, period_start: iso(s.current_start), period_end: iso(s.current_end),
    }, { onConflict: "razorpay_payment_id" });
  }
  // Issue the tax invoice right away (also retried every 10 minutes).
  if (pay?.id) { const { issueInvoices } = await import("./invoices-worker.js"); await issueInvoices(sb).catch(() => {}); }
  return `${event} → ${STATUS[event]}`;
}

/** Keep the Vault copy of the key secret (used by the database to verify checkout signatures) in step with env. */
export async function syncRazorpaySecret(sb: SupabaseClient): Promise<void> {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) return;
  const { error } = await sb.rpc("svc_set_razorpay_secret", { p_secret: secret });
  if (error) console.error("[Billing] could not sync Razorpay secret:", error.message);
}

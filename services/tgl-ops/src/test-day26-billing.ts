process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { handleRazorpayEvent, splitGst, validWebhook } from "./agents/aeo-billing/razorpay.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

function fakeSb(rows: Record<string, any[]>) {
  const writes: { table: string; op: string; data: any; where?: any }[] = [];
  const q = (table: string) => {
    const filters: [string, any][] = [];
    const api: any = {
      select: () => api, eq: (k: string, v: any) => { filters.push([k, v]); return api; }, is: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: (rows[table] ?? []).find((r) => filters.every(([k, v]) => r[k] === v)) ?? null }),
      update: (data: any) => ({ eq: async (k: string, v: any) => { writes.push({ table, op: "update", data, where: [k, v] }); return {}; } }),
      upsert: async (data: any) => { writes.push({ table, op: "upsert", data }); return {}; },
    };
    return api;
  };
  return { sb: { from: q } as any, writes };
}

async function main() {
await t("webhook signature: HMAC-SHA256 of the raw body with the webhook secret", () => {
  const raw = Buffer.from('{"event":"x"}');
  const sig = crypto.createHmac("sha256", "whsec").update(raw).digest("hex");
  assert.equal(validWebhook(raw, sig, "whsec"), true);
  assert.equal(validWebhook(raw, sig, "other"), false);
  assert.equal(validWebhook(raw, undefined, "whsec"), false);
  assert.equal(validWebhook(raw, sig, undefined), false);
});
await t("GST split of an Indian charge; none abroad", () => {
  assert.deepEqual(splitGst(471_882, 18), { amount: 399_900, gst: 71_982 });
  assert.deepEqual(splitGst(4_900, 0), { amount: 4_900, gst: 0 });
});
await t("charged: activates from the checkout if the browser confirm was lost, and records the invoice once", async () => {
  const { sb, writes } = fakeSb({ subscriptions: [{ id: "s1", tenant_id: "t1", product: "truevisible" }], billing_checkouts: [{ tenant_id: "t1", billing_interval: "month", currency: "INR", price_minor: 399_900, gst_rate: 18, razorpay_subscription_id: "sub_9" }] });
  const out = await handleRazorpayEvent(sb, { event: "subscription.charged", payload: {
    subscription: { entity: { id: "sub_9", current_start: 1762500000, current_end: 1765100000 } },
    payment: { entity: { id: "pay_1", amount: 471_882, currency: "INR", created_at: 1762500100 } } } });
  assert.equal(out, "subscription.charged → active");
  assert.ok(writes.some((w) => w.table === "subscriptions" && w.data.plan === "track" && w.data.status === "active"));
  const inv = writes.find((w) => w.table === "invoices")!.data;
  assert.deepEqual([inv.amount_minor, inv.gst_minor, inv.razorpay_payment_id, inv.status], [399_900, 71_982, "pay_1", "paid"]);
});
await t("halted → past_due; cancelled → cancelled; unknown events ignored", async () => {
  const { sb, writes } = fakeSb({ subscriptions: [{ id: "s1", tenant_id: "t1", razorpay_subscription_id: "sub_9", gst_rate: 18, currency: "INR" }] });
  assert.equal(await handleRazorpayEvent(sb, { event: "subscription.halted", payload: { subscription: { entity: { id: "sub_9" } } } }), "subscription.halted → past_due");
  assert.equal(await handleRazorpayEvent(sb, { event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_9", current_end: 1765100000 } } } }), "subscription.cancelled → cancelled");
  assert.equal(await handleRazorpayEvent(sb, { event: "payment.captured", payload: {} }), "ignored");
  assert.deepEqual(writes.map((w) => w.data.status), ["past_due", "cancelled"]);
});
console.log(`\nDay 26 billing: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// Issue GST tax invoices (plan Day 32b): every paid invoice row without a number gets the next number in the
// financial year's series, the tax split for its place of supply, a PDF in the private "invoices" bucket, and an
// email with the PDF to the workspace's owners. Runs every 10 minutes and right after each Razorpay payment.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestMode } from "../../config.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { sendEmail } from "../aeo-reports/worker.js";
import { render } from "../aeo-reports/email.js";
import { financialYear, invoiceNumber, money, SUPPLIER, taxFor } from "./invoice.js";
import { invoicePdf } from "./invoice-pdf.js";

const PLAN: Record<string, string> = { track: "Track", managed: "Managed AEO", managed_plus: "Managed AEO Plus" };
const day = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("-");

export async function issueInvoices(sbIn?: SupabaseClient): Promise<number> {
  if (isTestMode()) return 0;
  const sb = sbIn ?? getSupabase();
  if (!sb) return 0;
  const { data: rows } = await sb.from("invoices").select("id, tenant_id, subscription_id, amount_minor, gst_minor, currency, paid_at, period_start, period_end, razorpay_payment_id")
    .is("number", null).is("tax", null).eq("status", "paid").order("paid_at").limit(20);
  let n = 0;
  for (const inv of (rows ?? []) as any[]) {
    // Claim the row before taking a number, so the series never has gaps or duplicates.
    const { data: claimed } = await sb.from("invoices").update({ tax: { issuing: true } }).eq("id", inv.id).is("tax", null).is("number", null).select("id");
    if (!claimed?.length) continue;
    try {
      const { data: sub } = await sb.from("subscriptions").select("plan, billing_interval, gst_rate, razorpay_subscription_id").eq("id", inv.subscription_id).maybeSingle();
      const { data: co } = sub?.razorpay_subscription_id
        ? await sb.from("billing_checkouts").select("gstin, legal_name, state_code, user_id").eq("razorpay_subscription_id", sub.razorpay_subscription_id).maybeSingle()
        : { data: null as any };
      const { data: tenant } = await sb.from("tenants").select("name").eq("id", inv.tenant_id).maybeSingle();
      const paid = new Date(inv.paid_at ?? Date.now());
      const fy = financialYear(paid);
      const { data: seq, error: seqErr } = await sb.rpc("svc_next_invoice_seq", { p_fy: fy });
      if (seqErr || !seq) throw new Error(`invoice number: ${seqErr?.message ?? "none"}`);
      const number = invoiceNumber(process.env.INVOICE_PREFIX?.trim() || "FM", fy, Number(seq));
      const tax = taxFor({ currency: inv.currency, gstMinor: Number(inv.gst_minor), gstRate: Number(sub?.gst_rate ?? 18), customerState: co?.state_code ?? (co?.gstin ? co.gstin.slice(0, 2) : null), lutArn: process.env.LEGAL_LUT_ARN?.trim() || null });
      const owners = (await sb.from("tenant_members").select("user_id, role").eq("tenant_id", inv.tenant_id)).data ?? [];
      const emails: string[] = [];
      for (const m of owners as any[]) if (m.role === "owner" || m.role === "admin") { const { data } = await sb.auth.admin.getUserById(m.user_id); if (data?.user?.email) emails.push(data.user.email); }
      const description = `TrueVisible ${PLAN[sub?.plan ?? "track"] ?? "subscription"} — ${sub?.billing_interval === "year" ? "annual" : "monthly"} subscription`;
      const period = inv.period_start && inv.period_end ? `Period ${inv.period_start.split("-").reverse().join("-")} to ${inv.period_end.split("-").reverse().join("-")}` : null;
      const pdf = await invoicePdf({ number, date: day(paid), currency: inv.currency, taxableMinor: Number(inv.amount_minor), tax, sac: process.env.INVOICE_SAC?.trim() || "998319",
        description, period, customer: { name: co?.legal_name ?? tenant?.name ?? "Customer", gstin: co?.gstin ?? null, email: emails[0] ?? null }, paymentRef: inv.razorpay_payment_id });
      const key = `${inv.tenant_id}/${number.replace(/\//g, "-")}.pdf`;
      const up = await sb.storage.from("invoices").upload(key, pdf, { contentType: "application/pdf", upsert: false });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
      await sb.from("invoices").update({ number, pdf_url: key, issued_at: new Date().toISOString(), tax: { ...tax, sac: process.env.INVOICE_SAC?.trim() || "998319", supplier_gstin: SUPPLIER.gstin } }).eq("id", inv.id);
      const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
      if (emails.length && appUrl) {
        const total = Number(inv.amount_minor) + Number(inv.gst_minor);
        const e = render([{ lines: [`Thank you — we've received ${money(total, inv.currency)} for ${description}.`, `Your tax invoice ${number} is attached, and is always in Settings → Plan.`] }],
          { label: "Open Settings", url: `${appUrl}/dashboard/settings#plan` }, `${appUrl}/dashboard/settings#email`, undefined, { aboutAnswers: false });
        const err = await sendEmail(emails, { subject: `Tax invoice ${number} — TrueVisible`, ...e }, fetch, [{ filename: `${number.replace(/\//g, "-")}.pdf`, content: pdf.toString("base64") }]);
        if (err) await postLine({ channel: getAlertsChannel(), text: `[Warning] invoice ${number} email not sent: \`${err}\`` }).catch(() => {});
      }
      if (inv.currency !== "INR" && !process.env.LEGAL_LUT_ARN?.trim()) await postLine({ channel: getAlertsChannel(), text: `[Warning] Export invoice ${number} issued without an LUT — IGST is payable on it. File the LUT (GST RFD-11) and set LEGAL_LUT_ARN.` }).catch(() => {});
      n++;
    } catch (err: any) {
      await sb.from("invoices").update({ tax: null }).eq("id", inv.id);   // release the claim; retried next run
      await postLine({ channel: getAlertsChannel(), text: `[Warning] couldn't issue a tax invoice for payment ${inv.razorpay_payment_id}: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
  return n;
}

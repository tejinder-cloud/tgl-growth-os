// Invoice provider adapters (Razorpay Invoices, Zoho Books). fetch is injected so tests never touch the network.
// Both create the invoice as a DRAFT: the service never issues or sends anything to a client. The Architect issues it.
import { minorToRupees } from "./gst.js";
import type { InvoiceDraft, Provider } from "./types.js";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export interface ProviderResult { providerInvoiceId: string; providerUrl?: string; totalMinor?: number }

const lineName = (inv: InvoiceDraft) => `${inv.description} (SAC ${inv.sacCode})`;

export async function createRazorpayDraft(inv: InvoiceDraft, f: FetchLike, env: NodeJS.ProcessEnv = process.env): Promise<ProviderResult> {
  const id = env.RAZORPAY_KEY_ID?.trim(), secret = env.RAZORPAY_KEY_SECRET?.trim();
  if (!id || !secret) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set");
  const g = inv.gst;
  const items: Array<{ name: string; amount: number; currency: string; quantity: number }> = [
    { name: lineName(inv), amount: g.taxableMinor, currency: "INR", quantity: 1 },
  ];
  if (g.cgstMinor) items.push({ name: `CGST @ ${g.ratePct / 2}%`, amount: g.cgstMinor, currency: "INR", quantity: 1 });
  if (g.sgstMinor) items.push({ name: `SGST @ ${g.ratePct / 2}%`, amount: g.sgstMinor, currency: "INR", quantity: 1 });
  if (g.igstMinor) items.push({ name: `IGST @ ${g.ratePct}%`, amount: g.igstMinor, currency: "INR", quantity: 1 });
  const body = {
    type: "invoice", draft: "1", currency: "INR", receipt: inv.number, description: inv.notes.join(" "),
    date: Math.floor(Date.parse(inv.issueDate + "T00:00:00+05:30") / 1000),
    customer: { name: inv.buyer.company || inv.buyer.name, email: inv.buyer.email, contact: inv.buyer.phone, gstin: inv.buyer.gstin?.toUpperCase() },
    line_items: items, sms_notify: 0, email_notify: 0,
    notes: { deal_id: inv.dealId, due_date: inv.dueDate, invoice_number: inv.number },
  };
  const res = await f("https://api.razorpay.com/v1/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.id) throw new Error(`Razorpay invoice create failed (${res.status}): ${j?.error?.description ?? "no id returned"}`);
  return { providerInvoiceId: String(j.id), providerUrl: j.short_url, totalMinor: typeof j.amount === "number" ? j.amount : undefined };
}

/** GST state code (numeric) to the two-letter place_of_supply code Zoho Books India expects. */
export const ZOHO_STATE: Record<string, string> = {
  "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR",
  "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH",
  "21": "OD", "22": "CG", "23": "MP", "24": "GJ", "26": "DN", "27": "MH", "29": "KA", "30": "GA", "31": "LD", "32": "KL",
  "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP", "38": "LA",
};

export async function createZohoDraft(inv: InvoiceDraft, f: FetchLike, env: NodeJS.ProcessEnv = process.env): Promise<ProviderResult> {
  const org = env.ZOHO_BOOKS_ORG_ID?.trim(), token = env.ZOHO_BOOKS_ACCESS_TOKEN?.trim();
  const base = (env.ZOHO_BOOKS_API_BASE?.trim() || "https://www.zohoapis.in/books/v3").replace(/\/$/, "");
  const taxId = inv.gst.igstMinor ? env.ZOHO_TAX_ID_INTER?.trim() : env.ZOHO_TAX_ID_INTRA?.trim();
  if (!org || !token) throw new Error("ZOHO_BOOKS_ORG_ID / ZOHO_BOOKS_ACCESS_TOKEN not set");
  if (!taxId) throw new Error(inv.gst.igstMinor ? "ZOHO_TAX_ID_INTER not set" : "ZOHO_TAX_ID_INTRA not set");
  const pos = ZOHO_STATE[inv.gst.placeOfSupplyCode];
  if (!pos) throw new Error(`No Zoho place_of_supply mapping for state code ${inv.gst.placeOfSupplyCode}`);
  const headers = { "content-type": "application/json", authorization: `Zoho-oauthtoken ${token}` };
  const q = `organization_id=${encodeURIComponent(org)}`;
  const name = inv.buyer.company || inv.buyer.name;

  let customerId: string | undefined;
  const found = await f(`${base}/contacts?${q}&contact_name=${encodeURIComponent(name)}`, { method: "GET", headers });
  const fj = await found.json().catch(() => ({}));
  if (found.ok) customerId = fj?.contacts?.find((c: any) => c.contact_name === name)?.contact_id;
  if (!customerId) {
    const c = await f(`${base}/contacts?${q}`, {
      method: "POST", headers,
      body: JSON.stringify({ contact_name: name, contact_type: "customer", gst_treatment: inv.buyer.gstin ? "business_gst" : "consumer", gst_no: inv.buyer.gstin?.toUpperCase(), place_of_contact: pos,
        contact_persons: inv.buyer.email ? [{ first_name: inv.buyer.name, email: inv.buyer.email, phone: inv.buyer.phone }] : undefined }),
    });
    const cj = await c.json().catch(() => ({}));
    customerId = cj?.contact?.contact_id;
    if (!c.ok || !customerId) throw new Error(`Zoho contact create failed (${c.status}): ${cj?.message ?? "no contact id"}`);
  }
  const res = await f(`${base}/invoices?${q}`, {
    method: "POST", headers,
    body: JSON.stringify({
      customer_id: customerId, date: inv.issueDate, due_date: inv.dueDate, reference_number: inv.number, place_of_supply: pos,
      gst_treatment: inv.buyer.gstin ? "business_gst" : "consumer", gst_no: inv.buyer.gstin?.toUpperCase(), is_inclusive_tax: false,
      line_items: [{ name: inv.description, description: lineName(inv), rate: minorToRupees(inv.gst.taxableMinor), quantity: 1, hsn_or_sac: inv.sacCode, tax_id: taxId }],
      notes: inv.notes.join(" "),
    }),
  });
  const j = await res.json().catch(() => ({}));
  const zi = j?.invoice;
  if (!res.ok || !zi?.invoice_id) throw new Error(`Zoho invoice create failed (${res.status}): ${j?.message ?? "no invoice id"}`);
  return { providerInvoiceId: String(zi.invoice_id), providerUrl: zi.invoice_url, totalMinor: typeof zi.total === "number" ? Math.round(zi.total * 100) : undefined };
}

export function createDraft(provider: Provider, inv: InvoiceDraft, f: FetchLike, env: NodeJS.ProcessEnv = process.env): Promise<ProviderResult> {
  return provider === "zoho" ? createZohoDraft(inv, f, env) : createRazorpayDraft(inv, f, env);
}

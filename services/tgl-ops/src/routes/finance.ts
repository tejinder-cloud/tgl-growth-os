// Finance routes (plan Day 13). Every route fails closed: no secret configured means 401/503, never open.
//   POST /finance/deal-won        GHL "opportunity status = won" workflow webhook (header x-finance-secret)
//   POST /finance/razorpay        Razorpay invoice.issued / invoice.paid / invoice.cancelled (x-razorpay-signature)
//   POST /finance/invoice-status  { number, status } for Zoho or manual issue/cancel (x-finance-secret)
//   POST /finance/expense         per-audit API cost line (x-finance-secret)
//   POST /finance/collections/run run the collections cadence, posts drafts (x-finance-secret)
//   GET  /finance/summary         ledger totals and per-audit cost (x-finance-secret)
import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { FileLedger, buildExpense, effectiveStatus, findInvoiceByProviderId, newId, paidMinor, summarise, invoiceEntries, type LedgerStore } from "../agents/finance/ledger.js";
import { handleDealWon, normalizeDealWon } from "../agents/finance/deal-won.js";
import { loadConfig } from "../agents/finance/invoice.js";
import { runCollections } from "../agents/finance/collections.js";
import type { FetchLike } from "../agents/finance/providers.js";
import type { InvoiceStatus } from "../agents/finance/types.js";

export const financeRouter = Router();

let ledger: LedgerStore | null = null;
let notifier: (text: string) => Promise<void> = async (t) => { console.log("[Finance]", t); };
export const setFinanceLedger = (l: LedgerStore | null) => { ledger = l; };
/** Wire to the Slack poster at boot. Default logs only. */
export const setFinanceNotifier = (fn: (text: string) => Promise<void>) => { notifier = fn; };
const getLedger = (): LedgerStore => (ledger ??= new FileLedger());
const httpFetch: FetchLike = (url, init) => fetch(url, init as any) as any;

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function authorised(req: Request): boolean {
  const secret = process.env.FINANCE_WEBHOOK_SECRET?.trim();
  const got = req.header("x-finance-secret") ?? "";
  return !!secret && safeEq(got, secret);
}
const guard = (req: Request, res: Response): boolean => { if (authorised(req)) return true; res.status(401).json({ ok: false }); return false; };

financeRouter.post("/deal-won", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const deal = normalizeDealWon(req.body);
  if (!deal) { res.status(200).json({ ok: true, status: "skipped", reason: "not a won deal" }); return; }
  try {
    const out = await handleDealWon({ cfg: loadConfig(), ledger: getLedger(), fetch: httpFetch, now: () => new Date(), notify: (t) => notifier(t) }, deal);
    res.status(out.status === "failed" ? 502 : 200).json({ ok: out.status !== "failed", ...out });
  } catch (err: any) {
    console.error("[Finance] deal-won failed:", err?.message ?? err);
    res.status(500).json({ ok: false });
  }
});

financeRouter.post("/razorpay", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  const sig = req.header("x-razorpay-signature") ?? "";
  const raw = req.rawBody ?? Buffer.alloc(0);
  if (!secret || !sig || !safeEq(createHmac("sha256", secret).update(raw).digest("hex"), sig)) { res.status(401).json({ ok: false }); return; }
  try {
    const ev = JSON.parse(raw.toString("utf8"));
    const ent = ev?.payload?.invoice?.entity;
    const l = getLedger();
    const all = await l.all();
    const inv = ent?.id ? findInvoiceByProviderId(all, String(ent.id)) : undefined;
    if (!inv) { res.status(200).json({ ok: true, ignored: "unknown invoice" }); return; }
    const now = new Date().toISOString();
    if (ev.event === "invoice.issued") await l.append({ kind: "status", id: newId(), at: now, number: inv.number, status: "issued" });
    else if (ev.event === "invoice.cancelled" || ev.event === "invoice.expired") await l.append({ kind: "status", id: newId(), at: now, number: inv.number, status: "cancelled" });
    else if (ev.event === "invoice.paid") {
      const paid = typeof ent.amount_paid === "number" ? ent.amount_paid : inv.totalMinor;
      const delta = paid - paidMinor(all, inv.number);
      if (delta > 0) await l.append({ kind: "payment", id: newId(), at: now, number: inv.number, amountMinor: delta, reference: String(ent.id) });
    }
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[Finance] razorpay webhook failed:", err?.message ?? err);
    res.status(500).json({ ok: false });                       // Razorpay retries
  }
});

financeRouter.post("/invoice-status", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const { number, status } = req.body ?? {};
  const ok: InvoiceStatus[] = ["issued", "cancelled", "paid"];
  const l = getLedger();
  const inv = invoiceEntries(await l.all()).find((i) => i.number === number);
  if (!inv || !ok.includes(status)) { res.status(400).json({ ok: false }); return; }
  await l.append({ kind: "status", id: newId(), at: new Date().toISOString(), number: inv.number, status });
  res.status(200).json({ ok: true, number: inv.number, status });
});

financeRouter.post("/expense", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const b = req.body ?? {};
  if (typeof b.vendor !== "string" || !b.vendor.trim()) { res.status(400).json({ ok: false, error: "vendor required" }); return; }
  const entry = buildExpense({ auditId: b.auditId, vendor: b.vendor.trim(), description: b.description, usd: b.usd, fxInrPerUsd: b.fxInrPerUsd, amountMinor: b.amountMinor });
  await getLedger().append(entry);
  res.status(200).json({ ok: true, id: entry.id, amountMinor: entry.amountMinor });
});

financeRouter.post("/collections/run", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const drafts = await runCollections(getLedger(), new Date(), (t) => notifier(t));
  res.status(200).json({ ok: true, drafts: drafts.length });
});

financeRouter.get("/summary", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const all = await getLedger().all();
  res.status(200).json({ ok: true, ...summarise(all), openInvoices: invoiceEntries(all).filter((i) => effectiveStatus(all, i) === "issued").length });
});

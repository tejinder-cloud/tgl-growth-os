// Deal Won -> draft GST invoice. Idempotent per deal, dry-run unless FINANCE_LIVE=1, never sends anything to a client.
import { buildInvoice, parseProductLine } from "./invoice.js";
import { createDraft, type FetchLike } from "./providers.js";
import { exportComplianceTask } from "./compliance.js";
import { findInvoiceByDeal, newId, nextInvoiceNumber, type LedgerStore } from "./ledger.js";
import { minorToRupees } from "./gst.js";
import type { DealWon, FinanceConfig, InvoiceDraft } from "./types.js";

export interface Deps {
  cfg: Partial<FinanceConfig>;
  ledger: LedgerStore;
  fetch: FetchLike;
  now: () => Date;
  /** Posts a plain-text line to the Architect/finance channel. Plain text only, no emojis. */
  notify: (text: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

export type Outcome =
  | { status: "skipped"; reason: string }
  | { status: "duplicate"; number: string }
  | { status: "held"; code: string; reasons: string[] }
  | { status: "dry_run"; invoice: InvoiceDraft }
  | { status: "failed"; error: string }
  | { status: "created"; number: string; providerInvoiceId: string; totalMismatch: boolean };

const pick = (o: any, ...keys: string[]): any => { for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };

/**
 * Normalises a GHL "Opportunity Status Changed" workflow webhook (or an already-normalised body).
 * Returns null unless the status is won. Field contract is documented in agents/finance/SKILL.md.
 * `product` (custom data key product, product_line or offer) selects the SAC: track or services.
 */
export function normalizeDealWon(p: any): DealWon | null {
  const opp = p?.opportunity ?? p;
  const status = String(pick(p, "status", "opportunity_status") ?? pick(opp, "status") ?? "").toLowerCase();
  if (status !== "won") return null;
  const c = p?.contact ?? p;
  const amount = Number(pick(p, "amount_inr", "monetaryValue", "monetary_value", "lead_value") ?? pick(opp, "monetaryValue", "monetary_value", "amount_inr"));
  return {
    dealId: String(pick(p, "dealId", "opportunity_id", "opportunityId") ?? pick(opp, "id") ?? ""),
    dealName: String(pick(p, "dealName", "opportunity_name") ?? pick(opp, "name") ?? "TGL engagement"),
    amountInr: amount,
    product: parseProductLine(pick(p, "product", "product_line", "offer") ?? pick(opp, "product", "product_line", "offer")),
    wonAt: pick(p, "wonAt", "date_updated"),
    description: pick(p, "invoice_description"),
    buyer: {
      name: String(pick(c, "full_name", "contactName", "name") ?? ""),
      company: pick(c, "company_name", "companyName", "company"),
      email: pick(c, "email"),
      phone: pick(c, "phone"),
      gstin: pick(p, "gstin", "gst_number") ?? pick(c, "gstin", "gst_number"),
      stateCode: pick(p, "state_code") ?? pick(c, "state_code"),
      country: pick(c, "country"),
      address: pick(c, "address", "address1"),
    },
  };
}

export async function handleDealWon(deps: Deps, deal: DealWon): Promise<Outcome> {
  return deps.ledger.withLock(async () => {
    const all = await deps.ledger.all();
    const existing = deal.dealId ? findInvoiceByDeal(all, deal.dealId) : undefined;
    if (existing) return { status: "duplicate", number: existing.number } as Outcome;

    const now = deps.now();
    const built = buildInvoice(deal, deps.cfg, nextInvoiceNumber(all, now), now);
    if (!built.ok) {
      await deps.notify(`Finance: invoice for deal ${deal.dealId || "(no id)"} held (${built.code}). ${built.reasons.join("; ")}`);
      if (built.code === "EXPORT_REVIEW") {
        const t = exportComplianceTask(deal, deps.cfg);
        await deps.notify(`Compliance task: ${t.title}. ${t.body}`);
      }
      return { status: "held", code: built.code, reasons: built.reasons } as Outcome;
    }
    const inv = built.invoice;
    if (!deps.cfg.live) return { status: "dry_run", invoice: inv } as Outcome;

    let res;
    try {
      res = await createDraft(deps.cfg.provider ?? "razorpay", inv, deps.fetch, deps.env ?? process.env);
    } catch (e: any) {
      const error = String(e?.message ?? e);
      await deps.notify(`Finance: draft invoice ${inv.number} for deal ${inv.dealId} failed. ${error}. Nothing was written to the ledger; the webhook can be retried.`);
      return { status: "failed", error } as Outcome;
    }
    const totalMismatch = res.totalMinor !== undefined && res.totalMinor !== inv.gst.totalMinor;
    await deps.ledger.append({
      kind: "invoice", id: newId(), at: now.toISOString(), number: inv.number, dealId: inv.dealId, buyerName: inv.buyer.company || inv.buyer.name,
      provider: deps.cfg.provider ?? "razorpay", providerInvoiceId: res.providerInvoiceId, providerUrl: res.providerUrl, status: "draft",
      taxableMinor: inv.gst.taxableMinor, gstMinor: inv.gst.cgstMinor + inv.gst.sgstMinor + inv.gst.igstMinor, totalMinor: inv.gst.totalMinor,
      dueDate: inv.dueDate, totalMismatch: totalMismatch || undefined,
    });
    await deps.notify(
      `Finance: draft GST invoice ${inv.number} created for ${inv.buyer.company || inv.buyer.name}, total Rs ${minorToRupees(inv.gst.totalMinor).toFixed(2)}, due ${inv.dueDate}. ` +
      `Review and issue it in ${deps.cfg.provider ?? "razorpay"}; nothing has been sent to the client.` +
      (totalMismatch ? ` WARNING: provider total Rs ${minorToRupees(res.totalMinor!).toFixed(2)} differs from computed total. Check before issuing.` : "") +
      (res.providerUrl ? ` ${res.providerUrl}` : ""),
    );
    // Every export invoice, even a correctly rendered one, goes to Compliance: LUT validity, FIRC and the CA's confirmation are human steps.
    if (inv.gst.supply === "export") {
      const t = exportComplianceTask(deal, deps.cfg);
      await deps.notify(`Compliance task: ${t.title}. ${t.body}`);
    }
    return { status: "created", number: inv.number, providerInvoiceId: res.providerInvoiceId, totalMismatch } as Outcome;
  });
}

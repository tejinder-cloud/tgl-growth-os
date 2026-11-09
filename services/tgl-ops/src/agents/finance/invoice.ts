// Builds a GST invoice from a Won deal. Pure: no I/O. Anything uncertain becomes a hold, never a guess.
import { classifySupply, buyerStateCode, computeGst, financialYear, rupeesToMinor, validGstin } from "./gst.js";
import type { DealWon, FinanceConfig, InvoiceDraft } from "./types.js";

export type BuildResult = { ok: true; invoice: InvoiceDraft } | { ok: false; code: string; reasons: string[] };

/** Config the Architect must confirm (AGENTS.md mandate 0). Missing values hold invoicing instead of being assumed. */
export function configGaps(cfg: Partial<FinanceConfig>): string[] {
  const gaps: string[] = [];
  if (!cfg.supplierName) gaps.push("FINANCE_SUPPLIER_NAME (legal name on the GST registration)");
  if (!validGstin(cfg.supplierGstin)) gaps.push("FINANCE_SUPPLIER_GSTIN (valid 15-character GSTIN)");
  if (!cfg.supplierStateCode || !/^\d{2}$/.test(cfg.supplierStateCode)) gaps.push("FINANCE_SUPPLIER_STATE_CODE (two digits)");
  if (!cfg.sacCode || !/^\d{6}$/.test(cfg.sacCode)) gaps.push("FINANCE_SAC_CODE (6-digit SAC, confirm with the CA)");
  if (typeof cfg.gstRatePct !== "number" || !(cfg.gstRatePct >= 0 && cfg.gstRatePct <= 100)) gaps.push("FINANCE_GST_RATE (percent, confirm with the CA)");
  if (cfg.amountMode !== "exclusive" && cfg.amountMode !== "inclusive") gaps.push("FINANCE_AMOUNT_MODE (exclusive or inclusive of GST)");
  return gaps;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Partial<FinanceConfig> {
  const rate = env.FINANCE_GST_RATE?.trim();
  const terms = Number(env.FINANCE_PAYMENT_TERMS_DAYS ?? "");
  const mode = env.FINANCE_AMOUNT_MODE?.trim();
  const provider = env.FINANCE_INVOICE_PROVIDER?.trim() === "zoho" ? "zoho" : "razorpay";
  return {
    supplierName: env.FINANCE_SUPPLIER_NAME?.trim() || undefined,
    supplierGstin: env.FINANCE_SUPPLIER_GSTIN?.trim().toUpperCase() || undefined,
    supplierStateCode: env.FINANCE_SUPPLIER_STATE_CODE?.trim() || undefined,
    sacCode: env.FINANCE_SAC_CODE?.trim() || undefined,
    gstRatePct: rate ? Number(rate) : undefined,
    amountMode: mode === "inclusive" || mode === "exclusive" ? mode : undefined,
    paymentTermsDays: Number.isFinite(terms) && terms > 0 ? Math.floor(terms) : 7,
    lutNumber: env.FINANCE_LUT_NUMBER?.trim() || undefined,
    provider,
    live: env.FINANCE_LIVE === "1",
  };
}

/** IST calendar date (YYYY-MM-DD) offset by `addDays`. */
export function istDate(d: Date, addDays = 0): string {
  return new Date(d.getTime() + 330 * 60000 + addDays * 86400000).toISOString().slice(0, 10);
}

export function buildInvoice(deal: DealWon, cfgIn: Partial<FinanceConfig>, number: string, now: Date): BuildResult {
  const gaps = configGaps(cfgIn);
  if (gaps.length) return { ok: false, code: "CONFIG_MISSING", reasons: gaps.map((g) => `Architect to confirm: ${g}`) };
  const cfg = cfgIn as FinanceConfig;
  const reasons: string[] = [];
  if (!deal.dealId) reasons.push("deal id missing");
  if (!deal.buyer?.name?.trim()) reasons.push("buyer name missing");
  const minor = rupeesToMinor(deal.amountInr);
  if (minor === null) reasons.push("deal value missing or not a positive number: pricing is never inferred");
  if (deal.buyer?.gstin && !validGstin(deal.buyer.gstin)) reasons.push("buyer GSTIN fails the format check");
  if (reasons.length) return { ok: false, code: "DEAL_INCOMPLETE", reasons };

  const supply = classifySupply(deal.buyer, cfg);
  if (supply === "export") {
    return { ok: false, code: "EXPORT_REVIEW", reasons: ["buyer is outside India: zero-rated export under LUT, foreign-currency invoice and FIRC handled by a human via the LUT checklist"] };
  }
  if (supply === null) return { ok: false, code: "STATE_UNKNOWN", reasons: ["place of supply unknown: need the buyer state code or GSTIN"] };

  const stateCode = buyerStateCode(deal.buyer)!;
  const gst = computeGst(minor!, cfg.gstRatePct, cfg.amountMode, supply, stateCode);
  const notes = [
    `Supplier GSTIN ${cfg.supplierGstin}. SAC ${cfg.sacCode}. Place of supply: state code ${stateCode}.`,
    deal.buyer.gstin ? `Recipient GSTIN ${deal.buyer.gstin.toUpperCase()}.` : "Unregistered recipient (no GSTIN supplied).",
    `Deal ${deal.dealId}. Financial year ${financialYear(now)}.`,
  ];
  return {
    ok: true,
    invoice: {
      number, dealId: deal.dealId, dealName: deal.dealName, buyer: deal.buyer, sacCode: cfg.sacCode, gst,
      issueDate: istDate(now), dueDate: istDate(now, cfg.paymentTermsDays),
      description: (deal.description?.trim() || deal.dealName).slice(0, 250), notes,
    },
  };
}

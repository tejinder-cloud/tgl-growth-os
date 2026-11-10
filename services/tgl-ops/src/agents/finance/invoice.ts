// Builds a GST invoice from a Won deal. Pure: no I/O. Anything uncertain becomes a hold, never a guess.
// Tax configuration (rate, SAC codes, GSTIN, LUT number) comes only from the environment. There are no tax defaults in code.
// The generator refuses to render (returns a hold) when GST_RATE, the SAC for the deal, TGL's GSTIN, or, for an export, the LUT number is missing.
import { LUT_EXPORT_LINE, classifySupply, buyerStateCode, computeExport, computeGst, financialYear, rupeesToMinor, validGstin } from "./gst.js";
import type { DealWon, FinanceConfig, InvoiceDraft, ProductLine } from "./types.js";

export type BuildResult = { ok: true; invoice: InvoiceDraft } | { ok: false; code: string; reasons: string[] };

const SAC_RE = /^\d{6}$/;

/** Maps the GHL product custom field to a product line. Unrecognised values return undefined (the invoice is then held). */
export function parseProductLine(v: unknown): ProductLine | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["track", "software", "software_subscription", "subscription"].includes(s)) return "track";
  if (["services", "service", "managed_aeo", "ai_automation", "managed_aeo_and_ai_automation", "managed"].includes(s)) return "services";
  return undefined;
}

/** SAC for a deal's product line. With no product line the legacy single FINANCE_SAC_CODE applies if it is set. */
export function sacFor(cfg: Partial<FinanceConfig>, product: ProductLine | undefined): { sac?: string; gap?: string; code?: string } {
  if (product === "track") return cfg.sacTrack && SAC_RE.test(cfg.sacTrack) ? { sac: cfg.sacTrack } : { gap: "SAC_TRACK (6-digit SAC for the Track software subscription, confirm with the CA)", code: "CONFIG_MISSING" };
  if (product === "services") return cfg.sacServices && SAC_RE.test(cfg.sacServices) ? { sac: cfg.sacServices } : { gap: "SAC_SERVICES (6-digit SAC for Managed AEO and AI Automation, confirm with the CA)", code: "CONFIG_MISSING" };
  if (cfg.sacCode && SAC_RE.test(cfg.sacCode)) return { sac: cfg.sacCode };
  return { gap: "product line on the deal (track or services) so the SAC can be chosen", code: "PRODUCT_UNKNOWN" };
}

/** Config the Architect must confirm (AGENTS.md mandate 0). Missing values hold invoicing instead of being assumed. */
export function configGaps(cfg: Partial<FinanceConfig>): string[] {
  const gaps: string[] = [];
  if (!cfg.supplierName) gaps.push("FINANCE_SUPPLIER_NAME (legal name on the GST registration)");
  if (!validGstin(cfg.supplierGstin)) gaps.push("TGL_GSTIN (valid 15-character GSTIN of TGL)");
  if (!cfg.supplierStateCode || !/^\d{2}$/.test(cfg.supplierStateCode)) gaps.push("FINANCE_SUPPLIER_STATE_CODE (two digits, or leave unset to take it from TGL_GSTIN)");
  else if (validGstin(cfg.supplierGstin) && cfg.supplierGstin!.trim().slice(0, 2) !== cfg.supplierStateCode) gaps.push("FINANCE_SUPPLIER_STATE_CODE does not match the first two digits of TGL_GSTIN");
  if (typeof cfg.gstRatePct !== "number" || !(cfg.gstRatePct >= 0 && cfg.gstRatePct <= 100)) gaps.push("GST_RATE (percent, confirm with the CA)");
  if (cfg.amountMode !== "exclusive" && cfg.amountMode !== "inclusive") gaps.push("FINANCE_AMOUNT_MODE (exclusive or inclusive of GST)");
  const anySac = [cfg.sacTrack, cfg.sacServices, cfg.sacCode].some((s) => !!s);
  if (!anySac) gaps.push("SAC_TRACK and SAC_SERVICES (6-digit SAC codes, confirm with the CA)");
  for (const [k, v] of [["SAC_TRACK", cfg.sacTrack], ["SAC_SERVICES", cfg.sacServices], ["FINANCE_SAC_CODE", cfg.sacCode]] as const) {
    if (v && !SAC_RE.test(v)) gaps.push(`${k} must be 6 digits`);
  }
  return gaps;
}

const first = (...vals: Array<string | undefined>): string | undefined => {
  for (const v of vals) { const t = v?.trim(); if (t) return t; }
  return undefined;
};

/** Reads every tax setting from the environment. Preferred names first, legacy FINANCE_* names as fallback. No defaults for tax values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Partial<FinanceConfig> {
  const rate = first(env.GST_RATE, env.FINANCE_GST_RATE);
  const terms = Number(env.FINANCE_PAYMENT_TERMS_DAYS ?? "");
  const mode = env.FINANCE_AMOUNT_MODE?.trim();
  const provider = env.FINANCE_INVOICE_PROVIDER?.trim() === "zoho" ? "zoho" : "razorpay";
  const gstin = first(env.TGL_GSTIN, env.FINANCE_SUPPLIER_GSTIN)?.toUpperCase();
  const explicitState = first(env.FINANCE_SUPPLIER_STATE_CODE);
  return {
    supplierName: env.FINANCE_SUPPLIER_NAME?.trim() || undefined,
    supplierGstin: gstin,
    supplierStateCode: explicitState ?? (validGstin(gstin) ? gstin!.slice(0, 2) : undefined),
    sacTrack: first(env.SAC_TRACK),
    sacServices: first(env.SAC_SERVICES),
    sacCode: first(env.FINANCE_SAC_CODE),
    gstRatePct: rate ? Number(rate) : undefined,
    amountMode: mode === "inclusive" || mode === "exclusive" ? mode : undefined,
    paymentTermsDays: Number.isFinite(terms) && terms > 0 ? Math.floor(terms) : 7,
    lutNumber: first(env.LUT_NUMBER, env.FINANCE_LUT_NUMBER),
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

  const sac = sacFor(cfg, deal.product);
  if (!sac.sac) return { ok: false, code: sac.code!, reasons: [sac.code === "PRODUCT_UNKNOWN" ? `Need the ${sac.gap}: never guessed` : `Architect to confirm: ${sac.gap}`] };

  const supply = classifySupply(deal.buyer, cfg);
  if (supply === null) return { ok: false, code: "STATE_UNKNOWN", reasons: ["place of supply unknown: need the buyer state code or GSTIN"] };

  const notes: string[] = [];
  let gst;
  let description = (deal.description?.trim() || deal.dealName).slice(0, 250);
  let lutNumber: string | undefined;
  if (supply === "export") {
    if (!cfg.lutNumber) {
      return { ok: false, code: "EXPORT_REVIEW", reasons: ["buyer is outside India: export under LUT needs LUT_NUMBER in the environment; the invoice is not rendered without it. Compliance to work finance/compliance/lut-checklist.md"] };
    }
    lutNumber = cfg.lutNumber;
    gst = computeExport(minor!);
    const lutLine = `${LUT_EXPORT_LINE}. LUT No. ${lutNumber}.`;
    description = `${description.slice(0, Math.max(0, 250 - lutLine.length - 3))} | ${lutLine}`;
    notes.push(lutLine);
    notes.push(`Supplier GSTIN ${cfg.supplierGstin}. SAC ${sac.sac}. Place of supply: ${gst.placeOfSupplyCode} (other countries). Zero-rated, GST 0%.`);
    notes.push(deal.buyer.country ? `Recipient country: ${deal.buyer.country}.` : "Recipient country not stated.");
  } else {
    const stateCode = buyerStateCode(deal.buyer)!;
    gst = computeGst(minor!, cfg.gstRatePct, cfg.amountMode, supply, stateCode);
    notes.push(`Supplier GSTIN ${cfg.supplierGstin}. SAC ${sac.sac}. Place of supply: state code ${stateCode}.`);
    notes.push(deal.buyer.gstin ? `Recipient GSTIN ${deal.buyer.gstin.toUpperCase()}.` : "Unregistered recipient (no GSTIN supplied).");
  }
  notes.push(`Deal ${deal.dealId}. Financial year ${financialYear(now)}.`);
  return {
    ok: true,
    invoice: {
      number, dealId: deal.dealId, dealName: deal.dealName, buyer: deal.buyer, sacCode: sac.sac, gst,
      issueDate: istDate(now), dueDate: istDate(now, cfg.paymentTermsDays),
      description, notes, lutNumber, product: deal.product,
    },
  };
}

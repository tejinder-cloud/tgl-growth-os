// GST maths and supply classification. Pure functions, integer paise, no I/O.
import type { AmountMode, Buyer, FinanceConfig, GstBreakup, Supply } from "./types.js";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function validGstin(v: string | undefined): boolean {
  return !!v && GSTIN_RE.test(v.trim().toUpperCase());
}

export function isIndia(country: string | undefined): boolean {
  if (!country || !country.trim()) return true;          // domestic is the default market
  const c = country.trim().toLowerCase();
  return c === "in" || c === "ind" || c === "india";
}

/** Recipient state code: explicit value first, else the first two digits of a valid GSTIN. Null means unknown: never guessed. */
export function buyerStateCode(b: Buyer): string | null {
  if (b.stateCode && /^\d{2}$/.test(b.stateCode.trim())) return b.stateCode.trim();
  if (validGstin(b.gstin)) return b.gstin!.trim().slice(0, 2);
  return null;
}

export function classifySupply(b: Buyer, cfg: Pick<FinanceConfig, "supplierStateCode">): Supply | null {
  if (!isIndia(b.country)) return "export";
  const sc = buyerStateCode(b);
  if (!sc) return null;
  return sc === cfg.supplierStateCode ? "intra_state" : "inter_state";
}

/**
 * Splits an amount (paise) into taxable value and GST.
 * Intra-state: CGST and SGST are always equal halves; the taxable value absorbs any paise rounding so the total
 * of an inclusive deal equals the agreed amount exactly. Inter-state: single IGST line.
 */
export function computeGst(amountMinor: number, ratePct: number, mode: AmountMode, supply: Exclude<Supply, "export">, placeOfSupplyCode: string): GstBreakup {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error("amountMinor must be a positive integer");
  if (!(ratePct >= 0 && ratePct <= 100)) throw new Error("ratePct out of range");
  const base = mode === "inclusive" ? Math.round((amountMinor * 100) / (100 + ratePct)) : amountMinor;
  let taxable = base, cgst = 0, sgst = 0, igst = 0, total: number;
  if (supply === "intra_state") {
    const half = Math.round((base * ratePct) / 200);
    cgst = half; sgst = half;
    if (mode === "inclusive") { taxable = amountMinor - 2 * half; total = amountMinor; }
    else total = base + 2 * half;
  } else {
    igst = Math.round((base * ratePct) / 100);
    if (mode === "inclusive") { taxable = amountMinor - igst; total = amountMinor; }
    else total = base + igst;
  }
  return { supply, ratePct, taxableMinor: taxable, cgstMinor: cgst, sgstMinor: sgst, igstMinor: igst, totalMinor: total, placeOfSupplyCode };
}

export function rupeesToMinor(r: number): number | null {
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return null;
  return Math.round(r * 100);
}

export const minorToRupees = (m: number): number => Math.round(m) / 100;

/** Indian financial year label for a date, e.g. 2026-11-09 gives "26-27"; 2027-02-01 gives "26-27". */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

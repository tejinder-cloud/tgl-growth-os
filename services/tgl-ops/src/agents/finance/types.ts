// Finance agent shared types (plan Day 13). All money is integer minor units (paise) so GST maths never drifts.

export type Provider = "razorpay" | "zoho";
export type Supply = "intra_state" | "inter_state" | "export";
export type AmountMode = "exclusive" | "inclusive";

/**
 * Product line of a deal. It decides the SAC code (issue #141): "track" is the software subscription (Track),
 * "services" is Managed AEO and AI Automation. Never inferred from the deal name.
 */
export type ProductLine = "track" | "services";

export interface Buyer {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  gstin?: string;
  /** Two-digit GST state code of the recipient. Derived from the GSTIN when absent. */
  stateCode?: string;
  /** ISO country code or name. Anything other than India is an export under LUT (0% GST, LUT number required). */
  country?: string;
  address?: string;
}

/** Normalised "deal Won" event. The amount is the agreed deal value, never inferred or discounted here. */
export interface DealWon {
  dealId: string;
  dealName: string;
  /** Agreed deal value in rupees (decimals allowed). Whether it includes GST is set by FINANCE_AMOUNT_MODE. */
  amountInr: number;
  buyer: Buyer;
  /** Product line from the GHL deal custom field. Missing or unrecognised: the invoice is held, never guessed. */
  product?: ProductLine;
  wonAt?: string;
  description?: string;
}

/**
 * Every tax value here comes from the environment (see loadConfig in invoice.ts). Nothing is defaulted in code:
 * a missing value makes the invoice generator refuse to render.
 */
export interface FinanceConfig {
  supplierName: string;
  /** TGL's GSTIN (env TGL_GSTIN, legacy FINANCE_SUPPLIER_GSTIN). */
  supplierGstin: string;
  /** Two-digit state of TGL's registration. Taken from env, else the first two digits of the GSTIN. */
  supplierStateCode: string;
  /** SAC for the software subscription (Track). Env SAC_TRACK. */
  sacTrack?: string;
  /** SAC for Managed AEO and AI Automation services. Env SAC_SERVICES. */
  sacServices?: string;
  /** Legacy single SAC (FINANCE_SAC_CODE). Used only when a deal carries no product line. */
  sacCode?: string;
  /** Env GST_RATE (legacy FINANCE_GST_RATE). */
  gstRatePct: number;
  amountMode: AmountMode;
  paymentTermsDays: number;
  /** Env LUT_NUMBER (legacy FINANCE_LUT_NUMBER). Required to render any export invoice. */
  lutNumber?: string;
  provider: Provider;
  /** Provider writes happen only when true (FINANCE_LIVE=1). Otherwise the invoice is built and returned as a dry run. */
  live: boolean;
}

export interface GstBreakup {
  supply: Supply;
  ratePct: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  placeOfSupplyCode: string;
}

export interface InvoiceDraft {
  number: string;
  dealId: string;
  dealName: string;
  buyer: Buyer;
  sacCode: string;
  gst: GstBreakup;
  issueDate: string;
  dueDate: string;
  description: string;
  notes: string[];
  /** Set on export invoices only. */
  lutNumber?: string;
  product?: ProductLine;
}

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export interface InvoiceEntry {
  kind: "invoice";
  id: string;
  at: string;
  number: string;
  dealId: string;
  buyerName: string;
  provider: Provider;
  providerInvoiceId: string;
  providerUrl?: string;
  status: InvoiceStatus;
  taxableMinor: number;
  gstMinor: number;
  totalMinor: number;
  dueDate: string;
  /** True when the provider's total differed from the total computed here. Needs a human look before issue. */
  totalMismatch?: boolean;
}

export interface PaymentEntry {
  kind: "payment";
  id: string;
  at: string;
  number: string;
  amountMinor: number;
  reference?: string;
}

export interface ExpenseEntry {
  kind: "expense";
  id: string;
  at: string;
  /** Audit this cost belongs to. Costs with no audit use category "overhead". */
  auditId?: string;
  category: "audit_api" | "overhead";
  vendor: string;
  description?: string;
  usd?: number;
  fxInrPerUsd?: number;
  /** INR paise. Null when only USD was supplied without an FX rate: never guessed. */
  amountMinor: number | null;
}

export interface ReminderEntry {
  kind: "reminder";
  id: string;
  at: string;
  number: string;
  step: number;
}

export interface StatusEntry {
  kind: "status";
  id: string;
  at: string;
  number: string;
  status: InvoiceStatus;
}

export type LedgerEntry = InvoiceEntry | PaymentEntry | ExpenseEntry | ReminderEntry | StatusEntry;

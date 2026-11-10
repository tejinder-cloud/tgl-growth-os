// Finance agent shared types (plan Day 13). All money is integer minor units (paise) so GST maths never drifts.

export type Provider = "razorpay" | "zoho";
export type Supply = "intra_state" | "inter_state" | "export";
export type AmountMode = "exclusive" | "inclusive";

export interface Buyer {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  gstin?: string;
  /** Two-digit GST state code of the recipient. Derived from the GSTIN when absent. */
  stateCode?: string;
  /** ISO country code or name. Anything other than India routes to the export (LUT) review path. */
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
  wonAt?: string;
  description?: string;
}

export interface FinanceConfig {
  supplierName: string;
  supplierGstin: string;
  supplierStateCode: string;
  sacCode: string;
  gstRatePct: number;
  amountMode: AmountMode;
  paymentTermsDays: number;
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

/**
 * Product line of a deal. It decides the SAC code (issue #141): "track" is the software subscription (Track),
 * "services" is Managed AEO and AI Automation. Never inferred from the deal name.
 */
export type ProductLine = "track" | "services";

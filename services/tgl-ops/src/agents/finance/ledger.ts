// Finance ledger: append-only JSONL (one file per stream) so income and per-audit API expenses are auditable.
// Default directory is finance/ledger (override with FINANCE_LEDGER_DIR). Swap the LedgerStore for a Supabase-backed
// implementation if the host filesystem is ephemeral (see SKILL.md section 4).
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { financialYear } from "./gst.js";
import type { ExpenseEntry, InvoiceEntry, InvoiceStatus, LedgerEntry, PaymentEntry } from "./types.js";

export interface LedgerStore {
  append(entry: LedgerEntry): Promise<void>;
  all(): Promise<LedgerEntry[]>;
  /** Serialises read-modify-append sequences such as invoice numbering. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

const FILES: Record<LedgerEntry["kind"], string> = {
  invoice: "income.jsonl",
  payment: "income.jsonl",
  status: "income.jsonl",
  reminder: "collections.jsonl",
  expense: "expenses.jsonl",
};

export class FileLedger implements LedgerStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string = process.env.FINANCE_LEDGER_DIR?.trim() || path.join(process.cwd(), "finance", "ledger")) {}

  async append(entry: LedgerEntry): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.appendFile(path.join(this.dir, FILES[entry.kind]), JSON.stringify(entry) + "\n", "utf8");
  }

  async all(): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = [];
    for (const f of new Set(Object.values(FILES))) {
      let text = "";
      try { text = await fs.readFile(path.join(this.dir, f), "utf8"); } catch (e: any) { if (e?.code !== "ENOENT") throw e; }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        out.push(JSON.parse(line) as LedgerEntry);               // a corrupt line must fail loudly, never be skipped
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/** In-memory store for tests. */
export class MemoryLedger implements LedgerStore {
  entries: LedgerEntry[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  async append(e: LedgerEntry) { this.entries.push(e); }
  async all() { return [...this.entries]; }
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export const newId = (): string => randomUUID();

export function invoiceEntries(all: LedgerEntry[]): InvoiceEntry[] {
  return all.filter((e): e is InvoiceEntry => e.kind === "invoice");
}

export function findInvoiceByDeal(all: LedgerEntry[], dealId: string): InvoiceEntry | undefined {
  return invoiceEntries(all).find((i) => i.dealId === dealId && effectiveStatus(all, i) !== "cancelled");
}

export function findInvoiceByProviderId(all: LedgerEntry[], providerInvoiceId: string): InvoiceEntry | undefined {
  return invoiceEntries(all).find((i) => i.providerInvoiceId === providerInvoiceId);
}

/** Latest status event wins; a recorded payment covering the total forces "paid". */
export function effectiveStatus(all: LedgerEntry[], inv: InvoiceEntry): InvoiceStatus {
  let status: InvoiceStatus = inv.status;
  for (const e of all) if (e.kind === "status" && e.number === inv.number) status = e.status;
  if (status !== "cancelled" && paidMinor(all, inv.number) >= inv.totalMinor) return "paid";
  return status;
}

export function paidMinor(all: LedgerEntry[], number: string): number {
  return all.filter((e): e is PaymentEntry => e.kind === "payment" && e.number === number).reduce((s, p) => s + p.amountMinor, 0);
}

/** Next consecutive invoice number for the financial year: TGL/26-27/0001 (14 chars, within the 16-character GST limit). */
export function nextInvoiceNumber(all: LedgerEntry[], now: Date): string {
  const fy = financialYear(now);
  const prefix = `TGL/${fy}/`;
  let max = 0;
  for (const i of invoiceEntries(all)) if (i.number.startsWith(prefix)) max = Math.max(max, parseInt(i.number.slice(prefix.length), 10) || 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function buildExpense(input: { auditId?: string; vendor: string; description?: string; usd?: number; fxInrPerUsd?: number; amountMinor?: number; category?: "audit_api" | "overhead"; at?: string }): ExpenseEntry {
  let amountMinor: number | null = null;
  if (typeof input.amountMinor === "number" && Number.isInteger(input.amountMinor) && input.amountMinor >= 0) amountMinor = input.amountMinor;
  else if (typeof input.usd === "number" && input.usd >= 0 && typeof input.fxInrPerUsd === "number" && input.fxInrPerUsd > 0) amountMinor = Math.round(input.usd * input.fxInrPerUsd * 100);
  return {
    kind: "expense", id: newId(), at: input.at ?? new Date().toISOString(),
    auditId: input.auditId, category: input.category ?? (input.auditId ? "audit_api" : "overhead"),
    vendor: input.vendor, description: input.description, usd: input.usd, fxInrPerUsd: input.fxInrPerUsd, amountMinor,
  };
}

export interface LedgerSummary {
  invoicedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  gstCollectedMinor: number;
  expenseMinor: number;
  unconvertedExpenses: number;
  perAudit: Record<string, { expenseMinor: number; entries: number; unconverted: number }>;
}

export function summarise(all: LedgerEntry[]): LedgerSummary {
  const live = invoiceEntries(all).filter((i) => effectiveStatus(all, i) !== "cancelled" && effectiveStatus(all, i) !== "draft");
  const invoicedMinor = live.reduce((s, i) => s + i.totalMinor, 0);
  const gstCollectedMinor = live.reduce((s, i) => s + i.gstMinor, 0);
  const receivedMinor = all.filter((e): e is PaymentEntry => e.kind === "payment").reduce((s, p) => s + p.amountMinor, 0);
  const perAudit: LedgerSummary["perAudit"] = {};
  let expenseMinor = 0, unconvertedExpenses = 0;
  for (const e of all) {
    if (e.kind !== "expense") continue;
    if (e.amountMinor === null) unconvertedExpenses++; else expenseMinor += e.amountMinor;
    if (e.auditId) {
      const row = (perAudit[e.auditId] ??= { expenseMinor: 0, entries: 0, unconverted: 0 });
      row.entries++;
      if (e.amountMinor === null) row.unconverted++; else row.expenseMinor += e.amountMinor;
    }
  }
  return { invoicedMinor, receivedMinor, outstandingMinor: Math.max(0, invoicedMinor - receivedMinor), gstCollectedMinor, expenseMinor, unconvertedExpenses, perAudit };
}

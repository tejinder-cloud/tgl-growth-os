// Collections cadence. Plans reminder DRAFTS for issued, unpaid invoices. Nothing is sent to a client by the service.
import { effectiveStatus, invoiceEntries, newId, paidMinor, type LedgerStore } from "./ledger.js";
import { istDate } from "./invoice.js";
import { minorToRupees } from "./gst.js";
import type { InvoiceEntry, LedgerEntry } from "./types.js";

/** Offsets in days from the due date. Step 5 is an escalation to the Architect, not a client message. */
export const CADENCE: ReadonlyArray<{ step: number; offsetDays: number; audience: "client" | "architect"; purpose: string }> = [
  { step: 1, offsetDays: -3, audience: "client", purpose: "Heads-up: invoice due in 3 days, payment link attached." },
  { step: 2, offsetDays: 0, audience: "client", purpose: "Due today: one line, payment link." },
  { step: 3, offsetDays: 3, audience: "client", purpose: "Gentle reminder: ask if anything blocks payment (PO, approval, wrong GSTIN)." },
  { step: 4, offsetDays: 7, audience: "client", purpose: "Second reminder: offer a call with the Architect if there is a query on the invoice." },
  { step: 5, offsetDays: 15, audience: "architect", purpose: "Escalate: Architect calls the owner. Any pause of delivery or late fee is the Architect's decision." },
];

export interface ReminderDraft {
  number: string; step: number; audience: "client" | "architect"; daysFromDue: number; outstandingMinor: number; text: string;
}

const dayNum = (isoDate: string) => Date.parse(isoDate + "T00:00:00Z") / 86400000;

/**
 * For each issued invoice with a balance, returns at most ONE draft: the latest cadence step that is due and is
 * later than any step already logged. Earlier missed steps are skipped, so a late-issued invoice never floods the
 * client with catch-up reminders and a step is never repeated or walked backwards.
 */
export function planCollections(all: LedgerEntry[], now: Date): ReminderDraft[] {
  const today = dayNum(istDate(now));
  const out: ReminderDraft[] = [];
  for (const inv of invoiceEntries(all)) {
    if (effectiveStatus(all, inv) !== "issued") continue;
    const balance = inv.totalMinor - paidMinor(all, inv.number);
    if (balance <= 0) continue;
    const daysFromDue = today - dayNum(inv.dueDate);
    const maxLogged = all.reduce((m, e) => (e.kind === "reminder" && e.number === inv.number ? Math.max(m, e.step) : m), 0);
    const due = CADENCE.filter((c) => daysFromDue >= c.offsetDays && c.step > maxLogged);
    const next = due[due.length - 1];
    if (!next) continue;
    out.push({ number: inv.number, step: next.step, audience: next.audience, daysFromDue, outstandingMinor: balance, text: draftText(inv, next.step, next.purpose, balance, daysFromDue) });
  }
  return out;
}

function draftText(inv: InvoiceEntry, step: number, purpose: string, balance: number, daysFromDue: number): string {
  const when = daysFromDue < 0 ? `due in ${-daysFromDue} day(s)` : daysFromDue === 0 ? "due today" : `${daysFromDue} day(s) overdue`;
  return `Reminder draft ${step} for ${inv.buyerName}, invoice ${inv.number}, Rs ${minorToRupees(balance).toFixed(2)} outstanding, ${when}. Purpose: ${purpose}${inv.providerUrl ? ` Payment link: ${inv.providerUrl}` : ""}`;
}

/** Posts each draft to the Architect via notify and logs the step so it is never repeated. Returns the drafts. */
export async function runCollections(ledger: LedgerStore, now: Date, notify: (t: string) => Promise<void>): Promise<ReminderDraft[]> {
  return ledger.withLock(async () => {
    const drafts = planCollections(await ledger.all(), now);
    for (const d of drafts) {
      await notify(`Finance collections: ${d.text}. Draft only; a human sends it.`);
      await ledger.append({ kind: "reminder", id: newId(), at: now.toISOString(), number: d.number, step: d.step });
    }
    return drafts;
  });
}

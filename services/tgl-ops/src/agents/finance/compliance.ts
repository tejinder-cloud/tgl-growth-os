// Compliance hand-off for export of services under a Letter of Undertaking (LUT). Text only: a human files the LUT.
import type { DealWon, FinanceConfig } from "./types.js";

export interface ComplianceTask { forAgent: "compliance"; title: string; body: string; checklist: string }

export const LUT_CHECKLIST_PATH = "finance/compliance/lut-checklist.md";

export function exportComplianceTask(deal: DealWon, cfg: Partial<FinanceConfig>): ComplianceTask {
  const lut = cfg.lutNumber
    ? `LUT on file in config: ${cfg.lutNumber}. Confirm it covers the financial year of the invoice date.`
    : "No LUT number is configured (FINANCE_LUT_NUMBER). Do not issue a zero-rated invoice until a valid LUT ARN for the financial year is confirmed.";
  return {
    forAgent: "compliance",
    title: `LUT / export invoice review for deal ${deal.dealId || "(no id)"}: ${deal.buyer?.name || deal.dealName}`,
    body: `Buyer country: ${deal.buyer?.country || "not stated"}. ${lut} Work through ${LUT_CHECKLIST_PATH}. The service did not create an invoice; foreign-currency invoicing and FIRC are manual.`,
    checklist: LUT_CHECKLIST_PATH,
  };
}

// services/tgl-ops/src/agents/pipeline/stages.ts
// The sales pipeline's stages and the rule for moving between them (Architect, 21 Nov 2026).
export const STAGES = ["in_outreach", "audit_requested", "replied", "call_booked", "call_done", "proposal_sent", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  in_outreach: "In outreach",
  audit_requested: "Audit requested",
  replied: "Replied",
  call_booked: "Call booked",
  call_done: "Call done",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

export type Currency = "INR" | "USD";

export interface HistoryEntry {
  stage: Stage;
  at: string;
  by: string;
  note?: string;
}

export interface Deal {
  id: string;
  company: string;
  contact_name?: string | null;
  contact_email?: string | null;
  city?: string | null;
  source: "outreach" | "site" | "booking" | "manual";
  prospect_id?: string | null;
  site_lead_id?: string | null;
  booking_id?: string | null;
  stage: Stage;
  amount?: number | null;
  currency?: Currency | null;
  lost_reason?: string | null;
  no_show?: boolean;
  call_at?: string | null;
  call_prompted_at?: string | null;
  history: HistoryEntry[];
}

const RANK: Record<Stage, number> = { in_outreach: 0, audit_requested: 1, replied: 2, call_booked: 3, call_done: 4, proposal_sent: 5, won: 6, lost: 6 };

export function isClosed(stage: Stage): boolean {
  return stage === "won" || stage === "lost";
}

/**
 * Automatic signals only move a deal forward: a reply that arrives after a call is booked leaves it at
 * "Call booked". Closed deals never move automatically.
 */
export function canAdvance(from: Stage, to: Stage): boolean {
  if (isClosed(from)) return false;
  return RANK[to] > RANK[from];
}

export function money(amount: number, currency: Currency): string {
  return currency === "USD"
    ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} a month`
    : `Rs ${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} a month`;
}

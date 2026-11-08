// services/tgl-ops/src/agents/sales-desk/types.ts
// Shared types for the Sales Desk. Prospect shape is structural so this module does not depend on
// the researcher's schema file; it reads only fields the researcher and sequencer already persist.

export interface SalesProspect {
  id: string;
  company: string;
  category?: string;
  city?: string;
  website?: string;
  door?: string;
  status?: string;
  fit_score?: number;
  fit_reasons?: string[];
  decision_maker?: { name?: string; role?: string; email?: string; phone?: string; source?: string };
  signals?: Record<string, any>;
  source_refs?: string[];
}

export interface Appointment {
  id: string;
  contactId: string;
  /** ISO timestamps. */
  startTime: string;
  endTime: string;
  title?: string;
  /** GHL appointment status, for example confirmed, showed, noshow, cancelled. */
  status?: string;
}

export interface PricingLine {
  label: string;
  /** Exact amount text approved by the Architect, for example "INR 9,999 per month". Never computed here. */
  amount: string;
  note?: string;
}

export type ProposalStatus = "pending" | "drafted" | "held" | "sent";

export interface ProposalRecord {
  appointment_id: string;
  call_ended_at: string;
  due_by: string;
  status: ProposalStatus;
  attempts: number;
  drafted_at?: string;
  sla_met?: boolean;
  hold_reason?: string;
  body_markdown?: string;
  sent_at?: string;
  warned_at?: string;
  breach_posted_at?: string;
  review_task_id?: string;
  dry_run?: boolean;
}

export interface CadenceTaskRecord {
  step: number;
  due_at: string;
  ghl_task_id?: string;
}

export interface CadenceRecord {
  anchor_sent_at: string;
  registered_at: string;
  tasks: CadenceTaskRecord[];
  workflow_enrolled?: boolean;
  dry_run: boolean;
  /** True once every task, the tag and (when configured) the workflow enrolment are done. */
  complete?: boolean;
  last_error?: string;
}

/** Persisted in prospects.signals.sales_desk */
export interface SalesDeskState {
  dossier_appointment_ids: string[];
  proposal?: ProposalRecord;
  cadence?: CadenceRecord;
}

export type SendMode = "live" | "dry_run";

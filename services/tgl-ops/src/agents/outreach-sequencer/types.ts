// services/tgl-ops/src/agents/outreach-sequencer/types.ts

export type TouchChannel = "Email" | "WhatsApp";

export type SequenceState =
  | "active"
  | "paused"
  | "replied"
  | "completed"
  | "opted_out";

export type ReplyIntent =
  | "opt_out"
  | "out_of_office"
  | "meeting_request"
  | "positive_interest"
  | "question"
  | "referral"
  | "not_interested"
  | "other";

export interface TouchRecord {
  n: number;
  channel: TouchChannel;
  sent_at: string;
  message_id?: string;
  dry_run: boolean;
  attachment_url?: string;
}

export interface AuditSummary {
  visibility_percent: number;
  mentions: number;
  total_queries: number;
  mentions_by_engine: Record<string, number>;
  top_competitors: string[];
  top_cited_domains: string[];
  audited_at: string;
}

/** Sequence state persisted in prospects.signals.outreach */
export interface OutreachState {
  state: SequenceState;
  ghl_contact_id?: string;
  enrolled_at: string;
  /** Next touch number to send (1-5). 6 means complete. */
  next_touch: number;
  /** ISO timestamp from which next_touch may be sent. */
  next_due_at: string;
  touches: TouchRecord[];
  onepager_url?: string;
  onepager_path?: string;
  audit?: AuditSummary;
  /** Consecutive failed audit / one-pager builds for the current touch. */
  audit_attempts?: number;
  /** Consecutive failed GHL sends for the current touch. */
  send_failures?: number;
  pause_reason?: string;
  last_reply_message_id?: string;
  last_reply_intent?: ReplyIntent;
  last_reply_at?: string;
  /** True once the reply has been posted to the Sales Desk; guards webhook retries. */
  last_reply_routed?: boolean;
}

export interface SequenceTouchDef {
  n: number;
  /** Business days after enrollment. */
  offsetBusinessDays: number;
  /** Preferred channel; WhatsApp falls back to Email when unavailable. */
  channel: TouchChannel;
  attachOnePager: boolean;
}

export interface RenderedMessage {
  subject?: string;
  html?: string;
  text: string;
}

// services/tgl-ops/src/agents/outreach-sequencer/types.ts
import type { ProspectRecord } from "../prospect-researcher/types.js";

export type TouchChannel = "email" | "whatsapp";

export interface TouchTemplate {
  touchNo: number; // 1..5
  channel: TouchChannel;
  subject?: string;
  dayOffset: number; // days after the previous touch (0 for touch 1)
  attachAudit: boolean;
  needsAudit: boolean;
  body: string;
  file: string;
}

export interface AuditVars {
  audit_date: string;
  visibility_score: string;
  mentions: string;
  total_queries: string;
  weakest_engine: string;
  winning_competitor: string;
  top_citation_gap: string;
}

export interface AuditOutcome {
  vars: AuditVars;
  pdf?: { buffer: Buffer; sizeBytes: number; filename: string };
  rawPath?: string;
  fixture: boolean;
}

export interface RenderedTouch {
  touchNo: number;
  channel: TouchChannel;
  subject?: string;
  body: string;
  attachAudit: boolean;
}

export type TouchStatus = "sent" | "failed" | "replied" | "opted_out";

export interface TouchRecord {
  prospectKey: string;
  touchNo: number; // 0 = prospect-level marker (replied / opted_out)
  channel: TouchChannel | "none";
  status: TouchStatus;
  sentAt: string;
  ghlMessageId?: string;
  error?: string;
  audit?: AuditVars;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface SequencerDeps {
  live: boolean;
  now(): Date;
  dailyCap: number;
  perTickCap: number;
  loadProspects(): Promise<ProspectRecord[]>;
  loadTemplates(): Promise<TouchTemplate[]>;
  loadHistory(keys: string[]): Promise<Record<string, TouchRecord[]>>;
  countSentToday(): Promise<number>;
  runAudit(prospect: ProspectRecord, opts: { fixture: boolean }): Promise<AuditOutcome>;
  sendEmail(args: {
    prospect: ProspectRecord;
    subject: string;
    body: string;
    attachment?: { buffer: Buffer; filename: string };
  }): Promise<SendResult>;
  sendWhatsApp(args: { prospect: ProspectRecord; body: string }): Promise<SendResult>;
  recordTouch(rec: TouchRecord): Promise<void>;
  notify(text: string): Promise<void>;
  writeLog(dateStr: string, markdown: string): Promise<void>;
}

export interface TickOptions {
  includeTestProspect?: boolean;
  enforceWindow?: boolean;
}

export interface TickResult {
  mode: "dry-run" | "live";
  skippedReason?: string;
  testProspectTouches: RenderedTouch[];
  actions: { prospect: string; touchNo: number; channel: string; outcome: string }[];
  logMarkdown: string;
}

export function prospectKey(p: ProspectRecord): string {
  return p.id || p.website.toLowerCase().trim();
}

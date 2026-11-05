// services/tgl-ops/src/agents/outreach-sequencer/execute.ts
// Per-touch executor for the 5-touch sequence (SKILL.md Playbooks A and C). It implements TickPorts.execute
// from worker.ts: load the prospect's sequence state, build the audit and one-pager when the touch needs
// them, render the message, send through GHL when live, and persist the new state.
//
// Everything that touches the outside world (Supabase, GHL, the audit engine, PDF storage) is injected
// through ExecutorPorts, so these rules can be exercised offline. The composition root adapts the real
// store, GHL client and one-pager builder to ExecutorPorts.
//
// Rules enforced here:
//   1. Stale or non-active sequences are skipped, never sent (reply, opt-out, pause, completed).
//   2. Touch 2 is held, never sent bare: if the audit, the PDF or its signed URL is missing, the touch is held.
//   3. The audit and PDF are cached in the sequence state, so a retry never pays for a second audit.
//   4. Dry run builds and renders everything but does not contact GHL and does not advance the sequence.
//   5. Three consecutive failures on a touch pause the sequence (worker.ts posts the single #alerts line).
import { SEQUENCE, TOTAL_TOUCHES, dueAtForTouch, renderTouch, resolveChannel } from "./sequence.js";
import type { AuditSummary, OutreachState, RenderedMessage, TouchChannel, TouchRecord } from "./types.js";
import { MAX_HOLD_ATTEMPTS, type DueTouch, type ExecuteResult, type SendMode } from "./worker.js";

export interface ProspectView {
  id: string;
  company: string;
  category: string;
  city: string;
  email?: string;
  phone?: string;
  decisionMakerName?: string;
  /** Sequence state from prospects.signals.outreach. Absent means the prospect is not enrolled. */
  outreach?: OutreachState;
}

export interface OutboundMessage {
  contactId: string;
  channel: TouchChannel;
  message: RenderedMessage;
  /** Signed URL of the prospect's one-pager. Present on touch 2 only. */
  attachmentUrl?: string;
}

export interface ExecutorPorts {
  now: () => Date;
  senderName: string;
  /** True when WhatsApp is enabled on the GHL location. */
  whatsappEnabled: boolean;
  loadProspect: (prospectId: string) => Promise<ProspectView | null>;
  /** Persist the full sequence state to prospects.signals.outreach. */
  saveState: (prospectId: string, state: OutreachState) => Promise<void>;
  /** Run the short-form audit, render the one-page PDF and upload it. Returns the audit summary and storage path. */
  buildOnePager: (prospect: ProspectView) => Promise<{ audit: AuditSummary; path: string }>;
  /** Signed URL (7 days) for a stored one-pager. */
  signOnePagerUrl: (path: string) => Promise<string>;
  /** Create or update the GHL contact and return its id. */
  upsertContact: (prospect: ProspectView) => Promise<string>;
  /** Send one message through GHL. Only called in live mode. */
  sendMessage: (msg: OutboundMessage) => Promise<{ messageId?: string }>;
}

function errMessage(err: unknown): string {
  const e = err as { message?: string } | undefined;
  return (e && e.message) || String(err);
}

/** Records the failure on the state. Pauses the sequence once the hold limit is reached. */
function withFailure(state: OutreachState, kind: "audit_attempts" | "send_failures", reason: string): { state: OutreachState; attempts: number } {
  const attempts = (state[kind] || 0) + 1;
  const next: OutreachState = { ...state, [kind]: attempts };
  if (attempts >= MAX_HOLD_ATTEMPTS) {
    next.state = "paused";
    next.pause_reason = `touch ${state.next_touch}: ${reason}`;
  }
  return { state: next, attempts };
}

export function makeExecute(ports: ExecutorPorts): (item: DueTouch, mode: SendMode) => Promise<ExecuteResult> {
  return async function execute(item: DueTouch, mode: SendMode): Promise<ExecuteResult> {
    const prospect = await ports.loadProspect(item.prospectId);
    if (!prospect) return { status: "skipped", reason: "prospect not found" };

    let state = prospect.outreach;
    if (!state) return { status: "skipped", reason: "prospect is not enrolled" };
    if (state.state !== "active") return { status: "skipped", reason: `sequence is ${state.state}` };
    if (state.next_touch !== item.touch) return { status: "skipped", reason: `stale: next touch is ${state.next_touch}` };

    const def = SEQUENCE.find((t) => t.n === item.touch);
    if (!def) return { status: "skipped", reason: `unknown touch ${item.touch}` };

    // Touches 2 and 3 quote the prospect's own audit; touch 2 also attaches the PDF.
    const needsAudit = item.touch === 2 || item.touch === 3;
    let attachmentUrl: string | undefined;

    if (needsAudit) {
      try {
        if (!state.audit || !state.onepager_path) {
          const built = await ports.buildOnePager(prospect);
          state = { ...state, audit: built.audit, onepager_path: built.path };
          // Persist at once so a failure further down never repeats the paid audit.
          await ports.saveState(prospect.id, state);
        }
        if (def.attachOnePager) {
          attachmentUrl = await ports.signOnePagerUrl(state.onepager_path as string);
          if (!attachmentUrl) throw new Error("one-pager signed URL was empty");
        }
      } catch (err) {
        const reason = `audit or one-pager failed: ${errMessage(err)}`;
        const failed = withFailure(state, "audit_attempts", reason);
        await ports.saveState(prospect.id, failed.state);
        return { status: "held", reason, attempts: failed.attempts };
      }
    }

    const channel = resolveChannel(def.channel, { hasPhone: Boolean(prospect.phone), whatsappEnabled: ports.whatsappEnabled });

    let message: RenderedMessage;
    try {
      message = renderTouch(item.touch, channel, {
        company: prospect.company,
        category: prospect.category,
        city: prospect.city,
        decisionMakerName: prospect.decisionMakerName,
        audit: state.audit,
        senderName: ports.senderName,
      });
    } catch (err) {
      const reason = `render failed: ${errMessage(err)}`;
      const failed = withFailure(state, "audit_attempts", reason);
      await ports.saveState(prospect.id, failed.state);
      return { status: "held", reason, attempts: failed.attempts };
    }

    const nowIso = ports.now().toISOString();

    if (mode === "dry_run") {
      // Record the dry run (one record per touch number) but do not advance: the sequence has not really moved.
      const record: TouchRecord = { n: item.touch, channel, sent_at: nowIso, dry_run: true, attachment_url: attachmentUrl };
      const touches = state.touches.filter((t) => !(t.dry_run && t.n === item.touch)).concat(record);
      await ports.saveState(prospect.id, { ...state, touches });
      return { status: "dry_run", attachmentUrl };
    }

    // Live send. Touch 2 never goes out without the attachment.
    if (def.attachOnePager && !attachmentUrl) {
      return { status: "held", reason: "touch 2 has no one-pager attachment", attempts: state.audit_attempts };
    }

    try {
      let contactId = state.ghl_contact_id;
      if (!contactId) {
        contactId = await ports.upsertContact(prospect);
        state = { ...state, ghl_contact_id: contactId };
      }
      const sent = await ports.sendMessage({ contactId, channel, message, attachmentUrl });

      const record: TouchRecord = {
        n: item.touch,
        channel,
        sent_at: nowIso,
        message_id: sent.messageId,
        dry_run: false,
        attachment_url: attachmentUrl,
      };
      const touches = state.touches.filter((t) => !(t.dry_run && t.n === item.touch)).concat(record);
      const done = item.touch >= TOTAL_TOUCHES;
      const next: OutreachState = {
        ...state,
        touches,
        audit_attempts: 0,
        send_failures: 0,
        pause_reason: undefined,
        next_touch: done ? TOTAL_TOUCHES + 1 : item.touch + 1,
        next_due_at: done ? state.next_due_at : dueAtForTouch(new Date(state.enrolled_at), item.touch + 1).toISOString(),
        state: done ? "completed" : "active",
      };
      await ports.saveState(prospect.id, next);
      return { status: "sent", attachmentUrl };
    } catch (err) {
      const reason = `GHL send failed: ${errMessage(err)}`;
      const failed = withFailure(state, "send_failures", reason);
      await ports.saveState(prospect.id, failed.state);
      return { status: "held", reason, attempts: failed.attempts };
    }
  };
}

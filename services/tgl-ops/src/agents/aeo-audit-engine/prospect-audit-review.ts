// services/tgl-ops/src/agents/aeo-audit-engine/prospect-audit-review.ts
// The Architect's review of a prospect audit in #revenue (decisions/2026-11-12.md):
//
//   "Send on email"     the service emails the PDF to the prospect. One email per tap, fixed wording, no follow-ups.
//   "Needs refinement"  a box asks what the business is and the city; the audit runs again and replaces this one.
//
// The service emails a prospect only here, only on the Architect's tap, and only once per audit: the row is
// claimed (ready -> sending) before the email leaves, so two taps cannot send twice. Every outcome shown in
// Slack is read from what actually happened: "Sent" appears only when the mail provider accepted the message.
import type { ProspectAuditRow, ProspectAuditStore } from "./prospect-audit-store.js";
import type { ProspectAuditRequest, ProspectAuditOutcome } from "./prospect-audit.js";

export const SEND_ACTION = "prospect_audit_send";
export const REFINE_ACTION = "prospect_audit_refine";
export const EMAIL_MODAL = "prospect_audit_email_modal";
export const REFINE_MODAL = "prospect_audit_refine_modal";
export const DEFAULT_REPLY_TO = "aeoaudits@thegrowthlab.co.in";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isProspectAuditAction(actionId: unknown): boolean {
  return actionId === SEND_ACTION || actionId === REFINE_ACTION;
}
export function isProspectAuditModal(callbackId: unknown): boolean {
  return callbackId === EMAIL_MODAL || callbackId === REFINE_MODAL;
}

function section(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } };
}

/** The summary with the two buttons. */
export function reviewBlocks(summary: string, auditId: string): unknown[] {
  return [
    section(summary),
    {
      type: "actions",
      block_id: "prospect_audit_review",
      elements: [
        { type: "button", style: "primary", action_id: SEND_ACTION, value: auditId, text: { type: "plain_text", text: "Send on email" } },
        { type: "button", action_id: REFINE_ACTION, value: auditId, text: { type: "plain_text", text: "Needs refinement" } },
      ],
    },
  ];
}

/** The summary with the buttons replaced by what was decided. */
export function decidedBlocks(summary: string, outcome: string): unknown[] {
  return [section(summary), { type: "context", elements: [{ type: "mrkdwn", text: outcome.slice(0, 1900) }] }];
}

function summaryFromMessage(payload: any): string {
  const first = payload?.message?.blocks?.[0];
  return (first?.text?.text as string) || (payload?.message?.text as string) || "";
}

/** "Dr Neha Kapoor" -> "Dr. Neha"; "Arjun Mehta" -> "Arjun"; nothing usable -> "". */
export function greetingName(contactName: string | null | undefined): string {
  const parts = (contactName || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  if (/^(dr|prof)\.?$/i.test(parts[0])) return parts[1] ? `${parts[0].replace(/\.$/, "")}. ${parts[1]}` : "";
  return /^[\p{L}][\p{L}'.-]*$/u.test(parts[0]) ? parts[0] : "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) && !/^(uni|use|eu|one)/i.test(phrase) ? "an" : "a";
}

/** The one email a prospect receives. Wording approved by the Architect on 12 Nov 2026; nothing else is added. */
export function buildProspectAuditEmail(row: Pick<ProspectAuditRow, "business_name" | "category_phrase" | "city" | "contact_name">): { subject: string; text: string; html: string } {
  const first = greetingName(row.contact_name);
  const where = (row.city || "").trim() || "India";
  const paragraphs = [
    first ? `Hi ${first},` : "Hi,",
    "Thank you for asking. Your one-page AI visibility check is attached.",
    `We asked ChatGPT, Gemini and Perplexity five questions a customer would ask about ${article(row.category_phrase)} ${row.category_phrase} in ${where}. The report shows where they named ${row.business_name}, who they named instead, and which websites they took their answers from.`,
    "If you'd like to know what to fix first, reply to this email and we'll set up a 20-minute call.",
    "Tejinder Singh\nThe Growth Lab",
  ];
  return {
    subject: `Your AI visibility check: ${row.business_name}`,
    text: paragraphs.join("\n\n"),
    html: paragraphs.map((p) => `<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1F2421;margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join(""),
  };
}

/** Sender shown to the prospect. PROSPECT_AUDIT_FROM wins; otherwise the reports address with the Architect's name. */
export function prospectAuditFrom(env: Record<string, string | undefined> = process.env): string | null {
  const own = (env.PROSPECT_AUDIT_FROM || "").trim();
  if (own) return own;
  const reports = (env.REPORTS_FROM || "").trim();
  if (!reports) return null;
  const address = (reports.match(/<([^>]+)>/)?.[1] || reports).trim();
  return EMAIL_RE.test(address) ? `Tejinder Singh - The Growth Lab <${address}>` : null;
}

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Sends through Resend. `ok` is true only when the provider accepted the message; `id` is the provider's own. */
export async function sendProspectAuditEmail(row: ProspectAuditRow, to: string, fetchFn: FetchFn, env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = (env.RESEND_API_KEY || "").trim();
  const from = prospectAuditFrom(env);
  if (!key || !from) return { ok: false, error: "email is not configured (RESEND_API_KEY and PROSPECT_AUDIT_FROM or REPORTS_FROM)" };
  if (!row.pdf_base64) return { ok: false, error: "the stored PDF is empty" };
  const email = buildProspectAuditEmail(row);
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: (env.PROSPECT_AUDIT_REPLY_TO || "").trim() || DEFAULT_REPLY_TO,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: [{ filename: row.pdf_filename, content: row.pdf_base64 }],
      }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `mail provider answered ${res.status}: ${body.slice(0, 200)}` };
    let id: string | undefined;
    try {
      id = JSON.parse(body)?.id;
    } catch {
      id = undefined;
    }
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: `mail provider not reached: ${String(e?.message || e).slice(0, 200)}` };
  }
}

export interface ReviewDeps {
  store: ProspectAuditStore | null;
  fetchFn: FetchFn;
  env: Record<string, string | undefined>;
  isArchitect: (user: any) => Promise<boolean>;
  actorName: (user: any) => Promise<string>;
  updateMessage: (channel: string, ts: string, text: string, blocks: unknown[]) => Promise<void>;
  postThread: (channel: string, ts: string | undefined, text: string) => Promise<void>;
  openModal: (triggerId: string, view: unknown) => Promise<void>;
  rerun: (req: ProspectAuditRequest) => Promise<ProspectAuditOutcome>;
  /** Marks the website lead as audit_sent. Best effort. */
  markLeadSent: (leadId: string) => Promise<void>;
  now: () => Date;
}

async function defaultReviewDeps(): Promise<ReviewDeps> {
  const { defaultProspectAuditStore } = await import("./prospect-audit-store.js");
  const { slackClient, openModal, getActorDisplayName } = await import("../../lib/slack-client.js");
  const { isArchitectUser } = await import("../../lib/org.js");
  return {
    store: defaultProspectAuditStore(),
    fetchFn: (url, init) => fetch(url, init) as any,
    env: process.env,
    isArchitect: (user) => isArchitectUser(user),
    actorName: (user) => getActorDisplayName(user),
    updateMessage: async (channel, ts, text, blocks) => {
      await slackClient.chat.update({ channel, ts, text, blocks: blocks as any });
    },
    postThread: async (channel, ts, text) => {
      await slackClient.chat.postMessage({ channel, thread_ts: ts, text, unfurl_links: false, unfurl_media: false });
    },
    openModal: (triggerId, view) => openModal(triggerId, view),
    rerun: async (req) => {
      const { runProspectAudit } = await import("./prospect-audit.js");
      return runProspectAudit(req);
    },
    markLeadSent: async (leadId) => {
      const { createClient } = await import("@supabase/supabase-js");
      const url = (process.env.SUPABASE_URL || "").trim();
      const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
      if (!url || !key) return;
      await createClient(url, key, { auth: { persistSession: false } }).from("site_leads").update({ status: "audit_sent" }).eq("id", leadId).eq("status", "new");
    },
    now: () => new Date(),
  };
}

function istTime(d: Date): string {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " IST";
}

function emailModal(row: ProspectAuditRow, meta: object): unknown {
  return {
    type: "modal",
    callback_id: EMAIL_MODAL,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "Send audit on email" },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `No email is on record for *${row.business_name}*. The PDF is sent once, to the address you enter.` } },
      { type: "input", block_id: "email", label: { type: "plain_text", text: "Their work email" }, element: { type: "plain_text_input", action_id: "v", placeholder: { type: "plain_text", text: "name@business.com" } } },
      { type: "input", block_id: "name", optional: true, label: { type: "plain_text", text: "Their name (for the greeting)" }, element: { type: "plain_text_input", action_id: "v", ...(row.contact_name ? { initial_value: row.contact_name } : {}) } },
    ],
  };
}

function refineModal(row: ProspectAuditRow, meta: object): unknown {
  return {
    type: "modal",
    callback_id: REFINE_MODAL,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "Refine this audit" },
    submit: { type: "plain_text", text: "Run again" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `The audit for *${row.business_name}* runs again with these words and replaces this one. It costs about the same as the first run.` } },
      { type: "input", block_id: "what", label: { type: "plain_text", text: "What they are, as a customer would say it" }, element: { type: "plain_text_input", action_id: "v", initial_value: row.category_phrase, placeholder: { type: "plain_text", text: "for example: nursing coaching institute" } } },
      { type: "input", block_id: "city", optional: true, label: { type: "plain_text", text: "City" }, element: { type: "plain_text_input", action_id: "v", ...(row.city ? { initial_value: row.city } : {}) } },
    ],
  };
}

async function doSend(row: ProspectAuditRow, to: string, user: any, ref: { channel: string; ts?: string; summary: string }, deps: ReviewDeps): Promise<"sent" | "send_failed" | "not_claimed"> {
  const store = deps.store as ProspectAuditStore;
  const who = await deps.actorName(user).catch(() => "the Architect");
  const stamp = deps.now();
  const claimed = await store.claim(row.id, ["ready", "send_failed"], "sending", { decided_by: who, decided_at: stamp.toISOString() });
  if (!claimed) {
    await deps.postThread(ref.channel, ref.ts, `Not sent again: this audit for ${row.business_name} is already being sent or was already sent.`);
    return "not_claimed";
  }
  const sent = await sendProspectAuditEmail(row, to, deps.fetchFn, deps.env);
  if (!sent.ok) {
    await store.update(row.id, { status: "send_failed", send_error: sent.error || "unknown error" });
    await deps.postThread(ref.channel, ref.ts, `*Email not sent* for ${row.business_name}: ${sent.error}. Nothing reached the prospect. The buttons still work once this is fixed.`);
    return "send_failed";
  }
  await store.update(row.id, { status: "sent", sent_to: to, sent_at: stamp.toISOString(), email_id: sent.id || null, send_error: null });
  if (row.site_lead_id) await deps.markLeadSent(row.site_lead_id).catch((e: any) => console.warn(`[Prospect Audit] lead status not updated: ${e?.message || e}`));
  const outcome = `*Sent to ${to}* on ${istTime(stamp)} by ${who}${sent.id ? ` (mail id ${sent.id})` : ""}. One email, no follow-ups.`;
  if (ref.ts) await deps.updateMessage(ref.channel, ref.ts, ref.summary || outcome, decidedBlocks(ref.summary || `Prospect audit: ${row.business_name}`, outcome)).catch((e: any) => console.warn(`[Prospect Audit] message not updated: ${e?.message || e}`));
  return "sent";
}

/** A tap on "Send on email" or "Needs refinement". */
export async function handleProspectAuditAction(payload: any, action: any, depsOverride?: Partial<ReviewDeps>): Promise<string> {
  const deps: ReviewDeps = { ...(await defaultReviewDeps()), ...(depsOverride || {}) };
  const channel: string = payload.channel?.id || payload.container?.channel_id || "";
  const ts: string | undefined = payload.container?.message_ts || payload.message?.ts;
  const summary = summaryFromMessage(payload);
  const tell = (text: string) => deps.postThread(channel, ts, text).catch((e: any) => console.warn(`[Prospect Audit] thread reply failed: ${e?.message || e}`));

  if (!(await deps.isArchitect(payload.user).catch(() => false))) {
    await tell("Only the Architect can send or refine a prospect audit. Nothing was done.");
    return "not_architect";
  }
  if (!deps.store) {
    await tell("The review record is not available (database not configured). Nothing was sent.");
    return "no_store";
  }
  const row = await deps.store.get(String(action.value || "")).catch(() => null);
  if (!row) {
    await tell("The record for this audit was not found. Nothing was sent.");
    return "not_found";
  }
  if (row.status === "sent") {
    await tell(`Already sent to ${row.sent_to} on ${row.sent_at ? istTime(new Date(row.sent_at)) : "an earlier date"}. Not sent again.`);
    return "already_sent";
  }
  if (row.status === "refined") {
    await tell("This audit was replaced by a refined one. Use the buttons on the newer message.");
    return "already_refined";
  }
  if (row.status === "sending") {
    await tell("This audit is being sent right now. Not sent again.");
    return "sending";
  }
  const meta = { id: row.id, channel, ts, summary: summary.slice(0, 2500) };

  if (action.action_id === REFINE_ACTION) {
    await deps.openModal(payload.trigger_id, refineModal(row, meta));
    return "refine_modal";
  }
  if (!row.contact_email) {
    await deps.openModal(payload.trigger_id, emailModal(row, meta));
    return "email_modal";
  }
  return doSend(row, row.contact_email, payload.user, { channel, ts, summary }, deps);
}

function fieldValue(payload: any, block: string): string {
  return String(payload?.view?.state?.values?.[block]?.v?.value || "").replace(/\s+/g, " ").trim();
}

/**
 * Checks a modal before it closes. Returns Slack's response body: field errors keep the modal open,
 * `clear` closes it and the caller then runs handleProspectAuditModal.
 */
export function prospectAuditModalResponse(payload: any): { response_action: "errors"; errors: Record<string, string> } | { response_action: "clear" } {
  const id = payload?.view?.callback_id;
  if (id === EMAIL_MODAL && !EMAIL_RE.test(fieldValue(payload, "email"))) {
    return { response_action: "errors", errors: { email: "Enter a full email address, for example name@business.com." } };
  }
  if (id === REFINE_MODAL && fieldValue(payload, "what").length < 3) {
    return { response_action: "errors", errors: { what: "Say what they are in a few words, for example dental clinic." } };
  }
  return { response_action: "clear" };
}

/** A submitted modal: the email to send to, or the words to run the audit again with. */
export async function handleProspectAuditModal(payload: any, depsOverride?: Partial<ReviewDeps>): Promise<string> {
  const deps: ReviewDeps = { ...(await defaultReviewDeps()), ...(depsOverride || {}) };
  let meta: { id?: string; channel?: string; ts?: string; summary?: string } = {};
  try {
    meta = JSON.parse(payload?.view?.private_metadata || "{}");
  } catch {
    meta = {};
  }
  const channel = meta.channel || "";
  const tell = (text: string) => deps.postThread(channel, meta.ts, text).catch((e: any) => console.warn(`[Prospect Audit] thread reply failed: ${e?.message || e}`));

  if (!(await deps.isArchitect(payload.user).catch(() => false))) {
    await tell("Only the Architect can send or refine a prospect audit. Nothing was done.");
    return "not_architect";
  }
  if (!deps.store || !meta.id) return "no_store";
  const row = await deps.store.get(meta.id).catch(() => null);
  if (!row) {
    await tell("The record for this audit was not found. Nothing was done.");
    return "not_found";
  }

  if (payload.view?.callback_id === EMAIL_MODAL) {
    const to = fieldValue(payload, "email").toLowerCase();
    if (!EMAIL_RE.test(to)) return "invalid_email";
    const name = fieldValue(payload, "name") || row.contact_name || null;
    await deps.store.update(row.id, { contact_email: to, contact_name: name });
    return doSend({ ...row, contact_email: to, contact_name: name }, to, payload.user, { channel, ts: meta.ts, summary: meta.summary || "" }, deps);
  }

  if (payload.view?.callback_id === REFINE_MODAL) {
    const what = fieldValue(payload, "what");
    const city = fieldValue(payload, "city") || null;
    const who = await deps.actorName(payload.user).catch(() => "the Architect");
    const stamp = deps.now();
    const claimed = await deps.store.claim(row.id, ["ready", "send_failed"], "refined", { decided_by: who, decided_at: stamp.toISOString() });
    if (!claimed) {
      await tell("Not refined: this audit was already sent or already replaced.");
      return "not_claimed";
    }
    const outcome = `*Replaced by a refined audit* ("${what}"${city ? `, ${city}` : ""}) on ${istTime(stamp)} by ${who}. This one was not sent.`;
    if (meta.ts) await deps.updateMessage(channel, meta.ts, meta.summary || outcome, decidedBlocks(meta.summary || `Prospect audit: ${row.business_name}`, outcome)).catch((e: any) => console.warn(`[Prospect Audit] message not updated: ${e?.message || e}`));
    const result = await deps.rerun({
      businessName: row.business_name,
      website: row.domain,
      what,
      city,
      source: "architect",
      leadId: row.site_lead_id,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      refinedFrom: row.id,
    });
    return `refined:${result.status}`;
  }
  return "ignored";
}

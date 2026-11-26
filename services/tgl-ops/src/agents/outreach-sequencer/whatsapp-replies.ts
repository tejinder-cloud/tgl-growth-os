// services/tgl-ops/src/agents/outreach-sequencer/whatsapp-replies.ts
// WhatsApp replies from businesses (Build day 14, 26 Nov 2026). Meta posts each incoming message to the webhook;
// this matches it to the business by mobile number and acts on it:
//   YES (button or typed)  the one-page report goes back on WhatsApp, the deal moves to Replied, #revenue is told.
//   Not now                one line of thanks; nothing more is ever sent.
//   STOP                   one line confirming; the business is marked opted out for good.
//   anything else          posted in #revenue with the text; the deal moves to Replied; the Architect answers from
//                          the WhatsApp app on his phone (coexistence), within WhatsApp's 24-hour window.
// The same message is never handled twice. Replies use only facts already stored for the business.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cleanBusinessName } from "./names.js";
import { classifyIntent } from "./reply.js";
import { indianMobile, type WaCandidate } from "./whatsapp-first-touch.js";
import type { AuditSummary } from "./types.js";

export interface InboundMessage {
  id: string;
  /** The sender's WhatsApp number, digits only (e.g. 919876543210). */
  from: string;
  at: string;
  type: string;
  text: string;
}

export interface DeliveryFailure {
  to: string;
  reason: string;
}

/** True when the body was signed by Meta with the app secret (X-Hub-Signature-256). */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The messages and failed deliveries in one webhook body. Anything else (read receipts, etc.) is ignored. */
export function parseWebhook(body: any): { messages: InboundMessage[]; failures: DeliveryFailure[] } {
  const messages: InboundMessage[] = [];
  const failures: DeliveryFailure[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value || {};
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (!m?.id || !m?.from) continue;
        const text =
          m.type === "text" ? m.text?.body : m.type === "button" ? m.button?.text || m.button?.payload : m.type === "interactive" ? m.interactive?.button_reply?.title || m.interactive?.list_reply?.title : "";
        messages.push({ id: String(m.id), from: String(m.from).replace(/\D/g, ""), at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(), type: String(m.type || "unknown"), text: String(text || "").trim() });
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        if (s?.status === "failed") failures.push({ to: String(s.recipient_id || "").replace(/\D/g, ""), reason: String(s.errors?.[0]?.title || s.errors?.[0]?.message || "not delivered") });
      }
    }
  }
  return { messages, failures };
}

export type WaIntent = "yes" | "not_now" | "opt_out" | "other" | "media";

/** What the message asks for. The template's buttons are "Yes, send it" and "Not now". */
export function waIntent(m: InboundMessage): WaIntent {
  const t = m.text.trim();
  if (!t) return "media";
  if (/^(yes,? send it|yes|yes please|haan|ha|han|ok|okay|sure|send|send it)[.! ]*$/i.test(t)) return "yes";
  if (/^not now[.! ]*$/i.test(t)) return "not_now";
  if (/^(stop|unsubscribe|band karo|no more)[.! ]*$/i.test(t) || classifyIntent(t) === "opt_out") return "opt_out";
  return "other";
}

export interface WaProspect extends WaCandidate {
  website?: string | null;
}

export interface WaReplyPorts {
  now: () => Date;
  findByMobile: (from: string) => Promise<WaProspect | null>;
  saveWhatsApp: (id: string, patch: Record<string, unknown>) => Promise<void>;
  sendText: (to: string, text: string) => Promise<{ messageId: string }>;
  sendReport: (to: string, p: WaProspect, audit: AuditSummary, caption: string) => Promise<{ messageId: string }>;
  notify: (text: string) => Promise<void>;
  replied: (p: WaProspect) => Promise<void>;
  record: (e: { kind: "reply" | "sent" | "held"; prospectId?: string; summary: string }) => Promise<void>;
  bookingLink?: string;
}

export const OPT_OUT_REPLY = "Understood. You will not get any more messages from The Growth Lab.";
export const NOT_NOW_REPLY = "No problem. Thank you for letting me know.";

export function reportCaption(company: string, bookingLink?: string): string {
  return `Here is the one-page result for ${company}: the questions we asked and what each assistant said.${bookingLink ? ` If it helps, I can take you through it in 20 minutes: ${bookingLink}` : ""}`;
}

function last4(n: string): string {
  return n.slice(-4);
}

/** Handles one incoming message. Returns what happened, for tests and logs. */
export async function handleWhatsAppMessage(m: InboundMessage, ports: WaReplyPorts): Promise<string> {
  const p = await ports.findByMobile(m.from);
  if (!p) {
    await ports.notify(`*WhatsApp message from a number not in outreach* (ending ${last4(m.from)}): "${m.text.slice(0, 300) || `[${m.type}]`}". Nothing was sent back.`);
    return "unknown_sender";
  }
  const wa = p.signals?.whatsapp as Record<string, any> | undefined;
  if (wa?.last_inbound_id === m.id) return "duplicate";
  const company = cleanBusinessName(p.company);
  const intent = waIntent(m);
  const said = m.text ? `"${m.text.slice(0, 500)}"` : `[${m.type}]`;
  await ports.saveWhatsApp(p.id, { last_inbound_id: m.id, last_reply_at: m.at, last_reply_intent: intent });

  if (intent === "opt_out") {
    await ports.saveWhatsApp(p.id, { opted_out: true, opted_out_at: m.at });
    await ports.sendText(m.from, OPT_OUT_REPLY).catch(() => {});
    await ports.record({ kind: "reply", prospectId: p.id, summary: `${company} asked to stop WhatsApp messages; marked opted out.` });
    await ports.notify(`*WhatsApp: ${company} opted out* (${said}). They will get no more messages.`);
    return "opted_out";
  }
  if (wa?.opted_out) {
    await ports.notify(`*WhatsApp from ${company}*, who opted out earlier: ${said}. Nothing was sent back; answer from the WhatsApp app only if they ask you to.`);
    return "after_opt_out";
  }
  if (intent === "not_now") {
    await ports.saveWhatsApp(p.id, { not_now_at: m.at });
    await ports.sendText(m.from, NOT_NOW_REPLY).catch(() => {});
    await ports.record({ kind: "reply", prospectId: p.id, summary: `${company} replied Not now on WhatsApp.` });
    await ports.notify(`*WhatsApp: ${company} said Not now.* Nothing more will be sent to them.`);
    return "not_now";
  }

  await ports.replied(p).catch(() => {});
  await ports.record({ kind: "reply", prospectId: p.id, summary: `WhatsApp reply from ${company}${intent === "yes" ? ": asked for the report" : ""}.` });

  if (intent === "yes") {
    const a = p.signals?.preaudit as AuditSummary | undefined;
    if (wa?.report_sent_at) {
      await ports.notify(`*WhatsApp: ${company} said ${said} again.* The report was already sent on ${wa.report_sent_at.slice(0, 10)}; answer from the WhatsApp app if needed.`);
      return "report_already_sent";
    }
    if (!a || typeof a.mentions !== "number" || !p.website) {
      await ports.notify(`*WhatsApp: ${company} asked for the report*, but there is no stored AI check to build it from. Please answer from the WhatsApp app.`);
      return "report_missing";
    }
    try {
      const sent = await ports.sendReport(m.from, p, a, reportCaption(company, ports.bookingLink));
      await ports.saveWhatsApp(p.id, { report_sent_at: ports.now().toISOString(), report_message_id: sent.messageId });
      await ports.record({ kind: "sent", prospectId: p.id, summary: `One-page report sent to ${company} on WhatsApp.` });
      await ports.notify(`*WhatsApp: ${company} said YES.* The one-page report was sent to them on WhatsApp. They are now in Replied on the pipeline; follow up from the WhatsApp app.`);
      return "report_sent";
    } catch (err) {
      const { plainError } = await import("../../lib/plain-error.js");
      await ports.notify(`*WhatsApp: ${company} said YES*, but the report could not be sent (${plainError(err)}). Please send it from the WhatsApp app.`);
      return "report_failed";
    }
  }

  await ports.notify(`*WhatsApp reply from ${company}*${p.city ? `, ${p.city}` : ""}: ${said}\nThey are in Replied on the pipeline. Answer from the WhatsApp app on your phone within 24 hours.`);
  return "routed";
}

/** A delivery Meta reports as failed: recorded and shown, so a number that cannot get WhatsApp is visible. */
export async function handleDeliveryFailure(f: DeliveryFailure, ports: Pick<WaReplyPorts, "findByMobile" | "record" | "saveWhatsApp">): Promise<void> {
  const p = await ports.findByMobile(f.to);
  if (!p) return;
  await ports.saveWhatsApp(p.id, { last_failure: f.reason, last_failure_at: new Date().toISOString() });
  await ports.record({ kind: "held", prospectId: p.id, summary: `WhatsApp message to ${cleanBusinessName(p.company)} was not delivered: ${f.reason}.` });
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

export async function liveReplyPorts(env: NodeJS.ProcessEnv = process.env): Promise<WaReplyPorts> {
  const { getSupabase } = await import("../prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const graph = await import("../whatsapp/graph.js");
  const { postLine } = await import("../../lib/post.js");
  const { salesDeskChannel } = await import("./reply.js");
  const { loadEmailConfig } = await import("./email.js");
  const { bookingLinkFor } = await import("./suggested-reply.js");
  const phoneId = () => {
    const id = (env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
    if (!id) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not set");
    return id;
  };
  const ctx = async () => {
    const token = await graph.resolveToken(env);
    if (!token) throw new Error("the WhatsApp token is not set");
    return graph.waContext(token, env);
  };
  return {
    now: () => new Date(),
    bookingLink: bookingLinkFor(env, loadEmailConfig(env).publicUrl),
    async findByMobile(from) {
      const { data, error } = await sb.from("prospects").select("id, company, website, city, category, status, door, fit_score, decision_maker, signals").eq("tenant_id", "tgl").in("status", ["reviewed", "handed_to_outreach"]).is("deleted_at", null).limit(3000);
      if (error) throw new Error(error.message);
      const matches = ((data || []) as WaProspect[]).filter((p) => indianMobile(p.decision_maker?.phone) === from);
      // Prefer the business we actually messaged on WhatsApp.
      return matches.find((p) => p.signals?.whatsapp?.first_touch_at) || matches[0] || null;
    },
    async saveWhatsApp(id, patch) {
      const { data, error } = await sb.from("prospects").select("signals").eq("id", id).eq("tenant_id", "tgl").single();
      if (error) throw new Error(`read before save failed: ${error.message}`);
      const signals = (data as any)?.signals || {};
      const upd = await sb.from("prospects").update({ signals: { ...signals, whatsapp: { ...(signals.whatsapp || {}), ...patch } } }).eq("id", id).eq("tenant_id", "tgl");
      if (upd.error) throw new Error(`save failed: ${upd.error.message}`);
    },
    async sendText(to, text) {
      return graph.sendText(await ctx(), phoneId(), to, text);
    },
    async sendReport(to, p, audit, caption) {
      const { renderOnePagerPdf } = await import("./onepager.js");
      const pdf = renderOnePagerPdf({ company: cleanBusinessName(p.company), website: String(p.website), category: p.category || "", city: p.city || "" }, audit);
      const c = await ctx();
      const filename = `${cleanBusinessName(p.company).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-AI-visibility.pdf`;
      const mediaId = await graph.uploadMedia(c, phoneId(), pdf, "application/pdf", filename);
      return graph.sendDocument(c, phoneId(), to, mediaId, filename, caption);
    },
    async notify(text) {
      await postLine({ channel: salesDeskChannel(env), text });
    },
    async replied(p) {
      const { safely } = await import("../pipeline/live.js");
      await safely("replied", (pl) => pl.replied({ company: p.company, name: (p.decision_maker as any)?.name, email: p.decision_maker?.email, city: p.city || undefined }, p.id));
    },
    async record(e) {
      const { recordEvent } = await import("../../lib/events.js");
      await recordEvent({ agent: "outreach-sequencer", ...e });
    },
  };
}

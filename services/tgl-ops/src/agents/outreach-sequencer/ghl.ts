// services/tgl-ops/src/agents/outreach-sequencer/ghl.ts
// GoHighLevel (LeadConnector v2) client for outreach. Only ever called when OUTREACH_LIVE=1.
// Env: GHL_API_KEY (private integration token), GHL_LOCATION_ID, GHL_WA_PHONE_ID (WhatsApp sender), GHL_EMAIL_FROM (optional).
//
// VERIFY BEFORE FIRST LIVE SEND: payload field names below follow the LeadConnector v2 conversations API as
// documented; the WhatsApp sender field and the media upload response shape have not been exercised against
// TGL's GHL account from this repo. Both are isolated to this file.
import type { ProspectRecord } from "../prospect-researcher/types.js";
import type { SendResult } from "./types.js";

const GHL_BASE = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";

export interface GhlEnv {
  apiKey: string;
  locationId: string;
  waPhoneId: string;
  emailFrom?: string;
}

export function readGhlEnv(): { env?: GhlEnv; missing: string[] } {
  const apiKey = (process.env.GHL_API_KEY || "").trim();
  const locationId = (process.env.GHL_LOCATION_ID || "").trim();
  const waPhoneId = (process.env.GHL_WA_PHONE_ID || "").trim();
  const missing: string[] = [];
  if (!apiKey) missing.push("GHL_API_KEY");
  if (!locationId) missing.push("GHL_LOCATION_ID");
  if (!waPhoneId) missing.push("GHL_WA_PHONE_ID");
  if (missing.length) return { missing };
  return { env: { apiKey, locationId, waPhoneId, emailFrom: (process.env.GHL_EMAIL_FROM || "").trim() || undefined }, missing };
}

function headers(env: GhlEnv, json = true): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${env.apiKey}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function ghlFetch(env: GhlEnv, path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${GHL_BASE}${path}`, init);
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    throw new Error(`GHL ${path} HTTP ${res.status}: ${(data?.message || data?.raw || text).toString().slice(0, 200)}`);
  }
  return data;
}

export async function upsertContact(env: GhlEnv, p: ProspectRecord): Promise<string> {
  const dm = p.decision_maker;
  const [firstName, ...rest] = (dm?.name || "").trim().split(/\s+/);
  const data = await ghlFetch(env, "/contacts/upsert", {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      locationId: env.locationId,
      firstName: firstName || undefined,
      lastName: rest.join(" ") || undefined,
      email: dm?.email || undefined,
      phone: dm?.phone || undefined,
      companyName: p.company,
      website: p.website,
      tags: ["tgl-outreach", `door-${p.door}`],
      source: "outreach-sequencer",
    }),
  });
  const id = data?.contact?.id;
  if (!id) throw new Error("GHL contact upsert returned no contact id");
  return id;
}

export async function uploadMedia(env: GhlEnv, buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  form.append("name", filename);
  const data = await ghlFetch(env, "/medias/upload-file", { method: "POST", headers: headers(env, false), body: form });
  const url = data?.url;
  if (!url) throw new Error("GHL media upload returned no url");
  return url;
}

function toHtml(body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return body
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function sendEmailViaGhl(
  env: GhlEnv,
  args: { prospect: ProspectRecord; subject: string; body: string; attachment?: { buffer: Buffer; filename: string } }
): Promise<SendResult> {
  try {
    const contactId = await upsertContact(env, args.prospect);
    const attachments = args.attachment ? [await uploadMedia(env, args.attachment.buffer, args.attachment.filename)] : undefined;
    const data = await ghlFetch(env, "/conversations/messages", {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify({
        type: "Email",
        contactId,
        subject: args.subject,
        html: toHtml(args.body),
        emailFrom: env.emailFrom,
        attachments,
      }),
    });
    return { ok: true, messageId: data?.messageId || data?.emailMessageId };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function sendWhatsAppViaGhl(env: GhlEnv, args: { prospect: ProspectRecord; body: string }): Promise<SendResult> {
  try {
    const contactId = await upsertContact(env, args.prospect);
    const data = await ghlFetch(env, "/conversations/messages", {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify({
        type: "WhatsApp",
        contactId,
        message: args.body,
        // Sender: the WhatsApp phone configured for this location (GHL_WA_PHONE_ID).
        phoneId: env.waPhoneId,
      }),
    });
    return { ok: true, messageId: data?.messageId };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

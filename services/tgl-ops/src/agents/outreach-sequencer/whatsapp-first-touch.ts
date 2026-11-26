// services/tgl-ops/src/agents/outreach-sequencer/whatsapp-first-touch.ts
// The WhatsApp first message for approved businesses that have only a phone number (Build day 11, 26 Nov 2026).
// No cold calls (Architect, 24 Nov): WhatsApp is how these businesses are reached. The first message must be an
// approved Meta template; its words below are the draft for tgl_ai_visibility_first_touch (submitted on day 18).
// Every value in it comes from the business's own advance AI check (preaudit.ts): the date, the number of
// answers, how often the business was named, and a rival named in the same check with its count. A check that did not ask
// all three assistants is not quoted, because the message names them.
//
// Dry run is the default: the Outreach page shows each business's exact message or why it would be skipped, and
// nothing is sent. Sending happens only when WHATSAPP_OUTREACH_MODE=live, the sending number and the webhook's app
// secret are set, and Meta reports the template as APPROVED. Then a few a day, never twice to one business, never after an opt-out.
import { cleanBusinessName } from "./names.js";
import { categoryLabel } from "./sequence.js";
import type { AuditSummary } from "./types.js";

export const TEMPLATE_NAME = "tgl_ai_visibility_first_touch";
export const TEMPLATE_LANGUAGE = "en";
/** The template draft. Seven values, each filled from the business's own check. */
export const TEMPLATE = {
  name: TEMPLATE_NAME,
  category: "MARKETING" as const,
  language: TEMPLATE_LANGUAGE,
  body:
    "Hello, this is Tejinder Singh from The Growth Lab. On {{1}} we asked ChatGPT, Gemini and Perplexity the questions people ask when looking for {{2}} in {{3}}, {{4}} answers in all. {{5}} was named in {{6}}. {{7}} Would you like the one-page report? Reply YES and I will send it here.",
  examples: ["25 Nov", "hospitals", "Chandigarh Tricity", "15", "Shivalik Hospital", "none of them", "Fortis Mohali was named in 10."],
  footer: "Reply STOP to stop these messages",
  quickReplies: ["Yes, send it", "Not now"],
};

export const DEFAULT_WHATSAPP_PER_DAY = 5;
/** A check older than this is not quoted (preaudit.ts runs it again). */
export const MAX_CHECK_AGE_DAYS = 30;
const ENGINES = ["chatgpt", "gemini", "perplexity"];

export interface WaCandidate {
  id: string;
  company: string;
  city?: string | null;
  category?: string | null;
  status: string;
  door?: string | null;
  fit_score?: number | null;
  decision_maker?: { email?: string; phone?: string } | null;
  signals?: {
    outreach?: { state?: string } | null;
    preaudit?: Partial<AuditSummary> | null;
    whatsapp?: { first_touch_at?: string; opted_out?: boolean } | null;
  } | null;
}

export interface FirstTouch {
  id: string;
  company: string;
  /** The number in international form without "+", as WhatsApp expects. */
  to: string;
  values: string[];
  /** The message exactly as the business would read it. */
  text: string;
  fit: number;
}

export type Plan = { ok: true; touch: FirstTouch } | { ok: false; id: string; company: string; reason: string };

/** An Indian mobile number in international form (91 and ten digits starting 6 to 9), or null. */
export function indianMobile(raw: string | undefined | null): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `91${d}` : null;
}

export function fillTemplate(values: string[]): string {
  return TEMPLATE.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => values[Number(n) - 1] ?? "");
}

function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(iso));
}

function plural(label: string): string {
  return /s$/i.test(label) ? label : `${label}s`;
}

/** The first message for one business, or why it cannot have one. Pure. */
export function planFirstTouch(p: WaCandidate, now: Date): Plan {
  const company = cleanBusinessName(p.company);
  const no = (reason: string): Plan => ({ ok: false, id: p.id, company, reason });
  if (p.signals?.whatsapp?.opted_out || p.signals?.outreach?.state === "opted_out") return no("Opted out");
  if (p.signals?.whatsapp?.first_touch_at) return no("First message already sent");
  const to = indianMobile(p.decision_maker?.phone);
  if (!to) return no("The number is not a mobile, so it has no WhatsApp");
  const a = p.signals?.preaudit;
  if (!a || typeof a.mentions !== "number" || !a.total_queries || !a.audited_at) return no("AI check not run yet");
  if (now.getTime() - Date.parse(a.audited_at) > MAX_CHECK_AGE_DAYS * 86_400_000) return no("AI check is older than 30 days; it runs again first");
  const engines = Object.keys(a.mentions_by_engine || {}).map((k) => k.toLowerCase());
  if (!ENGINES.every((e) => engines.includes(e))) return no("The AI check did not ask all three assistants");
  if (!p.city || !p.category) return no("City or business type missing");
  const rival = a.weakest_competitor && typeof a.competitor_mentions?.[a.weakest_competitor] === "number" ? a.weakest_competitor : "";
  const rivalLine = rival ? `${rival} was named in ${a.competitor_mentions![rival]}.` : "No other business was named often enough to compare.";
  // total_queries counts answers (5 questions to each of the 3 assistants), so the message says answers, not questions.
  const values = [
    dayMonth(a.audited_at),
    plural(categoryLabel(p.category)),
    p.city,
    String(a.total_queries),
    company,
    a.mentions === 0 ? "none of them" : `${a.mentions} of them`,
    rivalLine,
  ];
  // WhatsApp rejects values with line breaks, tabs or runs of spaces; a value that has one is cleaned, not sent raw.
  const clean = values.map((v) => v.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, " ").trim());
  return { ok: true, touch: { id: p.id, company, to, values: clean, text: fillTemplate(clean), fit: Number(p.fit_score || 0) } };
}

/** Approved, never emailed, no email address, with a phone: the businesses WhatsApp is for. */
export function isWhatsAppAudience(p: WaCandidate): boolean {
  return (
    p.status === "reviewed" &&
    (p.door || "aeo") === "aeo" &&
    !p.signals?.outreach &&
    !/\S+@\S+\.\S+/.test(p.decision_maker?.email || "") &&
    String(p.decision_maker?.phone || "").replace(/\D/g, "").length >= 8
  );
}

export function whatsappPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt((env.WHATSAPP_PER_DAY || "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_WHATSAPP_PER_DAY;
  return Math.min(n, 20);
}

export type WaMode = "dry_run" | "live";
export function whatsappMode(env: NodeJS.ProcessEnv = process.env): WaMode {
  return (env.WHATSAPP_OUTREACH_MODE || "").trim().toLowerCase() === "live" ? "live" : "dry_run";
}

export interface WaPorts {
  now: () => Date;
  env: NodeJS.ProcessEnv;
  list: () => Promise<WaCandidate[]>;
  /** The template's status at Meta ("APPROVED", "PENDING", ...), or null when it is not there. */
  templateStatus: () => Promise<string | null>;
  send: (to: string, values: string[]) => Promise<{ messageId: string }>;
  markSent: (id: string, info: { at: string; messageId: string }) => Promise<void>;
  record: (touch: FirstTouch) => Promise<void>;
}

export interface WaRun {
  mode: WaMode;
  /** Why nothing was sent, when the run stopped before sending. */
  stopped?: string;
  sent: FirstTouch[];
  wouldSend: FirstTouch[];
  failed: { company: string; error: string }[];
  skipped: { company: string; reason: string }[];
}

/** One daily run. In dry run it only reports what it would send. */
export async function runWhatsAppFirstTouch(ports: WaPorts): Promise<WaRun> {
  const now = ports.now();
  const mode = whatsappMode(ports.env);
  const plans = (await ports.list()).filter(isWhatsAppAudience).map((p) => planFirstTouch(p, now));
  const ready = plans.filter((x): x is { ok: true; touch: FirstTouch } => x.ok).map((x) => x.touch).sort((a, b) => b.fit - a.fit);
  const skipped = plans.filter((x): x is { ok: false; id: string; company: string; reason: string } => !x.ok).map((x) => ({ company: x.company, reason: x.reason }));
  const today = ready.slice(0, whatsappPerDay(ports.env));
  const run: WaRun = { mode, sent: [], wouldSend: [], failed: [], skipped };
  if (mode !== "live") {
    run.wouldSend = today;
    return run;
  }
  if (!(ports.env.WHATSAPP_PHONE_NUMBER_ID || "").trim()) return { ...run, stopped: "WHATSAPP_PHONE_NUMBER_ID is not set" };
  // Replies must be able to reach us before anyone is messaged (whatsapp-replies.ts, build day 14).
  if (!(ports.env.WHATSAPP_APP_SECRET || "").trim()) return { ...run, stopped: "WHATSAPP_APP_SECRET is not set, so replies could not be received" };
  const status = await ports.templateStatus().catch(() => null);
  if (status !== "APPROVED") return { ...run, stopped: `the template ${TEMPLATE_NAME} is ${status ? status.toLowerCase() : "not found"} at Meta, not approved` };
  for (const t of today) {
    try {
      const r = await ports.send(t.to, t.values);
      await ports.markSent(t.id, { at: ports.now().toISOString(), messageId: r.messageId });
      await ports.record(t).catch(() => {});
      run.sent.push(t);
    } catch (err) {
      const { plainError } = await import("../../lib/plain-error.js");
      run.failed.push({ company: t.company, error: plainError(err) });
    }
  }
  return run;
}

/** Real wiring: Supabase rows, Meta's Graph API, the events record. */
export async function runWhatsAppFirstTouchLive(env: NodeJS.ProcessEnv = process.env): Promise<WaRun> {
  const { getSupabase } = await import("../prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const graph = await import("../whatsapp/graph.js");
  let ctxPromise: Promise<import("../whatsapp/graph.js").WaContext> | null = null;
  const ctx = () =>
    (ctxPromise ||= graph.resolveToken(env).then((token) => {
      if (!token) throw new Error("the WhatsApp token is not set");
      return graph.waContext(token, env);
    }));
  return runWhatsAppFirstTouch({
    now: () => new Date(),
    env,
    async list() {
      const { data, error } = await sb.from("prospects").select("id, company, city, category, status, door, fit_score, decision_maker, signals").eq("tenant_id", "tgl").eq("status", "reviewed").is("deleted_at", null).limit(2000);
      if (error) throw new Error(error.message);
      return (data || []) as WaCandidate[];
    },
    async templateStatus() {
      const waba = (env.WHATSAPP_WABA_ID || "").trim();
      if (!waba) return null;
      const rows = await graph.listTemplates(await ctx(), waba);
      const row = rows.find((r) => r.name === TEMPLATE_NAME && (r.language || TEMPLATE_LANGUAGE).startsWith(TEMPLATE_LANGUAGE));
      return row ? String(row.status || "").toUpperCase() : null;
    },
    async send(to, values) {
      return graph.sendTemplate(await ctx(), String(env.WHATSAPP_PHONE_NUMBER_ID).trim(), to, { name: TEMPLATE_NAME, language: TEMPLATE_LANGUAGE }, values);
    },
    async markSent(id, info) {
      const { data, error } = await sb.from("prospects").select("signals").eq("id", id).eq("tenant_id", "tgl").single();
      if (error) throw new Error(`read before save failed: ${error.message}`);
      const signals = (data as any)?.signals || {};
      const upd = await sb.from("prospects").update({ signals: { ...signals, whatsapp: { ...(signals.whatsapp || {}), first_touch_at: info.at, first_touch_message_id: info.messageId, template: TEMPLATE_NAME } } }).eq("id", id).eq("tenant_id", "tgl");
      if (upd.error) throw new Error(`save failed: ${upd.error.message}`);
    },
    async record(t) {
      const { recordEvent } = await import("../../lib/events.js");
      await recordEvent({ agent: "outreach-sequencer", kind: "sent", prospectId: t.id, summary: `WhatsApp first message sent to ${t.company}.` });
    },
  });
}

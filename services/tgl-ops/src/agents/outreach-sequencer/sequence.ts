// services/tgl-ops/src/agents/outreach-sequencer/sequence.ts
// 5-touch cadence, send-window logic and deterministic message rendering.
// No figure appears in any message unless it comes from the prospect's own audit summary.
import type {
  AuditSummary,
  RenderedMessage,
  SequenceTouchDef,
  TouchChannel,
} from "./types.js";

// Cadence decided by the Architect (issue #72 thread, 3-5 Nov 2026):
// T1 email day 0 · T2 WhatsApp day 2 · T3 email with the audit PDF day 4 · T4 WhatsApp day 7 · T5 email day 12.
// WhatsApp touches fall back to email when the prospect has no business phone or WhatsApp is off in GHL.
export const SEQUENCE: SequenceTouchDef[] = [
  { n: 1, offsetBusinessDays: 0, channel: "Email", attachOnePager: false },
  // Touch 2 says "I emailed your report"; as an email on day 2 that would be untrue (the report goes on day 4), so
  // it is skipped when WhatsApp is unavailable (Architect, 13 Nov 2026). Touch 4 still falls back to email.
  { n: 2, offsetBusinessDays: 2, channel: "WhatsApp", attachOnePager: false, whatsappOnly: true },
  { n: 3, offsetBusinessDays: 4, channel: "Email", attachOnePager: true },
  { n: 4, offsetBusinessDays: 7, channel: "WhatsApp", attachOnePager: false },
  { n: 5, offsetBusinessDays: 12, channel: "Email", attachOnePager: false },
];

/** The touch that carries the prospect's one-pager PDF. Never sent bare. */
export const ONE_PAGER_TOUCH = SEQUENCE.find((t) => t.attachOnePager)!.n;

export const TOTAL_TOUCHES = SEQUENCE.length;

export const OPT_OUT_LINE = "Reply STOP and I will not write again.";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Shifts a UTC instant so that its UTC getters read as IST wall-clock. */
function toIstWall(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}

/**
 * Adds working days, preserving time of day. Agents work every day of the week (Architect decision, 13 Nov 2026),
 * so every day counts. The name is kept for its callers.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + Math.max(0, days));
  return d;
}

/** Send window: every day, 09:30-17:30 IST. */
export function isWithinSendWindow(now: Date = new Date()): boolean {
  const ist = toIstWall(now);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= 9 * 60 + 30 && minutes <= 17 * 60 + 30;
}

/** YYYY-MM-DD in IST, used for the daily send cap. */
export function istDateKey(now: Date = new Date()): string {
  return toIstWall(now).toISOString().slice(0, 10);
}

export function dueAtForTouch(enrolledAt: Date, n: number): Date {
  const def = SEQUENCE.find((t) => t.n === n);
  if (!def) throw new Error(`Unknown touch ${n}`);
  return addBusinessDays(enrolledAt, def.offsetBusinessDays);
}

export function resolveChannel(
  preferred: TouchChannel,
  opts: { hasPhone: boolean; whatsappEnabled: boolean }
): TouchChannel {
  if (preferred === "WhatsApp" && !(opts.hasPhone && opts.whatsappEnabled)) return "Email";
  return preferred;
}

export function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    dental_clinic: "dental implant clinic",
    // The prospect researcher's own category keys.
    cosmetic_dental: "dental clinic",
    ivf_fertility: "IVF centre",
    high_ticket_coaching: "coaching institute",
    hospitals: "hospital",
    hospital: "multi-speciality hospital",
    ivf_center: "IVF centre",
    coaching_institute: "coaching institute",
    hotel: "boutique hotel",
    real_estate: "real estate developer",
    law_firm: "law firm",
    ca_firm: "chartered accountancy firm",
  };
  const key = (category || "").trim().toLowerCase();
  return map[key] || key.replace(/[_-]+/g, " ") || "business";
}

export interface MessageContext {
  company: string;
  category: string;
  city: string;
  decisionMakerName?: string;
  audit?: AuditSummary;
  senderName: string;
}

function greeting(name?: string): string {
  const clean = (name || "").trim();
  return clean ? `Hello ${clean},` : "Hello,";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

function build(subject: string | undefined, paragraphs: string[]): RenderedMessage {
  return {
    subject,
    text: paragraphs.join("\n\n"),
    html: subject ? toHtml(paragraphs) : undefined,
  };
}

function auditFinding(ctx: MessageContext): string {
  const a = ctx.audit;
  if (!a) throw new Error("Audit summary required to render this touch");
  if (a.mentions === 0) {
    return `${ctx.company} was not named in any of the ${a.total_queries} answers`;
  }
  return `${ctx.company} was named in ${a.mentions} of ${a.total_queries} answers`;
}

/**
 * Renders the message for touch n on the given (already resolved) channel.
 * Touches 3-4 require ctx.audit; the caller must hold the touch if it is missing. Touch 2 uses it when present.
 * The editable copy for each touch lives in agents/outreach-sequencer/templates/touch-N.md; this function is the
 * code rendering of those templates and must be kept in step with them.
 */
export function renderTouch(n: number, channel: TouchChannel, ctx: MessageContext): RenderedMessage {
  const label = categoryLabel(ctx.category);
  const hello = greeting(ctx.decisionMakerName);
  const sign = ctx.senderName;

  switch (n) {
    case 1:
      return build(`How AI assistants answer questions about ${label}s in ${ctx.city}`, [
        hello,
        `I am writing from The Growth Lab. When someone asks ChatGPT, Gemini or Perplexity which ${label} in ${ctx.city} to trust, the answer they get shapes who they call.`,
        `I am putting together a one-page result for ${ctx.company}: the same buyer questions, asked of the three assistants, and what each one says. It will reach you in a few days.`,
        sign,
        OPT_OUT_LINE,
      ]);
    case 2: {
      const a = ctx.audit;
      const finding = a ? `${auditFinding(ctx)}.` : `the one-page result for ${ctx.company} reaches your inbox in two days.`;
      const body = `${hello} ${sign} from The Growth Lab. I emailed you about how ChatGPT, Gemini and Perplexity answer when someone in ${ctx.city} asks for a ${label}: ${finding} Reply YES if you would like the PDF here as well. Reply STOP to hear no more.`;
      if (channel === "WhatsApp") return { text: body };
      return build(`Re: how AI assistants answer about ${label}s in ${ctx.city}`, [
        hello,
        `A short follow-up to my note on how ChatGPT, Gemini and Perplexity answer when someone in ${ctx.city} asks for a ${label}: ${finding}`,
        "The full one-page result follows by email.",
        sign,
        OPT_OUT_LINE,
      ]);
    }
    case 3: {
      const a = ctx.audit;
      if (!a) throw new Error(`Touch ${ONE_PAGER_TOUCH} requires the audit summary`);
      const paras = [
        hello,
        `Attached is the one-page result for ${ctx.company}. We asked ChatGPT, Gemini and Perplexity ${a.total_queries / Math.max(1, Object.keys(a.mentions_by_engine).length)} buyer questions each about ${label}s in ${ctx.city}. ${auditFinding(ctx)}.`,
      ];
      if (a.top_competitors.length > 0) {
        paras.push(`The names that came up most instead: ${a.top_competitors.join(", ")}.`);
      }
      paras.push(
        "If it is useful, I can walk you through it in 20 minutes and show which questions you are missing from. Reply here and I will send times.",
        sign,
        OPT_OUT_LINE
      );
      return build(`${ctx.company}: how AI assistants answer for ${label}s in ${ctx.city}`, paras);
    }
    case 4: {
      const finding = auditFinding(ctx);
      const cited = ctx.audit?.top_cited_domains?.[0];
      const body = `${hello} one line from the report: ${finding}.${cited ? ` The source the assistants cited most was ${cited}.` : ""} That is usually a two-week fix, not a campaign. Want the 20-minute walkthrough? Reply with a day. ${OPT_OUT_LINE}`;
      if (channel === "WhatsApp") return { text: body };
      return build(`One fix from the report, ${ctx.company}`, [
        hello,
        `One line from the report: ${finding}.${cited ? ` The source the assistants cited most was ${cited}.` : ""} That is usually a two-week fix, not a campaign.`,
        "Want the 20-minute walkthrough? Reply with a day that suits you. You keep the audit whether or not we work together.",
        sign,
        OPT_OUT_LINE,
      ]);
    }
    case 5:
      return build(`Closing the file on ${ctx.company}`, [
        hello,
        `This is my last note. If AI assistant visibility for ${ctx.company} is not a priority right now, no problem, and I will close the file. If it becomes one, reply to this thread and the one-pager is still yours.`,
        sign,
        OPT_OUT_LINE,
      ]);
    default:
      throw new Error(`Unknown touch ${n}`);
  }
}

// services/tgl-ops/src/agents/outreach-sequencer/live.ts
// Composition root for the Outreach Sequencer (PLAN-D10b). The modules from PR #104 (worker, execute, reply,
// templates, ghl, store, onepager) are ports-and-rules code with no I/O of their own. This file connects them to
// the real world: Supabase prospects, GHL (email; WhatsApp only when GHL_WA_PHONE_ID is set), the short-form audit
// engine, Supabase Storage for the one-pager, Slack, and the templates in agents/outreach-sequencer/templates.
//
// Safety: everything stays dry-run until OUTREACH_LIVE=1 (enforced in worker.ts runTick). A dry run never contacts
// GHL and never advances a sequence. This file adds no send path of its own.
//
// Environment read here:
//   OUTREACH_LIVE                 "1" sends for real; anything else is a dry run (worker.ts)
//   GHL_WA_PHONE_ID               when set, WhatsApp touches go out on WhatsApp; unset, they fall back to email
//   GHL_API_KEY, GHL_LOCATION_ID  GHL access (ghl.ts); required only when live
//   OUTREACH_BOOKING_LINK         fills {{booking_link}} when a template uses it
//   OUTREACH_SENDER_NAME          sender sign-off passed to the renderer (default "The Growth Lab")
//   OUTREACH_TEMPLATES_DIR        override for agents/outreach-sequencer/templates (templates.ts)
//   OUTREACH_TEST_PROSPECT_ID     dry-run only: the first in-window tick of each IST day renders all five touches
//                                 for this prospect into logs/<date>/outreach-sequencer.md, with no sends and no writes
//   OUTREACH_LOG_DIR              override for the logs directory
//   OUTREACH_TICK_CRON            override for the tick schedule (default "30 9-16 * * 1-5", IST)
import fs from "node:fs";
import path from "node:path";
import { postLine } from "../../lib/post.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { makeExecute, type ExecutorPorts, type ProspectView } from "./execute.js";
import { createGhlClient, loadGhlConfig, type GhlClient } from "./ghl.js";
import { domainOf, renderOnePagerPdf, runProspectAudit, uploadOnePager, type OnePagerProspect } from "./onepager.js";
import type { ReplyDeps } from "./reply.js";
import { SEQUENCE, TOTAL_TOUCHES, istDateKey, resolveChannel } from "./sequence.js";
import { createSupabaseStore, getOutreachState, type OutreachProspect, type ProspectStore } from "./store.js";
import { loadTemplates, makeTemplateRenderer, resolveTemplatesDir, type TemplateSet } from "./templates.js";
import type { AuditSummary, RenderedMessage } from "./types.js";
import { isLive, isSendWindow, runTick, type DueTouch, type TickPorts, type TickSummary, type TouchNumber } from "./worker.js";

export const DEFAULT_TICK_CRON = "30 9-16 * * 1-5";
export const DEFAULT_SENDER_NAME = "The Growth Lab";

export function tickCron(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OUTREACH_TICK_CRON || "").trim() || DEFAULT_TICK_CRON;
}

export function whatsappEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GHL_WA_PHONE_ID || "").trim() !== "";
}

// ---------------------------------------------------------------------------
// Prospect row -> executor view
// ---------------------------------------------------------------------------

type ViewWithWebsite = ProspectView & { website: string };

function categoryOf(p: OutreachProspect): string {
  const direct = (p as unknown as { category?: string }).category;
  if (typeof direct === "string" && direct.trim()) return direct;
  const fromSignals = (p.signals as unknown as { category?: unknown } | undefined)?.category;
  return typeof fromSignals === "string" ? fromSignals : "";
}

export function toView(p: OutreachProspect): ViewWithWebsite {
  const dm = p.decision_maker;
  return {
    id: p.id,
    company: p.company,
    category: categoryOf(p),
    city: p.city,
    email: dm?.email || undefined,
    phone: dm?.phone || undefined,
    decisionMakerName: dm?.name || undefined,
    outreach: getOutreachState(p),
    website: p.website,
  };
}

function toOnePagerProspect(v: ViewWithWebsite): OnePagerProspect {
  return { company: v.company, website: v.website, category: v.category, city: v.city };
}

// ---------------------------------------------------------------------------
// Template preflight and the five-touch preview
// ---------------------------------------------------------------------------

/** Names of every {{placeholder}} used by any touch (body or subject). */
export function templatePlaceholders(set: TemplateSet): Set<string> {
  const found = new Set<string>();
  const re = /\{\{\s*([a-z_]+)\s*\}\}/g;
  for (const t of set.values()) {
    for (const text of [t.body, t.subject || ""]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) found.add(m[1]);
    }
  }
  return found;
}

export interface PreviewResult {
  markdown: string;
  rendered: number;
  failures: number;
}

/**
 * Renders all five touches for one prospect exactly as the executor would (same channel resolution, same
 * template renderer) and formats them for the log. Pure: no I/O, no state change.
 */
export function renderSequencePreview(
  set: TemplateSet,
  view: ProspectView,
  audit: AuditSummary | undefined,
  opts: { senderName: string; bookingLink?: string; whatsappEnabled: boolean }
): PreviewResult {
  const render = makeTemplateRenderer(set, { bookingLink: opts.bookingLink });
  const lines: string[] = [];
  let rendered = 0;
  let failures = 0;

  for (const def of SEQUENCE) {
    const channel = resolveChannel(def.channel, { hasPhone: Boolean(view.phone), whatsappEnabled: opts.whatsappEnabled });
    lines.push(`#### Touch ${def.n} of ${TOTAL_TOUCHES}: ${channel}, business day ${def.offsetBusinessDays}`);
    try {
      const msg: RenderedMessage = render(def.n, channel, {
        company: view.company,
        category: view.category,
        city: view.city,
        decisionMakerName: view.decisionMakerName,
        audit,
        senderName: opts.senderName,
        email: view.email,
      });
      if (msg.subject) lines.push(`Subject: ${msg.subject}`);
      if (def.attachOnePager) lines.push("Attachment: prospect one-pager PDF (built and signed at send time, not uploaded in a preview)");
      lines.push("```", msg.text, "```");
      rendered++;
    } catch (err) {
      failures++;
      lines.push(`RENDER FAILED: ${(err as { message?: string })?.message || String(err)}`);
    }
    lines.push("");
  }

  return { markdown: lines.join("\n"), rendered, failures };
}

export function formatTickLog(now: Date, summary: TickSummary): string {
  const lines = [
    `### Tick ${now.toISOString()} (${summary.mode === "live" ? "LIVE" : "dry run"})`,
    `ran: ${summary.ran}${summary.reason ? ` (${summary.reason})` : ""} | due: ${summary.due} | sent today before tick: ${summary.sentToday} | cap: ${summary.cap} | deferred by cap: ${summary.deferredByCap}`,
  ];
  for (const o of summary.outcomes) {
    lines.push(
      `- ${o.item.company} (${o.item.prospectId}) touch ${o.item.touch} via ${o.item.channel}: ${o.result.status}${o.result.reason ? ` - ${o.result.reason}` : ""}${o.result.attachmentUrl ? " - one-pager attached" : ""}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Log sink: logs/<IST date>/outreach-sequencer.md
// ---------------------------------------------------------------------------

function findLogsRoot(env: NodeJS.ProcessEnv, cwd: string = process.cwd()): string {
  const override = (env.OUTREACH_LOG_DIR || "").trim();
  if (override) return path.resolve(cwd, override);
  for (const base of [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "..", "..")]) {
    const candidate = path.join(base, "logs");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return path.join(cwd, "logs");
}

export function fileLogWriter(env: NodeJS.ProcessEnv = process.env): (dateKey: string, markdown: string) => Promise<void> {
  return async (dateKey, markdown) => {
    const dir = path.join(findLogsRoot(env), dateKey);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "outreach-sequencer.md");
    const header = fs.existsSync(file) ? "" : `# Outreach Sequencer ${dateKey}\n\n`;
    fs.appendFileSync(file, `${header}${markdown}\n`, "utf8");
  };
}

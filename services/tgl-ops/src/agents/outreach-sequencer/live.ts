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

// ---------------------------------------------------------------------------
// Real-world adapters (defaults; every one is injectable for tests)
// ---------------------------------------------------------------------------

async function defaultAudit(p: OnePagerProspect): Promise<AuditSummary> {
  const { result, summary } = await runProspectAudit(p);
  // Templates may quote the top competitor's count; it comes straight from the audit, never estimated.
  const counts = result.summary.competitorMentions;
  const competitorMentions: Record<string, number> = {};
  for (const name of summary.top_competitors) {
    if (typeof counts[name] === "number") competitorMentions[name] = counts[name];
  }
  return Object.keys(competitorMentions).length > 0 ? { ...summary, competitor_mentions: competitorMentions } : summary;
}

async function defaultStoreOnePager(p: OnePagerProspect, summary: AuditSummary, env: NodeJS.ProcessEnv): Promise<string> {
  const pdf = renderOnePagerPdf(p, summary);
  const stored = await uploadOnePager(p.company || domainOf(p.website), pdf, env);
  return stored.path;
}

async function defaultSignUrl(storagePath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured; cannot sign one-pager URL");
  const bucket = (env.OUTREACH_ONEPAGER_BUCKET || "audit-onepagers").trim();
  const signed = await sb.storage.from(bucket).createSignedUrl(storagePath, 7 * 24 * 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(`One-pager signed URL failed: ${signed.error?.message || "no url"}`);
  }
  return signed.data.signedUrl;
}

async function defaultAlert(text: string): Promise<unknown> {
  const { getAlertsChannel } = await import("../../lib/cron-wrapper.js");
  return postLine({ channel: getAlertsChannel(), text });
}

// ---------------------------------------------------------------------------
// Reply webhook dependencies
// ---------------------------------------------------------------------------

export interface WiringOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  store?: ProspectStore;
  /** Pass a client to use it. Omit to build one from GHL_API_KEY / GHL_LOCATION_ID on first use. */
  ghl?: GhlClient;
}

/**
 * Dependencies for POST /outreach/ghl-reply. The store is always present. GHL annotation (tags, notes) is optional
 * in handleReply, so a missing GHL config logs a warning and the reply is still routed to the Sales Desk.
 */
export function buildReplyDeps(opts: WiringOptions = {}): ReplyDeps {
  const env = opts.env || process.env;
  let ghl: GhlClient | undefined = opts.ghl;
  if (!ghl) {
    try {
      ghl = createGhlClient(loadGhlConfig(env));
    } catch (err) {
      console.warn(`[Outreach] Reply handler running without GHL annotation: ${(err as Error).message}`);
    }
  }
  return { store: opts.store || createSupabaseStore(), ghl, now: opts.now };
}

// ---------------------------------------------------------------------------
// Runtime: the daily tick, the preview and the preflight
// ---------------------------------------------------------------------------

export interface RuntimeOptions extends WiringOptions {
  /** Loaded templates. Omit to read agents/outreach-sequencer/templates (throws if missing). */
  templates?: TemplateSet;
  alert?: (text: string) => Promise<unknown>;
  writeLog?: (dateKey: string, markdown: string) => Promise<void>;
  audit?: (p: OnePagerProspect) => Promise<AuditSummary>;
  /** Render and store the one-pager PDF; returns the storage path. */
  storeOnePager?: (p: OnePagerProspect, summary: AuditSummary) => Promise<string>;
  signUrl?: (storagePath: string) => Promise<string>;
}

export interface TickResult {
  /** Null when the tick did not run because of a preflight problem. */
  summary: TickSummary | null;
  issues: string[];
  previewed?: PreviewResult;
}

export interface OutreachRuntime {
  tick(): Promise<TickResult>;
  /** Render all five touches for one prospect without sending or saving anything. */
  preview(prospectId: string): Promise<PreviewResult>;
  /** Problems that would make a live send fail or render badly. Empty when clean. */
  preflight(): string[];
}

export function createOutreachRuntime(opts: RuntimeOptions = {}): OutreachRuntime {
  const env = opts.env || process.env;
  const now = opts.now || (() => new Date());
  const store = opts.store || createSupabaseStore();
  const templates = opts.templates || loadTemplates(resolveTemplatesDir(env));
  const alert = opts.alert || defaultAlert;
  const writeLog = opts.writeLog || fileLogWriter(env);
  const audit = opts.audit || defaultAudit;
  const storeOnePager = opts.storeOnePager || ((p, s) => defaultStoreOnePager(p, s, env));
  const signUrl = opts.signUrl || ((p) => defaultSignUrl(p, env));
  const senderName = (env.OUTREACH_SENDER_NAME || "").trim() || DEFAULT_SENDER_NAME;
  const bookingLink = (env.OUTREACH_BOOKING_LINK || "").trim() || undefined;
  const waOn = whatsappEnabled(env);

  let ghlCache: GhlClient | undefined = opts.ghl;
  const ghl = (): GhlClient => {
    if (!ghlCache) ghlCache = createGhlClient(loadGhlConfig(env));
    return ghlCache;
  };

  // Rows read at the start of each tick, so the executor sees exactly what listDue saw.
  const rows = new Map<string, OutreachProspect>();
  const previewedToday = new Set<string>();

  async function refresh(): Promise<OutreachProspect[]> {
    const list = await store.loadSequenced();
    rows.clear();
    for (const r of list) rows.set(r.id, r);
    return list;
  }

  const executorPorts: ExecutorPorts = {
    now,
    senderName,
    whatsappEnabled: waOn,
    render: makeTemplateRenderer(templates, { bookingLink }),
    // The file templates quote the prospect's own audit from touch 1, so the audit is built first.
    auditEveryTouch: true,
    async loadProspect(id) {
      const row = rows.get(id) || (await refresh(), rows.get(id));
      return row ? toView(row) : null;
    },
    async saveState(id, state) {
      await store.saveState(id, state);
    },
    async buildOnePager(prospect) {
      const op = toOnePagerProspect(prospect as ViewWithWebsite);
      const summary = await audit(op);
      const storagePath = await storeOnePager(op, summary);
      return { audit: summary, path: storagePath };
    },
    signOnePagerUrl: signUrl,
    async upsertContact(prospect) {
      const v = prospect as ViewWithWebsite;
      const res = await ghl().upsertContact({
        name: v.decisionMakerName,
        email: v.email,
        phone: v.phone,
        companyName: v.company,
        website: v.website,
        tags: ["tgl-outreach"],
      });
      return res.contactId;
    },
    async sendMessage(msg) {
      const res = await ghl().sendMessage({
        contactId: msg.contactId,
        channel: msg.channel,
        subject: msg.message.subject,
        html: msg.message.html,
        text: msg.message.text,
        attachmentUrls: msg.attachmentUrl ? [msg.attachmentUrl] : undefined,
      });
      return { messageId: res.messageId };
    },
  };

  const tickPorts: TickPorts = {
    now,
    env,
    async listDue(at) {
      const list = await refresh();
      const due: DueTouch[] = [];
      for (const r of list) {
        const s = getOutreachState(r);
        if (!s || s.state !== "active") continue;
        const def = SEQUENCE.find((t) => t.n === s.next_touch);
        if (!def) continue;
        if (new Date(s.next_due_at).getTime() > at.getTime()) continue;
        const channel = resolveChannel(def.channel, { hasPhone: Boolean(r.decision_maker?.phone), whatsappEnabled: waOn });
        due.push({
          prospectId: r.id,
          company: r.company,
          touch: def.n as TouchNumber,
          channel: channel === "WhatsApp" ? "whatsapp" : "email",
          dueAt: s.next_due_at,
        });
      }
      return due;
    },
    async countToday(at) {
      const today = istDateKey(at);
      const list = await store.loadSequenced();
      let count = 0;
      for (const r of list) {
        for (const t of getOutreachState(r)?.touches || []) {
          if (!t.dry_run && istDateKey(new Date(t.sent_at)) === today) count++;
        }
      }
      return count;
    },
    execute: makeExecute(executorPorts),
    alert,
  };

  function preflight(): string[] {
    const issues: string[] = [];
    if (templatePlaceholders(templates).has("booking_link") && !bookingLink) {
      issues.push("a template uses {{booking_link}} but OUTREACH_BOOKING_LINK is not set");
    }
    if (isLive(env)) {
      const cfg = loadGhlConfig(env);
      if (!cfg.apiKey || !cfg.locationId) issues.push("OUTREACH_LIVE=1 but GHL_API_KEY or GHL_LOCATION_ID is not set");
    }
    return issues;
  }

  async function preview(prospectId: string): Promise<PreviewResult> {
    const pool = [...(await store.loadSequenced()), ...(await store.loadEnrollable(500))];
    const row = pool.find((r) => r.id === prospectId);
    if (!row) throw new Error(`Preview prospect ${prospectId} not found among sequenced or enrollable prospects`);
    const view = toView(row);
    // Use the stored audit when there is one; otherwise run the short-form audit once. Nothing is saved.
    const summary = view.outreach?.audit || (await audit(toOnePagerProspect(view)));
    const result = renderSequencePreview(templates, view, summary, { senderName, bookingLink, whatsappEnabled: waOn });
    const at = now();
    await writeLog(
      istDateKey(at),
      [
        `### Preview ${at.toISOString()} (dry run): ${view.company} (${view.id})`,
        `preview:${view.id} | audit run ${summary.audited_at.slice(0, 10)} | ${summary.mentions} of ${summary.total_queries} answers named the brand`,
        "",
        result.markdown,
      ].join("\n")
    );
    return result;
  }

  async function tick(): Promise<TickResult> {
    const issues = preflight();
    const at = now();
    const live = isLive(env);

    if (issues.length > 0) {
      console.warn(`[Outreach] Tick skipped, preflight failed: ${issues.join("; ")}`);
      if (live) await alert(`*Outreach tick skipped.* ${issues.join("; ")}. Nothing was sent.`);
    }

    const result: TickResult = { summary: null, issues };

    const testId = (env.OUTREACH_TEST_PROSPECT_ID || "").trim();
    const previewKey = `${istDateKey(at)}:${testId}`;
    if (testId && !live && isSendWindow(at) && !previewedToday.has(previewKey)) {
      previewedToday.add(previewKey);
      try {
        result.previewed = await preview(testId);
        console.log(`[Outreach] Preview for ${testId}: ${result.previewed.rendered} of ${TOTAL_TOUCHES} touches rendered, ${result.previewed.failures} failed`);
      } catch (err) {
        previewedToday.delete(previewKey);
        console.warn(`[Outreach] Preview failed: ${(err as Error).message}`);
      }
    }

    if (issues.length > 0) return result;

    const summary = await runTick(tickPorts);
    result.summary = summary;
    console.log(`[Outreach] Tick ${summary.mode}: ran=${summary.ran} reason=${summary.reason || "-"} due=${summary.due} outcomes=${summary.outcomes.length}`);
    if (summary.outcomes.length > 0 || summary.reason === "cap_reached") {
      await writeLog(istDateKey(at), formatTickLog(at, summary));
    }
    return result;
  }

  return { tick, preview, preflight };
}

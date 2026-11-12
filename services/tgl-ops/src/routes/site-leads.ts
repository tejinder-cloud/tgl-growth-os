// services/tgl-ops/src/routes/site-leads.ts
// Public lead endpoints behind the website forms: POST /aeo/lead and POST /automation/lead (one handler,
// two kinds). Origin allow-list, honeypot, per-IP rate limit, validation, save-first, GHL second, card third.
// Deps are injectable so tests exercise the full HTTP path with no network.
import express, { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { FetchLike } from "../lib/aeo-lead.js";
import {
  siteGhlConfigFromEnv,
  siteLeadCard,
  supabaseSiteLeadStore,
  validateSiteLead,
  writeSiteLeadToGhl,
  type SiteGhlConfig,
  type SiteGhlResult,
  type SiteLead,
  type SiteLeadKind,
  type SiteLeadStore,
} from "../lib/site-leads.js";

export interface SiteLeadDeps {
  store: SiteLeadStore | null;
  ghl: SiteGhlConfig | null;
  fetchFn: FetchLike;
  /** Operational alert (#alerts). */
  notify: (text: string) => Promise<void>;
  /** The lead card (#revenue). */
  postLeadCard: (card: { title: string; summary: string; kind: SiteLeadKind }) => Promise<void>;
  now: () => number;
  /**
   * Starts the free first audit for an AEO request (decisions/2026-11-12.md). Fire-and-forget: the visitor's
   * response never waits for it. The audit is posted to #revenue for the Architect; it is never sent by the service.
   */
  startAudit: (lead: SiteLead, rowId: string) => void;
}

let depsOverride: Partial<SiteLeadDeps> | null = null;
/** Tests inject fakes; pass null to restore defaults. */
export function setSiteLeadDeps(d: Partial<SiteLeadDeps> | null): void {
  depsOverride = d;
}

async function defaultNotify(text: string): Promise<void> {
  const { slackClient } = await import("../lib/slack-client.js");
  const { config } = await import("../config.js");
  await slackClient.chat.postMessage({ channel: config.alertsChannelId, text });
}

async function defaultPostLeadCard(card: { title: string; summary: string; kind: SiteLeadKind }): Promise<void> {
  const { postCard } = await import("../lib/post.js");
  const { config } = await import("../config.js");
  const channel = (process.env.REVENUE_CHANNEL_ID || "").trim() || (config as any).revenueChannelId || "#revenue";
  await postCard({
    channel,
    agent: card.kind === "aeo" ? "aeo-audit-engine" : "sales-desk",
    door: card.kind === "aeo" ? "aeo" : "core",
    title: card.title,
    summary: card.summary,
  });
}

function defaultStartAudit(lead: SiteLead, rowId: string): void {
  // Tests never start a live audit from the lead route; they inject startAudit when they want to observe it.
  if (process.env.TGL_TEST_MODE === "1") return;
  void (async () => {
    try {
      const { runProspectAudit } = await import("../agents/aeo-audit-engine/prospect-audit.js");
      await runProspectAudit({
        businessName: lead.business_name,
        website: lead.domain || lead.website || "",
        industry: lead.industry,
        city: lead.city,
        source: "site_lead",
        leadId: rowId,
      });
    } catch (err: any) {
      console.error("[Site Leads] prospect audit crashed:", err?.message || err);
      await defaultNotify(`Prospect audit for lead ${rowId} (${lead.business_name}) crashed: ${String(err?.message || err).slice(0, 160)}`).catch(() => undefined);
    }
  })();
}

function defaultStore(): SiteLeadStore | null {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) return null;
  return supabaseSiteLeadStore(createClient(url, key, { auth: { persistSession: false } }));
}

let cachedDefaultStore: SiteLeadStore | null | undefined;
function resolveDeps(): SiteLeadDeps {
  if (cachedDefaultStore === undefined && !(depsOverride && "store" in depsOverride)) cachedDefaultStore = defaultStore();
  return {
    store: depsOverride && "store" in depsOverride ? (depsOverride.store ?? null) : (cachedDefaultStore ?? null),
    ghl: depsOverride && "ghl" in depsOverride ? (depsOverride.ghl ?? null) : siteGhlConfigFromEnv(),
    fetchFn: depsOverride?.fetchFn ?? ((url, init) => fetch(url, init) as any),
    notify: depsOverride?.notify ?? defaultNotify,
    postLeadCard: depsOverride?.postLeadCard ?? defaultPostLeadCard,
    now: depsOverride?.now ?? Date.now,
    startAudit: depsOverride?.startAudit ?? defaultStartAudit,
  };
}

// Per-IP rate limit: 5 requests per rolling hour, shared by both forms.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();
export function resetSiteLeadRateLimit(): void {
  hits.clear();
}
function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const k of Array.from(hits.keys()).slice(0, 1000)) hits.delete(k);
  return recent.length > MAX_PER_WINDOW;
}

export function allowedOrigins(): string[] {
  return (process.env.AEO_ALLOWED_ORIGINS || "https://thegrowthlab.co.in,https://www.thegrowthlab.co.in")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function cors(req: Request, res: Response, next: () => void): void {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function ipHash(ip: string | undefined): string | null {
  if (!ip) return null;
  const salt = (process.env.LEAD_IP_SALT || "tgl").trim();
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function leadHandler(kind: SiteLeadKind) {
  return async (req: Request, res: Response): Promise<void> => {
    const deps = resolveDeps();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins().includes(origin)) {
      res.status(403).json({ ok: false, error: "origin not allowed" });
      return;
    }

    // Honeypot: a hidden field real visitors never fill. Answer 200 so bots do not retry; nothing is saved.
    if (req.body && typeof req.body.hp === "string" && req.body.hp.trim() !== "") {
      res.status(200).json({ ok: true });
      return;
    }

    if (rateLimited(req.ip || "unknown", deps.now())) {
      res.setHeader("Retry-After", "3600");
      res.status(429).json({ ok: false, error: "Too many requests. Try again in an hour." });
      return;
    }

    const parsed = validateSiteLead(kind, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, errors: parsed.errors });
      return;
    }
    const lead: SiteLead = parsed.lead;

    // 1. Save first. No row, no success.
    if (!deps.store) {
      console.error("[Site Leads] database not configured (SUPABASE_URL / service key)");
      await deps.notify(`${kind} lead from ${lead.business_name} could not be saved: database not configured.`).catch(() => undefined);
      res.status(503).json({ ok: false, error: "We could not save your request. Please try again in a few minutes." });
      return;
    }
    let rowId: string;
    try {
      rowId = await deps.store.insert(lead, { ipHash: ipHash(req.ip), userAgent: (req.headers["user-agent"] || "").toString().slice(0, 200) || null });
    } catch (err: any) {
      console.error("[Site Leads] insert failed:", err?.message || err);
      await deps.notify(`${kind} lead from ${lead.business_name} could not be saved: ${String(err?.message || err).slice(0, 160)}`).catch(() => undefined);
      res.status(503).json({ ok: false, error: "We could not save your request. Please try again in a few minutes." });
      return;
    }

    // 2. GoHighLevel, when configured. A failure here is recorded and alerted, never shown to the visitor.
    let ghl: SiteGhlResult | null = null;
    let ghlError: string | null = null;
    if (deps.ghl) {
      try {
        ghl = await writeSiteLeadToGhl(lead, deps.ghl, deps.fetchFn);
      } catch (err: any) {
        ghlError = String(err?.message || err);
        console.error("[Site Leads] GHL write failed:", ghlError);
        await deps.notify(`${kind} lead ${rowId} (${lead.business_name}) saved but not written to GoHighLevel: ${ghlError.slice(0, 160)}`).catch(() => undefined);
      }
      await deps.store.markGhl(rowId, { contactId: ghl?.contactId ?? null, opportunityId: ghl?.opportunityId ?? null, error: ghlError });
    }

    // 3. The card. Also non-fatal: the row is the record.
    const card = siteLeadCard(lead, ghl, ghlError);
    await deps.postLeadCard({ ...card, kind }).catch((e: any) => console.warn("[Site Leads] card failed:", e?.message || e));

    // 4. The free first audit, for AEO requests. Started after everything else; never awaited.
    if (kind === "aeo") {
      try {
        deps.startAudit(lead, rowId);
      } catch (e: any) {
        console.warn("[Site Leads] audit not started:", e?.message || e);
      }
    }

    res.status(200).json({ ok: true });
  };
}

export const aeoLeadRouter = Router();
aeoLeadRouter.use(cors);
aeoLeadRouter.post("/lead", express.json({ limit: "16kb" }), leadHandler("aeo"));

export const automationLeadRouter = Router();
automationLeadRouter.use(cors);
automationLeadRouter.post("/lead", express.json({ limit: "16kb" }), leadHandler("automation"));

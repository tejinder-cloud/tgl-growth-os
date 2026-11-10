// services/tgl-ops/src/routes/aeo.ts
// POST /aeo/lead : public endpoint behind the /aeo audit request form.
// Validates, writes the lead to the GHL "AEO" pipeline, and posts a plain-text alert to the ops channel.
// Fails closed: with GHL unconfigured it returns 503 and the form shows a retry message, rather than
// pretending the lead was saved.
//
// Mount in app.ts:   app.use("/aeo", aeoRouter);
import express, { Router, type Request, type Response } from "express";
import { validateLead, writeLeadToGhl, ghlConfigFromEnv, sourceLabel, type AeoLeadClean, type FetchLike, type GhlConfig, type GhlWriteResult } from "../lib/aeo-lead.js";

export interface AeoLeadDeps {
  ghl: GhlConfig | null;
  fetchFn: FetchLike;
  notify: (text: string) => Promise<void>;
  now: () => number;
}

let depsOverride: Partial<AeoLeadDeps> | null = null;

/** Test hook and composition-root hook. Pass null to restore the environment-backed defaults. */
export function setAeoLeadDeps(d: Partial<AeoLeadDeps> | null): void {
  depsOverride = d;
}

async function defaultNotify(text: string): Promise<void> {
  const { slackClient } = await import("../lib/slack-client.js");
  const { config } = await import("../config.js");
  await slackClient.chat.postMessage({ channel: config.alertsChannelId, text });
}

function resolveDeps(): AeoLeadDeps {
  return {
    ghl: depsOverride && "ghl" in depsOverride ? (depsOverride.ghl ?? null) : ghlConfigFromEnv(),
    fetchFn: depsOverride?.fetchFn ?? ((url, init) => fetch(url, init) as any),
    notify: depsOverride?.notify ?? defaultNotify,
    now: depsOverride?.now ?? Date.now,
  };
}

// Per-IP limiter: 5 submissions per hour. In-memory, per process.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export function resetAeoRateLimit(): void {
  hits.clear();
}

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function allowedOrigins(): string[] {
  return (process.env.AEO_ALLOWED_ORIGINS || "https://thegrowthlab.co.in,https://www.thegrowthlab.co.in")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const aeoRouter = Router();

aeoRouter.use((req: Request, res: Response, next) => {
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
});

aeoRouter.post("/lead", express.json({ limit: "16kb" }), async (req: Request, res: Response) => {
  const deps = resolveDeps();
  const origin = req.headers.origin;
  if (origin && !allowedOrigins().includes(origin)) {
    res.status(403).json({ ok: false, error: "origin not allowed" });
    return;
  }

  // Honeypot: a hidden field real visitors never fill. Answer 200 so bots do not retry.
  if (req.body && typeof req.body.hp === "string" && req.body.hp.trim() !== "") {
    res.status(200).json({ ok: true });
    return;
  }

  if (rateLimited(req.ip || "unknown", deps.now())) {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({ ok: false, error: "Too many requests. Try again in an hour." });
    return;
  }

  const parsed = validateLead(req.body);
  if (!parsed.ok) {
    res.status(422).json({ ok: false, errors: parsed.errors });
    return;
  }

  if (!deps.ghl) {
    console.error("[AEO Lead] GHL env (GHL_API_KEY, GHL_LOCATION_ID, GHL_AEO_PIPELINE_ID, GHL_AEO_STAGE_NEW_ID) not configured");
    res.status(503).json({ ok: false, error: "Requests are temporarily unavailable. Please try again shortly." });
    return;
  }

  let result: GhlWriteResult;
  try {
    result = await writeLeadToGhl(parsed.lead, deps.ghl, deps.fetchFn);
  } catch (err: any) {
    console.error("[AEO Lead] GHL write failed:", err?.message || err);
    // Tell the team so a failed write is never a silently lost lead. No personal data in the alert beyond the institute.
    await deps.notify(`AEO audit request for ${parsed.lead.institute} could not be written to GHL. Check the GHL credentials and the ops logs.`).catch(() => undefined);
    res.status(502).json({ ok: false, error: "We could not save your request. Please try again." });
    return;
  }

  await deps.notify(formatAlert(parsed.lead, result)).catch((e: any) => console.warn("[AEO Lead] alert failed:", e?.message || e));
  res.status(200).json({ ok: true });
});

export function formatAlert(lead: AeoLeadClean, r: GhlWriteResult): string {
  return [
    "*New AEO audit request*",
    `Institute: ${lead.institute} (${lead.domain})`,
    `Contact: ${lead.name}, ${lead.phoneE164}`,
    `Source: ${sourceLabel(lead)}`,
    `GHL opportunity: ${r.opportunityId}`,
  ].join("\n");
}

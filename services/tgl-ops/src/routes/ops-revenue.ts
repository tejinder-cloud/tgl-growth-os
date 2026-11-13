// services/tgl-ops/src/routes/ops-revenue.ts
// GET /ops/revenue : read-only, public, no-auth counts for the revenue strip on the project dashboard
// (project.thegrowthlab.co.in). It returns the target set on 12 Nov 2026 and five counts, the same ones the
// 09:00 card shows. No business name, no person, no email, no token, no channel id.
//
// A count that cannot be read is null, never a typed fallback: the page then shows a dash for it.
// Answers are cached for five minutes, so the page's refreshes never multiply calls to the database or GHL.
import { Router, type Request, type Response } from "express";
import { REVENUE_TARGET } from "../agents/chief-of-staff/plain-card.js";

export interface RevenueCounts {
  auditsRequested: number | null;
  auditsSent: number | null;
  callsBooked: number | null;
  retainersWon: number | null;
}

export interface OpsRevenue {
  target: { since: string; due: string; conversations: number; retainers: number };
  audits_requested: number | null;
  audits_sent: number | null;
  calls_booked: number | null;
  retainers_won: number | null;
  read_at: string;
}

export type RevenueCountsProvider = () => Promise<RevenueCounts>;

let provider: RevenueCountsProvider | null = null;
let cache: { at: number; body: OpsRevenue } | null = null;
export const CACHE_MS = 5 * 60 * 1000;

/** Composition-root and test hook. Pass null to remove the provider (the route then answers 503). Clears the cache. */
export function setRevenueCountsProvider(p: RevenueCountsProvider | null): void {
  provider = p;
  cache = null;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1_000_000 ? v : null);

/** Only the public keys, every count a plain non-negative integer or null. */
export function toPublicRevenue(raw: RevenueCounts, now: Date = new Date()): OpsRevenue {
  return {
    target: { since: REVENUE_TARGET.since, due: REVENUE_TARGET.due, conversations: REVENUE_TARGET.conversations, retainers: REVENUE_TARGET.retainers },
    audits_requested: count(raw?.auditsRequested),
    audits_sent: count(raw?.auditsSent),
    calls_booked: count(raw?.callsBooked),
    retainers_won: count(raw?.retainersWon),
    read_at: now.toISOString(),
  };
}

function allowedOrigins(): string[] {
  const site = (process.env.AEO_ALLOWED_ORIGINS || "https://thegrowthlab.co.in,https://www.thegrowthlab.co.in")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...site, "https://project.thegrowthlab.co.in"];
}

export const opsRevenueRouter = Router();

opsRevenueRouter.get("/revenue", async (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Cache-Control", "no-store");

  if (!provider) {
    res.status(503).json({ ok: false, error: "revenue counts unavailable" });
    return;
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.status(200).json(cache.body);
    return;
  }
  try {
    const body = toPublicRevenue(await provider());
    cache = { at: Date.now(), body };
    res.status(200).json(body);
  } catch (err: any) {
    console.error("[Ops Revenue] provider failed:", err?.message || err);
    res.status(503).json({ ok: false, error: "revenue counts unavailable" });
  }
});

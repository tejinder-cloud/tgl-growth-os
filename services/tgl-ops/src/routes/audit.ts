// services/tgl-ops/src/routes/audit.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { runShortFormAuditCli } from "../scripts/run-short-form-audit.js";
import { slackClient } from "../lib/slack-client.js";
import { config } from "../config.js";

export const auditRouter = Router();

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authentication middleware for audit routes.
 * Requires HTTP header X-TGL-Secret matching AUDIT_ROUTE_SECRET.
 * Fails closed with 401 if AUDIT_ROUTE_SECRET is unconfigured or the header is missing/invalid.
 */
export const requireAuditSecret = (req: Request, res: Response, next: NextFunction): void => {
  const expectedSecret = (process.env.AUDIT_ROUTE_SECRET || config.auditRouteSecret || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const rawHeader = req.header("x-tgl-secret") || req.headers["x-tgl-secret"];
  const providedSecret = (Array.isArray(rawHeader) ? rawHeader[0] : (rawHeader as string) || "")
    .trim()
    .replace(/^["']|["']$/g, "");

  if (!expectedSecret) {
    console.warn("[Audit Auth] AUDIT_ROUTE_SECRET is not configured. Request rejected with 401.");
    res.status(401).json({
      ok: false,
      error: "Unauthorized: Missing or unconfigured AUDIT_ROUTE_SECRET",
    });
    return;
  }

  if (!providedSecret || !timingSafeCompare(providedSecret, expectedSecret)) {
    res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid or missing X-TGL-Secret header",
    });
    return;
  }

  next();
};

// Rate limiter: maximum 3 runs per hour per process
const MAX_RUNS_PER_HOUR = 3;
const ONE_HOUR_MS = 60 * 60 * 1000;
const runTimestamps: number[] = [];

export function getAuditRateLimitState(): { count: number; max: number; resetInMs: number } {
  const now = Date.now();
  while (runTimestamps.length > 0 && now - runTimestamps[0] >= ONE_HOUR_MS) {
    runTimestamps.shift();
  }
  const resetInMs = runTimestamps.length > 0 ? ONE_HOUR_MS - (now - runTimestamps[0]) : 0;
  return {
    count: runTimestamps.length,
    max: MAX_RUNS_PER_HOUR,
    resetInMs,
  };
}

export function resetAuditRateLimit(): void {
  runTimestamps.length = 0;
}

/**
 * Rate limiting middleware for audit routes.
 * Enforces a strict cap of 3 runs per hour per process.
 * Returns HTTP 429 Too Many Requests with Retry-After header when exceeded.
 */
export const auditRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const now = Date.now();
  while (runTimestamps.length > 0 && now - runTimestamps[0] >= ONE_HOUR_MS) {
    runTimestamps.shift();
  }

  if (runTimestamps.length >= MAX_RUNS_PER_HOUR) {
    const oldest = runTimestamps[0];
    const resetInMs = ONE_HOUR_MS - (now - oldest);
    const retryAfterSec = Math.ceil(resetInMs / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      ok: false,
      error: "Rate limit exceeded: Maximum 3 runs per hour per process",
      retryAfterSeconds: retryAfterSec,
    });
    return;
  }

  runTimestamps.push(now);
  next();
};

// Protect both routes: require X-TGL-Secret and rate limit to 3 runs per hour per process
auditRouter.use(requireAuditSecret);
auditRouter.use(auditRateLimiter);

const handleShortFormAudit = async (req: Request, res: Response): Promise<void> => {
  const brand = (req.body?.brand || req.query?.brand || "The Growth Lab") as string;
  const domain = (req.body?.domain || req.query?.domain || "thegrowthlab.co.in") as string;

  try {
    console.log(`[Audit Route] Triggered short-form audit for: ${brand} (${domain})`);
    // Real engines in production. Mock answers exist only inside a TGL_TEST_MODE=1 process (the CLI refuses otherwise).
    const result = await runShortFormAuditCli(brand, domain, { testMode: process.env.TGL_TEST_MODE === "1" });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[Audit Route Error]", err);
    res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
};

auditRouter.post("/short-form", handleShortFormAudit);
auditRouter.get("/short-form", handleShortFormAudit);

auditRouter.get("/channels", async (_req: Request, res: Response) => {
  try {
    const listRes = await slackClient.conversations.list({ types: "public_channel", limit: 200 });
    res.json({
      ok: true,
      channels: listRes.channels?.map((c: any) => ({ id: c.id, name: c.name, is_member: c.is_member })),
    });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

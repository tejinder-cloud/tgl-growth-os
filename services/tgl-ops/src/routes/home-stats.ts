// services/tgl-ops/src/routes/home-stats.ts
// GET /home/stats : read-only, public, no-auth feed for the Client Zero tiles on the Home page
// (site/pages/home.md section 3). It returns The Growth Lab's own Citation Tracker figures only: counts and
// dates. No brand other than TGL, no prospect, no email, no token, no channel id.
//
// Fails closed: with no data provider wired, or when the provider throws, it answers 503 with no figures, so
// the page keeps its dash on every tile. It never returns a cached or typed fallback.
//
// Mount in app.ts:   app.use("/home", homeStatsRouter);
import { Router, type Request, type Response } from "express";

export interface HomeStats {
  /** Questions in TGL's own tracked prompt set. */
  questions_tracked: number;
  /** AI engines checked in the latest run. */
  engines_checked: number;
  /** Times an engine named The Growth Lab in the latest run. */
  times_named_latest: number;
  /** The same figure from TGL's first run. */
  first_run_figure: number;
  /** ISO date (YYYY-MM-DD) of TGL's first run. */
  first_run_date: string;
  /** ISO date (YYYY-MM-DD) of the latest run. */
  last_run_date: string;
}

export type HomeStatsProvider = () => Promise<HomeStats | null>;

let provider: HomeStatsProvider | null = null;

/** Composition-root and test hook. Pass null to remove the provider (the route then fails closed). */
export function setHomeStatsProvider(p: HomeStatsProvider | null): void {
  provider = p;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1_000_000;
}

/** Returns only the six public keys, or null if any value is not a plain count or ISO date. */
export function sanitiseHomeStats(raw: unknown): HomeStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isCount(r.questions_tracked) || !isCount(r.engines_checked) || !isCount(r.times_named_latest) || !isCount(r.first_run_figure)) return null;
  if (typeof r.first_run_date !== "string" || !ISO_DATE.test(r.first_run_date)) return null;
  if (typeof r.last_run_date !== "string" || !ISO_DATE.test(r.last_run_date)) return null;
  return {
    questions_tracked: r.questions_tracked,
    engines_checked: r.engines_checked,
    times_named_latest: r.times_named_latest,
    first_run_figure: r.first_run_figure,
    first_run_date: r.first_run_date,
    last_run_date: r.last_run_date,
  };
}

function allowedOrigins(): string[] {
  return (process.env.AEO_ALLOWED_ORIGINS || "https://thegrowthlab.co.in,https://www.thegrowthlab.co.in")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const homeStatsRouter = Router();

homeStatsRouter.get("/stats", async (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Cache-Control", "no-store");

  if (!provider) {
    res.status(503).json({ ok: false, error: "stats unavailable" });
    return;
  }
  try {
    const stats = sanitiseHomeStats(await provider());
    if (!stats) {
      res.status(503).json({ ok: false, error: "stats unavailable" });
      return;
    }
    res.status(200).json(stats);
  } catch (err: any) {
    console.error("[Home Stats] provider failed:", err?.message || err);
    res.status(503).json({ ok: false, error: "stats unavailable" });
  }
});

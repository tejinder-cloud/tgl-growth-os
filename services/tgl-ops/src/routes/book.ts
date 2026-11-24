// services/tgl-ops/src/routes/book.ts
// GET  /book                 the booking page
// GET  /book/assets/:file    its fonts, logo and photo (a fixed list)
// GET  /book/slots           free slots for the next 10 working days (JSON)
// POST /book                 books a slot; "ok": true only after Google Calendar confirmed the event
// GET  /book/connect         one-time Google sign-in for the bookings calendar (only BOOKING_CALENDAR_EMAIL is accepted)
// GET  /book/oauth/callback  Google's return from that sign-in
import { Router, type Request, type Response } from "express";
import { authUrl, configIssues, exchangeCode, loadGoogleBookingConfig, makeState, verifyState } from "../agents/booking/google.js";
import { bookingService, bookingStore } from "../agents/booking/live.js";
import { BOOKING_ASSETS, BOOKING_PAGE, bookingAssetPath } from "../agents/booking/page.js";

export const bookRouter = Router();

// --- per-IP rate limit (in memory; one Railway instance) ---
const hits = new Map<string, number[]>();
export function resetBookRateLimitForTests(): void {
  hits.clear();
}
function limited(req: Request, key: string, max: number, windowMs = 10 * 60 * 1000): boolean {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(k, list);
  return list.length > max;
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f1e7;color:#1c1a17;margin:0;padding:48px 20px}main{max-width:440px;margin:0 auto}h1{font-size:22px;margin:0 0 12px}p{font-size:16px;line-height:1.5;margin:0 0 20px}</style></head><body><main>${body}</main></body></html>`;
}



bookRouter.get("/", (_req: Request, res: Response) => {
  res.status(200).type("html").set("Cache-Control", "no-store").send(BOOKING_PAGE);
});

bookRouter.get("/assets/:file", (req: Request, res: Response) => {
  const file = String(req.params.file || "");
  const p = bookingAssetPath(file);
  if (!p) {
    res.status(404).end();
    return;
  }
  res.status(200).type(BOOKING_ASSETS[file]).set("Cache-Control", "public, max-age=604800").sendFile(p);
});

bookRouter.get("/slots", async (req: Request, res: Response) => {
  if (limited(req, "slots", 120)) {
    res.status(429).json({ open: false, days: [], error: "too_many_requests" });
    return;
  }
  try {
    const out = await bookingService().slots();
    res.status(200).set("Cache-Control", "no-store").json(out);
  } catch (err) {
    console.error("[Book] slots failed:", (err as Error).message);
    res.status(503).json({ open: false, days: [], error: "calendar_unavailable" });
  }
});

bookRouter.post("/", async (req: Request, res: Response) => {
  if (limited(req, "book", 6)) {
    res.status(429).json({ ok: false, error: "too_many_requests", message: "Too many attempts. Please wait a few minutes." });
    return;
  }
  try {
    const out = await bookingService().book((req.body || {}) as any);
    if (out.ok) res.status(200).json(out);
    else res.status(out.status).json(out);
  } catch (err) {
    console.error("[Book] booking failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "calendar_failed", message: "We could not confirm that booking. Please try again, or reply to the email." });
  }
});

bookRouter.get("/connect", (_req: Request, res: Response) => {
  const cfg = loadGoogleBookingConfig();
  const issues = configIssues(cfg);
  if (issues.length > 0) {
    res.status(503).type("html").send(shell("Not ready", `<h1>Not ready to connect</h1><p>${issues.join(". ")}.</p>`));
    return;
  }
  res.redirect(302, authUrl(cfg, makeState(cfg.clientSecret)));
});

bookRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  const cfg = loadGoogleBookingConfig();
  const fail = (msg: string, code = 400) => res.status(code).type("html").send(shell("Not connected", `<h1>Not connected</h1><p>${msg}</p><p><a href="/book/connect">Try again</a></p>`));
  if (configIssues(cfg).length > 0) return void fail("The service is missing its Google settings.", 503);
  if (req.query.error) return void fail("Google sign-in was cancelled or refused.");
  if (!verifyState(String(req.query.state || ""), cfg.clientSecret)) return void fail("This sign-in link has expired. Start again.");
  try {
    const got = await exchangeCode(cfg, String(req.query.code || ""));
    if (got.email !== cfg.calendarEmail) return void fail(`Signed in as ${got.email || "an unknown account"}. Sign in with ${cfg.calendarEmail}.`, 403);
    if (!got.scopes.includes("https://www.googleapis.com/auth/calendar.events")) return void fail("Calendar access was not granted. Tick the calendar box on Google's screen.", 403);
    if (!got.refreshToken) return void fail("Google did not return a lasting sign-in. Remove The Growth Lab at myaccount.google.com/permissions and try again.", 502);
    await bookingStore().setRefreshToken(got.refreshToken);
    const gmailOk = got.scopes.includes("https://www.googleapis.com/auth/gmail.send") && got.scopes.includes("https://www.googleapis.com/auth/gmail.readonly");
    const mailLine = gmailOk
      ? `<p>Outreach email can be sent from ${cfg.calendarEmail}, and replies are read from its inbox.</p>`
      : `<p>Email sending and reading were not allowed, so outreach cannot use this account yet. <a href="/book/connect">Sign in again</a> and tick both email boxes.</p>`;
    res.status(200).type("html").send(shell("Connected", `<h1>Connected</h1><p>Bookings will be created on ${cfg.calendarEmail}.</p>${mailLine}<p><a href="/book">Open the booking page</a></p>`));
  } catch (err) {
    console.error("[Book] connect failed:", (err as Error).message);
    fail("Google sign-in could not be completed. Try again.", 502);
  }
});

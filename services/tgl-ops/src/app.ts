import express, { type Request, type Response, type NextFunction } from "express";
import querystring from "node:querystring";
import { config } from "./config.js";
import { verifySlackSignature, type SlackVerifiedRequest } from "./lib/slack-verify.js";
import { eventsRouter } from "./routes/events.js";
import { interactionsRouter } from "./routes/interactions.js";
import { commandsRouter } from "./routes/commands.js";
import { healthRouter } from "./routes/health.js";
import { cardsRouter } from "./routes/cards.js";
import { githubEventsRouter } from "./routes/github-events.js";
import { auditRouter } from "./routes/audit.js";
import { outreachRouter } from "./routes/outreach.js";
import { aeoRouter } from "./routes/aeo.js";
import { homeStatsRouter } from "./routes/home-stats.js";
import { billingRouter } from "./routes/billing.js";
import { financeRouter } from "./routes/finance.js";

/**
 * Creates and configures the Express app.
 * Captures raw body bytes once for all incoming requests, eliminating
 * conflicts between signature verification and JSON/URL-encoded parsing.
 */
export function createApp(signingSecret?: string) {
  const app = express();

  // 1. Capture raw bytes once into req.rawBody
  app.use(
    express.raw({
      type: "*/*",
      limit: "5mb",
    })
  );

  // 2. FIRST MIDDLEWARE: Synchronous url_verification handshake handler.
  // Fully synchronous: no awaits, no config fetch, no GitHub calls, no signature check.
  // Reads challenge directly from the raw buffer, logs "[handshake] answered in Nms", and responds 200 JSON.
  app.use((req: SlackVerifiedRequest, res: Response, next: NextFunction): void => {
    const url = req.originalUrl || req.url;
    if (req.method === "POST" && (url === "/slack/events" || url.startsWith("/slack/events?") || url === "/slack/events/")) {
      const buf = Buffer.isBuffer(req.body) ? req.body : undefined;
      if (buf && buf.length > 0) {
        req.rawBody = buf;
        const rawText = buf.toString("utf8");
        if (rawText.includes("url_verification")) {
          const start = process.hrtime.bigint();
          try {
            const parsed = JSON.parse(rawText);
            if (parsed.type === "url_verification" && parsed.challenge !== undefined) {
              const elapsedMs = (Number(process.hrtime.bigint() - start) / 1e6).toFixed(2);
              console.log(`[handshake] answered in ${elapsedMs}ms`);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.status(200).send(JSON.stringify({ challenge: parsed.challenge }));
              return;
            }
          } catch {
            // Not valid JSON, proceed to standard parsing
          }
        }
      }
    }
    next();
  });

  // 3. Parse body from raw bytes based on Content-Type for all other routes
  app.use((req: SlackVerifiedRequest, _res: Response, next: NextFunction) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
      const contentType = req.headers["content-type"] || "";
      const rawText = req.body.toString("utf8");

      if (contentType.includes("application/json")) {
        try {
          req.body = rawText ? JSON.parse(rawText) : {};
        } catch (err) {
          console.warn("[Body Parse Failure] Could not parse JSON body:", (err as Error).message);
          req.body = {};
        }
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        try {
          req.body = querystring.parse(rawText);
        } catch (err) {
          console.warn("[Body Parse Failure] Could not parse URL-encoded body:", (err as Error).message);
          req.body = {};
        }
      }
    } else {
      req.rawBody = Buffer.alloc(0);
      req.body = req.body || {};
    }
    next();
  });

  // 4. Health check route (unauthenticated for Railway / load balancer)
  app.use("/health", healthRouter);

  // 5. Slack entry logger: traces every request to /slack/* BEFORE signature verification
  app.use("/slack", (req: Request, _res: Response, next: NextFunction) => {
    const retryNum = req.headers["x-slack-retry-num"];
    const retryReason = req.headers["x-slack-retry-reason"];
    console.log(`[Slack Entry] ${req.method} ${req.originalUrl || req.url}`, {
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      hasTimestamp: Boolean(req.headers["x-slack-request-timestamp"]),
      hasSignature: Boolean(req.headers["x-slack-signature"]),
      retryNum: retryNum ? String(retryNum) : undefined,
      retryReason: retryReason ? String(retryReason) : undefined,
      userAgent: req.headers["user-agent"],
    });
    next();
  });

  // GET /slack/events for health/endpoint mounting verification
  app.get("/slack/events", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      endpoint: "/slack/events",
      mounted: true,
      timestamp: new Date().toISOString(),
    });
  });

  // 6. Slack routes with signature verification middleware (all real events strictly verified)
  const verifier = verifySlackSignature(signingSecret ?? config.slackSigningSecret);
  app.use("/slack/events", verifier, eventsRouter);
  app.use("/slack/interactions", verifier, interactionsRouter);
  app.use("/slack/commands", verifier, commandsRouter);

  // 7. Cards API: Inbound card dispatch endpoint for agents and tests
  app.use("/cards", cardsRouter);

  // 8. GitHub Webhook Route
  app.use("/github/events", githubEventsRouter);

  // 9. Audit API: On-demand AEO short-form audit execution and Slack attachment
  app.use("/audit", auditRouter);

  // 10. Outreach API: GHL inbound-reply webhook (shared-secret header, fails closed)
  app.use("/outreach", outreachRouter);

  // 11. AEO lead API: public POST /aeo/lead behind the /aeo audit form. Origin allow-list, honeypot,
  // per-IP rate limit; fails closed (503) when the GHL env is not configured.
  app.use("/aeo", aeoRouter);

  // 11b. Home stats: read-only GET /home/stats for the Client Zero tiles. Counts and dates for TGL's own
  // tracker only; fails closed (503, no figures) when no provider is wired.
  app.use("/home", homeStatsRouter);

  // 12. Billing: Razorpay webhooks for TrueVisible Track (signature-checked; fails closed) (plan Day 26)
  app.use("/billing", billingRouter);

  // 13. Finance: deal-Won GST invoice drafts, invoice events, ledger and collections (secret-checked; fails closed) (plan Day 13)
  app.use("/finance", financeRouter);

  // 14. Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server Error]", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

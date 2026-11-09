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

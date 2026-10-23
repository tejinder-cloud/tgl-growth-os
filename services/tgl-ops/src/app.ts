import express, { type Request, type Response, type NextFunction } from "express";
import querystring from "node:querystring";
import { config } from "./config.js";
import { verifySlackSignature, type SlackVerifiedRequest } from "./lib/slack-verify.js";
import { eventsRouter } from "./routes/events.js";
import { interactionsRouter } from "./routes/interactions.js";
import { commandsRouter } from "./routes/commands.js";
import { healthRouter } from "./routes/health.js";

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

  // 2. Parse body from raw bytes based on Content-Type
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

  // 3. Health check route (unauthenticated for Railway / load balancer)
  app.use("/health", healthRouter);

  // 4. Slack entry logger: traces every request to /slack/* BEFORE signature verification
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

  // Handshake: Respond to type=url_verification BEFORE signature verification.
  // Per Slack's documented behaviour, the handshake carries no payload worth protecting,
  // ensuring seamless setup while all real event callbacks stay strictly verified.
  app.post("/slack/events", (req: Request, res: Response, next: NextFunction) => {
    if (req.body?.type === "url_verification") {
      const challenge = req.body.challenge;
      console.log("[Slack Events] Responding to url_verification handshake before signature verification", {
        hasChallenge: Boolean(challenge),
      });
      res.status(200).json({ challenge });
      return;
    }
    next();
  });

  // 5. Slack routes with signature verification middleware (all real events strictly verified)
  const verifier = verifySlackSignature(signingSecret ?? config.slackSigningSecret);
  app.use("/slack/events", verifier, eventsRouter);
  app.use("/slack/interactions", verifier, interactionsRouter);
  app.use("/slack/commands", verifier, commandsRouter);

  // 6. Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server Error]", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

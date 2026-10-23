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

  // 4. Slack routes with signature verification middleware
  const verifier = verifySlackSignature(signingSecret ?? config.slackSigningSecret);
  app.use("/slack/events", verifier, eventsRouter);
  app.use("/slack/interactions", verifier, interactionsRouter);
  app.use("/slack/commands", verifier, commandsRouter);

  // 5. Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server Error]", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

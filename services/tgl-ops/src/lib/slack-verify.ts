import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export interface SlackVerifiedRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Verifies that an incoming HTTP request comes from Slack using HMAC-SHA256.
 * Rejects requests older than 5 minutes (300 seconds) to prevent replay attacks.
 */
export function verifySlackSignature(signingSecret: string = config.slackSigningSecret) {
  return (req: SlackVerifiedRequest, res: Response, next: NextFunction): void => {
    // If running in development without a secret, log a warning and proceed
    if (!signingSecret) {
      console.warn("[Slack Signature] SLACK_SIGNING_SECRET is not configured. Skipping verification in dev.");
      return next();
    }

    const timestamp = req.headers["x-slack-request-timestamp"] as string;
    const signature = req.headers["x-slack-signature"] as string;

    if (!timestamp || !signature) {
      res.status(401).json({ error: "Missing Slack signature headers" });
      return;
    }

    // Replay attack prevention: reject requests older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const reqTime = parseInt(timestamp, 10);
    if (isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
      res.status(400).json({ error: "Slack request timestamp expired (> 5 minutes old)" });
      return;
    }

    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : "";
    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const mySignature = "v0=" + crypto.createHmac("sha256", signingSecret).update(sigBasestring, "utf8").digest("hex");

    try {
      const match = crypto.timingSafeEqual(Buffer.from(mySignature, "utf8"), Buffer.from(signature, "utf8"));
      if (!match) {
        res.status(401).json({ error: "Invalid Slack signature" });
        return;
      }
    } catch {
      res.status(401).json({ error: "Signature comparison failure" });
      return;
    }

    next();
  };
}

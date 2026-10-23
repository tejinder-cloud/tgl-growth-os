import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export interface SlackVerifiedRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Verifies that an incoming HTTP request comes from Slack using HMAC-SHA256.
 * Rejects requests older than 5 minutes (300 seconds) to prevent replay attacks.
 * Logs failure reasons without exposing secret keys or sensitive tokens.
 */
export function verifySlackSignature(signingSecret: string = config.slackSigningSecret) {
  // Normalize secret: trim whitespace and surrounding quotes
  const secret = (signingSecret || "").trim().replace(/^["']|["']$/g, "");

  return (req: SlackVerifiedRequest, res: Response, next: NextFunction): void => {
    // If running in development without a secret, log a warning and proceed
    if (!secret) {
      console.warn("[Slack Signature] SLACK_SIGNING_SECRET is not configured. Skipping verification in dev.");
      return next();
    }

    const timestampHeader = req.headers["x-slack-request-timestamp"];
    const signatureHeader = req.headers["x-slack-signature"];

    const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!timestamp || !signature) {
      console.warn("[Slack Signature Verification Failed] Missing required headers", {
        hasTimestamp: Boolean(timestamp),
        hasSignature: Boolean(signature),
        method: req.method,
        path: req.originalUrl || req.url,
      });
      res.status(401).json({ error: "Missing Slack signature headers" });
      return;
    }

    // Replay attack prevention: reject requests older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const reqTime = parseInt(timestamp, 10);
    if (isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
      console.warn("[Slack Signature Verification Failed] Timestamp expired or invalid", {
        timestamp,
        now,
        diffSeconds: isNaN(reqTime) ? "NaN" : Math.abs(now - reqTime),
      });
      res.status(400).json({ error: "Slack request timestamp expired (> 5 minutes old)" });
      return;
    }

    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : "";
    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const mySignature = "v0=" + crypto.createHmac("sha256", secret).update(sigBasestring, "utf8").digest("hex");

    const mySigBuf = Buffer.from(mySignature, "utf8");
    const theirSigBuf = Buffer.from(signature, "utf8");

    if (mySigBuf.length !== theirSigBuf.length) {
      console.warn("[Slack Signature Verification Failed] Signature length mismatch", {
        expectedLength: mySigBuf.length,
        receivedLength: theirSigBuf.length,
        rawBodyLength: rawBody.length,
      });
      res.status(401).json({ error: "Invalid Slack signature" });
      return;
    }

    let match = false;
    try {
      match = crypto.timingSafeEqual(mySigBuf, theirSigBuf);
    } catch (err) {
      console.warn("[Slack Signature Verification Failed] Timing safe equal error", (err as Error).message);
      res.status(401).json({ error: "Invalid Slack signature" });
      return;
    }

    if (!match) {
      console.warn("[Slack Signature Verification Failed] HMAC signature mismatch", {
        timestamp,
        rawBodyLength: rawBody.length,
      });
      res.status(401).json({ error: "Invalid Slack signature" });
      return;
    }

    next();
  };
}

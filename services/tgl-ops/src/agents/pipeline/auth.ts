// services/tgl-ops/src/agents/pipeline/auth.ts
// Sign-in for the private board: Google sign-in, then a signed session cookie for 7 days. Only addresses listed
// in PIPELINE_ALLOWED_EMAILS can open the board; with none listed, nobody can.
import crypto from "node:crypto";

export const SESSION_COOKIE = "tgl_pipeline";
export const SESSION_DAYS = 7;
export const BOARD_CALLBACK_PATH = "/pipeline/oauth/callback";

export function allowedEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.PIPELINE_ALLOWED_EMAILS || "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")));
}

export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PIPELINE_SESSION_SECRET || env.GOOGLE_BOOKING_CLIENT_SECRET || "").trim();
}

export function makeSession(email: string, secret: string, now: Date = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ e: email.toLowerCase(), x: now.getTime() + SESSION_DAYS * 86400000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** The signed-in email, or null when the cookie is missing, forged, expired or no longer on the allowed list. */
export function readSession(token: string | undefined, secret: string, allowed: Set<string>, now: Date = new Date()): string | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof x !== "number" || x < now.getTime()) return null;
    return allowed.has(String(e)) ? String(e) : null;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function boardAuthUrl(clientId: string, publicUrl: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: publicUrl + BOARD_CALLBACK_PATH,
    response_type: "code",
    scope: "openid email",
    prompt: "select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

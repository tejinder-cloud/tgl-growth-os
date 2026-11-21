// services/tgl-ops/src/routes/pipeline.ts
// GET /pipeline                 the board (signed in) or the sign-in page
// GET /pipeline/connect         Google sign-in
// GET /pipeline/oauth/callback  Google's return; only PIPELINE_ALLOWED_EMAILS get a session
// GET /pipeline/logout          ends the session
// GET /pipeline/whatsapp        connect TGL's WhatsApp Business app number (coexistence)
// POST /pipeline/whatsapp/exchange  completes it with Meta's signup code
import { Router, type Request, type Response } from "express";
import { configIssues, exchangeCode, loadGoogleBookingConfig, makeState, verifyState } from "../agents/booking/google.js";
import { allowedEmails, boardAuthUrl, BOARD_CALLBACK_PATH, cookieValue, makeSession, readSession, sessionSecret, SESSION_COOKIE, SESSION_DAYS } from "../agents/pipeline/auth.js";
import { loginPage, renderBoard } from "../agents/pipeline/board.js";
import { dealStore } from "../agents/pipeline/live.js";
import type { Deal } from "../agents/pipeline/stages.js";
import { completeConnection, loadMetaConfig, metaConfigIssues, supabaseConnectStore, type ConnectStore } from "../agents/whatsapp/connect.js";
import { connectPage } from "../agents/whatsapp/connect-page.js";

export const pipelineRouter = Router();

type AuditReader = (prospectIds: string[]) => Promise<Record<string, string>>;
let auditReader: AuditReader = async (ids) => {
  if (ids.length === 0) return {};
  const { getSupabase } = await import("../agents/prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) return {};
  const { data } = await sb.from("prospects").select("id, signals").in("id", ids);
  const out: Record<string, string> = {};
  for (const r of (data || []) as any[]) {
    const a = r.signals?.outreach?.audit;
    if (a) out[r.id] = `AI check ${String(a.audited_at || "").slice(0, 10)}: named in ${a.mentions} of ${a.total_queries} answers.`;
  }
  return out;
};
let listDeals: () => Promise<Deal[]> = () => dealStore().list();

export function setBoardSourcesForTests(list: (() => Promise<Deal[]>) | null, audits?: AuditReader | null): void {
  listDeals = list || (() => dealStore().list());
  if (audits !== undefined) auditReader = audits || (async () => ({}));
}

function signedIn(req: Request): string | null {
  return readSession(cookieValue(req.headers.cookie, SESSION_COOKIE), sessionSecret(), allowedEmails());
}

function noStore(res: Response) {
  res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex").set("Referrer-Policy", "no-referrer");
}

pipelineRouter.get("/", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  if (!email) {
    res.status(200).type("html").send(loginPage());
    return;
  }
  try {
    const deals = await listDeals();
    const ids = Array.from(new Set(deals.map((d) => d.prospect_id).filter(Boolean) as string[]));
    const audits = await auditReader(ids).catch(() => ({}));
    res.status(200).type("html").send(renderBoard(deals, { now: new Date(), email, audits }));
  } catch (err) {
    console.error("[Pipeline] board failed:", (err as Error).message);
    res.status(503).type("html").send(loginPage("The pipeline could not be read just now. Refresh in a minute."));
  }
});

pipelineRouter.get("/connect", (_req: Request, res: Response) => {
  noStore(res);
  const cfg = loadGoogleBookingConfig();
  const secret = sessionSecret();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.publicUrl || !secret || allowedEmails().size === 0) {
    res.status(503).type("html").send(loginPage("Sign-in is not set up yet (Google client, public address or PIPELINE_ALLOWED_EMAILS)."));
    return;
  }
  res.redirect(302, boardAuthUrl(cfg.clientId, cfg.publicUrl, makeState(secret)));
});

pipelineRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  noStore(res);
  const cfg = loadGoogleBookingConfig();
  const secret = sessionSecret();
  if (req.query.error) return void res.status(400).type("html").send(loginPage("Google sign-in was cancelled."));
  if (!secret || !verifyState(String(req.query.state || ""), secret)) return void res.status(400).type("html").send(loginPage("That sign-in link expired. Try again."));
  try {
    const got = await exchangeCode(cfg, String(req.query.code || ""), fetch, BOARD_CALLBACK_PATH);
    if (!got.email || !allowedEmails().has(got.email)) {
      return void res.status(403).type("html").send(loginPage("This Google account does not have access to the pipeline."));
    }
    const secure = cfg.publicUrl.startsWith("https://") ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(makeSession(got.email, secret))}; Path=/pipeline; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
    res.redirect(302, "/pipeline");
  } catch (err) {
    console.error("[Pipeline] sign-in failed:", (err as Error).message);
    res.status(502).type("html").send(loginPage("Google sign-in could not be completed. Try again."));
  }
});

pipelineRouter.get("/logout", (_req: Request, res: Response) => {
  noStore(res);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/pipeline; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect(302, "/pipeline");
});

// --- WhatsApp coexistence connection (only for a signed-in, allowed account) ---

let connectStore: () => ConnectStore = supabaseConnectStore;
let readConnection: () => Promise<{ display_number?: string | null; connected_at?: string } | null> = async () => {
  const { getSupabase } = await import("../agents/prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("whatsapp_connection").select("display_number, connected_at").eq("id", "tgl").maybeSingle();
  return (data as any) || null;
};
let connectFetch: typeof fetch = fetch;
export function setWhatsAppConnectForTests(o: { store?: () => ConnectStore; read?: typeof readConnection; fetchImpl?: typeof fetch } | null): void {
  connectStore = o?.store || supabaseConnectStore;
  readConnection = o?.read || readConnection;
  connectFetch = o?.fetchImpl || fetch;
}

pipelineRouter.get("/whatsapp", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  if (!email) return void res.redirect(302, "/pipeline");
  const cfg = loadMetaConfig();
  const connected = await readConnection().catch(() => null);
  res.status(200).type("html").send(connectPage({ appId: cfg.appId, configId: cfg.configId, graphVersion: cfg.graphVersion, email, issues: metaConfigIssues(cfg), connected }));
});

pipelineRouter.post("/whatsapp/exchange", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  if (!email) return void res.status(401).json({ ok: false, message: "Sign in to the pipeline first." });
  if (!String(req.headers["content-type"] || "").includes("application/json")) return void res.status(415).json({ ok: false, message: "JSON only." });
  const cfg = loadMetaConfig();
  const issues = metaConfigIssues(cfg);
  if (issues.length) return void res.status(503).json({ ok: false, message: issues.join("; ") });
  const b = (req.body || {}) as any;
  const code = String(b.code || "").slice(0, 2000);
  if (!code) return void res.status(400).json({ ok: false, message: "No signup code from Meta." });
  try {
    const out = await completeConnection({ code, wabaId: String(b.waba_id || ""), phoneNumberId: b.phone_number_id ? String(b.phone_number_id) : undefined }, cfg, connectStore(), email, connectFetch);
    res.status(out.ok ? 200 : 502).json(out);
  } catch (err) {
    console.error("[WhatsApp Connect] failed:", (err as Error).message);
    res.status(500).json({ ok: false, message: "The connection could not be saved. Nothing was sent to anyone." });
  }
});

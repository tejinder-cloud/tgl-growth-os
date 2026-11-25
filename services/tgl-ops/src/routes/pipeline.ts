// services/tgl-ops/src/routes/pipeline.ts
// GET /pipeline                 the board (signed in) or the sign-in page
// GET /pipeline/connect         Google sign-in
// GET /pipeline/oauth/callback  Google's return; only PIPELINE_ALLOWED_EMAILS get a session
// GET /pipeline/logout          ends the session
// GET /pipeline/whatsapp        connect TGL's WhatsApp Business app number (coexistence)
// POST /pipeline/whatsapp/exchange  completes it with Meta's signup code
// GET /pipeline/whatsapp/console     templates (list, create) and sending one template message
// GET /pipeline/live                Overview: the journey, needs you, problems, today's activity, money (?part=main: the refreshing part)
// GET /pipeline/outreach            sent, next in line, waiting for WhatsApp, paused (?part=main)
// GET /pipeline/build               the build tracker (?part=main)
import { Router, type Request, type Response } from "express";
import { configIssues, exchangeCode, loadGoogleBookingConfig, makeState, verifyState } from "../agents/booking/google.js";
import { allowedEmails, boardAuthUrl, BOARD_CALLBACK_PATH, cookieValue, makeSession, readSession, sessionSecret, SESSION_COOKIE, SESSION_DAYS } from "../agents/pipeline/auth.js";
import { loginPage, renderBoard } from "../agents/pipeline/board.js";
import type { LiveView } from "../agents/pipeline/live-view.js";
import { renderOverviewMain, renderOverviewPage } from "../agents/pipeline/overview-page.js";
import { renderOutreachMain, renderOutreachPage } from "../agents/pipeline/outreach-page.js";
import { dealStore } from "../agents/pipeline/live.js";
import type { Deal } from "../agents/pipeline/stages.js";
import { completeConnection, loadMetaConfig, metaConfigIssues, supabaseConnectStore, type ConnectStore } from "../agents/whatsapp/connect.js";
import { connectPage } from "../agents/whatsapp/connect-page.js";
import { consolePage } from "../agents/whatsapp/console-page.js";
import { accountById, createTemplate, listAccounts, listTemplates, MetaError, normaliseIndianOrE164, resolveToken, sendTemplate, validateTemplate, waContext } from "../agents/whatsapp/graph.js";

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
/** Prospects the Architect rejected: their deals leave the board. */
let rejectedReader = async (ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const { getSupabase } = await import("../agents/prospect-researcher/db.js");
  const sb = getSupabase();
  if (!sb) return new Set();
  const { data } = await sb.from("prospects").select("id").in("id", ids).eq("status", "rejected");
  return new Set(((data || []) as { id: string }[]).map((r) => r.id));
};

export function setBoardSourcesForTests(list: (() => Promise<Deal[]>) | null, audits?: AuditReader | null, rejected?: ((ids: string[]) => Promise<Set<string>>) | null): void {
  if (rejected !== undefined) rejectedReader = rejected || (async () => new Set());
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
    const [audits, rejected] = await Promise.all([auditReader(ids).catch(() => ({})), rejectedReader(ids).catch(() => new Set<string>())]);
    res.status(200).type("html").send(renderBoard(deals, { now: new Date(), email, audits, rejected }));
  } catch (err) {
    console.error("[Pipeline] board failed:", (err as Error).message);
    res.status(503).type("html").send(loginPage("The pipeline could not be read just now. Refresh in a minute."));
  }
});

let liveLoader: () => Promise<LiveView> = async () => (await import("../agents/pipeline/live-data.js")).loadLiveView();
export function setLiveLoaderForTests(fn: (() => Promise<LiveView>) | null): void {
  liveLoader = fn || (async () => (await import("../agents/pipeline/live-data.js")).loadLiveView());
}

pipelineRouter.get("/live", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  const part = req.query.part === "main";
  if (!email) {
    if (part) res.status(401).end();
    else res.status(200).type("html").send(loginPage());
    return;
  }
  try {
    const view = await liveLoader();
    const now = new Date();
    res.status(200).type("html").send(part ? renderOverviewMain(view, now) : renderOverviewPage(view, email, now));
  } catch (err) {
    console.error("[Pipeline] live view failed:", (err as Error).message);
    if (part) res.status(503).end();
    else res.status(503).type("html").send(loginPage("The live view could not be read just now. Refresh in a minute."));
  }
});

pipelineRouter.get("/outreach", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  const part = req.query.part === "main";
  if (!email) {
    if (part) res.status(401).end();
    else res.status(200).type("html").send(loginPage());
    return;
  }
  try {
    const view = await liveLoader();
    res.status(200).type("html").send(part ? renderOutreachMain(view) : renderOutreachPage(view, email));
  } catch (err) {
    console.error("[Pipeline] outreach view failed:", (err as Error).message);
    if (part) res.status(503).end();
    else res.status(503).type("html").send(loginPage("Outreach could not be read just now. Refresh in a minute."));
  }
});

// The build tracker: plan, tasks, risks and decisions (build-plan.ts) with agents and spend from the live data.
// If the live data cannot be read, the plan still shows.
pipelineRouter.get("/build", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  const part = req.query.part === "main";
  if (!email) {
    if (part) res.status(401).end();
    else res.status(200).type("html").send(loginPage());
    return;
  }
  const { renderBuildMain, renderBuildPage } = await import("../agents/pipeline/build-view.js");
  const view = await liveLoader().catch((err) => {
    console.warn("[Pipeline] build tracker without live data:", (err as Error).message);
    return null;
  });
  const now = new Date();
  res.status(200).type("html").send(part ? renderBuildMain(view, now) : renderBuildPage(view, email, now));
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

// --- WhatsApp screen: templates and sending (signed-in, allowed account only) ---

let waToken: () => Promise<string | null> = () => resolveToken();
let waFetch: typeof fetch = fetch;
export function setWhatsAppConsoleForTests(o: { token?: () => Promise<string | null>; fetchImpl?: typeof fetch } | null): void {
  waToken = o?.token || (() => resolveToken());
  waFetch = o?.fetchImpl || fetch;
}

async function waCtx(req: Request, res: Response) {
  noStore(res);
  const email = signedIn(req);
  if (!email) {
    res.status(401).json({ ok: false, message: "Sign in to the pipeline first." });
    return null;
  }
  const token = await waToken().catch(() => null);
  if (!token) {
    res.status(503).json({ ok: false, message: "No WhatsApp token yet: add WHATSAPP_SYSTEM_TOKEN in Railway, or connect the number." });
    return null;
  }
  return { email, ctx: waContext(token, process.env, waFetch) };
}

function metaFail(res: Response, err: unknown) {
  const m = err instanceof MetaError ? err : null;
  if (!m) console.error("[WhatsApp] failed:", (err as Error).message);
  res.status(m ? 502 : 500).json({ ok: false, message: m ? `Meta: ${m.message}` : "The request failed. Nothing was sent." });
}

const META_ID = /^\d{5,25}$/;

pipelineRouter.get("/whatsapp/console", async (req: Request, res: Response) => {
  noStore(res);
  const email = signedIn(req);
  if (!email) return void res.redirect(302, "/pipeline");
  const token = await waToken().catch(() => null);
  res.status(200).type("html").send(consolePage(email, Boolean(token)));
});

pipelineRouter.get("/whatsapp/api/accounts", async (req: Request, res: Response) => {
  const w = await waCtx(req, res);
  if (!w) return;
  try {
    const notes: { call: string; ok: boolean; detail: string }[] = [];
    const accounts = await listAccounts(w.ctx, notes);
    // Accounts named by id (WHATSAPP_ACCOUNT_IDS in Railway, or ?add= from the screen), for accounts Meta does not
    // list under the business.
    const extra = new Set<string>([
      ...String(process.env.WHATSAPP_ACCOUNT_IDS || "").split(/[,\s]+/),
      ...String(req.query.add || "").split(/[,\s]+/),
    ].filter((x) => META_ID.test(x)));
    for (const id of extra) {
      if (accounts.some((a) => a.id === id)) continue;
      try {
        const a = await accountById(w.ctx, id);
        accounts.push(a);
        notes.push({ call: `account ${id}`, ok: true, detail: `${a.name}, ${a.numbers.length} number(s)` });
      } catch (err) {
        notes.push({ call: `account ${id}`, ok: false, detail: String((err as Error).message).slice(0, 300) });
      }
    }
    res.json({ ok: true, accounts, notes });
  } catch (err) {
    metaFail(res, err);
  }
});

pipelineRouter.get("/whatsapp/api/templates", async (req: Request, res: Response) => {
  const w = await waCtx(req, res);
  if (!w) return;
  const waba = String(req.query.waba || "");
  if (!META_ID.test(waba)) return void res.status(400).json({ ok: false, message: "Pick an account." });
  try {
    res.json({ ok: true, templates: await listTemplates(w.ctx, waba) });
  } catch (err) {
    metaFail(res, err);
  }
});

pipelineRouter.post("/whatsapp/api/templates", async (req: Request, res: Response) => {
  const w = await waCtx(req, res);
  if (!w) return;
  if (!String(req.headers["content-type"] || "").includes("application/json")) return void res.status(415).json({ ok: false, message: "JSON only." });
  const b = (req.body || {}) as any;
  if (!META_ID.test(String(b.waba || ""))) return void res.status(400).json({ ok: false, message: "Pick an account." });
  const t = {
    name: String(b.name || "").trim(),
    category: String(b.category || "") as "MARKETING" | "UTILITY",
    language: String(b.language || "en"),
    body: String(b.body || ""),
    examples: Array.isArray(b.examples) ? b.examples.map(String) : [],
    footer: b.footer ? String(b.footer) : undefined,
    quickReplies: Array.isArray(b.quickReplies) ? b.quickReplies.map(String).slice(0, 3) : [],
  };
  const invalid = validateTemplate(t);
  if (invalid) return void res.status(400).json({ ok: false, message: invalid });
  try {
    res.json({ ok: true, template: await createTemplate(w.ctx, String(b.waba), t) });
  } catch (err) {
    metaFail(res, err);
  }
});

pipelineRouter.post("/whatsapp/api/send", async (req: Request, res: Response) => {
  const w = await waCtx(req, res);
  if (!w) return;
  if (!String(req.headers["content-type"] || "").includes("application/json")) return void res.status(415).json({ ok: false, message: "JSON only." });
  const b = (req.body || {}) as any;
  const to = normaliseIndianOrE164(String(b.to || ""));
  if (!META_ID.test(String(b.phone_number_id || ""))) return void res.status(400).json({ ok: false, message: "This account has no number to send from." });
  if (!to) return void res.status(400).json({ ok: false, message: "Enter a valid WhatsApp number." });
  if (!/^[a-z0-9_]{1,512}$/.test(String(b.name || ""))) return void res.status(400).json({ ok: false, message: "Pick a template." });
  const values = Array.isArray(b.values) ? b.values.map((v: unknown) => String(v).slice(0, 1024)) : [];
  try {
    const out = await sendTemplate(w.ctx, String(b.phone_number_id), to, { name: String(b.name), language: String(b.language || "en") }, values);
    console.log(`[WhatsApp] template ${b.name} sent by ${w.email}: ${out.messageId}`);
    res.json({ ok: true, ...out });
  } catch (err) {
    metaFail(res, err);
  }
});

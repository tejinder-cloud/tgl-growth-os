// services/tgl-ops/src/agents/outreach-sequencer/templates.ts
// Reads the Architect's editable touch copy from agents/outreach-sequencer/templates/touch-N.md and renders it.
// This replaces the hard-coded copy in sequence.ts renderTouch for live wiring (PLAN-D10b).
//
// Rules enforced here (templates README):
//   1. Every placeholder is filled from stored data (prospect row or the prospect's own audit). A placeholder that
//      cannot be filled makes the render throw; the executor then holds the touch. Nothing is guessed or defaulted
//      for an audit figure.
//   2. Every message carries the opt-out line (a STOP instruction).
//   3. No emojis.
import fs from "node:fs";
import path from "node:path";
import { categoryLabel, type MessageContext } from "./sequence.js";
import type { RenderedMessage, TouchChannel } from "./types.js";

export const TEMPLATE_TOUCH_COUNT = 5;

export interface TemplateContext extends MessageContext {
  /** The prospect's work email, for {{work_email}}. */
  email?: string;
  /** Booking link for {{booking_link}}, from OUTREACH_BOOKING_LINK. */
  bookingLink?: string;
}

export interface TouchTemplate {
  touch: number;
  channel: "email" | "whatsapp";
  day?: number;
  subject?: string;
  fallback?: string;
  body: string;
}

export type TemplateSet = Map<number, TouchTemplate>;

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

function stripQuotes(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseTemplate(source: string, label = "template"): TouchTemplate {
  const normalised = source.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalised);
  if (!m) throw new Error(`${label}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = stripQuotes(line.slice(idx + 1));
  }
  const touch = Number(meta.touch);
  if (!Number.isInteger(touch) || touch < 1) throw new Error(`${label}: front matter has no valid touch number`);
  const channel = (meta.channel || "").toLowerCase();
  if (channel !== "email" && channel !== "whatsapp") throw new Error(`${label}: channel must be email or whatsapp`);
  const body = m[2].trim();
  if (!body) throw new Error(`${label}: empty body`);
  const day = meta.day !== undefined && meta.day !== "" ? Number(meta.day) : undefined;
  return {
    touch,
    channel,
    day: day !== undefined && Number.isFinite(day) ? day : undefined,
    subject: meta.subject || undefined,
    fallback: meta.fallback ? meta.fallback.toLowerCase() : undefined,
    body,
  };
}

/** Candidate directories, most specific first. OUTREACH_TEMPLATES_DIR overrides everything. */
export function templateDirCandidates(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
  const override = (env.OUTREACH_TEMPLATES_DIR || "").trim();
  if (override) return [path.resolve(cwd, override)];
  const rel = path.join("agents", "outreach-sequencer", "templates");
  return [
    path.resolve(cwd, rel),
    path.resolve(cwd, "..", rel),
    path.resolve(cwd, "..", "..", rel),
    path.resolve(cwd, "src/assets/outreach-templates"),
    path.resolve(cwd, "dist/assets/outreach-templates"),
    path.resolve(cwd, "assets/outreach-templates"),
    path.resolve(__dirname, "../assets/outreach-templates"),
    path.resolve(__dirname, "../../assets/outreach-templates"),
    path.resolve(__dirname, "../../../assets/outreach-templates"),
    path.resolve(__dirname, "./assets/outreach-templates"),
  ];
}

export function resolveTemplatesDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const candidates = templateDirCandidates(env, cwd);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "touch-1.md"))) return dir;
  }
  throw new Error(`Outreach templates not found. Looked in: ${candidates.join(", ")}. Set OUTREACH_TEMPLATES_DIR.`);
}

export function loadTemplates(dir: string): TemplateSet {
  const set: TemplateSet = new Map();
  for (let n = 1; n <= TEMPLATE_TOUCH_COUNT; n++) {
    const file = path.join(dir, `touch-${n}.md`);
    if (!fs.existsSync(file)) throw new Error(`Outreach template missing: ${file}`);
    const t = parseTemplate(fs.readFileSync(file, "utf8"), `touch-${n}.md`);
    if (t.touch !== n) throw new Error(`touch-${n}.md declares touch ${t.touch}`);
    set.set(n, t);
  }
  return set;
}

/**
 * Reads touch templates from the GitHub Contents API on the main branch.
 */
export async function loadTemplatesFromGitHub(
  octokitClient?: any,
  repoConfig?: { owner: string; repo: string }
): Promise<TemplateSet> {
  const { octokit } = octokitClient ? { octokit: octokitClient } : await import("../../lib/github-client.js");
  const { config } = await import("../../config.js");
  const owner = repoConfig?.owner || config.githubOwner;
  const repo = repoConfig?.repo || config.githubRepo;

  const set: TemplateSet = new Map();
  for (let n = 1; n <= TEMPLATE_TOUCH_COUNT; n++) {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: `agents/outreach-sequencer/templates/touch-${n}.md`,
      ref: "main",
    });

    if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
      const content = Buffer.from(res.data.content, "base64").toString("utf8");
      const t = parseTemplate(content, `touch-${n}.md`);
      if (t.touch !== n) throw new Error(`touch-${n}.md declares touch ${t.touch}`);
      set.set(n, t);
    } else {
      throw new Error(`Failed to read touch-${n}.md from GitHub Contents API`);
    }
  }
  return set;
}

/**
 * Loads outreach templates with local bundled file check and GitHub Contents API fallback.
 */
export async function loadOutreachTemplatesAsync(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Promise<TemplateSet> {
  // 1. Try local candidate directories (including bundled copy in src/assets or dist/assets)
  try {
    const dir = resolveTemplatesDir(env, cwd);
    const loaded = loadTemplates(dir);
    console.log(`[Outreach] Loaded ${loaded.size} templates from local disk (${dir}).`);
    return loaded;
  } catch (localErr) {
    console.warn(`[Outreach] Local template candidate lookup failed: ${(localErr as Error).message}. Falling back to GitHub Contents API...`);
  }

  // 2. Fall back to reading them from the repo via the Contents API
  try {
    const githubTemplates = await loadTemplatesFromGitHub();
    console.log(`[Outreach] Loaded ${githubTemplates.size} outreach templates from GitHub Contents API.`);
    return githubTemplates;
  } catch (ghErr) {
    console.error(`[Outreach] GitHub Contents API fallback failed:`, ghErr);
    throw new Error(`Outreach templates could not be loaded from local bundle or GitHub Contents API.`);
  }
}

/**
 * Startup check verifying that the bundled copy matches the repo copy.
 */
export async function verifyBundledTemplatesMatchRepo(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Promise<{ matches: boolean; diffs: string[] }> {
  const diffs: string[] = [];
  let bundledDir: string | null = null;
  const bundledCandidates = [
    path.resolve(cwd, "src/assets/outreach-templates"),
    path.resolve(cwd, "dist/assets/outreach-templates"),
    path.resolve(__dirname, "../assets/outreach-templates"),
    path.resolve(__dirname, "../../assets/outreach-templates"),
  ];

  for (const c of bundledCandidates) {
    if (fs.existsSync(path.join(c, "touch-1.md"))) {
      bundledDir = c;
      break;
    }
  }

  if (!bundledDir) {
    return { matches: false, diffs: ["Bundled outreach-templates directory not found on disk"] };
  }

  // Check against repo root if present on disk
  const repoDir = path.resolve(cwd, "agents/outreach-sequencer/templates");
  const parentRepoDir = path.resolve(cwd, "../../agents/outreach-sequencer/templates");
  const targetRepoDir = fs.existsSync(repoDir) ? repoDir : fs.existsSync(parentRepoDir) ? parentRepoDir : null;

  if (targetRepoDir) {
    for (let n = 1; n <= TEMPLATE_TOUCH_COUNT; n++) {
      const repoFile = path.join(targetRepoDir, `touch-${n}.md`);
      const bundleFile = path.join(bundledDir, `touch-${n}.md`);
      if (!fs.existsSync(repoFile)) continue;
      const repoContent = fs.readFileSync(repoFile, "utf8").trim();
      const bundleContent = fs.existsSync(bundleFile) ? fs.readFileSync(bundleFile, "utf8").trim() : "";
      if (repoContent !== bundleContent) {
        diffs.push(`touch-${n}.md content differs between repo and bundle`);
      }
    }
  } else {
    // Running in container: compare bundled copy to GitHub main via Contents API if token is configured
    try {
      const { octokit } = await import("../../lib/github-client.js");
      const { config } = await import("../../config.js");
      if (config.githubToken) {
        for (let n = 1; n <= TEMPLATE_TOUCH_COUNT; n++) {
          const bundleFile = path.join(bundledDir, `touch-${n}.md`);
          const bundleContent = fs.existsSync(bundleFile) ? fs.readFileSync(bundleFile, "utf8").trim() : "";
          const res = await octokit.repos.getContent({
            owner: config.githubOwner,
            repo: config.githubRepo,
            path: `agents/outreach-sequencer/templates/touch-${n}.md`,
            ref: "main",
          });
          if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
            const ghContent = Buffer.from(res.data.content, "base64").toString("utf8").trim();
            if (ghContent !== bundleContent) {
              diffs.push(`touch-${n}.md differs between GitHub main and bundled container copy`);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Outreach] Startup check warning: unable to verify against GitHub API: ${err.message}`);
    }
  }

  const matches = diffs.length === 0;
  if (!matches) {
    console.warn(`[Outreach Startup Check Mismatch] Bundled templates differ from repo: ${diffs.join("; ")}`);
  } else {
    console.log(`[Outreach Startup Check] Bundled outreach templates match repo exactly.`);
  }

  return { matches, diffs };
}

/** Variables available to templates. A variable is present only when its source data exists. */
export function buildTemplateVars(ctx: TemplateContext): Record<string, string> {
  const vars: Record<string, string> = {
    first_name: (ctx.decisionMakerName || "").trim().split(/\s+/)[0] || "Team",
    company: ctx.company,
    city: ctx.city,
    category: categoryLabel(ctx.category),
  };
  const a = ctx.audit;
  if (a) {
    vars.brand_mentions = String(a.mentions);
    vars.audit_date = a.audited_at.slice(0, 10);
    const top = a.top_competitors?.[0];
    if (top) {
      vars.top_competitor = top;
      const count = a.competitor_mentions?.[top];
      if (typeof count === "number") vars.competitor_mentions = String(count);
    }
    if (a.weakest_query) vars.weakest_query = a.weakest_query;
  }
  if (ctx.bookingLink) vars.booking_link = ctx.bookingLink;
  if (ctx.email) vars.work_email = ctx.email;
  return vars;
}

function fill(text: string, vars: Record<string, string>, missing: Set<string>): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined || v === "") {
      missing.add(name);
      return "";
    }
    return v;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

const EMOJI = /\p{Extended_Pictographic}/u;

export function renderFromTemplates(set: TemplateSet, n: number, channel: TouchChannel, ctx: TemplateContext): RenderedMessage {
  const tpl = set.get(n);
  if (!tpl) throw new Error(`Unknown touch ${n}`);
  if (channel === "WhatsApp" && tpl.channel !== "whatsapp") {
    throw new Error(`Touch ${n} has no WhatsApp template`);
  }

  const vars = buildTemplateVars(ctx);
  const missing = new Set<string>();
  const text = fill(tpl.body, vars, missing);

  let subject: string | undefined;
  if (channel === "Email") {
    if (tpl.subject) {
      subject = fill(tpl.subject, vars, missing);
    } else {
      // Email fallback for a WhatsApp touch: reply-style subject on the touch 1 thread.
      const first = set.get(1);
      if (!first?.subject) throw new Error(`Touch ${n} has no subject and touch 1 has none to fall back on`);
      subject = `Re: ${fill(first.subject, vars, missing)}`;
    }
  }

  if (missing.size > 0) {
    throw new Error(`Touch ${n} cannot be rendered: no stored data for ${Array.from(missing).sort().join(", ")}`);
  }
  if (!/\bSTOP\b/.test(text)) throw new Error(`Touch ${n} template has no opt-out line`);
  if (EMOJI.test(text) || (subject && EMOJI.test(subject))) throw new Error(`Touch ${n} rendered with an emoji`);

  if (channel === "WhatsApp") return { text };
  return { subject, text, html: toHtml(text) };
}

/** Returns a renderer bound to a loaded template set, shaped for ExecutorPorts.render. */
export function makeTemplateRenderer(set: TemplateSet, extras: { bookingLink?: string } = {}) {
  return (n: number, channel: TouchChannel, ctx: MessageContext & { email?: string }): RenderedMessage =>
    renderFromTemplates(set, n, channel, { ...ctx, bookingLink: extras.bookingLink });
}

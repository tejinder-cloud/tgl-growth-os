// services/tgl-ops/src/agents/aeo-audit-engine/prospect-audit.ts
// Free first audit for a prospect (decisions/2026-11-12.md): a website request, a request the Architect types in
// Slack, or an outreach prospect. No verified setup profile is needed. The five questions are built from the
// prospect's industry, specialty and city; the PDF and the questions are posted to #revenue for the Architect.
//
// The service never sends a prospect audit to the prospect. The Architect reviews it and sends it himself.
//
// Honest Work: every figure in the Slack summary is read from the audit result, and "posted" is only reported
// when Slack's own response says the file was accepted. When the questions cannot be built from what is known,
// no audit is run and the Architect is asked for one line; nothing is guessed.
import fs from "node:fs";
import path from "node:path";
import { defaultProspectAuditStore, type ProspectAuditStore } from "./prospect-audit-store.js";
import { reviewBlocks } from "./prospect-audit-review.js";
import { runShortFormAudit, AUDIT_PROMPT_COUNT, type ShortFormAuditResult, type ShortFormOptions } from "./short-form.js";
import { generateAuditPdf } from "./pdf.js";
import type { BrandLens } from "./types.js";
import { dim4SpecialtyPhrase } from "../prospect-researcher/dim4.js";

export const PROSPECT_AUDIT_AGENT = "aeo-audit-engine";
export const PROSPECT_AUDIT_API_NAME = "prospect-audit";
export const PROSPECT_AUDIT_CHANNEL = "#revenue";

export type ProspectAuditSource = "site_lead" | "architect" | "outreach";

export interface ProspectAuditRequest {
  businessName: string;
  website: string;
  /** Website form industry value (healthcare, education, hospitality, realestate, ecommerce, saas, other). */
  industry?: string | null;
  city?: string | null;
  /** What the business is, in a buyer's words ("dental clinic"). Overrides everything read from the name. */
  what?: string | null;
  source: ProspectAuditSource;
  /** site_leads row id, when the request came from the website. */
  leadId?: string | null;
  /** Who asked, when known: used only if the Architect taps "Send on email". */
  contactName?: string | null;
  contactEmail?: string | null;
  /** prospect_audits id of the audit this one replaces after "Needs refinement". */
  refinedFrom?: string | null;
}

// What a buyer would call a business in each form industry, when its name says nothing more specific.
// Industries missing here cover too many kinds of business to guess from: the Architect supplies one line.
const INDUSTRY_PHRASES: Record<string, string> = {
  education: "coaching institute",
  hospitality: "hotel",
  realestate: "real estate developer",
};

/** Hostname of the prospect's website without "www.", or "" when unreadable. */
export function prospectDomain(website: string): string {
  try {
    const clean = (website || "").trim();
    if (!clean) return "";
    return new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function cleanPhrase(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F|]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:a|an|the)\s+/i, "").slice(0, 60);
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

/** True when every word of `broad` appears in `narrow` and `narrow` says more. */
export function isBroaderThan(broad: string, narrow: string): boolean {
  const b = words(broad);
  const n = new Set(words(narrow));
  return b.length > 0 && b.length < n.size && b.every((w) => n.has(w));
}

// Words that name a kind of place without saying what it is for.
const CATEGORY_ONLY_WORDS = new Set([
  "coaching", "institute", "institutes", "academy", "classes", "class", "centre", "center", "school", "college",
  "clinic", "clinics", "hospital", "hospitals", "doctor", "doctors", "surgeon", "specialist", "hotel", "hotels",
  "resort", "store", "shop", "company", "agency", "business", "service", "services", "firm",
]);

/** True for "coaching institute" or "clinic": a description with no specialty in it. */
export function isOnlyCategoryWords(phrase: string): boolean {
  const w = words(phrase);
  return w.length > 0 && w.every((x) => CATEGORY_ONLY_WORDS.has(x));
}

/** "mohali" -> "Mohali", "new delhi" -> "New Delhi". A city already written with capitals is left as typed. */
export function tidyCity(city: string | null | undefined): string {
  const c = cleanPhrase(city || "");
  if (!c || c !== c.toLowerCase()) return c;
  return c.replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/**
 * What the prospect is, in a buyer's words, and where that came from. Null when it cannot be told from the
 * request: the caller then asks the Architect instead of guessing.
 */
export function prospectCategoryPhrase(req: Pick<ProspectAuditRequest, "businessName" | "industry" | "what">): { phrase: string; from: "architect" | "name" | "industry" } | null {
  const given = cleanPhrase(req.what || "");
  if (given.length >= 3) {
    // When the name already says something narrower ("nursing exam coaching institute") than the words given
    // ("coaching institute"), the narrower one is asked: a broad question scores every specialist at zero.
    const fromName = dim4SpecialtyPhrase({ company: req.businessName });
    if (fromName && isOnlyCategoryWords(given) && isBroaderThan(given, fromName)) return { phrase: fromName, from: "name" };
    return { phrase: given, from: "architect" };
  }
  const industry = (req.industry || "").toLowerCase().trim();
  // A specialty is read from the name only where names carry one (clinics, institutes) or nothing else is known.
  // A hotel or a developer whose name happens to contain "eye" or "heart" is still a hotel or a developer.
  if (industry === "" || industry === "healthcare" || industry === "education") {
    const fromName = dim4SpecialtyPhrase({ company: req.businessName });
    if (fromName) return { phrase: fromName, from: "name" };
  }
  const fromIndustry = INDUSTRY_PHRASES[industry];
  if (fromIndustry) return { phrase: fromIndustry, from: "industry" };
  return null;
}

/** The five buyer questions for one prospect. None contains the business name. */
export function buildProspectAuditPrompts(phrase: string, city?: string | null): string[] {
  const p = cleanPhrase(phrase);
  const where = tidyCity(city) || "India";
  return [
    `best ${p} in ${where}`,
    `which ${p} in ${where} has the best reviews`,
    `top rated ${p} in ${where}: what is each known for`,
    `how to choose a ${p} in ${where}: which do you recommend`,
    `${p} in ${where}: which one should I trust and why`,
  ];
}

export type ProspectAuditOutcome =
  | { status: "posted"; result: ShortFormAuditResult; prompts: string[]; fileId?: string; costUsd: number; auditId?: string }
  | { status: "post_failed"; result: ShortFormAuditResult; prompts: string[]; error: string; costUsd: number }
  | { status: "needs_input"; reason: string }
  | { status: "duplicate"; reason: string }
  | { status: "cap_reached"; reason: string }
  | { status: "failed"; reason: string };

export interface ProspectAuditDeps {
  runAudit: (lens: BrandLens, options: ShortFormOptions) => Promise<ShortFormAuditResult>;
  renderPdf: (result: ShortFormAuditResult, outFile: string) => Promise<{ sizeBytes: number }>;
  postFile: (o: { channel: string; filePath: string; filename: string; title: string }) => Promise<{ ok: boolean; fileId?: string; error?: string }>;
  postLine: (o: { channel: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
  getSpendUsd: () => Promise<number>;
  getCapUsd: () => Promise<number>;
  recordSpend: (usd: number, details: string) => void;
  now: () => Date;
  /** The review record. Null when the database is not configured: the audit is then posted without buttons. */
  store: ProspectAuditStore | null;
  /** Posts the summary with the Send / Needs refinement buttons. */
  postReview: (o: { channel: string; text: string; blocks: unknown[] }) => Promise<{ ok: boolean; ts?: string; channelId?: string; error?: string }>;
  readPdf: (file: string) => Buffer;
}

async function defaultPostReview(o: { channel: string; text: string; blocks: unknown[] }): Promise<{ ok: boolean; ts?: string; channelId?: string; error?: string }> {
  const { config, isTestMode } = await import("../../config.js");
  if (!config.slackBotToken || isTestMode()) {
    console.log(`[postReview Dry Run] ${o.channel}: ${o.text.slice(0, 80)}`);
    return { ok: true, ts: "mock-ts", channelId: o.channel };
  }
  try {
    const { slackClient } = await import("../../lib/slack-client.js");
    const { resolveChannelId } = await import("../../lib/post.js");
    const channelId = await resolveChannelId(o.channel);
    const res = await slackClient.chat.postMessage({ channel: channelId, text: o.text, blocks: o.blocks as any, unfurl_links: false, unfurl_media: false });
    return { ok: Boolean(res.ok), ts: res.ts as string | undefined, channelId: (res.channel as string) || channelId };
  } catch (e: any) {
    return { ok: false, error: String(e?.data?.error || e?.message || e) };
  }
}

async function defaultDeps(): Promise<ProspectAuditDeps> {
  const post = await import("../../lib/post.js");
  const cap = await import("../../lib/cost-cap.js");
  return {
    runAudit: (lens, options) => runShortFormAudit(lens, options),
    renderPdf: (result, outFile) => generateAuditPdf(result, outFile),
    postFile: (o) => post.postFile(o),
    postLine: (o) => post.postLine({ ...o, unfurl_links: false, unfurl_media: false }),
    getSpendUsd: () => cap.getAgentTodaySpend(PROSPECT_AUDIT_AGENT),
    getCapUsd: () => cap.getAgentCostCap(PROSPECT_AUDIT_AGENT),
    recordSpend: (usd, details) => cap.recordApiSpend({ agent: PROSPECT_AUDIT_AGENT, apiName: PROSPECT_AUDIT_API_NAME, totalCostUsd: usd, details }),
    now: () => new Date(),
    store: process.env.TGL_TEST_MODE === "1" ? null : defaultProspectAuditStore(),
    postReview: defaultPostReview,
    readPdf: (file) => fs.readFileSync(file),
  };
}

// One audit per website per day, per process. A restart forgets this; the cost cap still holds.
const auditedToday = new Map<string, string>();
export function resetProspectAuditMemoryForTests(): void {
  auditedToday.clear();
}

const ENGINE_NAMES: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };

function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "prospect";
}

/** The #revenue summary. Every number is read from the result. Plain text and bold only. */
export function prospectAuditSummary(req: ProspectAuditRequest, result: ShortFormAuditResult, prompts: string[], phraseFrom: string, pdfPosted: boolean, withButtons = false): string {
  const perEngine = Object.entries(result.summary.mentionsByEngine)
    .map(([e, n]) => `${ENGINE_NAMES[e] || e} ${n} of ${result.promptsCount}`)
    .join(", ");
  const names = Object.entries(result.summary.competitorMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, c]) => `${n} (${c})`)
    .join(", ");
  const origin = req.source === "site_lead" ? "website request" : req.source === "outreach" ? "outreach prospect" : "requested by the Architect";
  const lines = [
    `*Prospect audit ready for review: ${req.businessName}* (${result.brand.primaryDomain}), ${origin}`,
    `Named in *${result.summary.totalMentions} of ${result.totalQueries}* answers (${result.summary.visibilityScorePercent}%). ${perEngine}.`,
    `Names the answers put forward most: ${names || "none read from these answers"}.`,
    `Questions asked (${phraseFrom}):`,
    ...prompts.map((p, i) => `${i + 1}. ${p}`),
    `Cost of this audit: Rs ${result.summary.totalCostInr} (USD ${result.summary.totalCostUsd}).`,
    !pdfPosted
      ? `*The PDF could not be uploaded to Slack.* The figures above are from the completed audit. Nothing was sent to the prospect.`
      : withButtons
      ? `*Not sent to the prospect.* Read the PDF in this channel, then choose. ${(req.contactEmail || "").trim() ? `Send on email goes to ${(req.contactEmail || "").trim().toLowerCase()}.` : "No email is on record for this request: Send on email will ask for one."}`
      : `*Not sent to the prospect.* Read the PDF in this channel and send it yourself if it is right. If the questions are off, run it again: \`/task audit | ${req.businessName} | ${result.brand.primaryDomain} | <what they are> | <city>\``,
  ];
  return lines.join("\n");
}

/**
 * Runs one prospect audit and posts it to #revenue for review. Never throws: every way it can end is an outcome,
 * and every outcome except "duplicate" is reported in #revenue so a request is never silently dropped.
 */
export async function runProspectAudit(req: ProspectAuditRequest, depsOverride?: Partial<ProspectAuditDeps>, options?: { testMode?: boolean; engineMock?: ShortFormOptions["engineMock"] }): Promise<ProspectAuditOutcome> {
  const deps: ProspectAuditDeps = { ...(await defaultDeps()), ...(depsOverride || {}) };
  const say = (text: string) => deps.postLine({ channel: PROSPECT_AUDIT_CHANNEL, text }).catch((e: any) => ({ ok: false, error: String(e?.message || e) }));
  const name = (req.businessName || "").replace(/\s+/g, " ").trim();
  const domain = prospectDomain(req.website);
  const rerun = `\`/task audit | ${name || "<business>"} | ${domain || "<website>"} | <what they are, for example dental clinic> | <city>\``;

  if (!name || !domain) {
    const reason = "a business name and a website are both needed";
    await say(`*Prospect audit not run* for ${name || "an unnamed business"}: ${reason}. To run it: ${rerun}`);
    return { status: "needs_input", reason };
  }

  const today = deps.now().toISOString().slice(0, 10);
  if (req.source !== "architect" && auditedToday.get(domain) === today) {
    return { status: "duplicate", reason: `${domain} was already audited today` };
  }

  const category = prospectCategoryPhrase({ businessName: name, industry: req.industry, what: req.what });
  if (!category) {
    const reason = `the name and industry (${req.industry || "not given"}) do not say what the business offers`;
    await say(`*Prospect audit not run* for *${name}* (${domain}): ${reason}, so the five questions cannot be written without guessing. To run it, post in #architect: ${rerun}`);
    return { status: "needs_input", reason };
  }
  const prompts = buildProspectAuditPrompts(category.phrase, req.city);
  const phraseFrom =
    category.from === "architect" ? `"${category.phrase}", as you gave it` : category.from === "name" ? `"${category.phrase}", read from the business name` : `"${category.phrase}", from the industry chosen on the form`;

  let spend = 0;
  let cap = 0;
  try {
    [spend, cap] = await Promise.all([deps.getSpendUsd(), deps.getCapUsd()]);
  } catch (e: any) {
    const reason = `the cost ledger could not be read (${String(e?.message || e).slice(0, 120)})`;
    await say(`*Prospect audit not run* for *${name}* (${domain}): ${reason}.`);
    return { status: "failed", reason };
  }
  if (spend >= cap) {
    const reason = `today's audit budget is used (USD ${spend.toFixed(2)} of ${cap.toFixed(2)})`;
    await say(`*Prospect audit not run* for *${name}* (${domain}): ${reason}. It was not queued. Run it tomorrow with ${rerun}`);
    return { status: "cap_reached", reason };
  }

  // Mock engine answers exist only inside a TGL_TEST_MODE=1 process. A live process always asks the real engines.
  const inTestProcess = process.env.TGL_TEST_MODE === "1";
  if (options?.testMode && !inTestProcess) {
    const reason = "mock audit answers are only available under TGL_TEST_MODE=1";
    await say(`*Prospect audit not run* for *${name}* (${domain}): ${reason}.`);
    return { status: "failed", reason };
  }
  const testMode = options?.engineMock ? false : inTestProcess;

  auditedToday.set(domain, today);
  let result: ShortFormAuditResult;
  try {
    result = await deps.runAudit(
      { name, domains: [domain], variants: [name], competitors: [] },
      { prospect: { name, website: domain }, prompts, testMode, engineMock: options?.engineMock, saveRawJson: true }
    );
  } catch (e: any) {
    auditedToday.delete(domain);
    const reason = String(e?.message || e).slice(0, 300);
    await say(`*Prospect audit failed* for *${name}* (${domain}): ${reason}. Nothing was sent. To try again: ${rerun}`);
    return { status: "failed", reason };
  }
  if (result.promptsCount !== AUDIT_PROMPT_COUNT) {
    const reason = `the audit returned ${result.promptsCount} questions, not ${AUDIT_PROMPT_COUNT}`;
    await say(`*Prospect audit failed* for *${name}* (${domain}): ${reason}.`);
    return { status: "failed", reason };
  }
  const costUsd = result.summary.totalCostUsd;
  try {
    deps.recordSpend(costUsd, `Prospect audit (${req.source}) for ${domain}: ${result.totalQueries} answers`);
  } catch (e: any) {
    console.warn(`[Prospect Audit] spend not recorded: ${e?.message || e}`);
  }

  const filename = `${slugFor(name)}-ai-visibility-audit-${today}.pdf`;
  const outFile = path.join(process.cwd(), "artifacts", "audits", "prospects", filename);
  let upload: { ok: boolean; fileId?: string; error?: string };
  let pdfBase64 = "";
  try {
    await deps.renderPdf(result, outFile);
    try {
      pdfBase64 = deps.readPdf(outFile).toString("base64");
    } catch (e: any) {
      console.warn(`[Prospect Audit] PDF could not be read back for the review record: ${e?.message || e}`);
    }
    upload = await deps.postFile({ channel: PROSPECT_AUDIT_CHANNEL, filePath: outFile, filename, title: `AI visibility audit (for review) · ${name}` });
  } catch (e: any) {
    upload = { ok: false, error: String(e?.message || e) };
  }

  // The review record. Without it there is nothing for a button to act on, so the summary goes out without buttons.
  let auditId: string | undefined;
  if (upload.ok && deps.store && pdfBase64) {
    try {
      auditId = await deps.store.insert({
        site_lead_id: req.leadId || null,
        refined_from: req.refinedFrom || null,
        source: req.source,
        business_name: name,
        domain,
        category_phrase: category.phrase,
        phrase_from: category.from,
        city: tidyCity(req.city) || null,
        prompts,
        total_mentions: result.summary.totalMentions,
        total_queries: result.totalQueries,
        summary: { mentionsByEngine: result.summary.mentionsByEngine, competitorMentions: result.summary.competitorMentions, auditedAt: result.auditedAt },
        cost_usd: costUsd,
        pdf_filename: filename,
        pdf_base64: pdfBase64,
        contact_name: (req.contactName || "").trim() || null,
        contact_email: (req.contactEmail || "").trim().toLowerCase() || null,
      });
    } catch (e: any) {
      console.warn(`[Prospect Audit] review record not saved, posting without buttons: ${e?.message || e}`);
    }
  }

  if (auditId && deps.store) {
    const text = prospectAuditSummary(req, result, prompts, phraseFrom, true, true);
    const posted = await deps.postReview({ channel: PROSPECT_AUDIT_CHANNEL, text, blocks: reviewBlocks(text, auditId) }).catch((e: any) => ({ ok: false, error: String(e?.message || e) } as { ok: boolean; ts?: string; channelId?: string; error?: string }));
    if (posted.ok) {
      await deps.store.update(auditId, { slack_channel: posted.channelId || PROSPECT_AUDIT_CHANNEL, slack_ts: posted.ts || null, slack_file_id: upload.fileId || null }).catch((e: any) => console.warn(`[Prospect Audit] slack reference not saved: ${e?.message || e}`));
    } else {
      // The buttons could not be posted: fall back to the plain summary so the audit is still seen.
      await say(prospectAuditSummary(req, result, prompts, phraseFrom, true));
    }
    return { status: "posted", result, prompts, fileId: upload.fileId, costUsd, auditId };
  }

  await say(prospectAuditSummary(req, result, prompts, phraseFrom, upload.ok));
  if (!upload.ok) return { status: "post_failed", result, prompts, error: upload.error || "upload refused", costUsd };
  return { status: "posted", result, prompts, fileId: upload.fileId, costUsd };
}

/** Parses `audit | Business | website | what they are | city`. The last two parts are optional. */
export function parseAuditCommand(text: string): ProspectAuditRequest | null {
  const parts = (text || "").split("|").map((s) => s.trim());
  if (parts.length < 3 || !/^audit$/i.test(parts[0])) return null;
  const [, businessName, website, what, city] = parts;
  if (!businessName || !website) return null;
  return { businessName, website, what: what || null, city: city || null, source: "architect" };
}

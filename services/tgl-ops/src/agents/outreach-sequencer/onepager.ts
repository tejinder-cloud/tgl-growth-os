// services/tgl-ops/src/agents/outreach-sequencer/onepager.ts
// Builds the per-prospect one-pager: short-form AEO audit (5 prompts x 3 engines) -> summary -> single-page PDF.
// Every figure in the PDF comes from the audit result. The PDF writer is dependency-free.
import { isQuotableCompetitor, weakestQuery, type QuoteContext } from "./competitors.js";
import {
  runShortFormAudit,
  type ShortFormAuditResult,
  type ShortFormOptions,
} from "../aeo-audit-engine/short-form.js";
import type { BrandLens } from "../aeo-audit-engine/types.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { categoryLabel } from "./sequence.js";
import type { AuditSummary } from "./types.js";

export interface OnePagerProspect {
  company: string;
  website: string;
  category: string;
  city: string;
}

export function domainOf(website: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return website.replace(/^(https?:\/\/)?(www\.)?/i, "").split("/")[0].toLowerCase();
  }
}

/** Five buyer prompts derived from the prospect's own category and city. */
export function buildAuditPrompts(p: OnePagerProspect): string[] {
  const label = categoryLabel(p.category);
  return [
    `Best ${label} in ${p.city}`,
    `Top ${label} near me in ${p.city}`,
    `Which ${label} in ${p.city} has the best reviews and results`,
    `How much does a ${label} cost in ${p.city} and which one is worth it`,
    `Which ${label} in ${p.city} should I trust`,
  ];
}

export function buildBrandLens(p: OnePagerProspect): BrandLens {
  const domain = domainOf(p.website);
  const stem = domain.split(".")[0];
  const variants = Array.from(new Set([p.company, p.company.replace(/\s*\(.*?\)\s*/g, "").trim(), stem].filter(Boolean)));
  return { name: p.company, domains: [domain], variants } as unknown as BrandLens;
}

function topKeys(rec: Record<string, number>, limit: number): string[] {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/**
 * The audit as the emails may quote it. Competitors are only names that read as a business (competitors.ts); the
 * counts beside them come straight from the same run. weakest_query is a question where no engine named the prospect.
 */
export function summarizeAudit(result: ShortFormAuditResult, ctx?: QuoteContext): AuditSummary {
  const quotable = (n: string) => (ctx ? isQuotableCompetitor(n, ctx) : true);
  const comps: Record<string, number> = {};
  for (const [name, count] of Object.entries(result.summary.competitorMentions)) if (quotable(name)) comps[name] = count;
  const top = topKeys(comps, 3);
  const competitor_mentions: Record<string, number> = {};
  for (const n of top) competitor_mentions[n] = comps[n];
  const weak = weakestQuery(result, quotable, top[0]);
  const summary: AuditSummary = {
    visibility_percent: result.summary.visibilityScorePercent,
    mentions: result.summary.totalMentions,
    total_queries: result.totalQueries,
    mentions_by_engine: { ...result.summary.mentionsByEngine },
    top_competitors: top,
    top_cited_domains: topKeys(result.summary.citationDomains, 3),
    audited_at: result.auditedAt,
  };
  if (top.length > 0) summary.competitor_mentions = competitor_mentions;
  if (weak.query) summary.weakest_query = weak.query;
  if (weak.competitor) summary.weakest_competitor = weak.competitor;
  return summary;
}

/** The model check the Slack-requested audits already use: drops places, exams, treatments and headings. */
async function defaultNameFilter(names: string[], looking: { phrase: string; where: string }): Promise<string[] | null> {
  if (process.env.TGL_TEST_MODE === "1") return null;
  const { checkNamedBusinesses } = await import("../aeo-audit-engine/prospect-audit-brief.js");
  const { callStructuredTool } = await import("../../lib/anthropic-structured.js");
  const checked = await checkNamedBusinesses(names, looking, async (o) => {
    const res = await callStructuredTool<any>({ system: o.system, messages: [{ role: "user", content: o.user }], tool: o.tool as any, maxTokens: o.maxTokens ?? 800, agent: "outreach-sequencer" });
    return { data: res.data, usd: res.usd };
  });
  if (!checked) return null;
  // A reply that drops every one of several names is more likely a bad reply than a true reading.
  if (checked.keep.length === 0 && names.length >= 3) return null;
  return checked.keep;
}

export async function runProspectAudit(
  p: OnePagerProspect,
  options?: ShortFormOptions
): Promise<{ result: ShortFormAuditResult; summary: AuditSummary }> {
  // An outreach prospect has no setup profile: this is a prospect audit (decisions/2026-11-12.md).
  // Without the prospect option the audit engine refuses every business that is not a verified client.
  const lens = buildBrandLens(p);
  const looking = { phrase: categoryLabel(p.category), where: p.city };
  const result = await runShortFormAudit(lens, {
    ...options,
    prompts: buildAuditPrompts(p),
    prospect: { name: p.company, website: p.website, variants: lens.variants, nameFilter: (names) => defaultNameFilter(names, looking) },
  });
  return { result, summary: summarizeAudit(result, { company: p.company, city: p.city }) };
}

// ---------------------------------------------------------------------------
// Minimal single-page PDF writer (Helvetica, A4, text only)
// ---------------------------------------------------------------------------

function pdfSafe(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

interface PdfLine {
  text: string;
  size: number;
  bold?: boolean;
  gapBefore?: number;
}

export function onePagerLines(p: OnePagerProspect, a: AuditSummary): PdfLine[] {
  const label = categoryLabel(p.category);
  const perEngine = a.total_queries / Math.max(1, Object.keys(a.mentions_by_engine).length);
  const lines: PdfLine[] = [];
  const add = (text: string, size = 11, bold = false, gapBefore = 0) => {
    const max = Math.floor(95 * (11 / size));
    for (const [i, l] of wrap(text, max).entries()) {
      lines.push({ text: l, size, bold, gapBefore: i === 0 ? gapBefore : 0 });
    }
  };

  add("AI Answer Visibility Audit", 20, true);
  add(`${p.company}  |  ${p.city}  |  ${domainOf(p.website)}`, 11);
  add(`Prepared by The Growth Lab. Audit run: ${a.audited_at.slice(0, 10)}`, 9, false, 2);

  add("What we did", 13, true, 16);
  add(
    `We asked ChatGPT, Gemini and Perplexity ${perEngine} buyer questions each about ${label}s in ${p.city}, ${a.total_queries} answers in total, and checked whether ${p.company} was named.`
  );

  add("Result", 13, true, 14);
  add(
    `${p.company} was named in ${a.mentions} of ${a.total_queries} answers (${a.visibility_percent}%).`,
    12,
    true
  );
  for (const [engine, count] of Object.entries(a.mentions_by_engine)) {
    add(`${engine}: named in ${count} of ${perEngine} answers`, 11, false, 2);
  }

  // Only names that read as a business; an audit stored before 21 Nov can hold places or treatments here.
  const names = a.top_competitors.filter((n) => isQuotableCompetitor(n, { company: p.company, city: p.city }));
  add("Businesses named most in the answers", 13, true, 14);
  add(names.length ? names.join(", ") : "No other business was named often enough to list.");

  add("Sources the assistants cited most", 13, true, 14);
  add(a.top_cited_domains.length ? a.top_cited_domains.join(", ") : "No citations were returned in these answers.");

  add("Next step", 13, true, 14);
  add(
    "A 20-minute diagnostic: we walk through which questions you are missing from and what closing that gap would involve. You keep this audit either way."
  );

  add(
    "Method: 5 buyer prompts x 3 AI engines, answers read for brand mentions and citations. Results are a point-in-time sample and AI answers vary between runs.",
    8,
    false,
    24
  );
  return lines;
}

export function renderOnePagerPdf(p: OnePagerProspect, a: AuditSummary): Buffer {
  const lines = onePagerLines(p, a);
  let y = 790;
  const ops: string[] = [];
  for (const l of lines) {
    y -= (l.gapBefore || 0) + l.size * 1.35;
    ops.push(`BT /${l.bold ? "F2" : "F1"} ${l.size} Tf 50 ${y.toFixed(1)} Td (${pdfSafe(l.text)}) Tj ET`);
  }
  if (y < 40) throw new Error("One-pager content overflowed one page");
  const stream = ops.join("\n");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------------------
// Upload to Supabase Storage and sign a URL for the GHL attachment
// ---------------------------------------------------------------------------

export interface StoredOnePager {
  path: string;
  signedUrl: string;
}

export async function uploadOnePager(
  prospectKey: string,
  pdf: Buffer,
  env: NodeJS.ProcessEnv = process.env
): Promise<StoredOnePager> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured; cannot store one-pager");
  const bucket = (env.OUTREACH_ONEPAGER_BUCKET || "audit-onepagers").trim();
  const safeKey = prospectKey.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "prospect";
  const path = `tgl/${safeKey}/${Date.now()}-ai-visibility-audit.pdf`;
  const up = await sb.storage.from(bucket).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error) throw new Error(`One-pager upload failed: ${up.error.message}`);
  const signed = await sb.storage.from(bucket).createSignedUrl(path, 7 * 24 * 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(`One-pager signed URL failed: ${signed.error?.message || "no url"}`);
  }
  return { path, signedUrl: signed.data.signedUrl };
}

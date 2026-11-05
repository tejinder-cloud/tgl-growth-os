// services/tgl-ops/src/agents/outreach-sequencer/onepager.ts
// Builds the per-prospect one-pager: short-form AEO audit (5 prompts x 3 engines) -> summary -> single-page PDF.
// Every figure in the PDF comes from the audit result. The PDF writer is dependency-free.
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

export function summarizeAudit(result: ShortFormAuditResult): AuditSummary {
  return {
    visibility_percent: result.summary.visibilityScorePercent,
    mentions: result.summary.totalMentions,
    total_queries: result.totalQueries,
    mentions_by_engine: { ...result.summary.mentionsByEngine },
    top_competitors: topKeys(result.summary.competitorMentions, 3),
    top_cited_domains: topKeys(result.summary.citationDomains, 3),
    audited_at: result.auditedAt,
  };
}

export async function runProspectAudit(
  p: OnePagerProspect,
  options?: ShortFormOptions
): Promise<{ result: ShortFormAuditResult; summary: AuditSummary }> {
  const result = await runShortFormAudit(buildBrandLens(p), {
    ...options,
    prompts: buildAuditPrompts(p),
  });
  return { result, summary: summarizeAudit(result) };
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

  add("Names that appeared most in the answers", 13, true, 14);
  add(a.top_competitors.length ? a.top_competitors.join(", ") : "No competitor names were detected in these answers.");

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

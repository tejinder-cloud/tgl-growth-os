// services/tgl-ops/src/agents/aeo-audit-engine/pdf.ts
// Generates a 1-page paper-and-ink branded AEO audit PDF under 2MB.
// Uses pure-Node PDFKit with Fraunces & DM Sans typography and zero external browser binaries.
// Strictly enforces the Iron Law of Honesty:
// - Shows actual model positions (Named #1/#2/#3, Mentioned, —)
// - Shows actual answer frequencies for competitors and citations
// - "Mechanistic next steps" is regenerated from the matrix at render time (engines with zero mentions,
//   top competitor if any, two weakest queries); it never reuses stored or fixed phrases
// - Lower 40% dedicated to per-query 1-line answer excerpts proving each cell

import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { ShortFormAuditResult, MatrixBadge } from "./short-form.js";
import { generateMatrixNextSteps } from "./next-steps.js";

/**
 * The text of the "Mechanistic next steps" box, generated from the audit matrix only.
 */
export function buildNextStepsText(result: ShortFormAuditResult): string {
  return generateMatrixNextSteps(result.results, result.summary, result.brand.name).formattedText;
}

/**
 * Resolves font file path from various candidate locations in source or compiled dist.
 */
function resolveFontPath(filename: string): string | null {
  const candidates = [
    path.join(__dirname, "../../assets/fonts", filename),
    path.join(__dirname, "../assets/fonts", filename),
    path.join(__dirname, "assets/fonts", filename),
    path.join(process.cwd(), "services/tgl-ops/src/assets/fonts", filename),
    path.join(process.cwd(), "src/assets/fonts", filename),
    path.join(process.cwd(), "dist/assets/fonts", filename),
    path.join(process.cwd(), "assets/fonts", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Renders the single-page HTML markup conforming strictly to TGL "paper & ink" visual tokens.
 * Colors: cream canvas #F7F4EE, ink #1F2421, terracotta #C85A32, coral #E07A5F.
 * Typeface pair: Fraunces & DM Sans.
 */
export function renderAuditHtml(result: ShortFormAuditResult): string {
  const brandName = result.brand.name;
  const domain = result.brand.primaryDomain || result.brand.domains[0] || "thegrowthlab.co.in";
  const dateStr = result.auditedAt.slice(0, 10);
  const score = result.summary.visibilityScorePercent;
  const mentions = result.summary.totalMentions;
  const queries = result.totalQueries;
  const nextStepsText = buildNextStepsText(result);

  const competitors =
    Object.entries(result.summary.competitorMentions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => `${name} (${count})`)
      .join(", ") || "None detected";

  const topCitations =
    Object.entries(result.summary.citationDomains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([d, count]) => `${d} (${count})`)
      .join(", ") || "None recorded";

  const rows = result.results
    .map((r) => {
      const getBadgeHtml = (badge: MatrixBadge) => {
        if (badge === "—") {
          return `<span class="badge absent">—</span>`;
        }
        if (badge === "Named #1") {
          return `<span class="badge named-1">Named #1</span>`;
        }
        if (badge === "Named #2") {
          return `<span class="badge named-2">Named #2</span>`;
        }
        if (badge === "Named #3") {
          return `<span class="badge named-3">Named #3</span>`;
        }
        return `<span class="badge mentioned">Mentioned</span>`;
      };

      const chatgptBadge = r.engineResults.chatgpt ? r.engineResults.chatgpt.badge : "—";
      const geminiBadge = r.engineResults.gemini ? r.engineResults.gemini.badge : "—";
      const perplexityBadge = r.engineResults.perplexity ? r.engineResults.perplexity.badge : "—";

      return `
        <tr>
          <td class="prompt-col">
            <span class="prompt-num">${r.promptIndex}.</span>
            <span class="prompt-text">${escapeHtml(r.prompt)}</span>
          </td>
          <td class="engine-col">${getBadgeHtml(chatgptBadge)}</td>
          <td class="engine-col">${getBadgeHtml(geminiBadge)}</td>
          <td class="engine-col">${getBadgeHtml(perplexityBadge)}</td>
        </tr>
      `;
    })
    .join("");

  const excerptCards = result.results
    .map((r) => {
      const badgeClass =
        r.excerpt.badge === "Named #1"
          ? "named-1"
          : r.excerpt.badge === "—"
          ? "absent"
          : "named-2";
      return `
        <div class="excerpt-card">
          <div class="excerpt-header">
            <span class="query-pill">Q${r.promptIndex}</span>
            <span class="query-title">${escapeHtml(r.prompt)}</span>
            <span class="excerpt-engine-badge ${badgeClass}">${r.excerpt.engine.toUpperCase()}: ${r.excerpt.badge}</span>
          </div>
          <div class="excerpt-body">"${escapeHtml(r.excerpt.text)}"</div>
        </div>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AEO Short-Form Audit · ${escapeHtml(brandName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "DM Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #F7F4EE;
      color: #1F2421;
      line-height: 1.3;
      font-size: 10pt;
      width: 100%;
      height: 100%;
    }
    .sheet {
      background: #F7F4EE;
      border: 2px solid #1F2421;
      padding: 16px 20px;
      position: relative;
    }
    /* Risograph offset corner effect */
    .sheet::after {
      content: "";
      position: absolute;
      top: 4px;
      left: 4px;
      right: -6px;
      bottom: -6px;
      background: #C85A32;
      z-index: -1;
      opacity: 0.15;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1F2421;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .brand-group h1 {
      font-family: "Fraunces", Georgia, serif;
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #1F2421;
      margin-bottom: 2px;
    }
    .brand-group .meta {
      font-size: 9pt;
      color: #63615C;
    }
    .audit-stamp {
      text-align: right;
    }
    .stamp-badge {
      display: inline-block;
      border: 1.5px solid #C85A32;
      color: #C85A32;
      padding: 2px 7px;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .audit-date {
      font-size: 8pt;
      color: #63615C;
    }
    /* Summary KPI Bar */
    .kpi-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .kpi-card {
      background: #FFFFFF;
      border: 1.2px solid #1F2421;
      padding: 8px 10px;
    }
    .kpi-label {
      font-size: 7pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #E07A5F;
      margin-bottom: 1px;
    }
    .kpi-val {
      font-family: "Fraunces", Georgia, serif;
      font-size: 15pt;
      font-weight: 700;
      color: #1F2421;
    }
    .kpi-sub {
      font-size: 7pt;
      color: #63615C;
    }
    /* Matrix Table */
    .table-container {
      margin-bottom: 10px;
    }
    .section-title {
      font-family: "Fraunces", Georgia, serif;
      font-size: 11pt;
      font-weight: 700;
      margin-bottom: 4px;
      color: #1F2421;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1.2px solid #1F2421;
      background: #FFFFFF;
      font-size: 8pt;
    }
    th {
      background: #E8EDE6;
      border: 1px solid #1F2421;
      padding: 5px 7px;
      text-align: left;
      font-weight: 700;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      border: 1px solid #1F2421;
      padding: 4px 7px;
      vertical-align: middle;
    }
    .prompt-col {
      width: 58%;
    }
    .prompt-num {
      font-weight: 700;
      margin-right: 4px;
      color: #C85A32;
    }
    .engine-col {
      width: 14%;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      font-size: 7pt;
      font-weight: 700;
      border-radius: 2px;
    }
    .badge.named-1 {
      background: #FBECE8;
      color: #C85A32;
      border: 1px solid #C85A32;
    }
    .badge.named-2, .badge.named-3 {
      background: #FAF0ED;
      color: #E07A5F;
      border: 1px solid #E07A5F;
    }
    .badge.mentioned {
      background: #F2F0EB;
      color: #1F2421;
      border: 1px solid #1F2421;
    }
    .badge.absent {
      color: #99948D;
    }
    /* Insight Split Panels */
    .insights-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 10px;
    }
    .panel {
      background: #FFFFFF;
      border: 1.2px solid #1F2421;
      padding: 8px 10px;
      font-size: 8pt;
    }
    .panel-title {
      font-family: "Fraunces", Georgia, serif;
      font-size: 9pt;
      font-weight: 700;
      color: #1F2421;
      margin-bottom: 3px;
    }
    .panel p {
      font-size: 7.5pt;
      color: #4A4843;
      margin-bottom: 2px;
    }
    /* Action Box */
    .action-box {
      background: #FBECE8;
      border: 1.2px solid #C85A32;
      padding: 7px 10px;
      margin-bottom: 10px;
    }
    .action-title {
      font-weight: 700;
      font-size: 8pt;
      color: #C85A32;
      margin-bottom: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .action-text {
      font-size: 7.5pt;
      color: #1F2421;
      line-height: 1.25;
    }

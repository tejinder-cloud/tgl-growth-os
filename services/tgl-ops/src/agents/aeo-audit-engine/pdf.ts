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
  return generateMatrixNextSteps(result.results, result.summary, result.brand.name, result.auditKind === "prospect").formattedText;
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

function prospectBookingLink(): string | null {
  const v = (process.env.PROSPECT_AUDIT_BOOKING_LINK || "").trim();
  if (/^off$/i.test(v)) return null;
  return /^https:\/\/\S+$/.test(v) ? v : "https://api.leadconnectorhq.com/widget/booking/liUlrrRvDQmCUmUnudID";
}

/**
 * Headings and captions. A client audit keeps the analyst wording; a prospect audit is read by a business owner
 * who has never heard of us, so it says the same things in plain words.
 */
export function auditWording(result: ShortFormAuditResult) {
  const n = result.totalQueries;
  if (result.auditKind === "prospect") {
    return {
      kpiScore: "SHARE OF ANSWERS", kpiScoreSub: "Answers That Named You",
      kpiMentions: "TIMES NAMED", kpiMentionsSub: "Out of All Answers",
      kpiEngines: "AI ASSISTANTS ASKED", kpiPrompts: "QUESTIONS ASKED",
      matrix: "What AI Said When Buyers Asked",
      competitors: "Who AI Named Instead of You",
      competitorsNote: `Number of answers, out of ${n}, that named each one.`,
      sources: "Where AI Gets Its Answers",
      sourcesNote: `Websites the answers cited, with the number of answers out of ${n}.`,
      action: "WHAT THIS SHOWS",
      evidence: "What the Answers Said",
      evidenceSub: "One line from an answer to each question",
      closing: prospectBookingLink()
        ? ` What to fix first is a 20-minute conversation: reply to the email this report came with, or pick a time at\n${prospectBookingLink()}`
        : " What to fix first is a 20-minute conversation: reply to the message this report came with.",
    };
  }
  return {
    kpiScore: "VISIBILITY SCORE", kpiScoreSub: "Overall Brand Share",
    kpiMentions: "AI MENTIONS", kpiMentionsSub: "Total Model Answers",
    kpiEngines: "ENGINES EVALUATED", kpiPrompts: "AUDITED PROMPTS",
    matrix: "Query Visibility Matrix",
    competitors: "Competitors Named in Answers",
    competitorsNote: `Exact competitor appearance counts across all ${n} answers.`,
    sources: "Cited Authority Channels",
    sourcesNote: `Primary web sources cited in the ${n} model answers.`,
    action: "MECHANISTIC NEXT STEPS",
    evidence: "Query Evidence & Answer Excerpts",
    evidenceSub: "Verifiable 1-line excerpts establishing cell rankings and competitor mentions",
    closing: "",
  };
}

/** Label under the prompt count. A prospect audit has no verified setup profile and must not claim one. */
export function promptsLabel(result: ShortFormAuditResult): string {
  return result.auditKind === "prospect" ? "Buyer Questions for Your Category" : "Verified Buyer Prompts";
}

/** Header of the question column in the matrix. */
export function queryColumnLabel(result: ShortFormAuditResult): string {
  return result.auditKind === "prospect" ? "Buyer Question (Your Category and City)" : "Buyer Query (Verified Setup Profile)";
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
  const w = auditWording(result);
  const nextStepsText = buildNextStepsText(result) + w.closing;

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
    /* Lower 40%: Query Evidence & Excerpts */
    .evidence-section {
      margin-bottom: 8px;
    }
    .evidence-header-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 4px;
    }
    .evidence-sub {
      font-size: 7pt;
      color: #63615C;
    }
    .excerpt-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .excerpt-card {
      background: #FFFFFF;
      border: 1px solid #1F2421;
      padding: 5px 8px;
    }
    .excerpt-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 2px;
    }
    .query-pill {
      font-size: 6.5pt;
      font-weight: 700;
      background: #1F2421;
      color: #F7F4EE;
      padding: 1px 4px;
      border-radius: 2px;
    }
    .query-title {
      font-size: 7pt;
      font-weight: 700;
      color: #1F2421;
      flex-grow: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .excerpt-engine-badge {
      font-size: 6.5pt;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 2px;
    }
    .excerpt-engine-badge.named-1 {
      background: #FBECE8;
      color: #C85A32;
      border: 0.8px solid #C85A32;
    }
    .excerpt-engine-badge.named-2 {
      background: #FAF0ED;
      color: #E07A5F;
      border: 0.8px solid #E07A5F;
    }
    .excerpt-engine-badge.absent {
      background: #F2F0EB;
      color: #63615C;
      border: 0.8px solid #99948D;
    }
    .excerpt-body {
      font-size: 7pt;
      color: #33312E;
      font-style: italic;
      line-height: 1.2;
    }
    footer {
      border-top: 1px solid #1F2421;
      padding-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7pt;
      color: #63615C;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <header>
      <div class="brand-group">
        <h1>${escapeHtml(brandName)}</h1>
        <div class="meta">${escapeHtml(domain)} · AI Engine Visibility Audit</div>
      </div>
      <div class="audit-stamp">
        <div class="stamp-badge">TrueVisible Audit</div>
        <div class="audit-date">Date: ${dateStr}</div>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">${w.kpiScore}</div>
        <div class="kpi-val">${score}%</div>
        <div class="kpi-sub">${w.kpiScoreSub}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${w.kpiMentions}</div>
        <div class="kpi-val">${mentions} / ${queries}</div>
        <div class="kpi-sub">${w.kpiMentionsSub}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${w.kpiEngines}</div>
        <div class="kpi-val">${result.enginesCount}</div>
        <div class="kpi-sub">Perplexity, Gemini, ChatGPT</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${w.kpiPrompts}</div>
        <div class="kpi-val">${result.promptsCount}</div>
        <div class="kpi-sub">${promptsLabel(result)}</div>
      </div>
    </div>

    <div class="table-container">
      <div class="section-title">${w.matrix}</div>
      <table>
        <thead>
          <tr>
            <th class="prompt-col">${queryColumnLabel(result)}</th>
            <th class="engine-col">ChatGPT</th>
            <th class="engine-col">Gemini</th>
            <th class="engine-col">Perplexity</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <div class="insights-grid">
      <div class="panel">
        <div class="panel-title">${w.competitors}</div>
        <p>${escapeHtml(competitors)}</p>
        <p><em>Exact frequency of competitor appearances across all ${queries} model answers.</em></p>
      </div>
      <div class="panel">
        <div class="panel-title">${w.sources}</div>
        <p>${escapeHtml(topCitations)}</p>
        <p><em>Exact frequency of citation sources informing the AI answers.</em></p>
      </div>
    </div>

    <div class="action-box">
      <div class="action-title">${w.action}</div>
      <div class="action-text">
        ${escapeHtml(nextStepsText)}
      </div>
    </div>

    <!-- Lower 40%: Query Evidence & Excerpts -->
    <div class="evidence-section">
      <div class="evidence-header-row">
        <div class="section-title">${w.evidence}</div>
        <div class="evidence-sub">${w.evidenceSub}</div>
      </div>
      <div class="excerpt-list">
        ${excerptCards}
      </div>
    </div>

    <footer>
      <div>The Growth Lab · TrueVisible Engine · Chandigarh & Pan-India</div>
      <div>${escapeHtml(domain)} · Confidential</div>
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generates a 1-page paper-and-ink branded AEO audit PDF buffer using pure-Node PDFKit.
 * Strictly conforms to TGL tokens: cream canvas #F7F4EE, ink #1F2421, terracotta #C85A32, coral #E07A5F.
 * Uses Fraunces and DM Sans typography, risograph offset border, KPI grid, 5x3 query matrix,
 * dynamic matrix-driven next steps, and lower 40% query excerpts. Zero emojis.
 * Verified well under the 2MB size limit.
 */
export async function generateAuditPdf(
  result: ShortFormAuditResult,
  outputPath?: string
): Promise<{ buffer: Buffer; sizeBytes: number; outputPath?: string }> {
  const brandName = result.brand.name;
  const domain = result.brand.primaryDomain || result.brand.domains[0] || "thegrowthlab.co.in";
  const dateStr = result.auditedAt.slice(0, 10);
  const score = result.summary.visibilityScorePercent;
  const mentions = result.summary.totalMentions;
  const queries = result.totalQueries;
  const w = auditWording(result);
  const nextStepsText = buildNextStepsText(result) + w.closing;

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

  const frauncesPath = resolveFontPath("fraunces.ttf");
  const dmSansPath = resolveFontPath("dm-sans.ttf");

  const fontSerif = frauncesPath || "Times-Bold";
  const fontSans = dmSansPath || "Helvetica";
  const fontSansBold = dmSansPath || "Helvetica-Bold";

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 15, bottom: 15, left: 15, right: 15 },
    autoFirstPage: true,
    info: {
      Title: `AEO Short-Form Audit · ${brandName}`,
      Author: "The Growth Lab",
      Subject: "AI Engine Visibility Audit",
      Creator: "TrueVisible Audit Engine",
    },
  });

  const buffers: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => buffers.push(chunk));

  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", (err: Error) => reject(err));
  });

  const sheetX = 26;
  const sheetY = 20;
  const sheetW = 543.28;
  const sheetH = 795;

  // 1. Risograph offset corner effect (terracotta 15% opacity)
  doc.save();
  doc.rect(sheetX + 4, sheetY + 4, sheetW, sheetH).fillColor("#C85A32", 0.15).fill();
  doc.restore();

  // 2. Main Sheet Canvas (#F7F4EE cream canvas with 2px ink border)
  doc.rect(sheetX, sheetY, sheetW, sheetH).fillColor("#F7F4EE").fill();
  doc.rect(sheetX, sheetY, sheetW, sheetH).lineWidth(2).strokeColor("#1F2421").stroke();

  // 3. Header Section
  doc.font(fontSerif).fontSize(18).fillColor("#1F2421").text(brandName, 42, 34);
  doc.font(fontSans).fontSize(9).fillColor("#63615C").text(`${domain} · AI Engine Visibility Audit`, 42, 58);

  // Right stamp badge
  doc.rect(435, 34, 115, 18).lineWidth(1.2).strokeColor("#C85A32").stroke();
  const isMock = result.results.some((r) => Object.values(r.engineResults).some((er) => String(er?.model ?? "").includes("-mock")));
  doc.font(fontSansBold).fontSize(7.5).fillColor("#C85A32").text(isMock ? "TEST FIXTURE, NOT AN AUDIT" : "TRUEVISIBLE AUDIT", 435, 39, { width: 115, align: "center" });
  doc.font(fontSans).fontSize(8).fillColor("#63615C").text(`Date: ${dateStr}`, 435, 58, { width: 115, align: "center" });

  // Dividing rule
  doc.moveTo(42, 78).lineTo(550, 78).lineWidth(1.5).strokeColor("#1F2421").stroke();

  // 4. Summary KPI Bar (4 cards)
  const kpis = [
    { label: w.kpiScore, val: `${score}%`, sub: w.kpiScoreSub },
    { label: w.kpiMentions, val: `${mentions} / ${queries}`, sub: w.kpiMentionsSub },
    { label: w.kpiEngines, val: `${result.enginesCount}`, sub: "Perplexity, Gemini, ChatGPT" },
    { label: w.kpiPrompts, val: `${result.promptsCount}`, sub: promptsLabel(result) },
  ];

  const cardW = 119;
  const cardH = 44;
  const gap = 10.5;

  kpis.forEach((kpi, i) => {
    const x = 42 + i * (cardW + gap);
    const y = 88;
    doc.rect(x, y, cardW, cardH).fillColor("#FFFFFF").fill();
    doc.rect(x, y, cardW, cardH).lineWidth(1.1).strokeColor("#1F2421").stroke();

    doc.font(fontSansBold).fontSize(6.8).fillColor("#E07A5F").text(kpi.label, x + 7, y + 5);
    doc.font(fontSerif).fontSize(13.5).fillColor("#1F2421").text(kpi.val, x + 7, y + 15);
    doc.font(fontSans).fontSize(6.8).fillColor("#63615C").text(kpi.sub, x + 7, y + 32);
  });

  // 5. Query Visibility Matrix Table
  doc.font(fontSerif).fontSize(11).fillColor("#1F2421").text(w.matrix, 42, 142);

  const tableY = 156;
  const tableW = 508;
  doc.rect(42, tableY, tableW, 17).fillColor("#E8EDE6").fill();
  doc.rect(42, tableY, tableW, 17).lineWidth(1).strokeColor("#1F2421").stroke();

  doc.font(fontSansBold).fontSize(7).fillColor("#1F2421");
  doc.text(queryColumnLabel(result).toUpperCase(), 50, tableY + 5);
  doc.text("CHATGPT", 340, tableY + 5, { width: 70, align: "center" });
  doc.text("GEMINI", 410, tableY + 5, { width: 70, align: "center" });
  doc.text("PERPLEXITY", 480, tableY + 5, { width: 70, align: "center" });

  const rowHeight = 25;
  result.results.forEach((r, idx) => {
    const rowY = tableY + 17 + idx * rowHeight;
    doc.rect(42, rowY, tableW, rowHeight).fillColor("#FFFFFF").fill();
    doc.rect(42, rowY, tableW, rowHeight).lineWidth(0.8).strokeColor("#1F2421").stroke();

    // Vertical column borders
    doc.moveTo(340, rowY).lineTo(340, rowY + rowHeight).stroke();
    doc.moveTo(410, rowY).lineTo(410, rowY + rowHeight).stroke();
    doc.moveTo(480, rowY).lineTo(480, rowY + rowHeight).stroke();

    // Query text
    // Number and question are drawn separately so the question has its own box: one line, cut with an
    // ellipsis when it is too long, never running under the engine columns.
    doc.font(fontSansBold).fontSize(7.5).fillColor("#C85A32").text(`${r.promptIndex}.`, 48, rowY + 7, { width: 10, lineBreak: false });
    doc.font(fontSans).fontSize(7.5).fillColor("#1F2421").text(r.prompt, 58, rowY + 7, { width: 276, height: 10, ellipsis: true });

    // Engine badges
    const drawBadge = (colX: number, engine: "chatgpt" | "gemini" | "perplexity") => {
      const res = r.engineResults[engine];
      const badge = res ? res.badge : "—";

      if (badge === "—") {
        doc.font(fontSans).fontSize(9).fillColor("#99948D").text("—", colX, rowY + 7, { width: 70, align: "center" });
      } else {
        const isNamed1 = badge === "Named #1";
        const bgCol = isNamed1 ? "#FBECE8" : "#FAF0ED";
        const strokeCol = isNamed1 ? "#C85A32" : "#E07A5F";

        doc.rect(colX + 9, rowY + 5, 52, 14).fillColor(bgCol).fill();
        doc.rect(colX + 9, rowY + 5, 52, 14).lineWidth(0.8).strokeColor(strokeCol).stroke();
        doc.font(fontSansBold).fontSize(6.8).fillColor(strokeCol).text(badge, colX + 9, rowY + 8, { width: 52, align: "center" });
      }
    };

    drawBadge(340, "chatgpt");
    drawBadge(410, "gemini");
    drawBadge(480, "perplexity");
  });

  // 6. Insight Split Panels
  const panelY = tableY + 17 + result.results.length * rowHeight + 8;
  const panelW = 248;
  const panelH = 50;

  // Panel 1: Competitors
  doc.rect(42, panelY, panelW, panelH).fillColor("#FFFFFF").fill();
  doc.rect(42, panelY, panelW, panelH).lineWidth(1.1).strokeColor("#1F2421").stroke();
  doc.font(fontSerif).fontSize(8.8).fillColor("#1F2421").text(w.competitors, 50, panelY + 6);
  doc.font(fontSans).fontSize(7.5).fillColor("#4A4843").text(competitors, 50, panelY + 18, { width: panelW - 16, ellipsis: true });
  doc.font(fontSans).fontSize(6.8).fillColor("#63615C").text(w.competitorsNote, 50, panelY + 36);

  // Panel 2: Cited Authority Channels
  doc.rect(302, panelY, panelW, panelH).fillColor("#FFFFFF").fill();
  doc.rect(302, panelY, panelW, panelH).lineWidth(1.1).strokeColor("#1F2421").stroke();
  doc.font(fontSerif).fontSize(8.8).fillColor("#1F2421").text(w.sources, 310, panelY + 6);
  doc.font(fontSans).fontSize(7.5).fillColor("#4A4843").text(topCitations, 310, panelY + 18, { width: panelW - 16, ellipsis: true });
  doc.font(fontSans).fontSize(6.8).fillColor("#63615C").text(w.sourcesNote, 310, panelY + 36);

  // 7. Matrix-driven Next Steps Box (text regenerated from the matrix; box height fits the text)
  const actionY = panelY + panelH + 7;
  const actionTextOptions = { width: 492, lineGap: 1 };
  doc.font(fontSans).fontSize(7.2);
  const actionTextH = doc.heightOfString(nextStepsText, actionTextOptions);
  const actionH = Math.max(46, Math.ceil(18 + actionTextH + 8));
  doc.rect(42, actionY, tableW, actionH).fillColor("#FBECE8").fill();
  doc.rect(42, actionY, tableW, actionH).lineWidth(1.1).strokeColor("#C85A32").stroke();

  doc.font(fontSansBold).fontSize(7.5).fillColor("#C85A32").text(w.action, 50, actionY + 6);
  doc.font(fontSans).fontSize(7.2).fillColor("#1F2421").text(nextStepsText, 50, actionY + 18, actionTextOptions);
  // The booking page sits on its own last line; make that line a working link.
  const bookingUrl = result.auditKind === "prospect" ? prospectBookingLink() : null;
  if (bookingUrl && nextStepsText.endsWith(bookingUrl)) {
    const lineH = doc.currentLineHeight(true);
    doc.link(50, doc.y - lineH, doc.widthOfString(bookingUrl), lineH, bookingUrl);
  }

  // 8. Lower 40%: Query Evidence & Answer Excerpts
  const evidenceY = actionY + actionH + 8;
  doc.font(fontSerif).fontSize(10.5).fillColor("#1F2421").text(w.evidence, 42, evidenceY);
  doc.font(fontSans).fontSize(6.8).fillColor("#63615C").text(
    w.evidenceSub,
    230,
    evidenceY + 3,
    { width: 320, align: "right" }
  );

  const excerptStartY = evidenceY + 15;
  const excerptCardH = 48;
  const excerptGap = 4;

  result.results.forEach((r, idx) => {
    const cardY = excerptStartY + idx * (excerptCardH + excerptGap);
    doc.rect(42, cardY, tableW, excerptCardH).fillColor("#FFFFFF").fill();
    doc.rect(42, cardY, tableW, excerptCardH).lineWidth(0.8).strokeColor("#1F2421").stroke();

    // Query badge pill
    doc.rect(48, cardY + 5, 20, 11).fillColor("#1F2421").fill();
    doc.font(fontSansBold).fontSize(6.5).fillColor("#F7F4EE").text(`Q${r.promptIndex}`, 48, cardY + 7, { width: 20, align: "center" });

    // Query text
    doc.font(fontSansBold).fontSize(7.2).fillColor("#1F2421").text(r.prompt, 73, cardY + 6, { width: 330, ellipsis: true });

    // Source engine and badge pill
    const badgeLabel = `${r.excerpt.engine.toUpperCase()}: ${r.excerpt.badge}`;
    const isNamed1 = r.excerpt.badge === "Named #1";
    const pillBg = isNamed1 ? "#FBECE8" : "#FAF0ED";
    const pillColor = isNamed1 ? "#C85A32" : "#E07A5F";

    doc.rect(415, cardY + 5, 128, 12).fillColor(pillBg).fill();
    doc.rect(415, cardY + 5, 128, 12).lineWidth(0.7).strokeColor(pillColor).stroke();
    doc.font(fontSansBold).fontSize(6.5).fillColor(pillColor).text(badgeLabel, 415, cardY + 7, { width: 128, align: "center" });

    // Verbatim 1-line excerpt
    doc.font(fontSans).fontSize(6.8).fillColor("#4A4843").text(
      `"${r.excerpt.text}"`,
      48,
      cardY + 22,
      { width: 495, lineGap: 0.5, ellipsis: true }
    );
  });

  // 9. Footer Section
  const footerY = 776;
  doc.moveTo(42, footerY).lineTo(550, footerY).lineWidth(1).strokeColor("#1F2421").stroke();
  doc.font(fontSans).fontSize(7).fillColor("#63615C").text("The Growth Lab · TrueVisible Engine · Chandigarh & Pan-India", 42, footerY + 6);
  doc.font(fontSans).fontSize(7).fillColor("#63615C").text(`${domain} · Confidential`, 42, footerY + 6, { width: 508, align: "right" });

  doc.end();

  const buffer = await pdfPromise;
  const sizeBytes = buffer.length;
  const MAX_BYTES = 2 * 1024 * 1024; // 2MB

  if (sizeBytes > MAX_BYTES) {
    throw new Error(`Generated PDF size (${(sizeBytes / 1024 / 1024).toFixed(2)} MB) exceeds 2MB limit.`);
  }

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
  }

  return {
    buffer,
    sizeBytes,
    outputPath,
  };
}

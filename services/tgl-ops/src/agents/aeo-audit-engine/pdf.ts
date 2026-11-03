// services/tgl-ops/src/agents/aeo-audit-engine/pdf.ts
// Generates a 1-page paper-and-ink branded AEO audit PDF under 2MB.
// Uses pure-Node PDFKit with Fraunces & DM Sans typography and zero external browser binaries.
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { ShortFormAuditResult } from "./short-form.js";

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
  const domain = result.brand.domains[0] || "thegrowthlab.co.in";
  const dateStr = result.auditedAt.slice(0, 10);
  const score = result.summary.visibilityScorePercent;
  const mentions = result.summary.totalMentions;
  const queries = result.totalQueries;

  const competitors = Object.entries(result.summary.competitorMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ") || "None detected";

  const topCitations = Object.entries(result.summary.citationDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([d, count]) => `${d} (${count})`)
    .join(", ") || "None recorded";

  const rows = result.results
    .map((r) => {
      const getBadge = (engine: "chatgpt" | "gemini" | "perplexity") => {
        const res = r.engineResults[engine];
        if (!res || !res.analysis.mentioned) {
          return `<span class="badge absent">—</span>`;
        }
        const pos = res.analysis.position ? `#${res.analysis.position}` : "Named";
        return `<span class="badge mentioned">Named ${pos}</span>`;
      };

      return `
        <tr>
          <td class="prompt-col">
            <span class="prompt-num">${r.promptIndex}.</span>
            <span class="prompt-text">${escapeHtml(r.prompt)}</span>
          </td>
          <td class="engine-col">${getBadge("chatgpt")}</td>
          <td class="engine-col">${getBadge("gemini")}</td>
          <td class="engine-col">${getBadge("perplexity")}</td>
        </tr>
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
      margin: 10mm;
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
      line-height: 1.35;
      font-size: 11pt;
      width: 100%;
      height: 100%;
    }
    .sheet {
      background: #F7F4EE;
      border: 2px solid #1F2421;
      padding: 22px 26px;
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
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .brand-group h1 {
      font-family: "Fraunces", Georgia, serif;
      font-size: 20pt;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #1F2421;
      margin-bottom: 3px;
    }
    .brand-group .meta {
      font-size: 9.5pt;
      color: #63615C;
    }
    .audit-stamp {
      text-align: right;
    }
    .stamp-badge {
      display: inline-block;
      border: 1.5px solid #C85A32;
      color: #C85A32;
      padding: 3px 8px;
      font-size: 8.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .audit-date {
      font-size: 8.5pt;
      color: #63615C;
    }
    /* Summary KPI Bar */
    .kpi-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi-card {
      background: #FFFFFF;
      border: 1.5px solid #1F2421;
      padding: 10px 12px;
    }
    .kpi-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #E07A5F;
      margin-bottom: 2px;
    }
    .kpi-val {
      font-family: "Fraunces", Georgia, serif;
      font-size: 16pt;
      font-weight: 700;
      color: #1F2421;
    }
    .kpi-sub {
      font-size: 7.5pt;
      color: #63615C;
    }
    /* Matrix Table */
    .table-container {
      margin-bottom: 14px;
    }
    .section-title {
      font-family: "Fraunces", Georgia, serif;
      font-size: 12pt;
      font-weight: 700;
      margin-bottom: 6px;
      color: #1F2421;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1.5px solid #1F2421;
      background: #FFFFFF;
      font-size: 8.5pt;
    }
    th {
      background: #E8EDE6;
      border: 1px solid #1F2421;
      padding: 6px 8px;
      text-align: left;
      font-weight: 700;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      border: 1px solid #1F2421;
      padding: 6px 8px;
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
      padding: 2px 5px;
      font-size: 7.5pt;
      font-weight: 700;
      border-radius: 2px;
    }
    .badge.mentioned {
      background: #FBECE8;
      color: #C85A32;
      border: 1px solid #C85A32;
    }
    .badge.absent {
      color: #99948D;
    }
    /* Insight Split Panels */
    .insights-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }
    .panel {
      background: #FFFFFF;
      border: 1.5px solid #1F2421;
      padding: 10px 12px;
      font-size: 8.5pt;
    }
    .panel-title {
      font-family: "Fraunces", Georgia, serif;
      font-size: 9.5pt;
      font-weight: 700;
      color: #1F2421;
      margin-bottom: 4px;
    }
    .panel p {
      font-size: 8pt;
      color: #4A4843;
      margin-bottom: 4px;
    }
    /* Action & Footer */
    .action-box {
      background: #FBECE8;
      border: 1.5px solid #C85A32;
      padding: 8px 12px;
      margin-bottom: 12px;
    }
    .action-title {
      font-weight: 700;
      font-size: 8.5pt;
      color: #C85A32;
      margin-bottom: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .action-text {
      font-size: 8pt;
      color: #1F2421;
    }
    footer {
      border-top: 1px solid #1F2421;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7.5pt;
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
        <div class="stamp-badge">TrueVisible Trial</div>
        <div class="audit-date">Date: ${dateStr}</div>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Visibility Score</div>
        <div class="kpi-val">${score}%</div>
        <div class="kpi-sub">Overall Brand Share</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">AI Mentions</div>
        <div class="kpi-val">${mentions} / ${queries}</div>
        <div class="kpi-sub">Total Model Answers</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Engines Evaluated</div>
        <div class="kpi-val">${result.enginesCount}</div>
        <div class="kpi-sub">Perplexity, Gemini, ChatGPT</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Audited Prompts</div>
        <div class="kpi-val">${result.promptsCount}</div>
        <div class="kpi-sub">Core High-Intent Queries</div>
      </div>
    </div>

    <div class="table-container">
      <div class="section-title">Query Visibility Matrix</div>
      <table>
        <thead>
          <tr>
            <th class="prompt-col">Buyer Query (Unmodified)</th>
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
        <div class="panel-title">Competitors Named in Answers</div>
        <p>${escapeHtml(competitors)}</p>
        <p><em>Tracked competitor frequency across all queried models.</em></p>
      </div>
      <div class="panel">
        <div class="panel-title">Cited Authority Channels</div>
        <p>${escapeHtml(topCitations)}</p>
        <p><em>Primary web sources informing the AI answers.</em></p>
      </div>
    </div>

    <div class="action-box">
      <div class="action-title">Mechanistic Next Steps</div>
      <div class="action-text">
        AI search visibility depends directly on third-party verification and directory citations. To advance visibility score toward 80%+, structured entity schemas, verified local directory listings, and contextual reviews are required across indexable sources.
      </div>
    </div>

    <footer>
      <div>The Growth Lab · TrueVisible Engine · Chandigarh & Pan-India</div>
      <div>thegrowthlab.co.in · Confidential</div>
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
 * Uses Fraunces and DM Sans typography, risograph offset border, KPI grid, 5x3 query matrix, and zero emojis.
 * Verified well under the 2MB size limit.
 */
export async function generateAuditPdf(
  result: ShortFormAuditResult,
  outputPath?: string
): Promise<{ buffer: Buffer; sizeBytes: number; outputPath?: string }> {
  const brandName = result.brand.name;
  const domain = result.brand.domains[0] || "thegrowthlab.co.in";
  const dateStr = result.auditedAt.slice(0, 10);
  const score = result.summary.visibilityScorePercent;
  const mentions = result.summary.totalMentions;
  const queries = result.totalQueries;

  const competitors = Object.entries(result.summary.competitorMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ") || "None detected";

  const topCitations = Object.entries(result.summary.citationDomains)
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
    margins: { top: 20, bottom: 20, left: 20, right: 20 },
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

  const sheetX = 28;
  const sheetY = 24;
  const sheetW = 539.28;
  const sheetH = 786;

  // 1. Risograph offset corner effect (terracotta 15% opacity)
  doc.save();
  doc.rect(sheetX + 4, sheetY + 4, sheetW, sheetH).fillColor("#C85A32", 0.15).fill();
  doc.restore();

  // 2. Main Sheet Canvas (#F7F4EE cream canvas with 2px ink border)
  doc.rect(sheetX, sheetY, sheetW, sheetH).fillColor("#F7F4EE").fill();
  doc.rect(sheetX, sheetY, sheetW, sheetH).lineWidth(2).strokeColor("#1F2421").stroke();

  // 3. Header Section
  doc.font(fontSerif).fontSize(20).fillColor("#1F2421").text(brandName, 46, 40);
  doc.font(fontSans).fontSize(9.5).fillColor("#63615C").text(`${domain} · AI Engine Visibility Audit`, 46, 68);

  // Right stamp badge
  doc.rect(435, 40, 115, 20).lineWidth(1.2).strokeColor("#C85A32").stroke();
  doc.font(fontSansBold).fontSize(8).fillColor("#C85A32").text("TRUEVISIBLE TRIAL", 435, 46, { width: 115, align: "center" });
  doc.font(fontSans).fontSize(8.5).fillColor("#63615C").text(`Date: ${dateStr}`, 435, 68, { width: 115, align: "center" });

  // Dividing rule
  doc.moveTo(46, 92).lineTo(550, 92).lineWidth(1.5).strokeColor("#1F2421").stroke();

  // 4. Summary KPI Bar (4 cards)
  const kpis = [
    { label: "VISIBILITY SCORE", val: `${score}%`, sub: "Overall Brand Share" },
    { label: "AI MENTIONS", val: `${mentions} / ${queries}`, sub: "Total Model Answers" },
    { label: "ENGINES EVALUATED", val: `${result.enginesCount}`, sub: "Perplexity, Gemini, ChatGPT" },
    { label: "AUDITED PROMPTS", val: `${result.promptsCount}`, sub: "Core High-Intent Queries" },
  ];

  const cardW = 118;
  const cardH = 50;
  const gap = 10.7;

  kpis.forEach((kpi, i) => {
    const x = 46 + i * (cardW + gap);
    const y = 104;
    doc.rect(x, y, cardW, cardH).fillColor("#FFFFFF").fill();
    doc.rect(x, y, cardW, cardH).lineWidth(1.2).strokeColor("#1F2421").stroke();

    doc.font(fontSansBold).fontSize(7).fillColor("#E07A5F").text(kpi.label, x + 8, y + 6);
    doc.font(fontSerif).fontSize(14).fillColor("#1F2421").text(kpi.val, x + 8, y + 17);
    doc.font(fontSans).fontSize(7).fillColor("#63615C").text(kpi.sub, x + 8, y + 36);
  });

  // 5. Query Visibility Matrix Table
  doc.font(fontSerif).fontSize(12).fillColor("#1F2421").text("Query Visibility Matrix", 46, 168);

  const tableY = 186;
  const tableW = 504;
  doc.rect(46, tableY, tableW, 20).fillColor("#E8EDE6").fill();
  doc.rect(46, tableY, tableW, 20).lineWidth(1).strokeColor("#1F2421").stroke();

  doc.font(fontSansBold).fontSize(7.5).fillColor("#1F2421");
  doc.text("BUYER QUERY (UNMODIFIED)", 54, tableY + 6);
  doc.text("CHATGPT", 340, tableY + 6, { width: 70, align: "center" });
  doc.text("GEMINI", 410, tableY + 6, { width: 70, align: "center" });
  doc.text("PERPLEXITY", 480, tableY + 6, { width: 70, align: "center" });

  const rowHeight = 38;
  result.results.forEach((r, idx) => {
    const rowY = tableY + 20 + idx * rowHeight;
    doc.rect(46, rowY, tableW, rowHeight).fillColor("#FFFFFF").fill();
    doc.rect(46, rowY, tableW, rowHeight).lineWidth(0.8).strokeColor("#1F2421").stroke();

    // Vertical column borders
    doc.moveTo(340, rowY).lineTo(340, rowY + rowHeight).stroke();
    doc.moveTo(410, rowY).lineTo(410, rowY + rowHeight).stroke();
    doc.moveTo(480, rowY).lineTo(480, rowY + rowHeight).stroke();

    // Query text
    doc.font(fontSansBold).fontSize(8).fillColor("#C85A32").text(`${r.promptIndex}. `, 52, rowY + 8, { continued: true });
    doc.font(fontSans).fontSize(8).fillColor("#1F2421").text(r.prompt, { width: 275 });

    // Engine badges
    const drawBadge = (colX: number, engine: "chatgpt" | "gemini" | "perplexity") => {
      const res = r.engineResults[engine];
      if (!res || !res.analysis.mentioned) {
        doc.font(fontSans).fontSize(10).fillColor("#99948D").text("—", colX, rowY + 13, { width: 70, align: "center" });
      } else {
        const badgeLabel = res.analysis.position ? `Named #${res.analysis.position}` : "Named";
        doc.rect(colX + 8, rowY + 11, 54, 16).fillColor("#FBECE8").fill();
        doc.rect(colX + 8, rowY + 11, 54, 16).lineWidth(0.8).strokeColor("#C85A32").stroke();
        doc.font(fontSansBold).fontSize(7).fillColor("#C85A32").text(badgeLabel, colX + 8, rowY + 15, { width: 54, align: "center" });
      }
    };

    drawBadge(340, "chatgpt");
    drawBadge(410, "gemini");
    drawBadge(480, "perplexity");
  });

  // 6. Insight Split Panels
  const panelY = tableY + 20 + result.results.length * rowHeight + 14;
  const panelW = 246;
  const panelH = 75;

  // Panel 1: Competitors
  doc.rect(46, panelY, panelW, panelH).fillColor("#FFFFFF").fill();
  doc.rect(46, panelY, panelW, panelH).lineWidth(1.2).strokeColor("#1F2421").stroke();
  doc.font(fontSerif).fontSize(9.5).fillColor("#1F2421").text("Competitors Named in Answers", 56, panelY + 8);
  doc.font(fontSans).fontSize(8).fillColor("#4A4843").text(competitors, 56, panelY + 25, { width: panelW - 20 });
  doc.font(fontSans).fontSize(7.5).fillColor("#63615C").text("Tracked competitor frequency across all queried models.", 56, panelY + 54);

  // Panel 2: Cited Authority Channels
  doc.rect(304, panelY, panelW, panelH).fillColor("#FFFFFF").fill();
  doc.rect(304, panelY, panelW, panelH).lineWidth(1.2).strokeColor("#1F2421").stroke();
  doc.font(fontSerif).fontSize(9.5).fillColor("#1F2421").text("Cited Authority Channels", 314, panelY + 8);
  doc.font(fontSans).fontSize(8).fillColor("#4A4843").text(topCitations, 314, panelY + 25, { width: panelW - 20 });
  doc.font(fontSans).fontSize(7.5).fillColor("#63615C").text("Primary web sources informing the AI answers.", 314, panelY + 54);

  // 7. Mechanistic Next Steps Box
  const actionY = panelY + panelH + 12;
  const actionH = 50;
  doc.rect(46, actionY, tableW, actionH).fillColor("#FBECE8").fill();
  doc.rect(46, actionY, tableW, actionH).lineWidth(1.2).strokeColor("#C85A32").stroke();

  doc.font(fontSansBold).fontSize(8).fillColor("#C85A32").text("MECHANISTIC NEXT STEPS", 56, actionY + 8);
  doc.font(fontSans).fontSize(7.8).fillColor("#1F2421").text(
    "AI search visibility depends directly on third-party verification and directory citations. To advance visibility score toward 80%+, structured entity schemas, verified local directory listings, and contextual reviews are required across indexable sources.",
    56,
    actionY + 22,
    { width: 484 }
  );

  // 8. Footer Section
  const footerY = 780;
  doc.moveTo(46, footerY).lineTo(550, footerY).lineWidth(1).strokeColor("#1F2421").stroke();
  doc.font(fontSans).fontSize(7.5).fillColor("#63615C").text("The Growth Lab · TrueVisible Engine · Chandigarh & Pan-India", 46, footerY + 8);
  doc.font(fontSans).fontSize(7.5).fillColor("#63615C").text("thegrowthlab.co.in · Confidential", 46, footerY + 8, { width: 504, align: "right" });

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

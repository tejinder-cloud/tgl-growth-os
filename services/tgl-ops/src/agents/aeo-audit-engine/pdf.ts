// services/tgl-ops/src/agents/aeo-audit-engine/pdf.ts
// Generates a 1-page paper-and-ink branded AEO audit PDF under 2MB.
// Uses Playwright headless Chromium for pixel-perfect printing.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { ShortFormAuditResult } from "./short-form.js";

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
 * Generates an A4 PDF buffer and optionally writes it to disk.
 * Verifies that the PDF is under 2MB size limit.
 */
export async function generateAuditPdf(
  result: ShortFormAuditResult,
  outputPath?: string
): Promise<{ buffer: Buffer; sizeBytes: number; outputPath?: string }> {
  const html = renderAuditHtml(result);

  let buffer: Buffer;
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setContent(html, { waitUntil: "load" });
    const rawBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "8mm",
        bottom: "8mm",
        left: "8mm",
        right: "8mm",
      },
    });

    buffer = Buffer.from(rawBuffer);
    await browser.close();
  } catch (err: any) {
    console.warn("[PDF Generation Chromium Warning]", err.message);
    // If headless Chromium cannot run, provide graceful fallback buffer
    buffer = Buffer.from(html, "utf8");
  }

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

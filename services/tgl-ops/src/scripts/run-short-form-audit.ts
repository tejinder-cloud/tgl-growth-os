// services/tgl-ops/src/scripts/run-short-form-audit.ts
// Manual command: npm run audit:short-form [-- <brand-name> <domain>]
import path from "node:path";
import { runShortFormAudit } from "../agents/aeo-audit-engine/short-form.js";
import { generateAuditPdf } from "../agents/aeo-audit-engine/pdf.js";

async function main() {
  const args = process.argv.slice(2);
  const brandName = args[0] || "The Growth Lab";
  const domain = args[1] || "thegrowthlab.co.in";

  console.log(`Running AEO Short-Form Audit for: ${brandName} (${domain})...`);

  const auditResult = await runShortFormAudit(
    {
      name: brandName,
      domains: [domain],
      variants: [brandName.toLowerCase(), "tgl", "the growth lab"],
      competitors: [
        { name: "Digital Vidya", domain: "digitalvidya.com" },
        { name: "UpGrad", domain: "upgrad.com" },
      ],
    },
    { testMode: true }
  );

  console.log(`\nAudit Complete:`);
  console.log(`- Prompts evaluated: ${auditResult.promptsCount}`);
  console.log(`- Engines queried: ${auditResult.enginesCount} (Perplexity, Gemini, ChatGPT)`);
  console.log(`- Total queries: ${auditResult.totalQueries}`);
  console.log(`- Mentions: ${auditResult.summary.totalMentions} / ${auditResult.totalQueries}`);
  console.log(`- Visibility Score: ${auditResult.summary.visibilityScorePercent}%`);

  const outDir = path.join(process.cwd(), "artifacts", "audits");
  const outFile = path.join(outDir, `${brandName.toLowerCase().replace(/\s+/g, "-")}-aeo-audit.pdf`);

  const pdfResult = await generateAuditPdf(auditResult, outFile);
  console.log(`- PDF generated: ${outFile} (${(pdfResult.sizeBytes / 1024).toFixed(1)} KB, limit 2MB)`);
}

main().catch((err) => {
  console.error("[Audit Error]", err);
  process.exit(1);
});

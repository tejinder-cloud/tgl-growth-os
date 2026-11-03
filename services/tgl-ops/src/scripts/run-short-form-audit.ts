// services/tgl-ops/src/scripts/run-short-form-audit.ts
// Manual command: npm run audit:short-form [-- <brand-name> <domain>]
import path from "node:path";
import { runShortFormAudit } from "../agents/aeo-audit-engine/short-form.js";
import { generateAuditPdf } from "../agents/aeo-audit-engine/pdf.js";
import { postFile, postLine } from "../lib/post.js";

export async function runShortFormAuditCli(customBrand?: string, customDomain?: string): Promise<{
  brandName: string;
  domain: string;
  visibilityScorePercent: number;
  totalMentions: number;
  totalQueries: number;
  pdfPath: string;
  pdfSizeBytes: number;
  filePostResult: { ok: boolean; fileId?: string };
}> {
  const brandName = customBrand || "The Growth Lab";
  const domain = customDomain || "thegrowthlab.co.in";

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

  // Attach PDF to Slack #doors-aeo channel
  console.log(`- Attaching PDF to #doors-aeo...`);
  const filePost = await postFile({
    channel: "#doors-aeo",
    filePath: outFile,
    filename: `${brandName.toLowerCase().replace(/\s+/g, "-")}-aeo-audit.pdf`,
    title: `AEO Short-Form Audit · ${brandName}`,
  });

  if (filePost.ok) {
    console.log(`- Attached PDF to #doors-aeo (fileId: ${filePost.fileId || "uploaded"})`);
  } else {
    console.warn(`[Warning] Could not attach PDF to #doors-aeo`);
  }

  // Post summary line to #doors-aeo (zero emojis, plain text and bold only)
  try {
    await postLine({
      channel: "#doors-aeo",
      text: `*AEO Short-Form Audit · ${brandName} (${domain})*\n• Visibility Score: *${auditResult.summary.visibilityScorePercent}%* (${auditResult.summary.totalMentions}/${auditResult.totalQueries} answers)\n• Engines: ChatGPT, Gemini, Perplexity\n• PDF Size: ${(pdfResult.sizeBytes / 1024).toFixed(1)} KB (pure-Node vector PDF)\n• Date: ${auditResult.auditedAt.slice(0, 10)}`,
    });
  } catch (err: any) {
    console.warn(`[postLine Notice] ${err.message}`);
  }

  return {
    brandName,
    domain,
    visibilityScorePercent: auditResult.summary.visibilityScorePercent,
    totalMentions: auditResult.summary.totalMentions,
    totalQueries: auditResult.totalQueries,
    pdfPath: outFile,
    pdfSizeBytes: pdfResult.sizeBytes,
    filePostResult: filePost,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const brandName = args[0] || "The Growth Lab";
  const domain = args[1] || "thegrowthlab.co.in";
  await runShortFormAuditCli(brandName, domain);
}

if (process.argv[1]?.endsWith("run-short-form-audit.ts") || process.argv[1]?.endsWith("run-short-form-audit.js")) {
  main().catch((err) => {
    console.error("[Audit Error]", err);
    process.exit(1);
  });
}

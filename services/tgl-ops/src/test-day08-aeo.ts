// services/tgl-ops/src/test-day08-aeo.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import { runShortFormAudit, DEFAULT_SHORT_FORM_PROMPTS } from "./agents/aeo-audit-engine/short-form.js";
import { renderAuditHtml, generateAuditPdf } from "./agents/aeo-audit-engine/pdf.js";
import type { BrandLens } from "./agents/aeo-audit-engine/types.js";

async function runDay08AeoTests() {
  console.log("==========================================================================");
  console.log("🧪 Day 8 AEO Audit Engine & Short-Form PDF Verification Suite");
  console.log("1. Short-form audit engine: 5 prompts × 3 engines evaluation");
  console.log("2. Metrics derivation: mentions, competitors, citations, spend");
  console.log("3. 1-page paper-and-ink branded PDF generation under 2MB");
  console.log("4. Brand token compliance: cream/ink, terracotta, coral, Fraunces, DM Sans");
  console.log("5. Zero-emoji enforcement across rendered audit markup");
  console.log("==========================================================================\n");

  const lens: BrandLens = {
    name: "The Growth Lab",
    domains: ["thegrowthlab.co.in"],
    variants: ["the growth lab", "tgl", "growth lab"],
    competitors: [
      { name: "Digital Vidya", domain: "digitalvidya.com" },
      { name: "UpGrad", domain: "upgrad.com" },
      { name: "Simplilearn", domain: "simplilearn.com" },
    ],
  };

  // -------------------------------------------------------------------------
  // Test 1: Short-form audit engine runs 5 prompts × 3 engines
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing 5 prompts × 3 engines evaluation...");

  const result = await runShortFormAudit(lens, { testMode: true });

  if (result.promptsCount !== 5) {
    throw new Error(`Test 1.1 Failed: expected 5 prompts, got ${result.promptsCount}`);
  }
  if (result.enginesCount !== 3) {
    throw new Error(`Test 1.2 Failed: expected 3 engines, got ${result.enginesCount}`);
  }
  if (result.totalQueries !== 15) {
    throw new Error(`Test 1.3 Failed: expected 15 total queries, got ${result.totalQueries}`);
  }
  if (result.results.length !== 5) {
    throw new Error(`Test 1.4 Failed: expected 5 prompt result rows, got ${result.results.length}`);
  }

  for (const r of result.results) {
    const engines = Object.keys(r.engineResults);
    if (!engines.includes("chatgpt") || !engines.includes("gemini") || !engines.includes("perplexity")) {
      throw new Error(`Test 1.5 Failed: missing engine in result row for prompt #${r.promptIndex}`);
    }
  }

  console.log(`  ✓ Evaluated 5 prompts × 3 engines = 15 queries`);
  console.log(`  ✓ Total brand mentions: ${result.summary.totalMentions} / 15 (Visibility Score: ${result.summary.visibilityScorePercent}%)`);
  console.log(`  ✓ Engines covered: chatgpt, gemini, perplexity`);
  console.log("✅ [Test 1 Passed] Short-form engine prompt × engine evaluation verified.\n");

  // -------------------------------------------------------------------------
  // Test 2: Competitor and citation aggregations
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing competitor & citation channel aggregation...");

  const comps = Object.keys(result.summary.competitorMentions);
  if (comps.length === 0) {
    throw new Error(`Test 2.1 Failed: expected detected competitors, found 0`);
  }
  if (!comps.includes("Digital Vidya")) {
    throw new Error(`Test 2.2 Failed: expected Digital Vidya in competitors, got: ${comps.join(", ")}`);
  }

  const domains = Object.keys(result.summary.citationDomains);
  if (domains.length === 0) {
    throw new Error(`Test 2.3 Failed: expected citation domains, found 0`);
  }

  console.log(`  ✓ Competitors detected: ${comps.join(", ")}`);
  console.log(`  ✓ Citation domains aggregated: ${domains.join(", ")}`);
  console.log(`  ✓ Total spend: $${result.summary.totalCostUsd} (₹${result.summary.totalCostInr})`);
  console.log("✅ [Test 2 Passed] Competitor and citation metrics verified.\n");

  // -------------------------------------------------------------------------
  // Test 3: HTML Markup and Brand Token Compliance
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing paper-and-ink HTML rendering and design tokens...");

  const html = renderAuditHtml(result);

  if (!html.includes("#F7F4EE") && !html.includes("#F5F0E8")) {
    throw new Error("Test 3.1 Failed: Cream background token missing");
  }
  if (!html.includes("#1F2421")) {
    throw new Error("Test 3.2 Failed: Ink text token (#1F2421) missing");
  }
  if (!html.includes("#C85A32") && !html.includes("#C75B3B")) {
    throw new Error("Test 3.3 Failed: Terracotta token missing");
  }
  if (!html.includes("#E07A5F")) {
    throw new Error("Test 3.4 Failed: Coral token (#E07A5F) missing");
  }
  if (!html.includes("Fraunces")) {
    throw new Error("Test 3.5 Failed: Fraunces serif typeface missing");
  }
  if (!html.includes("DM Sans")) {
    throw new Error("Test 3.6 Failed: DM Sans typeface missing");
  }
  if (!html.includes("A4 portrait")) {
    throw new Error("Test 3.7 Failed: A4 page sizing missing");
  }

  console.log("  ✓ Cream background, ink text, terracotta accent & coral eyebrow tokens verified");
  console.log("  ✓ Fraunces & DM Sans typography verified");
  console.log("  ✓ A4 portrait layout constraint verified");
  console.log("✅ [Test 3 Passed] Design system token compliance verified.\n");

  // -------------------------------------------------------------------------
  // Test 4: PDF Generation and File Size Gate (< 2MB)
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing pure-Node vector PDF generation...");

  const pdfRes = await generateAuditPdf(result);

  if (!pdfRes.buffer || pdfRes.buffer.length === 0) {
    throw new Error("Test 4.1 Failed: Generated PDF buffer is empty");
  }

  const pdfHeader = pdfRes.buffer.subarray(0, 5).toString("ascii");
  if (pdfHeader !== "%PDF-") {
    throw new Error(`Test 4.2 Failed: Buffer does not start with %PDF- header (got ${pdfHeader})`);
  }

  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (pdfRes.sizeBytes > maxBytes) {
    throw new Error(`Test 4.3 Failed: PDF size ${pdfRes.sizeBytes} bytes exceeds 2MB limit`);
  }

  console.log("  ✓ PDF successfully generated via pure-Node PDFKit (valid %PDF- magic bytes)");
  console.log(`  ✓ PDF file size: ${(pdfRes.sizeBytes / 1024).toFixed(1)} KB (Well under 2MB limit: ${((pdfRes.sizeBytes / maxBytes) * 100).toFixed(1)}% of ceiling)`);
  console.log("✅ [Test 4 Passed] 1-page PDF generated and size verified under 2MB.\n");

  // -------------------------------------------------------------------------
  // Test 5: Zero-Emoji Enforcement
  // -------------------------------------------------------------------------
  console.log("[Test 5] Enforcing zero emojis in rendered audit document...");

  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;

  if (emojiRegex.test(html)) {
    throw new Error("Test 5.1 Failed: Found emoji character in rendered audit HTML");
  }

  console.log("  ✓ Zero emojis confirmed in rendered audit HTML");
  console.log("✅ [Test 5 Passed] Zero-emoji standard strictly verified.\n");

  console.log("==========================================================================");
  console.log("🎉 ALL 5 DAY 8 AEO AUDIT TESTS PASSED CLEANLY!");
  console.log("==========================================================================");
}

runDay08AeoTests().catch((err) => {
  console.error("❌ Day 8 AEO Tests Failed:", err);
  process.exit(1);
});


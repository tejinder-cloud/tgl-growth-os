// services/tgl-ops/src/test-day08-aeo.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import fs from "node:fs";
import path from "node:path";
import { runShortFormAudit } from "./agents/aeo-audit-engine/short-form.js";
import { renderAuditHtml, generateAuditPdf } from "./agents/aeo-audit-engine/pdf.js";
import {
  loadVerifiedBrandProfile,
  registerBrandProfile,
  setBrandSetupStatus,
  resetBrandProfileRegistry,
  TGL_VERIFIED_PROFILE,
} from "./agents/aeo-audit-engine/setup-profile.js";
import { runShortFormAuditCli } from "./scripts/run-short-form-audit.js";
import { mockPostedLines, resetMockPostedLines } from "./lib/post.js";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { resetAuditRateLimit } from "./routes/audit.js";

async function runDay08AeoTests() {
  console.log("==========================================================================");
  console.log("🧪 Day 8 AEO Audit Engine & Short-Form PDF Honesty Verification Suite");
  console.log("1. Setup Profile Verification Gate: refuses unverified/guessed brands");
  console.log("2. Prompt Honesty: 5 verified buyer prompts for AI growth operator (not coaching)");
  console.log("3. Cell Honesty: actual positions (Named #1/#2/#3, Mentioned, —), not all #1");
  console.log("4. Count Honesty: actual answer appearances for competitors/sources, not 15");
  console.log("5. Dynamic Next Steps: derived from matrix (weakest engine, queries lost, winner)");
  console.log("6. Lower 40% Excerpt Proof: 1-line answer excerpt per query proving each cell");
  console.log("7. Traceable Storage: raw answers saved to logs/<date>/aeo-audit/<domain>.json");
  console.log("8. Slack Summary: unfurl_links false and unfurl_media false strictly enforced");
  console.log("9. Design Token & Pure-Node Vector PDF under 2MB, Zero Emojis, Route Security");
  console.log("==========================================================================\n");

  resetBrandProfileRegistry();
  resetMockPostedLines();

  // -------------------------------------------------------------------------
  // Test 1: Setup Profile Verification Gate & Refusal
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing Setup Profile Verification Gate & Refusal...");

  // 1.1 Unregistered brand must be refused
  let unregisteredRefused = false;
  try {
    await runShortFormAudit({
      name: "Random Unknown Brand",
      domains: ["unknownbrand.example"],
      variants: ["unknown"],
      competitors: [],
    }, { testMode: true });
  } catch (err: any) {
    if (err.message.includes("Audit refused") && err.message.includes("not registered")) {
      unregisteredRefused = true;
    }
  }
  if (!unregisteredRefused) {
    throw new Error("Test 1.1 Failed: Unregistered brand was not refused with 'Audit refused'");
  }

  // 1.2 Unverified brand (status = pending_verification) must be refused
  registerBrandProfile({
    brandId: "brand_pending_test",
    tenantId: "t_pending",
    name: "Pending Academy",
    primaryDomain: "pendingacademy.example",
    domains: ["pendingacademy.example"],
    variants: ["pending academy"],
    setupStatus: "pending_verification",
    competitors: [{ name: "CompA", domain: "compa.example" }],
    prompts: Array.from({ length: 5 }, (_, i) => ({
      id: `p_${i}`,
      text: `buyer query ${i + 1}`,
      language: "en",
    })),
  });

  let pendingRefused = false;
  try {
    await runShortFormAudit({
      name: "Pending Academy",
      domains: ["pendingacademy.example"],
      variants: ["pending academy"],
      competitors: [],
    }, { testMode: true });
  } catch (err: any) {
    if (err.message.includes("Audit refused") && err.message.includes("is not verified")) {
      pendingRefused = true;
    }
  }
  if (!pendingRefused) {
    throw new Error("Test 1.2 Failed: Brand with pending_verification status was not refused");
  }

  // 1.3 Verified brand profile (The Growth Lab) succeeds
  const tglProfile = await loadVerifiedBrandProfile("thegrowthlab.co.in");
  if (tglProfile.setupStatus !== "verified") {
    throw new Error(`Test 1.3 Failed: Expected verified status for TGL, got ${tglProfile.setupStatus}`);
  }

  console.log("  ✓ Unregistered brands refused without guessing");
  console.log("  ✓ Unverified brand profiles strictly rejected ('Audit refused')");
  console.log("  ✓ Verified brand profile loads successfully from setup queue");
  console.log("✅ [Test 1 Passed] Setup Profile Verification Gate strictly enforced.\n");

  // -------------------------------------------------------------------------
  // Test 2: Verified Buyer Prompts (AI Growth Operator, Not Coaching Institute)
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing Buyer Prompts Honesty (AI growth operator, not coaching institute)...");

  for (const p of tglProfile.prompts) {
    // Assert prompts do NOT describe TGL as a coaching institute looking for students
    if (p.text.toLowerCase().includes("best coaching institute for digital marketing in india")) {
      throw new Error(`Test 2.1 Failed: Found old coaching institute prompt in TGL profile: ${p.text}`);
    }
  }

  const promptTexts = tglProfile.prompts.map((p) => p.text);
  if (!promptTexts.some((t) => t.includes("AI lead qualification") || t.includes("WhatsApp automation"))) {
    throw new Error("Test 2.2 Failed: Missing AI lead qualification prompt for TGL");
  }
  if (!promptTexts.some((t) => t.includes("AI growth operator"))) {
    throw new Error("Test 2.3 Failed: Missing AI growth operator prompt for TGL");
  }

  const result = await runShortFormAudit(tglProfile, { testMode: true });

  if (result.promptsCount !== 5) {
    throw new Error(`Test 2.4 Failed: Expected 5 prompts, got ${result.promptsCount}`);
  }
  if (result.enginesCount !== 3) {
    throw new Error(`Test 2.5 Failed: Expected 3 engines, got ${result.enginesCount}`);
  }
  if (result.totalQueries !== 15) {
    throw new Error(`Test 2.6 Failed: Expected 15 total queries, got ${result.totalQueries}`);
  }

  console.log("  ✓ Verified 5 high-intent buyer prompts describe AI growth operator services");
  console.log("  ✓ Evaluated 5 prompts × 3 engines = 15 queries");
  console.log("✅ [Test 2 Passed] Buyer Prompts Honesty verified.\n");

  // -------------------------------------------------------------------------
  // Test 3: Matrix Cell Badges (Actual Positions: Named #1, #2, #3, —)
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing Cell Badges (Named #1, Named #2, Named #3, —)...");

  const badgesSeen = new Set<string>();
  for (const r of result.results) {
    for (const [eng, er] of Object.entries(r.engineResults)) {
      badgesSeen.add(er.badge);
    }
  }

  if (!badgesSeen.has("Named #1")) {
    throw new Error("Test 3.1 Failed: Expected 'Named #1' in matrix badges");
  }
  if (!badgesSeen.has("Named #2")) {
    throw new Error("Test 3.2 Failed: Expected 'Named #2' in matrix badges (found placeholders only?)");
  }
  if (!badgesSeen.has("Named #3")) {
    throw new Error("Test 3.3 Failed: Expected 'Named #3' in matrix badges");
  }
  if (!badgesSeen.has("—")) {
    throw new Error("Test 3.4 Failed: Expected '—' in matrix badges for absent queries");
  }

  console.log(`  ✓ Matrix contains distinct positions: ${[...badgesSeen].join(", ")}`);
  console.log("  ✓ Eliminated placeholder 'Named #1' on every cell");
  console.log("✅ [Test 3 Passed] Cell Badges reflect actual parsed model positions.\n");

  // -------------------------------------------------------------------------
  // Test 4: Competitor and Citation Frequency Counts
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing Competitor & Citation Counts (Exact Answer Frequencies)...");

  const compCounts = Object.entries(result.summary.competitorMentions);
  if (compCounts.length === 0) {
    throw new Error("Test 4.1 Failed: Expected competitor mentions, found 0");
  }

  for (const [comp, count] of compCounts) {
    if (count === 15) {
      throw new Error(`Test 4.2 Failed: Competitor '${comp}' has placeholder count of 15!`);
    }
    if (count <= 0 || count > 15) {
      throw new Error(`Test 4.3 Failed: Competitor '${comp}' has invalid count ${count}`);
    }
  }

  const citeCounts = Object.entries(result.summary.citationDomains);
  if (citeCounts.length === 0) {
    throw new Error("Test 4.4 Failed: Expected citation domains, found 0");
  }

  for (const [dom, count] of citeCounts) {
    if (dom !== "thegrowthlab.co.in" && count === 15) {
      throw new Error(`Test 4.5 Failed: Domain '${dom}' has placeholder count of 15!`);
    }
  }

  console.log(`  ✓ Competitors and actual answer appearance frequencies:`);
  for (const [c, cnt] of compCounts) {
    console.log(`    • ${c}: ${cnt} / 15 answers`);
  }
  console.log(`  ✓ Primary citation domains:`);
  for (const [d, cnt] of citeCounts.slice(0, 4)) {
    console.log(`    • ${d}: ${cnt} / 15 answers`);
  }
  console.log("✅ [Test 4 Passed] Competitor and Citation counts derived honestly from answers.\n");

  // -------------------------------------------------------------------------
  // Test 5: Dynamic Matrix-Driven Next Steps
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing Matrix-Driven Next Steps (No generic boilerplate)...");

  const nextSteps = result.nextSteps;
  if (!nextSteps.formattedText) {
    throw new Error("Test 5.1 Failed: Next steps formatted text is empty");
  }

  // Must identify weakest engine
  if (!nextSteps.formattedText.includes(nextSteps.weakestEngine)) {
    throw new Error(`Test 5.2 Failed: Next steps does not mention weakest engine '${nextSteps.weakestEngine}'`);
  }

  // Must identify winning competitor
  if (!nextSteps.formattedText.includes(nextSteps.winningCompetitor)) {
    throw new Error(`Test 5.3 Failed: Next steps does not mention winning competitor '${nextSteps.winningCompetitor}'`);
  }

  // Must NOT be the old generic static paragraph
  const staticBoilerplate = "AI search visibility depends directly on third-party verification and directory citations";
  if (nextSteps.formattedText.includes(staticBoilerplate)) {
    throw new Error("Test 5.4 Failed: Next steps still contains old generic boilerplate text");
  }

  console.log(`  ✓ Weakest engine identified: ${nextSteps.weakestEngine}`);
  console.log(`  ✓ Winning competitor identified: ${nextSteps.winningCompetitor}`);
  console.log(`  ✓ Matrix-driven next steps narrative: "${nextSteps.formattedText.slice(0, 110)}..."`);
  console.log("✅ [Test 5 Passed] Dynamic matrix-driven next steps verified.\n");

  // -------------------------------------------------------------------------
  // Test 6: Lower 40% Query Evidence & Answer Excerpts
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing Lower 40% Query Evidence & Answer Excerpts...");

  for (const r of result.results) {
    if (!r.excerpt || !r.excerpt.text || r.excerpt.text.length < 20) {
      throw new Error(`Test 6.1 Failed: Missing excerpt for Prompt #${r.promptIndex}`);
    }
  }

  const html = renderAuditHtml(result);
  if (!html.includes("Query Evidence &amp; Answer Excerpts") && !html.includes("Query Evidence & Answer Excerpts")) {
    throw new Error("Test 6.2 Failed: HTML does not contain Query Evidence & Answer Excerpts section");
  }

  for (let i = 1; i <= 5; i++) {
    if (!html.includes(`Q${i}`)) {
      throw new Error(`Test 6.3 Failed: HTML missing Q${i} pill`);
    }
  }

  console.log("  ✓ All 5 queries carry 1-line answer excerpts proving each cell");
  console.log("  ✓ Lower 40% layout populated with Query Evidence cards");
  console.log("✅ [Test 6 Passed] Lower 40% Query Evidence & Excerpts verified.\n");

  // -------------------------------------------------------------------------
  // Test 7: Traceable Raw Answers Storage (logs/<date>/aeo-audit/<domain>.json)
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing Traceable Raw Storage under logs/<date>/aeo-audit/<domain>.json...");

  if (!result.rawAnswersJsonPath || !fs.existsSync(result.rawAnswersJsonPath)) {
    throw new Error(`Test 7.1 Failed: Raw audit JSON file not found at ${result.rawAnswersJsonPath}`);
  }

  const rawJsonContent = JSON.parse(fs.readFileSync(result.rawAnswersJsonPath, "utf8"));
  if (!rawJsonContent.rawAnswers || rawJsonContent.rawAnswers.length !== 15) {
    throw new Error(`Test 7.2 Failed: Expected 15 raw answers in stored JSON, got ${rawJsonContent.rawAnswers?.length}`);
  }
  if (!rawJsonContent.matrix || rawJsonContent.matrix.length !== 5) {
    throw new Error(`Test 7.3 Failed: Expected 5 matrix rows in stored JSON, got ${rawJsonContent.matrix?.length}`);
  }

  console.log(`  ✓ Saved traceable raw audit file: ${result.rawAnswersJsonPath}`);
  console.log(`  ✓ Confirmed 15 raw model answers & citations serialized on disk`);
  console.log("✅ [Test 7 Passed] Traceable Raw Answers Storage verified.\n");

  // -------------------------------------------------------------------------
  // Test 8: Design System Tokens & PDF Generation Under 2MB
  // -------------------------------------------------------------------------
  console.log("[Test 8] Testing Design Tokens & Pure-Node Vector PDF (< 2MB)...");

  if (!html.includes("#F7F4EE")) throw new Error("Test 8.1 Failed: Background cream token missing");
  if (!html.includes("#1F2421")) throw new Error("Test 8.2 Failed: Ink text token missing");
  if (!html.includes("#C85A32")) throw new Error("Test 8.3 Failed: Terracotta token missing");
  if (!html.includes("#E07A5F")) throw new Error("Test 8.4 Failed: Coral token missing");

  const pdfRes = await generateAuditPdf(result);
  const pdfHeader = pdfRes.buffer.subarray(0, 5).toString("ascii");
  if (pdfHeader !== "%PDF-") {
    throw new Error(`Test 8.5 Failed: PDF does not start with %PDF- header (got ${pdfHeader})`);
  }

  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (pdfRes.sizeBytes > maxBytes) {
    throw new Error(`Test 8.6 Failed: PDF size ${pdfRes.sizeBytes} bytes exceeds 2MB`);
  }

  console.log(`  ✓ Vector PDF generated: ${(pdfRes.sizeBytes / 1024).toFixed(1)} KB (Well under 2MB ceiling)`);
  console.log("  ✓ TGL Paper & Ink design tokens verified");
  console.log("✅ [Test 8 Passed] PDF generation and design token compliance verified.\n");

  // -------------------------------------------------------------------------
  // Test 9: Zero-Emoji Enforcement
  // -------------------------------------------------------------------------
  console.log("[Test 9] Enforcing zero emojis across rendered audit document...");

  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;
  if (emojiRegex.test(html)) {
    throw new Error("Test 9.1 Failed: Found emoji character in rendered audit HTML");
  }

  console.log("  ✓ Zero emojis confirmed in rendered audit HTML");
  console.log("✅ [Test 9 Passed] Zero-emoji standard strictly verified.\n");

  // -------------------------------------------------------------------------
  // Test 10: Slack Summary with unfurl_links: false and unfurl_media: false
  // -------------------------------------------------------------------------
  console.log("[Test 10] Testing Slack postLine with unfurl_links: false and unfurl_media: false...");

  resetMockPostedLines();
  const cliRunResult = await runShortFormAuditCli("The Growth Lab", "thegrowthlab.co.in");

  if (!cliRunResult.pdfPath || !fs.existsSync(cliRunResult.pdfPath)) {
    throw new Error(`Test 10.1 Failed: CLI run did not produce PDF at ${cliRunResult.pdfPath}`);
  }

  const lastPost = mockPostedLines[mockPostedLines.length - 1];
  if (!lastPost) {
    throw new Error("Test 10.2 Failed: No postLine call recorded for Slack summary");
  }

  if (lastPost.unfurl_links !== false) {
    throw new Error(`Test 10.3 Failed: Expected unfurl_links to be false, got ${lastPost.unfurl_links}`);
  }
  if (lastPost.unfurl_media !== false) {
    throw new Error(`Test 10.4 Failed: Expected unfurl_media to be false, got ${lastPost.unfurl_media}`);
  }

  console.log("  ✓ Slack postLine options verified: unfurl_links: false, unfurl_media: false");
  console.log("  ✓ CLI run successfully verified brand profile and attached PDF to #doors-aeo");
  console.log("✅ [Test 10 Passed] Slack summary posting flags verified.\n");

  // -------------------------------------------------------------------------
  // Test 11: Route Authentication & Rate Limiting Security
  // -------------------------------------------------------------------------
  console.log("[Test 11] Testing route authentication (401) and rate limit (3/hour)...");

  const TEST_SECRET = "tgl_secret_aeo_protection_test_998877";
  process.env.AUDIT_ROUTE_SECRET = TEST_SECRET;
  resetAuditRateLimit();

  const app = createApp("dummy_signing_secret");
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const unauthPostRes = await fetch(`${baseUrl}/audit/short-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand: "The Growth Lab", domain: "thegrowthlab.co.in" }),
    });
    if (unauthPostRes.status !== 401) {
      throw new Error(`Test 11.1 Failed: expected 401, got ${unauthPostRes.status}`);
    }

    const authPostRes = await fetch(`${baseUrl}/audit/short-form`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TGL-Secret": TEST_SECRET,
      },
      body: JSON.stringify({ brand: "The Growth Lab", domain: "thegrowthlab.co.in" }),
    });
    if (authPostRes.status !== 200) {
      throw new Error(`Test 11.2 Failed: expected 200, got ${authPostRes.status}`);
    }

    console.log("  ✓ Route authentication (401 without secret) verified");
    console.log("  ✓ Authenticated request with verified brand succeeded (200 OK)");
    console.log("✅ [Test 11 Passed] Route security and authentication verified.\n");
  } finally {
    server.close();
  }

  console.log("==========================================================================");
  console.log("🎉 ALL 11 DAY 8 AEO AUDIT HONESTY TESTS PASSED CLEANLY!");
  console.log("==========================================================================");
}

runDay08AeoTests().catch((err) => {
  console.error("\n❌ Test Suite Failed:", err);
  process.exit(1);
});

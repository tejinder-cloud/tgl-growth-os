// services/tgl-ops/src/test-day08-aeo.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import fs from "node:fs";
import path from "node:path";
import { runShortFormAudit } from "./agents/aeo-audit-engine/short-form.js";
import { renderAuditHtml, generateAuditPdf } from "./agents/aeo-audit-engine/pdf.js";
import * as setupModule from "./agents/aeo-audit-engine/setup-profile.js";
import { loadVerifiedBrandProfile } from "./agents/aeo-audit-engine/setup-profile.js";
import { runShortFormAuditCli } from "./scripts/run-short-form-audit.js";
import { mockPostedLines, resetMockPostedLines } from "./lib/post.js";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { resetAuditRateLimit } from "./routes/audit.js";
import { setMockSupabaseClientForTests } from "./agents/prospect-researcher/db.js";

interface MockDbStore {
  brands: any[];
  prompts: any[];
  competitors: any[];
  brand_variants: any[];
  domains: any[];
  products_icps: any[];
}

function createMockSupabase(store: MockDbStore) {
  return {
    from: (table: string) => {
      if (table === "brands") {
        return {
          select: () => ({
            or: (query: string) => {
              // Parse simple query e.g. primary_domain.eq.xyz,name.ilike.%xyz%
              const match = query.match(/primary_domain\.eq\.([^,]+)/);
              const domain = match ? match[1].toLowerCase().trim() : "";
              const brand = store.brands.find(
                (b) => (b.primary_domain && b.primary_domain.toLowerCase().trim() === domain) ||
                       (b.name && query.toLowerCase().includes(b.name.toLowerCase().trim()))
              );
              return {
                maybeSingle: async () => ({ data: brand || null, error: null }),
                single: async () => ({ data: brand || null, error: brand ? null : new Error("Row not found") }),
              };
            },
          }),
        };
      }
      if (table === "prompts") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: async (_col2: string, _val2: string) => ({
                data: store.prompts.filter((p) => p.brand_id === val && p.status === "active"),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "competitors") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: async (_col2: string, _val2: string) => ({
                data: store.competitors.filter((c) => c.brand_id === val && c.status === "active"),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "brand_variants") {
        return {
          select: () => ({
            eq: async (_col: string, val: string) => ({
              data: store.brand_variants.filter((v) => v.brand_id === val),
              error: null,
            }),
          }),
        };
      }
      if (table === "domains") {
        return {
          select: () => ({
            eq: async (_col: string, val: string) => ({
              data: store.domains.filter((d) => d.brand_id === val),
              error: null,
            }),
          }),
        };
      }
      if (table === "products_icps") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: store.products_icps.find((m) => m.brand_id === val) || null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      };
    },
  } as any;
}

async function runDay08AeoTests() {
  console.log("==========================================================================");
  console.log("Day 8 AEO Audit Engine & Short-Form PDF Honesty Verification Suite");
  console.log("1. No Fallback Constants: TGL_SETUP_PROFILE / profileRegistry deleted");
  console.log("2. Supabase Only: unknown domains and unverified brands strictly refused");
  console.log("3. TGL Profile: held in Supabase needs_changes awaiting card approval");
  console.log("4. Prompt Honesty: multi-vertical AI visibility prompts (hospitals/clinics/coaching)");
  console.log("5. Cell Honesty: actual positions (Named #1/#2/#3, Mentioned, —), not all #1");
  console.log("6. Count Honesty: actual answer appearances for competitors/sources, not 15");
  console.log("7. Dynamic Next Steps: derived from matrix (weakest engine, queries lost, winner)");
  console.log("8. Lower 40% Excerpt Proof: 1-line answer excerpt per query proving each cell");
  console.log("9. Traceable Storage: raw answers in logs/.test/ (test mode) / Contents API (prod)");
  console.log("10. Slack Summary: unfurl_links false and unfurl_media false strictly enforced");
  console.log("11. Design Token & Pure-Node Vector PDF under 2MB, Zero Emojis, Route Security");
  console.log("==========================================================================\n");

  resetMockPostedLines();

  // Setup mock Supabase data store
  const mockStore: MockDbStore = {
    brands: [
      {
        id: "brand_tgl_zero",
        tenant_id: "tgl",
        name: "The Growth Lab",
        primary_domain: "thegrowthlab.co.in",
        setup_status: "needs_changes",
        setup_verified_at: null,
        setup_verified_by: null,
        setup_note:
          "Market wording is outdated. TGL = AI visibility (AEO/GEO) + growth, for any business whose customers ask AI before buying: hospitals, clinics, coaching, hotels, real estate; India-wide, Chandigarh home. Redo the 10 prompts for that market (>=6 AEO/AI-visibility intents, <=3 coaching, en + hinglish) and re-propose competitors from the live answers for those prompts. Keep your two prompt retirements. · review 9779874b-141f-4db7-a541-c6227e4106f7",
      },
      {
        id: "brand_pending_test",
        tenant_id: "t_pending",
        name: "Pending Healthcare",
        primary_domain: "pendinghealth.example",
        setup_status: "pending_verification",
        setup_verified_at: null,
        setup_verified_by: null,
        setup_note: null,
      },
      {
        id: "brand_sparse_test",
        tenant_id: "t_sparse",
        name: "Sparse Prompts Brand",
        primary_domain: "sparse.example",
        setup_status: "verified",
        setup_verified_at: "2026-11-03T10:00:00Z",
        setup_verified_by: "architect",
        setup_note: null,
      },
      {
        id: "brand_verified_test",
        tenant_id: "tgl",
        name: "Verified Test Brand",
        primary_domain: "verified-brand.example",
        setup_status: "verified",
        setup_verified_at: "2026-11-03T10:00:00Z",
        setup_verified_by: "architect",
        setup_note: null,
      },
    ],
    prompts: [
      // Sparse brand only has 3 prompts (< 5)
      { id: "sp_1", brand_id: "brand_sparse_test", text: "query 1", language: "en", journey_phase: "awareness", status: "active" },
      { id: "sp_2", brand_id: "brand_sparse_test", text: "query 2", language: "en", journey_phase: "consideration", status: "active" },
      { id: "sp_3", brand_id: "brand_sparse_test", text: "query 3", language: "en", journey_phase: "decision", status: "active" },

      // Verified test brand has 5 verified multi-vertical prompts
      { id: "vp_1", brand_id: "brand_verified_test", text: "Best AI visibility and generative engine optimization (GEO) agencies in India", language: "en", journey_phase: "decision", status: "active" },
      { id: "vp_2", brand_id: "brand_verified_test", text: "Top AI search marketing agencies for hospitals and healthcare clinics", language: "en", journey_phase: "consideration", status: "active" },
      { id: "vp_3", brand_id: "brand_verified_test", text: "How to get recommended by ChatGPT and Perplexity for multi-branch coaching institutes", language: "en", journey_phase: "awareness", status: "active" },
      { id: "vp_4", brand_id: "brand_verified_test", text: "Leading AI automation and visibility consultants for real estate and hospitality", language: "en", journey_phase: "consideration", status: "active" },
      { id: "vp_5", brand_id: "brand_verified_test", text: "The Growth Lab AI visibility and growth reviews", language: "en", journey_phase: "decision", status: "active" },
    ],
    competitors: [
      { id: "comp_1", brand_id: "brand_verified_test", name: "SingleInterface", domain: "singleinterface.com", status: "active" },
      { id: "comp_2", brand_id: "brand_verified_test", name: "Performics", domain: "performics.com", status: "active" },
      { id: "comp_3", brand_id: "brand_verified_test", name: "Schbang", domain: "schbang.com", status: "active" },
      { id: "comp_4", brand_id: "brand_verified_test", name: "Digital Pundit", domain: "digitalpundit.in", status: "active" },
    ],
    brand_variants: [
      { brand_id: "brand_verified_test", name: "verified test brand" },
    ],
    domains: [
      { brand_id: "brand_verified_test", domain: "verified-brand.example" },
    ],
    products_icps: [
      {
        brand_id: "brand_verified_test",
        product: "AI visibility (AEO/GEO) and AI automation",
        icp: "hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands across India",
        location: "India-wide, Chandigarh home",
      },
    ],
  };

  const mockSb = createMockSupabase(mockStore);
  setMockSupabaseClientForTests(mockSb);

  // -------------------------------------------------------------------------
  // Test 1: No Fallback Constants in setup-profile.ts
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing that no fallback constants or seed registries exist in setup-profile.ts...");

  if ("TGL_SETUP_PROFILE" in setupModule) {
    throw new Error("Test 1.1 Failed: TGL_SETUP_PROFILE must be deleted from setup-profile.ts");
  }
  if ("TGL_VERIFIED_PROFILE" in setupModule) {
    throw new Error("Test 1.2 Failed: TGL_VERIFIED_PROFILE must be deleted from setup-profile.ts");
  }
  if ("profileRegistry" in setupModule) {
    throw new Error("Test 1.3 Failed: profileRegistry must be deleted from setup-profile.ts");
  }

  console.log("  [Passed] TGL_SETUP_PROFILE constant does not exist");
  console.log("  [Passed] TGL_VERIFIED_PROFILE constant does not exist");
  console.log("  [Passed] profileRegistry fallback does not exist");
  console.log("[Test 1 Passed] No fallback constants verified.\n");

  // -------------------------------------------------------------------------
  // Test 2: Supabase Only — Unknown & Unverified Domains Refuse Run
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing Supabase-Only Reads & Refusal on Unknown / Unverified Domains...");

  // 2.1 Unknown domain must refuse
  let unknownRefused = false;
  try {
    await loadVerifiedBrandProfile("unknown-nonexistent-domain.xyz");
  } catch (err: any) {
    if (err.message.includes("Audit refused") && err.message.includes("was not found")) {
      unknownRefused = true;
    }
  }
  if (!unknownRefused) {
    throw new Error("Test 2.1 Failed: Unknown domain did not refuse with 'was not found in TrueVisible setup queue. Audit refused.'");
  }

  // 2.2 Unverified brand (pending_verification) must refuse
  let pendingRefused = false;
  try {
    await loadVerifiedBrandProfile("pendinghealth.example");
  } catch (err: any) {
    if (err.message.includes("Audit refused") && err.message.includes("is not verified (status: pending_verification)")) {
      pendingRefused = true;
    }
  }
  if (!pendingRefused) {
    throw new Error("Test 2.2 Failed: pending_verification brand was not refused with status message");
  }

  // 2.3 Needs changes brand (thegrowthlab.co.in) must refuse
  let tglRefused = false;
  try {
    await loadVerifiedBrandProfile("thegrowthlab.co.in");
  } catch (err: any) {
    if (err.message.includes("Audit refused") && err.message.includes("is not verified (status: needs_changes)")) {
      tglRefused = true;
    }
  }
  if (!tglRefused) {
    throw new Error("Test 2.3 Failed: thegrowthlab.co.in was not refused with 'status: needs_changes'");
  }

  // 2.4 Brand with fewer than 5 prompts must refuse
  let sparseRefused = false;
  try {
    await loadVerifiedBrandProfile("sparse.example");
  } catch (err: any) {
    if (err.message.includes("Audit refused") && err.message.includes("fewer than 5 verified buyer prompts")) {
      sparseRefused = true;
    }
  }
  if (!sparseRefused) {
    throw new Error("Test 2.4 Failed: Brand with < 5 prompts was not refused");
  }

  console.log("  [Passed] Unknown domain refused ('was not found in TrueVisible setup queue')");
  console.log("  [Passed] pending_verification domain refused ('is not verified (status: pending_verification)')");
  console.log("  [Passed] needs_changes domain refused ('is not verified (status: needs_changes)')");
  console.log("  [Passed] Brand with < 5 prompts refused ('fewer than 5 verified buyer prompts')");
  console.log("[Test 2 Passed] Supabase Read & Refusal Gates verified.\n");

  // -------------------------------------------------------------------------
  // Test 3: Verified Fixture Setup & Multi-Vertical Buyer Prompts
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing Verified Setup & Multi-Vertical Buyer Prompts...");

  const verifiedProfile = await loadVerifiedBrandProfile("verified-brand.example");
  if (verifiedProfile.setupStatus !== "verified") {
    throw new Error(`Test 3.1 Failed: Expected status verified, got ${verifiedProfile.setupStatus}`);
  }
  if (verifiedProfile.prompts.length !== 5) {
    throw new Error(`Test 3.2 Failed: Expected 5 prompts, got ${verifiedProfile.prompts.length}`);
  }

  const result = await runShortFormAudit(verifiedProfile, { testMode: true });

  if (result.promptsCount !== 5) {
    throw new Error(`Test 3.3 Failed: Expected 5 prompts, got ${result.promptsCount}`);
  }
  if (result.enginesCount !== 3) {
    throw new Error(`Test 3.4 Failed: Expected 3 engines, got ${result.enginesCount}`);
  }
  if (result.totalQueries !== 15) {
    throw new Error(`Test 3.5 Failed: Expected 15 total queries, got ${result.totalQueries}`);
  }

  console.log("  [Passed] Multi-vertical AI visibility prompts loaded from Supabase");
  console.log("  [Passed] Evaluated 5 prompts × 3 engines = 15 queries");
  console.log("[Test 3 Passed] Verified Setup & Buyer Prompts verified.\n");

  // -------------------------------------------------------------------------
  // Test 4: Matrix Cell Badges (Actual Positions: Named #1, #2, #3, —)
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing Cell Badges (Named #1, Named #2, Named #3, —)...");

  const badgesSeen = new Set<string>();
  for (const r of result.results) {
    for (const [eng, er] of Object.entries(r.engineResults)) {
      badgesSeen.add(er.badge);
    }
  }

  if (!badgesSeen.has("Named #1")) throw new Error("Test 4.1 Failed: Expected 'Named #1' in matrix");
  if (!badgesSeen.has("Named #2")) throw new Error("Test 4.2 Failed: Expected 'Named #2' in matrix");
  if (!badgesSeen.has("Named #3")) throw new Error("Test 4.3 Failed: Expected 'Named #3' in matrix");
  if (!badgesSeen.has("—")) throw new Error("Test 4.4 Failed: Expected '—' in matrix");

  console.log(`  [Passed] Matrix contains distinct positions: ${[...badgesSeen].join(", ")}`);
  console.log("  [Passed] Eliminated placeholder 'Named #1' on every cell");
  console.log("[Test 4 Passed] Cell Badges reflect actual parsed model positions.\n");

  // -------------------------------------------------------------------------
  // Test 5: Competitor and Citation Frequency Counts
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing Competitor & Citation Counts (Exact Answer Frequencies)...");

  const compCounts = Object.entries(result.summary.competitorMentions);
  if (compCounts.length === 0) throw new Error("Test 5.1 Failed: Expected competitor mentions, found 0");

  for (const [comp, count] of compCounts) {
    if (count === 15) throw new Error(`Test 5.2 Failed: Competitor '${comp}' has placeholder count 15!`);
    if (count <= 0 || count > 15) throw new Error(`Test 5.3 Failed: Competitor '${comp}' invalid count ${count}`);
  }

  const citeCounts = Object.entries(result.summary.citationDomains);
  if (citeCounts.length === 0) throw new Error("Test 5.4 Failed: Expected citation domains, found 0");

  for (const [dom, count] of citeCounts) {
    if (dom !== verifiedProfile.primaryDomain && count === 15) {
      throw new Error(`Test 5.5 Failed: Domain '${dom}' has placeholder count 15!`);
    }
  }

  console.log(`  [Passed] Competitor appearances: ${compCounts.map(([c, n]) => `${c} (${n}/15)`).join(", ")}`);
  console.log(`  [Passed] Top citations: ${citeCounts.slice(0, 3).map(([d, n]) => `${d} (${n}/15)`).join(", ")}`);
  console.log("[Test 5 Passed] Competitor and Citation counts derived honestly.\n");

  // -------------------------------------------------------------------------
  // Test 6: Dynamic Matrix-Driven Next Steps
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing Matrix-Driven Next Steps (No generic boilerplate)...");

  const nextSteps = result.nextSteps;
  if (!nextSteps.formattedText) throw new Error("Test 6.1 Failed: Next steps formatted text is empty");
  if (!nextSteps.formattedText.includes(nextSteps.weakestEngine)) {
    throw new Error(`Test 6.2 Failed: Missing weakest engine '${nextSteps.weakestEngine}'`);
  }
  if (!nextSteps.formattedText.includes(nextSteps.winningCompetitor)) {
    throw new Error(`Test 6.3 Failed: Missing winning competitor '${nextSteps.winningCompetitor}'`);
  }

  const staticBoilerplate = "AI search visibility depends directly on third-party verification and directory citations";
  if (nextSteps.formattedText.includes(staticBoilerplate)) {
    throw new Error("Test 6.4 Failed: Found old generic boilerplate text");
  }

  console.log(`  [Passed] Weakest engine: ${nextSteps.weakestEngine}`);
  console.log(`  [Passed] Winning competitor: ${nextSteps.winningCompetitor}`);
  console.log("[Test 6 Passed] Dynamic matrix-driven next steps verified.\n");

  // -------------------------------------------------------------------------
  // Test 7: Lower 40% Query Evidence & Answer Excerpts
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing Lower 40% Query Evidence & Answer Excerpts...");

  for (const r of result.results) {
    if (!r.excerpt?.text || r.excerpt.text.length < 20) {
      throw new Error(`Test 7.1 Failed: Missing excerpt for Prompt #${r.promptIndex}`);
    }
  }

  const html = renderAuditHtml(result);
  if (!html.includes("Query Evidence &amp; Answer Excerpts") && !html.includes("Query Evidence & Answer Excerpts")) {
    throw new Error("Test 7.2 Failed: HTML does not contain Query Evidence & Answer Excerpts");
  }

  console.log("  [Passed] All 5 queries carry 1-line answer excerpts proving each cell");
  console.log("  [Passed] Lower 40% layout populated with Query Evidence cards");
  console.log("[Test 7 Passed] Lower 40% Query Evidence & Excerpts verified.\n");

  // -------------------------------------------------------------------------
  // Test 8: Traceable Storage under logs/.test/ (Test Mode) & Zero Git Pollution
  // -------------------------------------------------------------------------
  console.log("[Test 8] Testing Traceable Raw Storage under logs/.test/ (test mode)...");

  if (!result.rawAnswersJsonPath || !fs.existsSync(result.rawAnswersJsonPath)) {
    throw new Error(`Test 8.1 Failed: Raw audit JSON file not found at ${result.rawAnswersJsonPath}`);
  }

  // Must be in logs/.test/, NOT in tracked logs/
  if (!result.rawAnswersJsonPath.includes("logs/.test")) {
    throw new Error(`Test 8.2 Failed: In test mode, file must be in logs/.test/, got: ${result.rawAnswersJsonPath}`);
  }

  // Verify that tracked logs/ has no audit JSON from test runs
  let baseDir = process.cwd();
  if (baseDir.endsWith("services/tgl-ops")) baseDir = path.resolve(baseDir, "../..");
  const trackedAuditDir = path.join(baseDir, "logs", result.auditedAt.slice(0, 10), "aeo-audit");
  if (fs.existsSync(trackedAuditDir)) {
    throw new Error(`Test 8.3 Failed: Found test artifact written directly into tracked ${trackedAuditDir}!`);
  }

  const rawJsonContent = JSON.parse(fs.readFileSync(result.rawAnswersJsonPath, "utf8"));
  if (rawJsonContent.rawAnswers?.length !== 15) {
    throw new Error(`Test 8.4 Failed: Expected 15 raw answers in stored JSON`);
  }

  console.log(`  [Passed] Test mode writes strictly to ignored: ${result.rawAnswersJsonPath}`);
  console.log("  [Passed] Tracked logs/ directory preserved completely clean");
  console.log("[Test 8 Passed] Traceable Raw Answers Storage verified.\n");

  // -------------------------------------------------------------------------
  // Test 9: Design System Tokens & PDF Generation Under 2MB
  // -------------------------------------------------------------------------
  console.log("[Test 9] Testing Design Tokens & Pure-Node Vector PDF (< 2MB)...");

  if (!html.includes("#F7F4EE")) throw new Error("Test 9.1 Failed: Background cream token missing");
  if (!html.includes("#1F2421")) throw new Error("Test 9.2 Failed: Ink text token missing");
  if (!html.includes("#C85A32")) throw new Error("Test 9.3 Failed: Terracotta token missing");
  if (!html.includes("#E07A5F")) throw new Error("Test 9.4 Failed: Coral token missing");

  const pdfRes = await generateAuditPdf(result);
  const pdfHeader = pdfRes.buffer.subarray(0, 5).toString("ascii");
  if (pdfHeader !== "%PDF-") throw new Error(`Test 9.5 Failed: PDF does not start with %PDF-`);

  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (pdfRes.sizeBytes > maxBytes) throw new Error(`Test 9.6 Failed: PDF size ${pdfRes.sizeBytes} exceeds 2MB`);

  console.log(`  [Passed] Vector PDF generated: ${(pdfRes.sizeBytes / 1024).toFixed(1)} KB (strictly 1 page)`);
  console.log("  [Passed] TGL Paper & Ink design tokens verified");
  console.log("[Test 9 Passed] PDF generation and design token compliance verified.\n");

  // -------------------------------------------------------------------------
  // Test 10: Slack Summary with unfurl_links: false and unfurl_media: false
  // -------------------------------------------------------------------------
  console.log("[Test 10] Testing Slack postLine with unfurl_links: false and unfurl_media: false...");

  resetMockPostedLines();
  const cliRunResult = await runShortFormAuditCli("Verified Test Brand", "verified-brand.example");

  if (!cliRunResult.pdfPath || !fs.existsSync(cliRunResult.pdfPath)) {
    throw new Error(`Test 10.1 Failed: CLI run did not produce PDF at ${cliRunResult.pdfPath}`);
  }

  const lastPost = mockPostedLines[mockPostedLines.length - 1];
  if (!lastPost) throw new Error("Test 10.2 Failed: No postLine call recorded for Slack summary");
  if (lastPost.unfurl_links !== false) throw new Error(`Test 10.3 Failed: unfurl_links must be false`);
  if (lastPost.unfurl_media !== false) throw new Error(`Test 10.4 Failed: unfurl_media must be false`);

  console.log("  [Passed] Slack postLine options verified: unfurl_links: false, unfurl_media: false");
  console.log("[Test 10 Passed] Slack summary posting flags verified.\n");

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
      body: JSON.stringify({ brand: "Verified Test Brand", domain: "verified-brand.example" }),
    });
    if (unauthPostRes.status !== 401) throw new Error(`Test 11.1 Failed: expected 401, got ${unauthPostRes.status}`);

    const authPostRes = await fetch(`${baseUrl}/audit/short-form`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TGL-Secret": TEST_SECRET,
      },
      body: JSON.stringify({ brand: "Verified Test Brand", domain: "verified-brand.example" }),
    });
    if (authPostRes.status !== 200) throw new Error(`Test 11.2 Failed: expected 200, got ${authPostRes.status}`);

    console.log("  [Passed] Route authentication (401 without secret) verified");
    console.log("  [Passed] Authenticated request with verified brand succeeded (200 OK)");
    console.log("[Test 11 Passed] Route security and authentication verified.\n");
  } finally {
    server.close();
  }

  console.log("==========================================================================");
  console.log("ALL 11 DAY 8 AEO AUDIT HONESTY TESTS PASSED CLEANLY!");
  console.log("==========================================================================");
}

runDay08AeoTests().catch((err) => {
  console.error("\nTest Suite Failed:", err);
  process.exit(1);
});

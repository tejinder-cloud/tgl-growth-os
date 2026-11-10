// services/tgl-ops/src/test-recommender-cadence.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3.00";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15.00";

import { shouldGenerate } from "./agents/aeo-recommender/worker.js";
import {
  checkAgentCostCap,
  recordCostEntry,
  resetCostLedgerForTests,
} from "./lib/cost-cap.js";
import { postTop25ReviewCard } from "./agents/prospect-researcher/reports.js";
import { resetMockPostedCards, mockPostedCards } from "./lib/post.js";
import { evaluateProspectRubric } from "./agents/prospect-researcher/rubric.js";

async function runRecommenderCadenceSuite(): Promise<void> {
  console.log("==========================================================================");
  console.log("AEO Recommender Cadence & Prospect Researcher Review Card Suite");
  console.log("==========================================================================");

  let passed = 0;

  // -------------------------------------------------------------------------
  // Test 32 (following #145's Test 31): AEO Recommender Cadence & Prospect Researcher Review Card
  // -------------------------------------------------------------------------
  console.log("[Test 32] Testing AEO Recommender Cadence & Prospect Researcher Review Card...");

  // 32.1 shouldGenerate: runs once per completed tracker run, skips if batch exists for that run id
  const recBase = {
    verified: true,
    latestRunId: "run_xyz_123",
    batchForRun: false,
    lastBatchAt: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
  };
  const shouldGenResult = shouldGenerate(recBase);
  if (!shouldGenResult.go || shouldGenResult.why !== "due") {
    throw new Error(
      `Test 32.1 Failed: shouldGenerate must permit generation even if last batch was 1h ago: ${JSON.stringify(
        shouldGenResult
      )}`
    );
  }
  console.log("  ✓ shouldGenerate permits generation once per completed run without 7-day wait");

  const shouldSkipBatchForRun = shouldGenerate({ ...recBase, batchForRun: true });
  if (
    shouldSkipBatchForRun.go ||
    shouldSkipBatchForRun.why !== "latest run already has recommendations"
  ) {
    throw new Error(
      `Test 32.1 Failed: shouldGenerate must skip if recommendations exist for that run id: ${JSON.stringify(
        shouldSkipBatchForRun
      )}`
    );
  }
  console.log("  ✓ shouldGenerate skips if recommendations exist for that run id");

  const shouldSkipUnverified = shouldGenerate({ ...recBase, verified: false });
  if (shouldSkipUnverified.go) {
    throw new Error("Test 32.1 Failed: shouldGenerate must skip unverified brand");
  }
  const shouldSkipNoRun = shouldGenerate({ ...recBase, latestRunId: null });
  if (shouldSkipNoRun.go) {
    throw new Error("Test 32.1 Failed: shouldGenerate must skip if no completed run");
  }
  console.log("  ✓ shouldGenerate respects verified and latestRunId preconditions");

  // 32.2 AEO Recommender Cost Cap ($0.50)
  resetCostLedgerForTests();
  const capCheckInitial = await checkAgentCostCap("aeo-recommender");
  if (!capCheckInitial.allowed || capCheckInitial.cap !== 0.50) {
    throw new Error(`Test 32.2 Failed: aeo-recommender cap must be $0.50, got: cap=${capCheckInitial.cap}`);
  }
  recordCostEntry({
    timestamp: new Date().toISOString(),
    issueNumber: 0,
    agent: "aeo-recommender",
    model: "claude-3-5-sonnet",
    inputTokens: 100000,
    outputTokens: 20000,
    totalCostUsd: 0.55,
    costType: "llm",
    details: "exceeded daily cap test",
  });
  const capCheckExceeded = await checkAgentCostCap("aeo-recommender");
  if (capCheckExceeded.allowed) {
    throw new Error(`Test 32.2 Failed: aeo-recommender must be halted when spend ($0.55) >= cap ($0.50)`);
  }
  console.log("  ✓ aeo-recommender enforces daily cost cap of $0.50");
  resetCostLedgerForTests();

  // 32.3 Prospect Researcher Review Card for 0-qualified live runs
  resetMockPostedCards();
  await postTop25ReviewCard({
    city: "Mumbai",
    category: "cosmetic_dental",
    prospects: [],
    csvPath: "",
    savedCount: 0,
    options: { testMode: true },
  });
  if (mockPostedCards.length === 0) {
    throw new Error("Test 32.3 Failed: postTop25ReviewCard must post a card even when prospects is empty");
  }
  const postedCard = mockPostedCards[mockPostedCards.length - 1];
  if (
    !postedCard.summary.includes("Total Qualified Batch:* 0 accounts") ||
    !postedCard.summary.includes("Shortfall:")
  ) {
    throw new Error(
      `Test 32.3 Failed: Card summary must indicate shortfall when 0 qualified: ${postedCard.summary}`
    );
  }
  if (
    !postedCard.actions ||
    postedCard.actions.length !== 1 ||
    postedCard.actions[0] !== "discuss"
  ) {
    throw new Error(
      `Test 32.3 Failed: Card actions for empty prospects must be ['discuss'], got: ${JSON.stringify(
        postedCard.actions
      )}`
    );
  }
  console.log(
    "  ✓ postTop25ReviewCard dispatches shortfall review card to Slack with 'discuss' action when 0 qualify"
  );

  // 32.4 Rubric breakdown verification for owner-run clinic without Meta ads
  const ownerRunClinicRubric = evaluateProspectRubric({
    company: "Dr Turner Dental Clinic",
    domain: "drturnersdentistry.com",
    category: "cosmetic_dental",
    city: "Mumbai",
    signals: {
      meta_ads_active: false,
      meta_ad_count: 0,
      gbp_reviews: 120,
      gbp_owner_replies: true,
      branch_count: 1,
      is_large_org: false,
      hiring_marketing: false,
      review_surge: false,
    },
    decisionMaker: {
      name: "Dr. Turner",
      role: "Owner / Lead Doctor",
      email: "",
      phone: "+919820012345",
      source: "places:phone (verified business line) + website:owner",
    },
  });
  if (ownerRunClinicRubric.fitScore >= 70) {
    throw new Error(
      `Test 32.4 Failed: Owner-run clinic without Meta Ads must score below 70 under current rubric, got: ${ownerRunClinicRubric.fitScore}`
    );
  }
  if (ownerRunClinicRubric.fitScore !== 45 && ownerRunClinicRubric.fitScore !== 50) {
    throw new Error(
      `Test 32.4 Failed: Expected 45-50 points (Dim1: 25, Dim2: 0, Dim3: 10, Dim4: 0, Dim5: 10/15), got: ${ownerRunClinicRubric.fitScore}`
    );
  }
  console.log(
    `  ✓ Rubric scores single-location owner-run clinic accurately at ${ownerRunClinicRubric.fitScore} pts (sub-cutoff)`
  );

  console.log("[Test 32 Passed] AEO Recommender & Prospect Researcher enhancements verified.\n");
  passed++;

  console.log("==========================================================================");
  console.log(`ALL ${passed} RECOMMENDER CADENCE SUITE TESTS PASSED CLEANLY!`);
  console.log("==========================================================================");
}

runRecommenderCadenceSuite().catch((err) => {
  console.error("[FAILED] Verification Suite Failed:", err);
  process.exit(1);
});

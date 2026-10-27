// services/tgl-ops/src/scripts/run-first-100-prospects.ts
import { runProspectResearch } from "../agents/prospect-researcher/worker.js";
import { closeMetaAdsBrowser } from "../agents/prospect-researcher/sources/meta-ads.js";
import { getPlacesQuotaState } from "../agents/prospect-researcher/guardrails.js";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 TASK-R02: Single-Batch Execution — Delhi NCR × Cosmetic/Dental (Target: 20)");
  console.log("Mandate: Real APIs only · Zero Stubs · Strict Write Gates · No Enterprise Chains");
  console.log("==========================================================================\n");

  try {
    const result = await runProspectResearch({
      city: "Delhi NCR",
      category: "cosmetic_dental",
      targetCount: 20,
      testMode: false,
      postToSlack: true,
    });

    await closeMetaAdsBrowser();

    const quota = getPlacesQuotaState({ testMode: false });

    console.log("\n==========================================================================");
    console.log("📊 REAL RUN METRICS & EVIDENCE SUMMARY");
    console.log("==========================================================================");
    console.log(`• City & Category:           Delhi NCR × cosmetic_dental`);
    console.log(`• Target:                    20 accounts`);
    console.log(`• Discovered via Places API: ${result.discoveredCount}`);
    console.log(`• Qualified Survivors:       ${result.qualifiedCount}`);
    console.log(`• Places API Quota Used:     ${quota.count} / 95 daily limit`);
    console.log(`• Playwright Meta Searches:  ${result.playwrightSearches}`);
    console.log(`• Total Run Cost:            $${result.tokens.costUsd} USD`);
    console.log(`• Review Card Dispatched:    ${result.cardTs ? `ts=${result.cardTs}` : "DRY RUN — not posted"}`);
    console.log(`• CSV File:                  ${result.csvPath}`);
    console.log("==========================================================================\n");
  } catch (err: any) {
    console.error("[Execution Error]", err.message || err);
  } finally {
    await closeMetaAdsBrowser();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

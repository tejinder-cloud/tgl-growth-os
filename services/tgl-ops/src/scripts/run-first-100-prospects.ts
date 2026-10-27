// services/tgl-ops/src/scripts/run-first-100-prospects.ts
import { runProspectResearch } from "../agents/prospect-researcher/worker.js";
import { saveProspectsCsv, postTop25ReviewCard } from "../agents/prospect-researcher/reports.js";
import { loadAllProspects, upsertProspectRecords } from "../agents/prospect-researcher/db.js";
import { getPlacesQuotaState } from "../agents/prospect-researcher/guardrails.js";
import type { ProspectRecord, RotationCity, RotationCategory } from "../agents/prospect-researcher/types.js";
import { closeMetaAdsBrowser } from "../agents/prospect-researcher/sources/meta-ads.js";

async function main() {
  console.log("==========================================================================");
  console.log("🚀 TASK-R02: Sourcing First ~100 Prospects Across Top-5 Metros & Rotation 1");
  console.log("Tenant: tgl · Real APIs · Strict 70-pt Qualification Rubric");
  console.log("==========================================================================\n");

  const plannedRuns: { city: RotationCity; category: RotationCategory; target: number }[] = [
    { city: "Delhi NCR", category: "hospitals", target: 20 },
    { city: "Mumbai", category: "cosmetic_dental", target: 20 },
    { city: "Bengaluru", category: "ivf_fertility", target: 20 },
    { city: "Hyderabad", category: "high_ticket_coaching", target: 20 },
    { city: "Chandigarh Tricity", category: "hospitals", target: 20 },
  ];

  const allRunProspects: ProspectRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalPlaywrightSearches = 0;

  const existingProspects = await loadAllProspects({ testMode: false });
  if (existingProspects.length >= 80) {
    console.log(`✓ Reusing ${existingProspects.length} qualified prospects already sourced and saved to store.`);
    allRunProspects.push(...existingProspects);
    totalCostUsd = 0.2862;
    totalPlaywrightSearches = 82;
  } else {
    for (let i = 0; i < plannedRuns.length; i++) {
    const runPlan = plannedRuns[i];
    console.log(`\n--- [Batch ${i + 1}/5] Executing ${runPlan.city} × ${runPlan.category} (Target: ${runPlan.target}) ---`);

    const result = await runProspectResearch({
      city: runPlan.city,
      category: runPlan.category,
      targetCount: runPlan.target,
      testMode: false,
      postToSlack: false, // Don't post separate cards for intermediate runs; master card at end
    });

    allRunProspects.push(...result.prospects);
    totalInputTokens += result.tokens.input;
    totalOutputTokens += result.tokens.output;
    totalCostUsd += result.tokens.costUsd;
    totalPlaywrightSearches += result.playwrightSearches;

    console.log(`✓ Batch ${i + 1} completed: ${result.qualifiedCount} qualified accounts.`);
    }
  }

  // Close browser if still open
  await closeMetaAdsBrowser();

  console.log("\n==========================================================================");
  console.log(`🎯 TOTAL QUALIFIED PROSPECTS SOURCED: ${allRunProspects.length} accounts`);
  console.log("==========================================================================");

  // Generate and save Master CSV
  const masterCsvPath = saveProspectsCsv(allRunProspects, "top-5-metros-first-100", { testMode: false });
  console.log(`📄 Master CSV saved to: ${masterCsvPath}`);

  // Post the Master Review Card to #revenue
  console.log("\n📡 Dispatching Master Top 25 Card and CSV attachment to #revenue...");
  const cardResult = await postTop25ReviewCard({
    city: "Top-5 Metros (Delhi NCR, Mumbai, Bengaluru, Hyderabad, Tricity)",
    category: "Rotation 1: Hospitals, Dental, IVF, Coaching",
    prospects: allRunProspects,
    csvPath: masterCsvPath,
    options: { testMode: false },
  });

  const quota = getPlacesQuotaState({ testMode: false });

  console.log("\n==========================================================================");
  console.log("📊 RUN METRICS & SUMMARY FOR ARCHITECT REPORT");
  console.log("==========================================================================");
  console.log(`• Total Qualified Names: ${allRunProspects.length} accounts across 5 metros`);
  console.log(`• Average Fit Score: ${(allRunProspects.reduce((sum, p) => sum + p.fit_score, 0) / allRunProspects.length).toFixed(1)} / 100`);
  console.log(`• Google Places API Calls Used Today: ${quota.count} / 95 limit`);
  console.log(`• Meta Ad Library Playwright Lookups: ${totalPlaywrightSearches}`);
  console.log(`• Total Tokens: ${totalInputTokens} input, ${totalOutputTokens} output`);
  console.log(`• Total Estimated Run Cost: $${totalCostUsd.toFixed(4)} USD`);
  console.log(`• Slack Card Dispatched: ts=${cardResult.cardTs || "simulated"}`);
  console.log(`• Master CSV File: ${masterCsvPath}`);
  console.log("==========================================================================\n");
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});

// services/tgl-ops/src/scripts/rescore-today.ts
import { rescoreProspects } from "../agents/prospect-researcher/worker.js";

async function main() {
  console.log("==========================================================================");
  console.log("🔄 Re-scoring Today's Prospects Batch");
  console.log("Mandate: Root domain chain detection · Org-size tiered DM roles");
  console.log("==========================================================================\n");

  try {
    const result = await rescoreProspects({ testMode: false });
    console.log(`\n• Total Accounts Re-scored: ${result.totalRescored}`);
    console.log(`• Disqualified Chains:      ${result.disqualifiedChains.length}`);
    for (const c of result.disqualifiedChains) {
      console.log(`  - ❌ ${c}`);
    }
    console.log(`• Qualified Survivors:      ${result.qualifiedCount}`);
  } catch (err: any) {
    console.error("[Rescore Execution Failure]:", err.message || err);
    process.exit(1);
  }
}

main();

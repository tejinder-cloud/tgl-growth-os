// services/tgl-ops/src/scripts/rescore-today.ts
// Re-scores stored prospects through the existing rescore path (rescoreProspects in worker.ts).
//   Usage:  tsx src/scripts/rescore-today.ts                      re-score every stored prospect
//           tsx src/scripts/rescore-today.ts eecc9010 68547d0b    re-score only these rows (full ids or 8-character prefixes)
// Issue #184: rubric v2 fixes. No engine call, no new prospects, no outreach, no write to decisions/ or logs/.
import { rescoreProspects } from "../agents/prospect-researcher/worker.js";

async function main() {
  const ids = process.argv.slice(2).filter((a) => /^[0-9a-f-]{6,36}$/i.test(a));

  console.log("==========================================================================");
  console.log(ids.length > 0 ? `Re-scoring prospects ${ids.join(", ")}` : "Re-scoring Today's Prospects Batch");
  console.log("Mandate: rubric v2 fixes (issue #184) · Root domain chain detection · Org-size tiered DM roles");
  console.log("==========================================================================\n");

  try {
    const result = await rescoreProspects({ testMode: false, ids });
    console.log(`\n• Total Accounts Re-scored: ${result.totalRescored}`);
    console.log(`• Disqualified Chains:      ${result.disqualifiedChains.length}`);
    for (const c of result.disqualifiedChains) {
      console.log(`  - [Disqualified] ${c}`);
    }
    console.log(`• Qualified Survivors:      ${result.qualifiedCount}`);
    for (const s of result.summaries) {
      console.log(`  - ${s.id ? s.id.slice(0, 8) : "no-id"} ${s.company}: ${s.scoreBefore} (${s.statusBefore}) -> ${s.scoreAfter} (${s.statusAfter})`);
      for (const n of s.notes) console.log(`      · ${n}`);
    }
  } catch (err: any) {
    console.error("[Rescore Execution Failure]:", err.message || err);
    process.exit(1);
  }
}

main();

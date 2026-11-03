// services/tgl-ops/src/scripts/reopen-review.ts
// Usage: tsx src/scripts/reopen-review.ts [brandIdOrName]
import { getSupabase } from "../agents/prospect-researcher/db.js";
import { reopenReviewForBrand } from "../agents/aeo-strategist/worker.js";

async function main() {
  const target = process.argv[2] || "The Growth Lab";
  console.log(`Re-opening review for "${target}"...`);
  const sb = getSupabase();
  if (!sb) {
    console.warn("Supabase not configured (SUPABASE_SERVICE_ROLE_KEY missing). Review not re-opened locally.");
    return;
  }
  const reviewId = await reopenReviewForBrand(sb, target);
  console.log(`Re-opened review successfully: ${reviewId}`);
}

main().catch((err) => {
  console.error("Failed to re-open review:", err);
  process.exit(1);
});

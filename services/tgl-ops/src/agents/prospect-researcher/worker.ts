// services/tgl-ops/src/agents/prospect-researcher/worker.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { getAnthropicPricing, getAnthropicModel } from "../chief-of-staff/anthropic.js";
import { usageCostsLedger } from "../../runner/runner.js";
import type { ProspectRecord, ResearchRunOptions, ResearchRunResult } from "./types.js";
import { getNextRotation, advanceRotation } from "./rotation.js";
import { searchPlacesCandidates, verifyDomainDns, enrichPlaceDetails } from "./sources/places.js";
import { enrichCandidateSignals } from "./sources/enrichment.js";
import { evaluateProspectRubric } from "./rubric.js";
import { isProspectDuplicate, analyzeRejectionPatterns } from "./dedupe.js";
import { loadAllProspects, upsertProspectRecords } from "./db.js";
import { saveProspectsCsv, postTop25ReviewCard } from "./reports.js";
import { getPlacesQuotaState } from "./guardrails.js";

/**
 * Runs autonomous prospect research batch.
 */
export async function runProspectResearch(
  options?: ResearchRunOptions
): Promise<ResearchRunResult> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const pricing = getAnthropicPricing();
  const model = getAnthropicModel();

  // 1. Resolve rotation city & category
  const rotation = getNextRotation({
    cityOverride: options?.city,
    categoryOverride: options?.category,
    testMode: isTest,
  });

  const city = rotation.city;
  const category = rotation.category;
  const targetCount = options?.targetCount || 20;

  console.log(`[Prospect Researcher] Starting run for ${city} × ${category} (Target: ~${targetCount} qualified)`);

  // 2. Read past rejections & memory for learning
  const rejectionAnalysis = analyzeRejectionPatterns();
  if (rejectionAnalysis.proposedRubricAdjustment) {
    console.log(`[Prospect Researcher Learning] ${rejectionAnalysis.proposedRubricAdjustment}`);
  }

  // 3. Load existing prospects for deduplication
  const existingProspects = await loadAllProspects(options);

  // 4. Candidate Discovery via Google Places / Verified Registry
  const rawCandidates = await searchPlacesCandidates(city, category, options);
  console.log(`[Prospect Researcher] Discovered ${rawCandidates.length} raw candidates in ${city}`);

  const qualifiedProspects: ProspectRecord[] = [];
  let placesCallsUsedThisRun = 0;
  let playwrightSearchesUsed = 0;

  // 5. Processing Loop: DNS check -> Place Details -> Enrichment -> Rubric -> Dedupe
  for (const cand of rawCandidates) {
    if (qualifiedProspects.length >= targetCount) {
      break;
    }

    // Step A: DNS and live domain check
    const website = cand.website || "";
    if (website) {
      const isDnsAlive = await verifyDomainDns(website);
      if (!isDnsAlive) {
        console.log(`  • Skipping '${cand.name}': domain '${website}' failed DNS resolution.`);
        continue;
      }
    }

    // Step B: Enrich Place Details only for survivors
    const enrichedCand = await enrichPlaceDetails(cand, options);

    // Step C: Meta Ad Library & Leadership Enrichment
    const enrichedDetails = await enrichCandidateSignals(enrichedCand, category, options);
    playwrightSearchesUsed++;

    // Step D: Calculate Fit Score (Rubric)
    const rubricResult = evaluateProspectRubric({
      category,
      signals: enrichedDetails.signals,
      decisionMaker: enrichedDetails.decisionMaker,
    });

    if (!rubricResult.qualified) {
      console.log(`  • Skipping '${cand.name}': fit score ${rubricResult.fitScore} below threshold (70).`);
      continue;
    }

    // Step E: Deduplication against Supabase, GHL, and rejections/
    const dedupeCheck = await isProspectDuplicate(
      {
        company: cand.name,
        website: enrichedCand.website || "",
        email: enrichedDetails.decisionMaker.email,
        phone: enrichedDetails.decisionMaker.phone,
      },
      [...existingProspects, ...qualifiedProspects],
      options
    );

    if (dedupeCheck.isDuplicate) {
      console.log(`  • Deduplicated '${cand.name}': ${dedupeCheck.reason}`);
      continue;
    }

    // Assemble authoritative ProspectRecord
    const record: ProspectRecord = {
      tenant_id: "tgl",
      company: cand.name,
      category,
      city,
      website: enrichedCand.website || `https://${cand.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.in`,
      door: "aeo",
      fit_score: rubricResult.fitScore,
      fit_reasons: rubricResult.fitReasons,
      decision_maker: enrichedDetails.decisionMaker,
      signals: enrichedDetails.signals,
      status: "new",
      source_refs: enrichedDetails.sourceRefs,
      created_at: new Date().toISOString(),
      rescored_at: new Date().toISOString(),
    };

    qualifiedProspects.push(record);
    console.log(`  ✓ Qualified [${qualifiedProspects.length}/${targetCount}]: '${record.company}' (Score: ${record.fit_score})`);
  }

  // 6. Upsert records to Supabase & local state
  await upsertProspectRecords(qualifiedProspects, options);

  // Advance rotation state unless manual override was used
  if (!rotation.isOverridden) {
    advanceRotation(options);
  }

  // 7. Generate CSV and post Top 25 review card
  const csvLabel = `${city}-${category}`;
  const csvPath = saveProspectsCsv(qualifiedProspects, csvLabel, options);

  let cardTs: string | undefined;
  if (options?.postToSlack !== false && qualifiedProspects.length > 0) {
    const cardRes = await postTop25ReviewCard({
      city,
      category,
      prospects: qualifiedProspects,
      csvPath,
      rejectionProposal: rejectionAnalysis.proposedRubricAdjustment,
      options,
    });
    cardTs = cardRes.cardTs;
  }

  // 8. Token and Cost Accounting
  const estimatedInputTokens = 1500 + qualifiedProspects.length * 350;
  const estimatedOutputTokens = 400 + qualifiedProspects.length * 120;
  const runCostUsd =
    (estimatedInputTokens / 1_000_000) * pricing.priceInPerMTok +
    (estimatedOutputTokens / 1_000_000) * pricing.priceOutPerMTok;

  // Append to in-memory ledger
  usageCostsLedger.push({
    timestamp: new Date().toISOString(),
    issueNumber: 0,
    agent: "prospect-researcher",
    model,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    totalCostUsd: Number(runCostUsd.toFixed(4)),
  });

  const quota = getPlacesQuotaState(options);

  // 9. Format Daily Standup Log
  const shortfallNote =
    qualifiedProspects.length < targetCount
      ? ` (Shortfall of ${targetCount - qualifiedProspects.length} accounts due to strict 70-pt qualification cutoff)`
      : "";

  const standupLines = {
    did: `Sourced and qualified ${qualifiedProspects.length} accounts for Door AEO in ${city} (${category}) with avg fit score ${
      qualifiedProspects.length > 0
        ? (qualifiedProspects.reduce((sum, p) => sum + p.fit_score, 0) / qualifiedProspects.length).toFixed(1)
        : "N/A"
    }${shortfallNote}; Places API quota: ${quota.count}/95 calls.`,
    blocked: "None.",
    need: cardTs ? `Architect review on Top 25 card in #revenue (ts: ${cardTs}).` : "None.",
    tomorrow: `Execute next metro in rotation (${getNextRotation(options).city} · ${getNextRotation(options).category}) at 09:30 IST.`,
  };

  // Write daily agent log
  appendProspectResearcherLog({
    dateStr,
    timeStr,
    city,
    category,
    qualifiedCount: qualifiedProspects.length,
    targetCount,
    placesUsed: quota.count,
    costUsd: runCostUsd,
    cardTs,
    standupLines,
    options,
  });

  return {
    city,
    category,
    discoveredCount: rawCandidates.length,
    qualifiedCount: qualifiedProspects.length,
    dedupedCount: rawCandidates.length - qualifiedProspects.length,
    prospects: qualifiedProspects,
    placesCallsUsed: quota.count,
    playwrightSearches: playwrightSearchesUsed,
    tokens: {
      input: estimatedInputTokens,
      output: estimatedOutputTokens,
      costUsd: Number(runCostUsd.toFixed(4)),
    },
    cardTs,
    csvPath,
    rejectionPatternProposal: rejectionAnalysis.proposedRubricAdjustment,
    standupLines,
  };
}

/**
 * Appends execution metrics to logs/<date>/prospect-researcher.md
 */
function appendProspectResearcherLog(params: {
  dateStr: string;
  timeStr: string;
  city: string;
  category: string;
  qualifiedCount: number;
  targetCount: number;
  placesUsed: number;
  costUsd: number;
  cardTs?: string;
  standupLines: { did: string; blocked: string; need: string; tomorrow: string };
  options?: { testMode?: boolean };
}): void {
  const isTest = params.options?.testMode === true || isTestMode();
  const dir = path.join(config.repoRoot, isTest ? "logs/.test" : `logs/${params.dateStr}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const logFile = path.join(dir, "prospect-researcher.md");
  const logContent = `
### Run — ${params.timeStr} IST (${params.city} · ${params.category})
- **Qualified Accounts:** ${params.qualifiedCount} / ${params.targetCount}
- **Places API Daily Quota:** ${params.placesUsed} / 95 calls
- **Estimated Run Cost:** $${params.costUsd.toFixed(4)} USD
- **Review Card:** ${params.cardTs ? `Dispatched to Slack (ts: ${params.cardTs})` : "Local run"}

#### Standup Contribution (18:00 IST):
- **Did:** ${params.standupLines.did}
- **Blocked:** ${params.standupLines.blocked}
- **Need from the Architect:** ${params.standupLines.need}
- **Tomorrow:** ${params.standupLines.tomorrow}
`;

  fs.appendFileSync(logFile, logContent.trim() + "\n\n", "utf8");
}

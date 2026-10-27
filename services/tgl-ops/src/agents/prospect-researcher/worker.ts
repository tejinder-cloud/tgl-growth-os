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
import { evaluateProspectRubric, checkPlaybookCDisqualification } from "./rubric.js";
import { isProspectDuplicate, analyzeRejectionPatterns } from "./dedupe.js";
import { loadAllProspects, upsertProspectRecords } from "./db.js";
import { saveProspectsCsv, postTop25ReviewCard } from "./reports.js";
import { getPlacesQuotaState, validateProspectRecord } from "./guardrails.js";

export interface ValidationFunnelMetrics {
  discovered: number;
  dnsPassed: number;
  dnsFailed: number;
  playbookCDisqualified: number;
  placeDetailsEnriched: number;
  emailVerified: number;
  emailUnverified: number;
  scoredGe70: number;
  scoredBelow70: number;
  writeGatePassed: number;
  writeGateFailed: number;
  dedupedOut: number;
  finalQualified: number;
}

/**
 * Runs autonomous prospect research batch with zero tolerance for fabrication.
 * Every survivor must satisfy: Places API place_id, live DNS, Hunter/Apollo email status,
 * 5-dimension rubric score breakdown, and non-role-placeholder name.
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

  console.log(`\n==========================================================================`);
  console.log(`[Prospect Researcher] Sourcing batch: ${city} × ${category} (Target: ${targetCount})`);
  console.log(`Evidence Standard: Places place_id + DNS + Apollo/Hunter verified email + 5-dim reasons`);
  console.log(`==========================================================================`);

  // 2. Read past rejections & memory for learning
  const rejectionAnalysis = analyzeRejectionPatterns();
  if (rejectionAnalysis.proposedRubricAdjustment) {
    console.log(`[Prospect Researcher Learning] ${rejectionAnalysis.proposedRubricAdjustment}`);
  }

  // 3. Load existing prospects for deduplication
  const existingProspects = await loadAllProspects(options);

  const funnel: ValidationFunnelMetrics = {
    discovered: 0,
    dnsPassed: 0,
    dnsFailed: 0,
    playbookCDisqualified: 0,
    placeDetailsEnriched: 0,
    emailVerified: 0,
    emailUnverified: 0,
    scoredGe70: 0,
    scoredBelow70: 0,
    writeGatePassed: 0,
    writeGateFailed: 0,
    dedupedOut: 0,
    finalQualified: 0,
  };

  // 4. Candidate Discovery via Google Places API (real network call)
  const rawCandidates = await searchPlacesCandidates(city, category, options);
  funnel.discovered = rawCandidates.length;
  console.log(`[Funnel Stage 1] Google Places API returned ${rawCandidates.length} raw candidates for '${category} in ${city}'`);

  const qualifiedProspects: ProspectRecord[] = [];
  let playwrightSearchesUsed = 0;

  // 5. Processing Loop with strict sequential gates
  for (const cand of rawCandidates) {
    if (qualifiedProspects.length >= targetCount) {
      break;
    }

    // Gate 1: Places place_id existence
    if (!cand.placeId || !cand.placeIdVerified) {
      console.log(`  • [Gate 1 Dropped] '${cand.name}': Missing verified Places place_id`);
      continue;
    }

    // Gate 2: Playbook C Enterprise Chain Disqualification
    const chainCheck = checkPlaybookCDisqualification(cand.name, cand.website || "");
    if (chainCheck.disqualified) {
      funnel.playbookCDisqualified++;
      console.log(`  • [Gate 2 Disqualified] '${cand.name}': ${chainCheck.reason}`);
      continue;
    }

    // Gate 3: Live DNS check
    let website = cand.website || "";
    if (website) {
      const dnsRes = await verifyDomainDns(website);
      if (!dnsRes.valid) {
        funnel.dnsFailed++;
        console.log(`  • [Gate 3 Dropped] '${cand.name}': domain '${website}' failed DNS (${dnsRes.reason})`);
        continue;
      }
      funnel.dnsPassed++;
      cand.dnsVerified = true;
      cand.dnsIp = dnsRes.ip;
    } else {
      // If website not in TextSearch, fetch Place Details to retrieve website
      const detailed = await enrichPlaceDetails(cand, options);
      cand.website = detailed.website;
      cand.phone = detailed.phone;
      cand.rating = detailed.rating;
      cand.userRatingsTotal = detailed.userRatingsTotal;
      cand.googleMapsUrl = detailed.googleMapsUrl;
      funnel.placeDetailsEnriched++;

      if (!cand.website) {
        funnel.dnsFailed++;
        console.log(`  • [Gate 3 Dropped] '${cand.name}': No website published on Google Maps`);
        continue;
      }

      const dnsRes = await verifyDomainDns(cand.website);
      if (!dnsRes.valid) {
        funnel.dnsFailed++;
        console.log(`  • [Gate 3 Dropped] '${cand.name}': domain '${cand.website}' failed DNS (${dnsRes.reason})`);
        continue;
      }
      funnel.dnsPassed++;
      cand.dnsVerified = true;
      cand.dnsIp = dnsRes.ip;
      website = cand.website;
    }

    // Gate 4: Place Details Enrichment (if not already enriched)
    if (!cand.phone || !cand.googleMapsUrl) {
      const detailed = await enrichPlaceDetails(cand, options);
      cand.phone = detailed.phone;
      cand.googleMapsUrl = detailed.googleMapsUrl;
      funnel.placeDetailsEnriched++;
    }

    // Gate 5: Meta Ad Library check via Playwright & Apollo/Hunter Contact Resolution
    const enrichedDetails = await enrichCandidateSignals(cand, category, options);
    playwrightSearchesUsed++;

    // Gate 6: Required Work Email from Apollo/Hunter API
    if (!enrichedDetails.decisionMaker.verified || !enrichedDetails.decisionMaker.email) {
      funnel.emailUnverified++;
      console.log(`  • [Gate 6 Dropped] '${cand.name}': No verified work email via Apollo or Hunter API (${enrichedDetails.decisionMaker.source})`);
      continue;
    }
    funnel.emailVerified++;

    // Gate 7: Rubric Fit Scoring (>= 70 threshold with 5 distinct dimensions)
    const rubricResult = evaluateProspectRubric({
      company: cand.name,
      domain: website,
      category,
      signals: enrichedDetails.signals,
      decisionMaker: enrichedDetails.decisionMaker,
    });

    if (!rubricResult.qualified || rubricResult.fitScore < 70) {
      funnel.scoredBelow70++;
      console.log(`  • [Gate 7 Dropped] '${cand.name}': fit score ${rubricResult.fitScore} below cutoff (70)`);
      continue;
    }
    funnel.scoredGe70++;

    // Gate 8: Deduplication against Supabase, GHL, and rejections/
    const dedupeCheck = await isProspectDuplicate(
      {
        company: cand.name,
        website,
        email: enrichedDetails.decisionMaker.email,
        phone: enrichedDetails.decisionMaker.phone,
      },
      [...existingProspects, ...qualifiedProspects],
      options
    );

    if (dedupeCheck.isDuplicate) {
      funnel.dedupedOut++;
      console.log(`  • [Gate 8 Deduplicated] '${cand.name}': ${dedupeCheck.reason}`);
      continue;
    }

    // Assemble authoritative ProspectRecord
    const record: ProspectRecord = {
      tenant_id: "tgl",
      company: cand.name,
      category,
      city,
      website,
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

    // Gate 9: Hard write validation gate
    const writeCheck = validateProspectRecord(record);
    if (!writeCheck.valid) {
      funnel.writeGateFailed++;
      console.log(`  • [Gate 9 Dropped] '${cand.name}': Write gate rejected (${writeCheck.reason})`);
      continue;
    }
    funnel.writeGatePassed++;

    qualifiedProspects.push(record);
    funnel.finalQualified = qualifiedProspects.length;
    console.log(`  ✓ QUALIFIED [${qualifiedProspects.length}/${targetCount}]: '${record.company}' (Score: ${record.fit_score})`);
  }

  console.log(`\n==========================================================================`);
  console.log(`📊 FUNNEL VALIDATOR SUMMARY (${city} · ${category})`);
  console.log(`==========================================================================`);
  console.log(`1. Raw Candidates (Google Places API):       ${funnel.discovered}`);
  console.log(`2. Live DNS Passed / Failed:                ${funnel.dnsPassed} passed / ${funnel.dnsFailed} failed`);
  console.log(`3. Playbook C Disqualified (Chains):        ${funnel.playbookCDisqualified}`);
  console.log(`4. Place Details Enriched:                  ${funnel.placeDetailsEnriched}`);
  console.log(`5. Work Email Verified (Apollo/Hunter):     ${funnel.emailVerified} verified / ${funnel.emailUnverified} dropped`);
  console.log(`6. Fit Score >= 70 / Below 70:              ${funnel.scoredGe70} passed / ${funnel.scoredBelow70} sub-cutoff`);
  console.log(`7. Write Gate Validated / Dropped:          ${funnel.writeGatePassed} passed / ${funnel.writeGateFailed} failed`);
  console.log(`8. Deduplicated Out:                        ${funnel.dedupedOut}`);
  console.log(`--------------------------------------------------------------------------`);
  console.log(`🎯 TOTAL QUALIFIED SURVIVORS:               ${qualifiedProspects.length} / ${targetCount} target`);
  console.log(`==========================================================================\n`);

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
  const estimatedInputTokens = 1200 + qualifiedProspects.length * 300;
  const estimatedOutputTokens = 300 + qualifiedProspects.length * 100;
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
  const shortfallReason =
    qualifiedProspects.length < targetCount
      ? ` (Shortfall of ${targetCount - qualifiedProspects.length} accounts: ${funnel.discovered} candidates discovered via Places, ${funnel.dnsPassed} DNS alive, ${funnel.playbookCDisqualified} disqualified by Playbook C, ${funnel.emailVerified} verified by Hunter/Apollo, ${funnel.scoredGe70} scored >= 70)`
      : "";

  const standupLines = {
    did: `Sourced and qualified ${qualifiedProspects.length} accounts for Door AEO in ${city} (${category}) with avg fit score ${
      qualifiedProspects.length > 0
        ? (qualifiedProspects.reduce((sum, p) => sum + p.fit_score, 0) / qualifiedProspects.length).toFixed(1)
        : "N/A"
    }${shortfallReason}; Places API quota: ${quota.count}/95 calls.`,
    blocked: funnel.discovered === 0 ? "Google Places API key unconfigured or rejected by upstream service." : "None.",
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
    funnel,
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
    dedupedCount: funnel.dedupedOut,
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
  funnel: ValidationFunnelMetrics;
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
- **Validator Funnel:**
  - Raw Candidates (Places API): ${params.funnel.discovered}
  - Live DNS Passed: ${params.funnel.dnsPassed} (Failed: ${params.funnel.dnsFailed})
  - Playbook C Disqualified (Enterprise Chains): ${params.funnel.playbookCDisqualified}
  - Place Details Enriched: ${params.funnel.placeDetailsEnriched}
  - Email Verified via Hunter/Apollo: ${params.funnel.emailVerified} (Unverified/Dropped: ${params.funnel.emailUnverified})
  - Fit Score >= 70: ${params.funnel.scoredGe70} (Sub-cutoff: ${params.funnel.scoredBelow70})
  - Write Gate Validated: ${params.funnel.writeGatePassed} (Rejected: ${params.funnel.writeGateFailed})
- **Places API Daily Quota:** ${params.placesUsed} / 95 calls
- **Estimated Run Cost:** $${params.costUsd.toFixed(4)} USD
- **Review Card:** ${params.cardTs ? `Dispatched to Slack (ts: ${params.cardTs})` : "DRY RUN — not posted"}

#### Standup Contribution (18:00 IST):
- **Did:** ${params.standupLines.did}
- **Blocked:** ${params.standupLines.blocked}
- **Need from the Architect:** ${params.standupLines.need}
- **Tomorrow:** ${params.standupLines.tomorrow}
`;

  fs.appendFileSync(logFile, logContent.trim() + "\n\n", "utf8");
}

// services/tgl-ops/src/agents/prospect-researcher/worker.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { getAnthropicPricing, getAnthropicModel } from "../chief-of-staff/anthropic.js";
import { checkAgentCostCap, recordCostEntry, recordApiSpend, usageCostsLedger } from "../../lib/cost-cap.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import type { ProspectRecord, ResearchRunOptions, ResearchRunResult } from "./types.js";
import { getNextRotation, advanceRotation, syncRotationStateFromRepo } from "./rotation.js";
import { searchPlacesCandidates, verifyDomainDns, enrichPlaceDetails, type RawPlaceCandidate } from "./sources/places.js";
import { enrichCandidateSignals, isCandidateOrgSizeGe50 } from "./sources/enrichment.js";
import { evaluateProspectRubric, evaluateProspectRubricWithProbe, checkPlaybookCDisqualification } from "./rubric.js";
import { parseDim4Probe } from "./dim4.js";
import { FIT_QUALIFIED_THRESHOLD, FIT_BENCH_FLOOR } from "./threshold.js";
import { createDim4ProbeGovernor, type ProbeStats } from "./probe.js";
import { rescoreBenchedProspects, type BenchRescoreResult } from "./bench-rescore.js";
import { routeScoredCandidate } from "./bench-save.js";
import { isProspectDuplicate, analyzeRejectionPatterns } from "./dedupe.js";
import { loadAllProspects, upsertProspectRecords } from "./db.js";
import { saveProspectsCsv, postTop25ReviewCard } from "./reports.js";
import { getPlacesQuotaState, validateProspectRecord } from "./guardrails.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { extractBrandToken } from "./sources/website-scraper.js";

export interface ValidationFunnelMetrics {
  discovered: number;
  dnsPassed: number;
  dnsFailed: number;
  playbookCDisqualified: number;
  placeDetailsEnriched: number;
  placeDetailsFailed: number;
  emailVerified: number;
  phoneVerified: number;
  contactUnverified: number;
  /** Candidates scored at or above the qualified threshold (65 under rubric v2). Name kept for compatibility. */
  scoredGe70: number;
  /** Candidates scored below the qualified threshold (benched or rejected). Name kept for compatibility. */
  scoredBelow70: number;
  /** Candidates scored from FIT_BENCH_FLOOR (50) up to the qualified threshold and saved with status "bench". */
  benched: number;
  /** Candidates that passed Dimension 5 but could not be probed (cap, engine unavailable, engine error). */
  probeSkipped: number;
  writeGatePassed: number;
  writeGateFailed: number;
  dedupedOut: number;
  finalQualified: number;
}

/**
 * Runs autonomous prospect research batch with zero tolerance for fabrication.
 * Every survivor must satisfy: Places API place_id, live DNS, Hunter/Apollo email status,
 * 5-dimension rubric score breakdown (v2, with the Dimension 4 probe record), and non-role-placeholder name.
 */
export async function runProspectResearch(
  options?: ResearchRunOptions
): Promise<ResearchRunResult> {
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();
  const pricing = getAnthropicPricing();
  const model = getAnthropicModel();

  const placesKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Enforce cost cap check (Requirement 6)
  const costCheck = await checkAgentCostCap("prospect-researcher");
  if (!costCheck.allowed) {
    const alertMsg = `*@prospect-researcher* halted: Daily cost cap exceeded ($${costCheck.currentSpend.toFixed(2)} >= $${costCheck.cap.toFixed(2)}).`;
    console.warn(`[Prospect Researcher] ${alertMsg}`);
    const alertsChannel = getAlertsChannel();
    await postLine({ channel: alertsChannel, text: alertMsg }).catch(() => {});
    return {
      city: options?.city || "Delhi NCR",
      category: options?.category || "cosmetic_dental",
      discoveredCount: 0,
      qualifiedCount: 0,
      benchedCount: 0,
      dedupedCount: 0,
      prospects: [],
      placesCallsUsed: 0,
      playwrightSearches: 0,
      tokens: { input: 0, output: 0, costUsd: 0 },
      cardTs: undefined,
      csvPath: "",
      rejectionPatternProposal: undefined,
      standupLines: {
        did: "Halted due to daily cost cap",
        blocked: `Daily cost cap exceeded ($${costCheck.currentSpend.toFixed(2)} >= $${costCheck.cap.toFixed(2)})`,
        need: "Cost cap increase or daily reset",
        tomorrow: "Resume sourcing tomorrow upon daily budget reset",
      },
    };
  }

  if ((!placesKey || !supabaseKey) && !isTest) {
    console.log("DRY RUN — no keys, nothing sourced");
    return {
      city: options?.city || "Delhi NCR",
      category: options?.category || "cosmetic_dental",
      discoveredCount: 0,
      qualifiedCount: 0,
      benchedCount: 0,
      dedupedCount: 0,
      prospects: [],
      placesCallsUsed: 0,
      playwrightSearches: 0,
      tokens: { input: 0, output: 0, costUsd: 0 },
      cardTs: undefined,
      csvPath: "",
      rejectionPatternProposal: undefined,
      standupLines: {
        did: "DRY RUN — no keys, nothing sourced",
        blocked: "Keys unconfigured",
        need: "None",
        tomorrow: "Awaiting Railway deployment and secrets configuration",
      },
    };
  }

  // 1. Sync rotation state from repo if on ephemeral container boot
  await syncRotationStateFromRepo(options);

  // Resolve rotation city & category
  const rotation = getNextRotation({
    cityOverride: options?.city,
    categoryOverride: options?.category,
    testMode: isTest,
  });

  const city = rotation.city;
  const category = rotation.category;
  const targetCount = options?.targetCount || 20;

  console.log(`\n==========================================================================`);
  console.log(`[Prospect Researcher Run] Target Metro & Category: ${city} × ${category}`);
  console.log(`[Prospect Researcher] Sourcing batch: ${city} × ${category} (Target: ${targetCount})`);
  console.log(`Evidence Standard: Places place_id + DNS + Apollo/Hunter verified email + 5-dim reasons (rubric v2, Dim 4 AI visibility probe)`);
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
    placeDetailsFailed: 0,
    emailVerified: 0,
    phoneVerified: 0,
    contactUnverified: 0,
    scoredGe70: 0,
    scoredBelow70: 0,
    benched: 0,
    probeSkipped: 0,
    writeGatePassed: 0,
    writeGateFailed: 0,
    dedupedOut: 0,
    finalQualified: 0,
  };

  // 3b. Rubric v2 rotation: benched candidates (nurture / bench, 50 to 69 under v1) are re-scored under v2
  // BEFORE new discovery. One Dimension 4 probe per candidate, under the agent's daily cap.
  const probeGovernor = createDim4ProbeGovernor({ testMode: isTest });
  const benchResult: BenchRescoreResult = await rescoreBenchedProspects({
    prospects: existingProspects,
    probe: probeGovernor.probe,
  });
  let benchPromotedSaved = 0;
  if (benchResult.eligible > 0) {
    console.log(
      `[Bench Re-score v2] ${benchResult.eligible} benched candidate(s): ${benchResult.promoted.length} promoted (>= ${FIT_QUALIFIED_THRESHOLD}), ${benchResult.stillBenched.length} still benched, ${benchResult.rejected.length} rejected, ${benchResult.notProbed.length} not probed (retry next run)`
    );
    if (benchResult.touched.length > 0) {
      const benchWrite = await upsertProspectRecords(benchResult.touched, options);
      if (benchWrite.persistedToSupabase || isTest) {
        benchPromotedSaved = benchResult.promoted.length;
      }
    }
  }

  // 4. Candidate Discovery via Google Places API (real network call)
  const rawCandidates = await searchPlacesCandidates(city, category, options);
  funnel.discovered = rawCandidates.length;
  console.log(`[Funnel Stage 1] Google Places API returned ${rawCandidates.length} raw candidates for '${category} in ${city}'`);

  // Group candidates by normalized brand token and root domain to detect multi-unit chains
  for (const c of rawCandidates) {
    const { brand, rootDomain } = extractBrandToken(c.name, c.website);
    c.brandPrefix = brand;
    (c as any).rootDomain = rootDomain;
  }
  for (const c of rawCandidates) {
    const rootDomain = (c as any).rootDomain;
    const brand = c.brandPrefix || "";

    const domainMatches = rootDomain ? rawCandidates.filter((x: any) => x.rootDomain === rootDomain).length : 1;
    const brandMatches = brand && brand.length >= 3 ? rawCandidates.filter((x) => x.brandPrefix === brand).length : 1;

    c.placesBrandCount = Math.max(domainMatches, brandMatches);
  }

  // Bench candidates promoted under v2 come first; new discovery fills the rest of the target.
  const qualifiedProspects: ProspectRecord[] = [...benchResult.promoted];
  const newQualifiedProspects: ProspectRecord[] = [];
  // Candidates scored 50 to below 65 this run (issue #177): written with status "bench", kept OFF the qualified list,
  // never on the review card or CSV, never notified, never handed to outreach.
  const benchedProspects: ProspectRecord[] = [];
  let playwrightSearchesUsed = 0;

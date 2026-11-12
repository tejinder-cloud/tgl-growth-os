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
import { enrichCandidateSignals } from "./sources/enrichment.js";
import { evaluateProspectRubricWithProbe, checkPlaybookCDisqualification } from "./rubric.js";
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
import { isGenericBrandPrefix } from "./brand.js";
import { rescoreRows, type RescoreRowSummary } from "./rescore.js";

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

  // Group candidates by normalized brand token and root domain to detect multi-unit chains.
  // Issue #184: a generic brand prefix ("dr.") groups unrelated businesses, so it never counts as a shared brand.
  for (const c of rawCandidates) {
    const { brand, rootDomain } = extractBrandToken(c.name, c.website);
    c.brandPrefix = brand;
    (c as any).rootDomain = rootDomain;
  }
  for (const c of rawCandidates) {
    const rootDomain = (c as any).rootDomain;
    const brand = c.brandPrefix || "";

    const domainMatches = rootDomain ? rawCandidates.filter((x: any) => x.rootDomain === rootDomain).length : 1;
    const brandMatches =
      brand && brand.length >= 3 && !isGenericBrandPrefix(brand)
        ? rawCandidates.filter((x) => x.brandPrefix === brand).length
        : 1;

    c.placesBrandCount = Math.max(domainMatches, brandMatches);
  }

  // Bench candidates promoted under v2 come first; new discovery fills the rest of the target.
  const qualifiedProspects: ProspectRecord[] = [...benchResult.promoted];
  const newQualifiedProspects: ProspectRecord[] = [];
  // Candidates scored 50 to below 65 this run (issue #177): written with status "bench", kept OFF the qualified list,
  // never on the review card or CSV, never notified, never handed to outreach.
  const benchedProspects: ProspectRecord[] = [];
  let playwrightSearchesUsed = 0;

  // Filter candidates through Stage 1-3 (Place ID, Initial Playbook C, and DNS)
  const dnsPassedCandidates: RawPlaceCandidate[] = [];
  for (const cand of rawCandidates) {
    // Gate 1: Places place_id existence
    if (!cand.placeId || !cand.placeIdVerified) {
      console.log(`  • [Gate 1 Dropped] '${cand.name}': Missing verified Places place_id`);
      continue;
    }

    // Gate 2: Playbook C Enterprise Chain Disqualification (by initial signal)
    const initialSignals = {
      meta_ads_active: false,
      meta_ad_count: 0,
      gbp_reviews: cand.userRatingsTotal || 0,
      gbp_owner_replies: false,
      hiring_marketing: false,
      review_surge: false,
      branch_count: cand.placesBrandCount || 1,
      places_brand_count: cand.placesBrandCount,
      brand_prefix: cand.brandPrefix,
    };
    const chainCheck = checkPlaybookCDisqualification(cand.name, cand.website || "", initialSignals, city);
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
      dnsPassedCandidates.push(cand);
    } else {
      // If website not in searchText, fetch Place Details to retrieve website
      const detailed = await enrichPlaceDetails(cand, options);
      cand.website = detailed.website;
      cand.phone = detailed.phone;
      cand.rating = detailed.rating;
      cand.userRatingsTotal = detailed.userRatingsTotal;
      cand.googleMapsUrl = detailed.googleMapsUrl;
      cand.placeDetailsEnriched = detailed.placeDetailsEnriched;
      cand.primaryType = detailed.primaryType || cand.primaryType;
      cand.primaryTypeLabel = detailed.primaryTypeLabel || cand.primaryTypeLabel;

      if (detailed.placeDetailsEnriched) {
        funnel.placeDetailsEnriched++;
      } else {
        funnel.placeDetailsFailed++;
      }

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
      dnsPassedCandidates.push(cand);
    }
  }

  // Gate 4: Place Details Enrichment on ALL candidates that passed DNS
  let enrichmentAttempts = 0;
  let enrichmentFailures = 0;

  for (const cand of dnsPassedCandidates) {
    if (!cand.placeDetailsEnriched) {
      enrichmentAttempts++;
      const detailed = await enrichPlaceDetails(cand, options);
      cand.name = detailed.name;
      cand.address = detailed.address;
      cand.website = detailed.website || cand.website;
      cand.phone = detailed.phone || cand.phone;
      cand.rating = detailed.rating !== undefined ? detailed.rating : cand.rating;
      cand.userRatingsTotal = detailed.userRatingsTotal !== undefined ? detailed.userRatingsTotal : cand.userRatingsTotal;
      cand.googleMapsUrl = detailed.googleMapsUrl || cand.googleMapsUrl;
      cand.primaryType = detailed.primaryType || cand.primaryType;
      cand.primaryTypeLabel = detailed.primaryTypeLabel || cand.primaryTypeLabel;
      cand.placeDetailsEnriched = detailed.placeDetailsEnriched;

      if (detailed.placeDetailsEnriched) {
        funnel.placeDetailsEnriched++;
      } else {
        enrichmentFailures++;
        funnel.placeDetailsFailed++;
        console.warn(`  • [Gate 4 Enrichment Failed] '${cand.name}': ${detailed.placeDetailsError || "Unknown API error"}`);
      }
    }
  }

  // Circuit Breaker:
  // "a run where enrichment fails for more than half the candidates must stop and alert rather than score blind."
  if (enrichmentAttempts > 0 && enrichmentFailures > Math.floor(enrichmentAttempts / 2) && !isTest) {
    const alertMsg = `*[Prospect Researcher Circuit Breaker]* Place Details enrichment failed for ${enrichmentFailures} of ${enrichmentAttempts} candidates (>50% failure rate). Halting run to prevent blind scoring. Places API error or quota ceiling reached.`;
    console.error(alertMsg);
    const alertsChannel = getAlertsChannel();
    await postLine({ channel: alertsChannel, text: alertMsg }).catch(() => {});
    return {
      city,
      category,
      discoveredCount: rawCandidates.length,
      qualifiedCount: 0,
      benchedCount: 0,
      dedupedCount: 0,
      prospects: [],
      placesCallsUsed: getPlacesQuotaState(options).count,
      playwrightSearches: 0,
      tokens: { input: 0, output: 0, costUsd: 0 },
      cardTs: undefined,
      csvPath: "",
      rejectionPatternProposal: undefined,
      standupLines: {
        did: `Discovered ${rawCandidates.length} candidates in ${city} (${category}), but Place Details enrichment failed for ${enrichmentFailures}/${enrichmentAttempts} candidates.`,
        blocked: `Place Details enrichment failed for >50% candidates: halted by circuit breaker to avoid blind scoring.`,
        need: "Places API investigation (quota, billing, or field mask).",
        tomorrow: `Resume next scheduled metro upon resolving Places enrichment.`,
      },
    };
  }

  // 5. Processing Loop: Website Scraping, Meta Ads, Contact Resolution, Deduplication, Rubric v2 Scoring
  for (const cand of dnsPassedCandidates) {
    if (qualifiedProspects.length >= targetCount) {
      break;
    }

    const website = cand.website || "";

    // Gate 5: Meta Ad Library check via Playwright & Apollo/Hunter Contact Resolution
    // Signals from Places, website scrape and Meta Ad Library populate BEFORE scoring
    const enrichedDetails = await enrichCandidateSignals(cand, category, options);
    playwrightSearchesUsed++;

    // Gate 6: Contact Verification Gate
    // - For large organisations (>=50 staff, e.g. hospitals): MUST have Hunter-verified work email
    // - For owner-run clinics (<50 staff): Places verified business phone is accepted
    const dm = enrichedDetails.decisionMaker;
    const isHunterEmail = Boolean(
      dm.verified &&
      dm.email &&
      dm.email.includes("@") &&
      dm.source &&
      dm.source.includes("hunter:")
    );
    const isOwnerPhone = Boolean(
      dm.verified &&
      dm.phone &&
      String(dm.phone).trim().length >= 8 &&
      dm.source &&
      dm.source.includes("places:phone") &&
      !enrichedDetails.signals.is_large_org
    );

    if (isHunterEmail) {
      funnel.emailVerified++;
    } else if (isOwnerPhone) {
      funnel.phoneVerified++;
    } else {
      funnel.contactUnverified++;
      console.log(
        `  • [Gate 6 Dropped] '${cand.name}': No verified contact (requires Hunter work email for large orgs or Places phone for owner-run clinics) (${dm.source})`
      );
      continue;
    }

    // Gate 7: Deduplication against Supabase, GHL, and rejections/ (Playbook E: before scoring, so a duplicate never costs a probe)
    // Candidates benched earlier in this run are included so the same business is never benched twice.
    const dedupeCheck = await isProspectDuplicate(
      {
        company: cand.name,
        website,
        email: enrichedDetails.decisionMaker.email,
        phone: enrichedDetails.decisionMaker.phone,
      },
      [...existingProspects, ...qualifiedProspects, ...benchedProspects],
      options
    );

    if (dedupeCheck.isDuplicate) {
      funnel.dedupedOut++;
      console.log(`  • [Gate 7 Deduplicated] '${cand.name}': ${dedupeCheck.reason}`);
      continue;
    }

    // Gate 8: Rubric v2 Fit Scoring (>= 65 qualifies, 50 to 64 is benched, below 50 or disqualified is rejected).
    // The Dimension 4 probe runs only for a candidate that survived Playbook C and Dimension 5, once, under the daily cap.
    const rubricResult = await evaluateProspectRubricWithProbe({
      company: cand.name,
      domain: website,
      category,
      city,
      signals: enrichedDetails.signals,
      decisionMaker: enrichedDetails.decisionMaker,
      probe: probeGovernor.probe,
    });

    if (rubricResult.probeUnavailable) {
      funnel.probeSkipped++;
      console.log(`  • [Gate 8 Not Scored] '${cand.name}': Dimension 4 probe unavailable (${probeGovernor.stats.haltedReason || "engine call failed"}); retried on a later run`);
      continue;
    }

    // Gate 8 routing + Gate 9 hard write validation (bench-save.ts). Assembles the authoritative ProspectRecord:
    // status "new" when qualified, status "bench" (decision maker minimised) when scored 50 to 64.
    // Issue #184: the decision maker (verified flag) and signals (large-org cap reason) as judged by the rubric are stored.
    const routed = routeScoredCandidate(
      {
        company: cand.name,
        category,
        city,
        website,
        evaluation: rubricResult,
        decisionMaker: rubricResult.decisionMaker ?? enrichedDetails.decisionMaker,
        signals: rubricResult.signals ?? enrichedDetails.signals,
        sourceRefs: enrichedDetails.sourceRefs,
      },
      { qualified: qualifiedProspects, benched: benchedProspects }
    );

    if (routed.route === "rejected") {
      funnel.scoredBelow70++;
      console.log(
        `  • [Gate 8 Dropped] '${cand.name}': ${rubricResult.disqualified ? "disqualified" : `fit score ${rubricResult.fitScore} below bench floor (${FIT_BENCH_FLOOR})`}`
      );
      continue;
    }

    if (routed.route === "qualified") {
      funnel.scoredGe70++;
    } else {
      funnel.scoredBelow70++;
    }

    if (!routed.placed) {
      funnel.writeGateFailed++;
      console.log(`  • [Gate 9 Dropped] '${cand.name}': Write gate rejected (${routed.writeRejectedReason})`);
      continue;
    }

    if (routed.route === "bench") {
      funnel.benched++;
      console.log(`  [BENCHED] '${routed.record!.company}' (Score: ${routed.record!.fit_score}): saved with status bench, no notification, no outreach hand-off`);
      continue;
    }

    funnel.writeGatePassed++;
    newQualifiedProspects.push(routed.record!);
    funnel.finalQualified = qualifiedProspects.length;
    console.log(`  [QUALIFIED] [${qualifiedProspects.length}/${targetCount}]: '${routed.record!.company}' (Score: ${routed.record!.fit_score})`);
  }

  const probeShortfall = probeGovernor.shortfallReport();
  if (probeShortfall) {
    console.warn(`[Dim 4 Probe] ${probeShortfall}`);
  }

  console.log(`\n==========================================================================`);
  console.log(`FUNNEL VALIDATOR SUMMARY (${city} · ${category})`);
  console.log(`==========================================================================`);
  console.log(`0. Benched re-scored under v2 (promoted):    ${benchResult.eligible} eligible / ${benchResult.promoted.length} promoted`);
  console.log(`1. Raw Candidates (Google Places API):       ${funnel.discovered}`);
  console.log(`2. Live DNS Passed / Failed:                ${funnel.dnsPassed} passed / ${funnel.dnsFailed} failed`);
  console.log(`3. Playbook C Disqualified (Chains):        ${funnel.playbookCDisqualified}`);
  console.log(`4. Place Details Enriched / Failed:         ${funnel.placeDetailsEnriched} enriched / ${funnel.placeDetailsFailed} failed`);
  console.log(`5. Contact Verified (Hunter Email / Phone):  ${funnel.emailVerified} email / ${funnel.phoneVerified} owner-phone / ${funnel.contactUnverified} dropped`);
  console.log(`6. Fit Score >= ${FIT_QUALIFIED_THRESHOLD} / Below ${FIT_QUALIFIED_THRESHOLD}:              ${funnel.scoredGe70} passed / ${funnel.scoredBelow70} sub-cutoff (${funnel.benched} benched) / ${funnel.probeSkipped} not probed`);
  console.log(`7. Write Gate Validated / Dropped:          ${funnel.writeGatePassed} passed / ${funnel.writeGateFailed} failed`);
  console.log(`8. Deduplicated Out:                        ${funnel.dedupedOut}`);
  console.log(`--------------------------------------------------------------------------`);
  console.log(`TOTAL QUALIFIED SURVIVORS:               ${qualifiedProspects.length} / ${targetCount} target`);
  console.log(`BENCHED THIS RUN (${FIT_BENCH_FLOOR} to ${FIT_QUALIFIED_THRESHOLD - 1}):              ${benchedProspects.length}`);
  console.log(`==========================================================================\n`);

  // 6. Upsert new records to Supabase & read-back verification (bench rows were written right after re-scoring)
  const writeResult = await upsertProspectRecords(newQualifiedProspects, options);
  const savedCount = writeResult.readBackCount + benchPromotedSaved;

  // 6b. Save candidates benched this run (status "bench"). They are not part of savedCount, the card or the CSV,
  // and a failed bench write is logged only: nothing is posted to Slack for a benched candidate.
  let benchSavedCount = 0;
  if (benchedProspects.length > 0) {
    const benchWriteResult = await upsertProspectRecords(benchedProspects, options);
    benchSavedCount = benchWriteResult.readBackCount;
    if (benchSavedCount < benchedProspects.length) {
      console.warn(
        `[Bench Save Notice] ${benchSavedCount} of ${benchedProspects.length} benched candidate(s) verified in public.prospects${benchWriteResult.error ? ` (${benchWriteResult.error})` : ""}`
      );
    }
  }

  // Insert failure alert: if records were qualified but 0 saved in production, alert #alerts
  if (!isTest && qualifiedProspects.length > 0 && savedCount === 0) {
    console.error(`[Prospect Researcher Alert] 0 rows saved to Supabase! Alerting #alerts...`);
    await postLine({
      channel: config.alertsChannelId || "#alerts",
      text: `*[Prospect Researcher Alert]* Supabase write-back failed: 0 of ${qualifiedProspects.length} accounts saved to \`public.prospects\`. Write error: \`${writeResult.error || "Zero rows verified via read-back"}\``,
    }).catch((err) => console.warn(`[Alert Post Error]:`, err));
  }

  // Advance rotation state unless manual override was used
  if (!rotation.isOverridden) {
    advanceRotation(options);
  }

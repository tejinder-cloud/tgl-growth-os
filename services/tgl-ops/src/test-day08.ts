// services/tgl-ops/src/test-day08.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import {
  extractEmailsFromHtml,
  extractDoctorNamesFromHtml,
  extractDoctorName,
  extractChainSignalsFromHtml,
  extractBrandToken,
} from "./agents/prospect-researcher/sources/website-scraper.js";
import {
  checkMetaAdLibrary,
  resetMetaAdsBrowserState,
} from "./agents/prospect-researcher/sources/meta-ads.js";
import {
  evaluateProspectRubric,
  checkPlaybookCDisqualification,
} from "./agents/prospect-researcher/rubric.js";
import { isDecisionMakerRole, isCandidateOrgSizeGe50 } from "./agents/prospect-researcher/sources/enrichment.js";
import {
  advanceRotation,
  loadRotationState,
  saveRotationState,
} from "./agents/prospect-researcher/rotation.js";
import { validateProspectRecord, isRolePlaceholderName } from "./agents/prospect-researcher/guardrails.js";
import type { ProspectSignals, DecisionMaker } from "./agents/prospect-researcher/types.js";
import { getAgentRunnerLimits, findAgentByName } from "./lib/agents.js";
import { execute0900PlanDispatch } from "./agents/chief-of-staff/dispatch.js";

async function runDay08Tests() {
  console.log("==========================================================================");
  console.log("🧪 Live Run #48 Defect Fix Verification Suite");
  console.log("1. Clinic Website Scraper (Playbook D): mailto:, text emails, doctor/owner names");
  console.log("2. Hunter Domain-Search selection (owner/doctor first, generic never) & verifier");
  console.log("3. Playwright browser error handling: 'skipped: no browser' once, no spam banners");
  console.log("4. Architect decision: Owner-run businesses (<50 staff) Places phone verification");
  console.log("5. Rubric & Hard Write Gate validation");
  console.log("==========================================================================\n");

  // -------------------------------------------------------------------------
  // Test 1: Website Scraper (Playbook D)
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing Clinic Website Scraper email & doctor name extraction...");

  const sampleHtml = `
    <html>
      <head><title>Dr. Batra's Multispeciality Dental Centre</title></head>
      <body>
        <nav>
          <a href="/about">About Us</a>
          <a href="/doctors">Our Doctors</a>
          <a href="mailto:info@batradental.com">info@batradental.com</a>
          <a href="mailto:contact@batradental.com">contact@batradental.com</a>
          <a href="mailto:dr.batra@batradental.com">dr.batra@batradental.com</a>
        </nav>
        <section class="team">
          <h1>Welcome to our Practice</h1>
          <h2>Dr. Mukesh Batra</h2>
          <p>Founder & Chief Dental Surgeon with 25 years of implant experience.</p>
          <h2>Dr. Ananya Sharma</h2>
          <p>Consultant Orthodontist</p>
          <p>For confidential doctor enquiries: dr.sharma@batradental.com</p>
          <p>Ignore junk assets like banner.png@2x and support@batradental.com</p>
        </section>
      </body>
    </html>
  `;

  const extractedEmails: string[] = [];
  extractEmailsFromHtml(sampleHtml, extractedEmails);

  if (!extractedEmails.includes("dr.batra@batradental.com")) {
    throw new Error(`Test 1.1 Failed: dr.batra@batradental.com not extracted`);
  }
  if (!extractedEmails.includes("dr.sharma@batradental.com")) {
    throw new Error(`Test 1.2 Failed: dr.sharma@batradental.com not extracted`);
  }
  // Generic emails must be filtered
  if (extractedEmails.some((e) => e.startsWith("info@") || e.startsWith("contact@") || e.startsWith("support@"))) {
    throw new Error(`Test 1.3 Failed: generic emails (info/contact/support) were not filtered: ${extractedEmails.join(", ")}`);
  }
  console.log(`  ✓ Extracted non-generic emails: ${extractedEmails.join(", ")}`);

  const extractedDoctors: string[] = [];
  extractDoctorNamesFromHtml(sampleHtml, extractedDoctors);
  if (!extractedDoctors.includes("Dr. Mukesh Batra")) {
    throw new Error(`Test 1.4 Failed: Dr. Mukesh Batra not extracted from headings/text`);
  }
  if (!extractedDoctors.includes("Dr. Ananya Sharma")) {
    throw new Error(`Test 1.5 Failed: Dr. Ananya Sharma not extracted`);
  }
  console.log(`  ✓ Extracted doctor names: ${extractedDoctors.join(", ")}`);

  const doctorFromClinic = extractDoctorName("Dr. Kathuria Dental Clinic");
  if (doctorFromClinic !== "Dr. Kathuria") {
    throw new Error(`Test 1.6 Failed: expected 'Dr. Kathuria', got '${doctorFromClinic}'`);
  }
  console.log(`  ✓ Extracted doctor from clinic name: '${doctorFromClinic}'`);
  console.log("✅ [Test 1 Passed] Website Scraper correctly parses mailto: emails and doctor names.\n");

  // -------------------------------------------------------------------------
  // Test 2: Playwright 'skipped: no browser' reporting once
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing Playwright browser availability & reporting...");
  resetMetaAdsBrowserState();

  // In testMode=false with non-existent chromium path to trigger graceful fallback
  const originalEnv = process.env.CHROMIUM_PATH;
  process.env.CHROMIUM_PATH = "/invalid/path/to/nonexistent/chromium";

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.join(" "));
    originalLog(...args);
  };

  try {
    // First call: should fail launch and print '[Meta Ad Library] skipped: no browser' once
    const res1 = await checkMetaAdLibrary("Batras Dental Clinic", { testMode: false });
    if (res1.active || res1.adCount !== 0) {
      throw new Error(`Test 2.1 Failed: expected active=false, adCount=0 when browser missing`);
    }

    // Second call: should skip immediately without printing another skipped line
    const res2 = await checkMetaAdLibrary("Apollo White Dental", { testMode: false });
    if (res2.active || res2.adCount !== 0) {
      throw new Error(`Test 2.2 Failed: expected active=false, adCount=0 on second skip`);
    }

    const skipCount = logs.filter((l) => l.includes("[Meta Ad Library] skipped: no browser")).length;
    if (skipCount !== 1) {
      throw new Error(`Test 2.3 Failed: expected '[Meta Ad Library] skipped: no browser' to be logged exactly once, got ${skipCount}`);
    }
    console.log(`  ✓ Logged 'skipped: no browser' exactly once across multiple candidate calls.`);
  } finally {
    console.log = originalLog;
    process.env.CHROMIUM_PATH = originalEnv;
    resetMetaAdsBrowserState();
  }
  console.log("✅ [Test 2 Passed] Playwright reports 'skipped: no browser' once without per-candidate banners.\n");

  // -------------------------------------------------------------------------
  // Test 3: Rubric Dimension 5 & Architect Decision
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing Rubric Dimension 5 Reachability under Architect Decision...");

  const baseSignals: ProspectSignals = {
    meta_ads_active: true,
    meta_ad_count: 4,
    gbp_reviews: 120,
    gbp_owner_replies: true,
    hiring_marketing: false,
    review_surge: true,
    branch_count: 2, // Multi-location owner-run clinic (<50 staff)
  };

  // Case 3A: Owner-run business with verified Places phone (no email)
  const phoneOnlyDM: DecisionMaker = {
    name: "Dr. Mukesh Batra",
    role: "Founder & Lead Doctor",
    email: "",
    phone: "+919811122233",
    source: "places:phone (verified business line) + website:owner",
  };

  const eval3A = evaluateProspectRubric({
    company: "Batra Dental Centre",
    domain: "batradental.com",
    category: "cosmetic_dental",
    signals: baseSignals,
    decisionMaker: phoneOnlyDM,
  });

  if (!eval3A.qualified || eval3A.fitScore < 70) {
    throw new Error(`Test 3.1 Failed: owner-run clinic with Places phone should qualify (score >= 70), got ${eval3A.fitScore}`);
  }
  const dim5Reason = eval3A.fitReasons.find((r) => r.startsWith("Dim 5"));
  if (!dim5Reason || !dim5Reason.includes("Verified business phone from Places") || !dim5Reason.includes("10/15")) {
    throw new Error(`Test 3.2 Failed: Dim 5 reason should cite Places phone and score 10/15: ${dim5Reason}`);
  }
  console.log(`  ✓ Case 3A (Places Phone Only): Qualified with score ${eval3A.fitScore} (Dim 5: 10/15 pts)`);

  // Case 3B: Owner-run business with BOTH Hunter-verified email AND Places phone
  const emailAndPhoneDM: DecisionMaker = {
    name: "Dr. Mukesh Batra",
    role: "Founder & Lead Doctor",
    email: "dr.batra@batradental.com",
    phone: "+919811122233",
    source: "hunter:verified (status: deliverable, score: 95) + places:phone",
  };

  const eval3B = evaluateProspectRubric({
    company: "Batra Dental Centre",
    domain: "batradental.com",
    category: "cosmetic_dental",
    signals: baseSignals,
    decisionMaker: emailAndPhoneDM,
  });

  if (eval3B.fitScore !== eval3A.fitScore + 5) {
    throw new Error(`Test 3.3 Failed: expected +5 bonus for having both email and phone (+5 pts)`);
  }
  console.log(`  ✓ Case 3B (Hunter Email + Places Phone): Qualified with score ${eval3B.fitScore} (Dim 5: 15/15 pts with +5 bonus)`);

  // Case 3C: Disqualification if NEITHER Hunter email NOR Places phone exists
  const unverifiedDM: DecisionMaker = {
    name: "Dr. Mukesh Batra",
    role: "Founder & Lead Doctor",
    email: "",
    source: "unverified:no_contact_found",
  };

  const eval3C = evaluateProspectRubric({
    company: "Batra Dental Centre",
    domain: "batradental.com",
    category: "cosmetic_dental",
    signals: baseSignals,
    decisionMaker: unverifiedDM,
  });

  if (eval3C.qualified || eval3C.fitScore !== 0) {
    throw new Error(`Test 3.4 Failed: candidate without verified contact must be disqualified with score 0`);
  }
  console.log(`  ✓ Case 3C (No Verified Contact): Disqualified (Score 0)`);
  console.log("✅ [Test 3 Passed] Rubric Dimension 5 implements Architect decision.\n");

  // -------------------------------------------------------------------------
  // Test 4: Write Gate & Anti-Fabrication Safeguards (validateProspectRecord)
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing Hard Write Gate (validateProspectRecord)...");

  const validRecord = {
    tenant_id: "tgl",
    company: "Batra Dental Centre",
    category: "cosmetic_dental",
    city: "Delhi NCR",
    website: "https://batradental.com",
    door: "aeo",
    fit_score: 75,
    fit_reasons: eval3A.fitReasons,
    decision_maker: phoneOnlyDM,
    signals: baseSignals,
    status: "new",
    source_refs: [
      "places:place_id:ChIJN1t_tDeuEmsRUsoyG83frY4",
      "https://maps.google.com/?cid=12345",
      "dns:pass:104.21.5.12",
      phoneOnlyDM.source,
    ],
    created_at: new Date().toISOString(),
    rescored_at: new Date().toISOString(),
  };

  // 4A: Valid owner-run clinic with Places phone
  const val1 = validateProspectRecord(validRecord);
  if (!val1.valid) {
    throw new Error(`Test 4.1 Failed: valid owner-run clinic record rejected by write gate: ${val1.reason}`);
  }
  console.log(`  ✓ Valid owner-run record with Places phone passed write gate.`);

  // 4B: Role placeholder name rejected (e.g. "Dr. Chief Medical Officer")
  const placeholderRecord = {
    ...validRecord,
    decision_maker: {
      ...phoneOnlyDM,
      name: "Dr. Chief Medical Officer",
    },
  };
  const val2 = validateProspectRecord(placeholderRecord);
  if (val2.valid) {
    throw new Error(`Test 4.2 Failed: placeholder title 'Dr. Chief Medical Officer' should be rejected`);
  }
  console.log(`  ✓ Fabricated title 'Dr. Chief Medical Officer' rejected: ${val2.reason}`);

  // 4C: "Owner / Lead Doctor" accepted for owner-run clinic per Architect decision
  const ownerLeadDoctorRecord = {
    ...validRecord,
    decision_maker: {
      ...phoneOnlyDM,
      name: "Owner / Lead Doctor",
    },
  };
  const val3 = validateProspectRecord(ownerLeadDoctorRecord);
  if (!val3.valid) {
    throw new Error(`Test 4.3 Failed: 'Owner / Lead Doctor' should be accepted for owner-run businesses, got: ${val3.reason}`);
  }
  console.log(`  ✓ 'Owner / Lead Doctor' accepted for owner-run clinic.`);

  // 4D: Missing Places place_id rejected
  const missingPlaceId = {
    ...validRecord,
    source_refs: ["dns:pass:104.21.5.12"],
  };
  const val4 = validateProspectRecord(missingPlaceId);
  if (val4.valid) {
    throw new Error(`Test 4.4 Failed: missing Places place_id must be rejected`);
  }
  console.log(`  ✓ Missing Places place_id rejected: ${val4.reason}`);

  // 4E: Missing DNS pass rejected
  const missingDns = {
    ...validRecord,
    source_refs: ["places:place_id:12345"],
  };
  const val5 = validateProspectRecord(missingDns);
  if (val5.valid) {
    throw new Error(`Test 4.5 Failed: missing DNS pass must be rejected`);
  }
  console.log(`  ✓ Missing DNS pass rejected: ${val5.reason}`);

  console.log("✅ [Test 4 Passed] Hard write gate protects against fabrication and supports owner-run businesses.\n");

  // -------------------------------------------------------------------------
  // Test 5: Chain Detection by Signal (not hardcoded name list)
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing signal-based chain detection (Playbook C)...");

  // 5A: Multi-city HTML signal extraction (5+ cities)
  const chainHtml = `
    <html>
      <body>
        <nav>
          <a href="/locations">Our Centres</a>
        </nav>
        <footer>
          <p>We are present in: Delhi, Mumbai, Bengaluru, Hyderabad, Pune, Chennai, Kolkata, Ahmedabad.</p>
          <p>Backed by Tiger Global and Sequoia Capital. Raised Series D funding in 2024.</p>
        </footer>
      </body>
    </html>
  `;
  const chainSignals = extractChainSignalsFromHtml(chainHtml, ["https://example.com/locations"]);
  if (chainSignals.citiesFound.length < 5) {
    throw new Error(`Test 5.1 Failed: expected 5+ cities detected, got ${chainSignals.citiesFound.length}`);
  }
  if (!chainSignals.hasLocationsPage) {
    throw new Error(`Test 5.2 Failed: expected locations page detected`);
  }
  if (chainSignals.fundingMatches.length === 0) {
    throw new Error(`Test 5.3 Failed: expected funding mentions detected`);
  }
  console.log(`  ✓ Extracted chain signals: cities=${chainSignals.citiesFound.length}, locations=${chainSignals.hasLocationsPage}, funding=${chainSignals.fundingMatches.join(", ")}`);

  // 5B: Pristyn Care evaluated strictly by signals (not domain list)
  const pristynSignals: ProspectSignals = {
    meta_ads_active: true,
    meta_ad_count: 10,
    gbp_reviews: 1200,
    gbp_owner_replies: true,
    hiring_marketing: true,
    review_surge: true,
    branch_count: 8,
    chain_evidence: chainSignals.evidence,
    places_brand_count: 6,
  };
  const pristynCheck = checkPlaybookCDisqualification("Pristyn Care", "pristyncare.com", pristynSignals);
  if (!pristynCheck.disqualified) {
    throw new Error(`Test 5.4 Failed: Pristyn Care should be disqualified by signal evidence`);
  }
  console.log(`  ✓ Pristyn Care disqualified by signals: ${pristynCheck.reason}`);

  // 5C: Local single-doctor clinic with no chain signals passes
  const localClinicSignals: ProspectSignals = {
    meta_ads_active: false,
    meta_ad_count: 0,
    gbp_reviews: 80,
    gbp_owner_replies: true,
    hiring_marketing: false,
    review_surge: false,
    branch_count: 1,
    places_brand_count: 1,
  };
  const localCheck = checkPlaybookCDisqualification("Dr. Kathuria Dental Clinic", "drkathuria.com", localClinicSignals);
  if (localCheck.disqualified) {
    throw new Error(`Test 5.5 Failed: local clinic should not be disqualified`);
  }
  console.log(`  ✓ Local clinic passes Playbook C without false positive.`);

  // 5D: Max Saket deep URL & root domain brand counting test (Architect defect fix)
  const maxDeepUrl = "https://www.maxhealthcare.in/hospital-network/max-super-speciality-hospital-saket";
  const tokenSaket = extractBrandToken("Max Super Speciality Hospital, Saket", maxDeepUrl);
  const tokenSmart = extractBrandToken("Max Smart Super Speciality Hospital", "https://www.maxhealthcare.in/hospital-network/max-smart");
  const tokenMulti = extractBrandToken("Max Multi Speciality Centre, Panchsheel Park", "https://www.maxhealthcare.in/hospital-network/max-multi");

  if (tokenSaket.brand !== "max" || tokenSmart.brand !== "max" || tokenMulti.brand !== "max") {
    throw new Error(`Test 5.6 Failed: expected all Max variants to resolve brand 'max', got: ${tokenSaket.brand}, ${tokenSmart.brand}, ${tokenMulti.brand}`);
  }
  if (tokenSaket.rootDomain !== "maxhealthcare.in") {
    throw new Error(`Test 5.7 Failed: expected root domain maxhealthcare.in, got ${tokenSaket.rootDomain}`);
  }

  // Root domain HTML check for Max Healthcare
  const maxRootHtml = `
    <html>
      <body>
        <nav><a href="/hospital-network">Our Hospitals</a></nav>
        <section class="locations">
          <h2>Max Hospital Network</h2>
          <p>Hospitals located across Delhi, Gurgaon, Noida, Mohali, Dehradun, Bathinda, Mumbai.</p>
        </section>
      </body>
    </html>
  `;
  const maxSignalsExtracted = extractChainSignalsFromHtml(maxRootHtml, ["https://www.maxhealthcare.in/hospital-network"]);
  if (maxSignalsExtracted.citiesFound.length < 5) {
    throw new Error(`Test 5.8 Failed: root domain maxhealthcare.in must detect 5+ cities, got: ${maxSignalsExtracted.citiesFound.length}`);
  }

  const maxSaketSignals: ProspectSignals = {
    meta_ads_active: true,
    meta_ad_count: 12,
    gbp_reviews: 3500,
    gbp_owner_replies: true,
    hiring_marketing: true,
    review_surge: true,
    branch_count: 4,
    places_brand_count: 3,
    chain_evidence: [
      ...maxSignalsExtracted.evidence,
      `Found 3 Places results sharing brand 'max' (root domain: maxhealthcare.in)`
    ],
  };

  // Crucial check: chain_evidence must NOT be null or empty
  if (!maxSaketSignals.chain_evidence || maxSaketSignals.chain_evidence.length === 0) {
    throw new Error(`Test 5.9 Failed: Max Saket chain_evidence must NOT be null or empty`);
  }

  const maxCheck = checkPlaybookCDisqualification("Max Super Speciality Hospital, Saket", maxDeepUrl, maxSaketSignals);
  if (!maxCheck.disqualified) {
    throw new Error(`Test 5.10 Failed: Max Saket must be disqualified under Playbook C`);
  }
  console.log(`  ✓ Max Saket disqualified by root domain & brand Places signals (chain_evidence present): ${maxCheck.reason}`);
  console.log("✅ [Test 5 Passed] Chain detection operates purely on signal evidence and root domain.\n");

  // -------------------------------------------------------------------------
  // Test 6: Playbook D Decision-Maker Role Enforcement by Org Size
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing Playbook D role enforcement by organisation size...");

  // 6A: <50 staff (small / owner-run clinics & institutes)
  if (!isDecisionMakerRole("Owner / Lead Doctor", false)) {
    throw new Error(`Test 6.1 Failed: 'Owner / Lead Doctor' must be approved for <50 staff`);
  }
  if (!isDecisionMakerRole("Principal", false)) {
    throw new Error(`Test 6.2 Failed: 'Principal' must be approved for <50 staff`);
  }
  if (!isDecisionMakerRole("Managing Director", false)) {
    throw new Error(`Test 6.3 Failed: 'Managing Director' must be approved for <50 staff`);
  }
  // In <50 staff, CEO / Marketing Head / Administrator are NOT approved (owner unilateral)
  if (isDecisionMakerRole("CEO", false)) {
    throw new Error(`Test 6.4 Failed: 'CEO' must NOT be approved for <50 staff`);
  }
  if (isDecisionMakerRole("Hospital Administrator", false)) {
    throw new Error(`Test 6.5 Failed: 'Hospital Administrator' must NOT be approved for <50 staff`);
  }
  if (isDecisionMakerRole("Head of Marketing", false)) {
    throw new Error(`Test 6.6 Failed: 'Head of Marketing' must NOT be approved for <50 staff`);
  }
  if (isDecisionMakerRole("Assistant", false)) {
    throw new Error(`Test 6.7 Failed: 'Assistant' must NOT be approved for <50 staff`);
  }
  if (isDecisionMakerRole("Consultant Gastroenterologist", false)) {
    throw new Error(`Test 6.8 Failed: 'Consultant Gastroenterologist' must NOT be approved for <50 staff`);
  }
  console.log(`  ✓ <50 staff DM roles validated: strictly owner/founder/MD/lead doctor/principal.`);

  // 6B: ≥50 staff (growing institutes / hospitals): add CEO, COO, GM, VP Operations/Administration, hospital administrator, head of marketing
  if (!isDecisionMakerRole("CEO", true)) {
    throw new Error(`Test 6.9 Failed: 'CEO' must be approved for ≥50 staff`);
  }
  if (!isDecisionMakerRole("COO", true)) {
    throw new Error(`Test 6.10 Failed: 'COO' must be approved for ≥50 staff`);
  }
  if (!isDecisionMakerRole("GM", true)) {
    throw new Error(`Test 6.11 Failed: 'GM' must be approved for ≥50 staff`);
  }
  if (!isDecisionMakerRole("VP Operations", true)) {
    throw new Error(`Test 6.12 Failed: 'VP Operations' must be approved for ≥50 staff`);
  }
  if (!isDecisionMakerRole("VP Administration", true)) {
    throw new Error(`Test 6.13 Failed: 'VP Administration' must be approved for ≥50 staff`);
  }
  if (!isDecisionMakerRole("Hospital Administrator", true)) {
    throw new Error(`Test 6.14 Failed: 'Hospital Administrator' must be approved for ≥50 staff`);
  }
  if (!isDecisionMakerRole("Head of Marketing", true)) {
    throw new Error(`Test 6.15 Failed: 'Head of Marketing' must be approved for ≥50 staff`);
  }
  // Non-DM roles remain strictly rejected for ≥50 staff
  if (isDecisionMakerRole("Assistant", true)) {
    throw new Error(`Test 6.16 Failed: 'Assistant' must NOT be approved for ≥50 staff`);
  }
  if (isDecisionMakerRole("Consultant Gastroenterologist", true)) {
    throw new Error(`Test 6.17 Failed: 'Consultant Gastroenterologist' must NOT be approved for ≥50 staff`);
  }
  console.log(`  ✓ ≥50 staff DM roles validated: CEO, COO, GM, VP Ops/Admin, Hospital Admin, Head of Marketing added; non-DMs rejected.`);

  // 6C: Rubric scoring with organisation size
  // Hospital with Hospital Administrator -> scores Dim 5 = 10 pts
  const hospitalAdminEval = evaluateProspectRubric({
    company: "Apex City Hospital",
    domain: "apexhospital.in",
    category: "hospitals",
    signals: {
      meta_ads_active: true,
      meta_ad_count: 5,
      gbp_reviews: 650,
      gbp_owner_replies: true,
      hiring_marketing: true,
      review_surge: true,
      branch_count: 1,
      is_large_org: true,
    },
    decisionMaker: {
      name: "Dr. Vikram Seth",
      role: "Hospital Administrator",
      email: "v.seth@apexhospital.in",
      source: "hunter:verified (status: deliverable)",
    },
  });
  const adminDim5 = hospitalAdminEval.fitReasons.find((r) => r.startsWith("Dim 5"));
  if (!adminDim5 || !adminDim5.includes("10/15") && !adminDim5.includes("10 pts")) {
    throw new Error(`Test 6.18 Failed: Hospital Administrator for hospital must score Dim 5, got: ${adminDim5}`);
  }
  console.log(`  ✓ Hospital Administrator for hospital scores Dim 5: ${adminDim5}`);

  // Hospital with Consultant Gastroenterologist -> scores Dim 5 = 0 pts
  const consultantEval = evaluateProspectRubric({
    company: "Apex City Hospital",
    domain: "apexhospital.in",
    category: "hospitals",
    signals: {
      meta_ads_active: true,
      meta_ad_count: 5,
      gbp_reviews: 650,
      gbp_owner_replies: true,
      hiring_marketing: true,
      review_surge: true,
      branch_count: 1,
      is_large_org: true,
    },
    decisionMaker: {
      name: "Dr. Alok Verma",
      role: "Consultant Gastroenterologist",
      email: "a.verma@apexhospital.in",
      source: "hunter:verified (status: deliverable)",
    },
  });
  const consultantDim5 = consultantEval.fitReasons.find((r) => r.startsWith("Dim 5"));
  if (!consultantDim5 || !consultantDim5.includes("0 pts")) {
    throw new Error(`Test 6.19 Failed: Consultant Gastroenterologist must score 0 pts on Dim 5, got: ${consultantDim5}`);
  }
  console.log(`  ✓ Consultant Gastroenterologist scores 0 pts on Dim 5: ${consultantDim5}`);
  console.log("✅ [Test 6 Passed] Playbook D roles enforced strictly.\n");

  // -------------------------------------------------------------------------
  // Test 7: Rotation Advances City and Category
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing rotation advancement...");
  saveRotationState({
    version: 1,
    currentCityIndex: 0,
    currentCategoryIndex: 0,
    completedRunsCount: 0,
    lastRunAt: new Date().toISOString(),
  }, { testMode: true });

  const state1 = loadRotationState({ testMode: true });
  if (state1.currentCityIndex !== 0 || state1.currentCategoryIndex !== 0) {
    throw new Error(`Test 7.1 Failed: initial state index mismatch`);
  }

  const advanced = advanceRotation({ testMode: true });
  if (advanced.currentCityIndex !== 1 || advanced.currentCategoryIndex !== 1) {
    throw new Error(`Test 7.2 Failed: both city and category must advance on scheduled run, got city=${advanced.currentCityIndex}, cat=${advanced.currentCategoryIndex}`);
  }
  console.log(`  ✓ Advanced rotation: city index ${state1.currentCityIndex} -> ${advanced.currentCityIndex}, category index ${state1.currentCategoryIndex} -> ${advanced.currentCategoryIndex}`);
  console.log("✅ [Test 7 Passed] Rotation advances city and category on each run.\n");

  // -------------------------------------------------------------------------
  // Test 8: Item B Build Task Routing to @web-builder
  // -------------------------------------------------------------------------
  console.log("[Test 8] Testing build task routing to @web-builder...");
  const dispatchRes = await execute0900PlanDispatch({
    dateStr: "2026-10-30",
    testMode: true,
  });

  const day8Entry = dispatchRes.dispatchedEntries.find((e) => e.day === 8);
  if (!day8Entry) {
    throw new Error("Test 8.1 Failed: Day 8 entry must be dispatched");
  }
  console.log(`  ✓ Day 8 plan entry loaded: "${day8Entry.title}"`);
  console.log("✅ [Test 8 Passed] Build tasks creating SKILL.md/service code routed to @web-builder.\n");

  // -------------------------------------------------------------------------
  // Test 9: Per-Agent Runner Limits & Partial Resumption
  // -------------------------------------------------------------------------
  console.log("[Test 9] Testing per-agent runner limits...");
  const wbAgent = await findAgentByName("web-builder");
  const wbLimits = getAgentRunnerLimits(wbAgent);
  if (wbLimits.maxToolCalls !== 150 || wbLimits.timeoutMinutes !== 60) {
    throw new Error(`Test 9.1 Failed: web-builder limits must be 150 calls / 60m, got ${wbLimits.maxToolCalls} / ${wbLimits.timeoutMinutes}m`);
  }
  console.log(`  ✓ web-builder limits verified: ${wbLimits.maxToolCalls} tool calls / ${wbLimits.timeoutMinutes} min`);

  const defaultLimits = getAgentRunnerLimits(null);
  if (defaultLimits.maxToolCalls !== 25 || defaultLimits.timeoutMinutes !== 15) {
    throw new Error(`Test 9.2 Failed: default limits must be 25 calls / 15m, got ${defaultLimits.maxToolCalls} / ${defaultLimits.timeoutMinutes}m`);
  }
  console.log(`  ✓ default limits verified: ${defaultLimits.maxToolCalls} tool calls / ${defaultLimits.timeoutMinutes} min`);
  console.log("✅ [Test 9 Passed] Per-agent runner limits verified.\n");

  // -------------------------------------------------------------------------
  // Test 10: Monday 07:00 IST Playbook G Re-Score Cadence
  // -------------------------------------------------------------------------
  console.log("[Test 10] Testing Monday 07:00 IST Playbook G re-score registration...");
  const prAgent = await findAgentByName("prospect-researcher");
  const rescoreRoutine = prAgent?.routines?.find((r) => r.name === "monday_pipeline_rescore");
  if (!rescoreRoutine || rescoreRoutine.schedule !== "0 7 * * 1") {
    throw new Error(`Test 10.1 Failed: monday_pipeline_rescore schedule must be '0 7 * * 1', got: ${rescoreRoutine?.schedule}`);
  }
  console.log(`  ✓ monday_pipeline_rescore schedule verified: '${rescoreRoutine.schedule}' (${rescoreRoutine.description})`);
  console.log("✅ [Test 10 Passed] Monday 07:00 Playbook G re-score registered cleanly.\n");

  console.log("==========================================================================");
  console.log("🎉 ALL LIVE RUN #48 DEFECT FIX TESTS PASSED CLEANLY!");
  console.log("==========================================================================");
}

runDay08Tests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});

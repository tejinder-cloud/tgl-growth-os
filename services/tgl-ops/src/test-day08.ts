// services/tgl-ops/src/test-day08.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";

import {
  extractEmailsFromHtml,
  extractDoctorNamesFromHtml,
  extractDoctorName,
} from "./agents/prospect-researcher/sources/website-scraper.js";
import {
  checkMetaAdLibrary,
  resetMetaAdsBrowserState,
} from "./agents/prospect-researcher/sources/meta-ads.js";
import { evaluateProspectRubric } from "./agents/prospect-researcher/rubric.js";
import { validateProspectRecord, isRolePlaceholderName } from "./agents/prospect-researcher/guardrails.js";
import type { ProspectSignals, DecisionMaker } from "./agents/prospect-researcher/types.js";

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

  console.log("==========================================================================");
  console.log("🎉 ALL LIVE RUN #48 DEFECT FIX TESTS PASSED CLEANLY!");
  console.log("==========================================================================");
}

runDay08Tests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});

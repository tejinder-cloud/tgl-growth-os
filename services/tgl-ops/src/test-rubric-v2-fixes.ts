// services/tgl-ops/src/test-rubric-v2-fixes.ts
// Rubric v2 fixes (issue #184). Fixture scoring only: no live engine call, no Slack post, no prospect contact,
// no write to decisions/ or logs/. The two "stored 12 Nov" fixtures reproduce the shape of the first two rows that
// qualified under v2 (company name, category, signals, the engine's answer); contact addresses are examples.
import {
  evaluateProspectRubric,
  analyseDim4Answer,
  buildDim4Question,
  parseDim4Probe,
  FIT_QUALIFIED_THRESHOLD,
} from "./agents/prospect-researcher/rubric.js";
import { brandMatchWords, dim4SpecialtyPhrase, type Dim4Probe, type Dim4ProbeFn } from "./agents/prospect-researcher/dim4.js";
import {
  assessWorkEmail,
  isIndividualPractitionerName,
  rootDomainOf,
} from "./agents/prospect-researcher/contact-rules.js";
import { isCandidateOrgSizeGe50 } from "./agents/prospect-researcher/sources/enrichment.js";
import { extractBrandToken } from "./agents/prospect-researcher/sources/website-scraper.js";
import {
  applyContactRuleToStoredDecisionMaker,
  currentDim4QuestionFor,
  hasOutdatedProbeQuestion,
  refreshOutdatedProbes,
} from "./agents/prospect-researcher/probe-refresh.js";
import { validateProspectRecord } from "./agents/prospect-researcher/guardrails.js";
import { createDim4ProbeGovernor } from "./agents/prospect-researcher/probe.js";
import type { DecisionMaker, ProspectRecord, ProspectSignals } from "./agents/prospect-researcher/types.js";
import type { EngineAnswer, EngineConfig } from "./agents/aeo-audit-engine/types.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────
const CITY = "Chandigarh Tricity";
const GENERIC_QUESTION = "best hospital in Chandigarh Tricity";

const CHAIN_BRANCH = "Motherhood Chaitanya Hospital - Sector 44, Chandigarh";
const CHAIN_BRANCH_SITE = "https://motherhoodchaitanya.com/?utm_source=gmb_mhc&utm_medium=localseo&utm_campaign=homepage";
const SURGEON = "Dr. Harsh Aggarwal | Laparoscopic Surgeon";
const SURGEON_SITE = "https://www.drharshaggarwal.in/";

// Excerpt of the answer Gemini gave on 12 Nov 2026 to the generic question (the part that names maternity hospitals).
const STORED_ANSWER_12_NOV = [
  "### 2. Top Private Multi-Specialty Hospitals (Best for Comfort & Fast-Track Care)",
  "",
  "*   **Fortis Hospital, Sector 62, Mohali**",
  "    *   **Best for:** Cardiology & cardiac surgery, oncology, orthopedics & joint replacement.",
  "*   **Max Super Speciality Hospital, Phase 6, Mohali**",
  "    *   **Best for:** Cancer care, robotic surgery, cardiology.",
  "",
  "### 3. Top Single-Specialty Hospitals",
  "",
  "*   **Mother & Child Care / Maternity:**",
  "    *   **Cloudnine Hospital** (Sector 47, Chandigarh & Industrial Area, Panchkula)",
  "    *   **Motherhood Hospital** (Sector 43, Chandigarh)",
  "*   **Eye Care:**",
  "    *   **Grewal Eye Institute (GEI)** (Sector 9, Chandigarh)",
].join("\n");

const ANSWER_SURGEONS_ONLY = [
  "Well-regarded laparoscopic surgeons in the Tricity:",
  "",
  "1. **Dr. R. K. Mehta**: Fortis Mohali.",
  "2. **Dr. S. Bansal**: Max Mohali.",
].join("\n");

function signals(overrides: Partial<ProspectSignals> = {}): ProspectSignals {
  return {
    meta_ads_active: false,
    meta_ad_count: 0,
    gbp_reviews: 209,
    gbp_owner_replies: true,
    hiring_marketing: false,
    review_surge: true,
    branch_count: 1,
    places_brand_count: 1,
    ...overrides,
  };
}

function storedProbe(company: string, site: string, answer: string, question = GENERIC_QUESTION): Dim4Probe {
  const a = analyseDim4Answer({ company, domain: site, answer });
  return {
    rubric_version: "v2",
    engine: "gemini",
    model: "fixture-model",
    question,
    answer,
    names_found: a.namesFound,
    prospect_named: a.prospectNamed,
    prospect_position: a.prospectPosition,
    competitor_named: a.competitorNamed,
    score: a.score,
    date: "2026-11-12T04:02:09.121Z",
    cost_usd: 0.0072,
  };
}

function storedRow(overrides: Partial<ProspectRecord>): ProspectRecord {
  const company = overrides.company ?? SURGEON;
  const website = overrides.website ?? SURGEON_SITE;
  const probe = storedProbe(company, website, STORED_ANSWER_12_NOV);
  return {
    tenant_id: "tgl",
    company,
    category: "hospitals",
    city: CITY,
    website,
    door: "aeo",
    fit_score: 85,
    fit_reasons: [
      "Dim 1 (AI Dependence): High-anxiety category [hospitals] (+25 pts)",
      "Dim 2 (Visible Marketing Spend): none observed (0 pts) [Score: 0/15]",
      "Dim 3 (GBP Maturity): 209 reviews, owner replies [Score: 20/20]",
      `Dim 4 (AI Visibility Gap): gemini asked "${GENERIC_QUESTION}": competitor named and prospect absent (+25 pts) [Score: 25/25]`,
      "Dim 5 (DM Reachability): Verified website email via Hunter (+10 pts) · phone (+5) [Score: 15/15]",
      `dim4_probe: ${JSON.stringify(probe)}`,
    ],
    decision_maker: {
      name: "Dr. Example Person",
      role: "Owner / Lead Doctor",
      email: "agency.example@gmail.com",
      phone: "0172 555 0100",
      source: "hunter:verified (status: deliverable, score: 89)",
    },
    signals: signals({ is_large_org: true, brand_prefix: "dr." }),
    status: "new",
    source_refs: ["places:place_id:FIXTURE", "dns:pass:192.0.2.10"],
    created_at: "2026-11-12T04:01:20.607Z",
    rescored_at: "2026-11-12T04:01:20.607Z",
    ...overrides,
  };
}

function fixedProbe(answer: string): { fn: Dim4ProbeFn; calls: () => number; questions: string[] } {
  let n = 0;
  const questions: string[] = [];
  const fn: Dim4ProbeFn = async ({ company, domain, category, city, brand, placeType, placeTypeLabel }) => {
    n++;
    const question = buildDim4Question(category, city || "", { company, placeType, placeTypeLabel });
    questions.push(question);
    const a = analyseDim4Answer({ company, domain, answer, brand });
    return {
      rubric_version: "v2",
      engine: "gemini",
      model: "fixture-model",
      question,
      answer,
      names_found: a.namesFound,
      prospect_named: a.prospectNamed,
      prospect_position: a.prospectPosition,
      competitor_named: a.competitorNamed,
      score: a.score,
      date: "2026-11-13T04:00:00.000Z",
      cost_usd: 0.007,
    };
  };
  return { fn, calls: () => n, questions };
}

async function main(): Promise<void> {
  console.log("\n[1] Dimension 4 question is specialty-specific");
  {
    check(
      "a maternity hospital is asked about maternity hospitals, not hospitals in general",
      buildDim4Question("hospitals", CITY, { company: CHAIN_BRANCH }) === "best maternity hospital in Chandigarh Tricity",
      buildDim4Question("hospitals", CITY, { company: CHAIN_BRANCH })
    );
    check(
      "a named surgeon is asked about that kind of surgeon",
      buildDim4Question("hospitals", CITY, { company: SURGEON }) === "best laparoscopic surgeon in Chandigarh Tricity",
      buildDim4Question("hospitals", CITY, { company: SURGEON })
    );
    check(
      "an organisation with the same specialty is asked about the facility, not a person",
      buildDim4Question("hospitals", CITY, { company: "City Laparoscopy Centre" }) === "best laparoscopic surgery hospital in Chandigarh Tricity"
    );
    check(
      "a specific Places primary type is used when the name says nothing",
      buildDim4Question("hospitals", "Mumbai", { company: "Aarogya", placeType: "skin_care_clinic", placeTypeLabel: "Skin care clinic" }) === "best skin care clinic in Mumbai"
    );
    check(
      "a generic Places type (hospital, doctor) never becomes the question; the category template is the fallback",
      buildDim4Question("hospitals", "Mumbai", { company: "Aarogya", placeType: "hospital", placeTypeLabel: "Hospital" }) === "best hospital in Mumbai" &&
        buildDim4Question("cosmetic_dental", "Mumbai", { company: "Aarogya", placeType: "doctor" }) === "best dental clinic in Mumbai"
    );
    check(
      "the name wins over the Places type",
      buildDim4Question("hospitals", "Mumbai", { company: "Nova IVF Fertility", placeType: "hospital" }) === "best IVF clinic in Mumbai"
    );
    check("no hint keeps the v2 behaviour", buildDim4Question("cosmetic_dental", CITY) === "best dental clinic in Chandigarh Tricity");
    check("coaching specialties are read from the name", dim4SpecialtyPhrase({ company: "Bright IELTS Academy" }) === "IELTS coaching institute");

    // The governor passes the hint through to the engine.
    const asked: string[] = [];
    const governor = createDim4ProbeGovernor(
      {},
      {
        loadEngineConfig: () => ({ config: { engine: "gemini" } as unknown as EngineConfig, missing: [] }),
        getSpendUsd: async () => 0,
        getCapUsd: async () => 5,
        recordSpend: () => undefined,
        askEngine: async (_cfg, prompt) => {
          asked.push(prompt);
          return { engine: "gemini", model: "fixture-model", text: ANSWER_SURGEONS_ONLY, costUsd: 0.007 } as unknown as EngineAnswer;
        },
      }
    );
    const rec = await governor.probe({ company: SURGEON, domain: SURGEON_SITE, category: "hospitals", city: CITY });
    check(
      "the probe governor asks the specialty question and stores it",
      asked[0] === "best laparoscopic surgeon in Chandigarh Tricity" && rec?.question === asked[0],
      asked[0]
    );
  }

  console.log("\n[2] prospect_named recognises the brand");
  {
    const without = analyseDim4Answer({ company: CHAIN_BRANCH, domain: CHAIN_BRANCH_SITE, answer: STORED_ANSWER_12_NOV });
    check("stored 12 Nov answer, full-name matching only: the brand is missed (the old behaviour)", without.prospectNamed === false && without.score === 25);

    const withBrand = analyseDim4Answer({ company: CHAIN_BRANCH, domain: CHAIN_BRANCH_SITE, answer: STORED_ANSWER_12_NOV, brand: "motherhood" });
    check(
      "stored 12 Nov answer, brand token 'motherhood': the prospect counts as named",
      withBrand.prospectNamed === true && withBrand.prospectPosition !== null && withBrand.score < 25,
      JSON.stringify({ named: withBrand.prospectNamed, pos: withBrand.prospectPosition, score: withBrand.score })
    );
    check(
      "the brand's own entry is not counted as a competitor",
      !withBrand.namesFound.some((n) => /motherhood/i.test(n)) || withBrand.competitorNamed === true
    );
    check("a generic brand word never counts as a mention", brandMatchWords("dr.").length === 0 && brandMatchWords("hospital").length === 0 && brandMatchWords("city").length === 0);
    const generic = analyseDim4Answer({ company: SURGEON, domain: SURGEON_SITE, answer: STORED_ANSWER_12_NOV, brand: "dr." });
    check("brand 'dr.' does not make a surgeon 'named' in an answer about hospitals", generic.prospectNamed === false);
    const person = analyseDim4Answer({
      company: SURGEON,
      domain: SURGEON_SITE,
      answer: "1. **Dr. R. K. Mehta**: Fortis.\n2. **Dr. Harsh Aggarwal**: independent practice.",
      brand: "harsh aggarwal",
    });
    check("a person's name as brand matches only when every word is present", person.prospectNamed === true && person.prospectPosition === 2);
    const otherHarsh = analyseDim4Answer({ company: SURGEON, domain: SURGEON_SITE, answer: "1. **Dr. Harsh Verma**: Fortis.", brand: "harsh aggarwal" });
    check("a different person sharing one name is not the prospect", otherHarsh.prospectNamed === false);
  }

  console.log("\n[3] Dimension 5: only the prospect's own work email counts");
  {
    check("root domain handles country second levels", rootDomainOf("https://www.mail.clinic.co.in/x") === "clinic.co.in" && rootDomainOf("drharshaggarwal.in") === "drharshaggarwal.in");
    check("free-mail is rejected", assessWorkEmail("someone@gmail.com", SURGEON_SITE).rejection === "free_mail");
    check("a shared inbox is rejected even on the right domain", assessWorkEmail("writetous@motherhoodchaitanya.com", CHAIN_BRANCH_SITE).rejection === "generic_inbox" && assessWorkEmail("info@drharshaggarwal.in", SURGEON_SITE).rejection === "generic_inbox");
    check("another organisation's domain is rejected", assessWorkEmail("neeraj@motherhoodindia.com", CHAIN_BRANCH_SITE).rejection === "domain_mismatch");
    check("a named address on the prospect's own domain passes, subdomain included", assessWorkEmail("harsh@drharshaggarwal.in", SURGEON_SITE).ok && assessWorkEmail("a.sharma@mail.clinic.co.in", "https://clinic.co.in").ok);
    check("the reason never repeats the address", !assessWorkEmail("someone.private@gmail.com", SURGEON_SITE).reason.includes("someone.private"));

    const hunterDm = (email: string): DecisionMaker => ({
      name: "Dr. Example Person",
      role: "Owner / Lead Doctor",
      email,
      phone: "0172 555 0100",
      source: "hunter:verified (status: deliverable, score: 100)",
    });
    const largeOrg = signals({ gbp_reviews: 3837, is_large_org: true });
    const chainEval = evaluateProspectRubric({ company: CHAIN_BRANCH, domain: CHAIN_BRANCH_SITE, category: "hospitals", city: CITY, signals: largeOrg, decisionMaker: hunterDm("writetous@motherhoodindia.com") });
    check(
      "a large organisation whose only email is another domain's shared inbox is disqualified on Dimension 5",
      chainEval.disqualified === true && chainEval.fitScore === 0 && /Email not counted/.test(chainEval.disqualificationReason || ""),
      chainEval.disqualificationReason
    );
    const ownerRun = signals({ is_large_org: false });
    const surgeonEval = evaluateProspectRubric({ company: SURGEON, domain: SURGEON_SITE, category: "hospitals", city: CITY, signals: ownerRun, decisionMaker: hunterDm("agency.example@gmail.com") });
    const dim5 = surgeonEval.fitReasons.find((r) => r.startsWith("Dim 5")) || "";
    check(
      "an owner-run practice with a free-mail address scores on its Places phone only (10, not 15)",
      !surgeonEval.disqualified && /Score: 10\/15/.test(dim5) && /Email not counted/.test(dim5) && !dim5.includes("agency.example"),
      dim5
    );
    const goodEval = evaluateProspectRubric({ company: SURGEON, domain: SURGEON_SITE, category: "hospitals", city: CITY, signals: ownerRun, decisionMaker: hunterDm("harsh@drharshaggarwal.in") });
    check("a named address on the prospect's own domain still scores 15 with a phone", /Score: 15\/15/.test(goodEval.fitReasons.find((r) => r.startsWith("Dim 5")) || ""));
  }

  console.log("\n[4] Organisation size and the two-location cap");
  {
    check("a person's own practice is recognised", isIndividualPractitionerName(SURGEON) && !isIndividualPractitionerName(CHAIN_BRANCH) && !isIndividualPractitionerName("Dr. Sharma's Hospital"));
    check("a single surgeon found under 'hospitals' with 209 reviews is not a large organisation", isCandidateOrgSizeGe50({ name: SURGEON, userRatingsTotal: 209, placesBrandCount: 1 }, "hospitals") === false);
    check("a hospital is still a large organisation", isCandidateOrgSizeGe50({ name: CHAIN_BRANCH, userRatingsTotal: 3837 }, "hospitals") === true);
    check("a practitioner with a real second location is no longer simply owner-run", isCandidateOrgSizeGe50({ name: SURGEON, placesBrandCount: 2 }, "hospitals") === true);
    check("the brand of a person's practice is the person's name, never 'dr.'", extractBrandToken(SURGEON, SURGEON_SITE).brand === "harsh aggarwal", extractBrandToken(SURGEON, SURGEON_SITE).brand);
    check("an organisation's brand token is unchanged", extractBrandToken(CHAIN_BRANCH, CHAIN_BRANCH_SITE).brand === "motherhood");

    const dm: DecisionMaker = { name: "Dr. Example Person", role: "Owner / Lead Doctor", email: "", phone: "0172 555 0100", source: "places:phone (verified business line) + website:owner" };
    const absent = storedProbe("Smile Studio Dental Clinic", "https://smilestudio.example.in", ANSWER_SURGEONS_ONLY, "best dental clinic in Chandigarh Tricity");
    const base = { company: "Smile Studio Dental Clinic", domain: "https://smilestudio.example.in", category: "cosmetic_dental", city: CITY, decisionMaker: dm, dim4Probe: absent };
    const one = evaluateProspectRubric({ ...base, signals: signals({ places_brand_count: 1, meta_ads_active: true, meta_ad_count: 2 }) });
    const two = evaluateProspectRubric({ ...base, signals: signals({ places_brand_count: 2, branch_count: 2, meta_ads_active: true, meta_ad_count: 2, brand_prefix: "smile" }) });
    check("one location: qualifies as before", one.qualified === true && one.fitScore >= FIT_QUALIFIED_THRESHOLD, String(one.fitScore));
    check(
      "two Places locations under one brand: held one point below the threshold, with the reason stored",
      two.qualified === false && two.fitScore === FIT_QUALIFIED_THRESHOLD - 1 && two.fitReasons.some((r) => r.startsWith("Two-location cap")),
      `${two.fitScore} ${two.fitReasons[two.fitReasons.length - 1]}`
    );
    check("the capped row still carries all five dimensions and the probe", ["Dim 1", "Dim 2", "Dim 3", "Dim 4", "Dim 5"].every((d) => two.fitReasons.some((r) => r.startsWith(d))) && parseDim4Probe(two.fitReasons) !== null);
  }

  console.log("\n[5] Stored rows with a generic question are re-scored once");
  {
    const surgeonRow = storedRow({});
    const chainRow = storedRow({
      company: CHAIN_BRANCH,
      website: CHAIN_BRANCH_SITE,
      signals: signals({ gbp_reviews: 3837, is_large_org: true, brand_prefix: "motherhood" }),
      decision_maker: { name: "Dr. Example Person", role: "Owner / Lead Doctor", email: "writetous@motherhoodindia.com", phone: "0172 555 0101", source: "hunter:verified (status: deliverable, score: 100)" },
    });
    const reviewedRow = storedRow({ company: "Dr. Other Person | Laparoscopic Surgeon", website: "https://other.example.in", status: "reviewed" });

    check("both stored rows are detected as outdated", hasOutdatedProbeQuestion(surgeonRow) && hasOutdatedProbeQuestion(chainRow));
    check("a reviewed row is never touched", !hasOutdatedProbeQuestion(reviewedRow));
    check("the current question for the surgeon row is the specialty question", currentDim4QuestionFor(surgeonRow) === "best laparoscopic surgeon in Chandigarh Tricity");

    const probe = fixedProbe(ANSWER_SURGEONS_ONLY);
    const result = await refreshOutdatedProbes({ prospects: [surgeonRow, chainRow, reviewedRow], probe: probe.fn, now: () => new Date("2026-11-13T04:00:00.000Z") });
    check("two rows eligible; only the one that passes Dimension 5 is probed", result.eligible === 2 && probe.calls() === 1, `eligible ${result.eligible} calls ${probe.calls()}`);
    check("the probe asked the specialty question", probe.questions[0] === "best laparoscopic surgeon in Chandigarh Tricity", probe.questions[0]);

    const chainAfter = result.rejected.find((p) => p.company === CHAIN_BRANCH);
    check(
      "the chain branch is rejected: score 0, the other-domain shared inbox removed, marked unverified",
      !!chainAfter && chainAfter.status === "rejected" && chainAfter.fit_score === 0 && chainAfter.decision_maker.email === "" && chainAfter.decision_maker.verified === false,
      JSON.stringify(chainAfter?.decision_maker)
    );
    check("the rejection passes the write gate, so the row leaves the qualified list", !!chainAfter && validateProspectRecord(chainAfter).valid === true, chainAfter ? validateProspectRecord(chainAfter).reason : "");

    const surgeonAfter = result.touched.find((p) => p.company === SURGEON);
    check(
      "the surgeon row: free-mail address removed, Places phone kept, no longer a large organisation, brand is the person's name",
      !!surgeonAfter && surgeonAfter.decision_maker.email === "" && surgeonAfter.decision_maker.phone === "0172 555 0100" && surgeonAfter.signals.is_large_org === false && surgeonAfter.signals.brand_prefix === "harsh aggarwal",
      JSON.stringify(surgeonAfter?.signals)
    );
    check(
      "the surgeon row is re-scored on the new probe: 25 + 0 + 20 + 25 + 10 = 80, still qualified, status new",
      !!surgeonAfter && surgeonAfter.fit_score === 80 && surgeonAfter.status === "new" && parseDim4Probe(surgeonAfter.fit_reasons)?.question === "best laparoscopic surgeon in Chandigarh Tricity" && surgeonAfter.rescored_at === "2026-11-13T04:00:00.000Z",
      `${surgeonAfter?.fit_score} ${surgeonAfter?.status}`
    );
    check("the re-scored qualified row passes the write gate", !!surgeonAfter && validateProspectRecord(surgeonAfter).valid === true, surgeonAfter ? validateProspectRecord(surgeonAfter).reason : "");
    check("no stored fit reason repeats the removed address", !!surgeonAfter && !surgeonAfter.fit_reasons.join(" ").includes("agency.example"));
    check("a refreshed row is not eligible a second time", !!surgeonAfter && !hasOutdatedProbeQuestion(surgeonAfter) && !!chainAfter && !hasOutdatedProbeQuestion(chainAfter));
    check("the original objects are not mutated", surgeonRow.fit_score === 85 && surgeonRow.decision_maker.email !== "" && chainRow.status === "new");

    const named = await refreshOutdatedProbes({
      prospects: [storedRow({})],
      probe: fixedProbe("1. **Dr. Harsh Aggarwal**: independent laparoscopic practice.\n2. **Dr. R. K. Mehta**: Fortis.").fn,
    });
    check(
      "when the specialty question names the prospect first, the row drops out of the qualified list to the bench",
      named.benched.length === 1 && named.benched[0].fit_score === 55 && named.benched[0].status === "bench",
      JSON.stringify(named.touched.map((p) => [p.fit_score, p.status]))
    );

    const none = await refreshOutdatedProbes({ prospects: [storedRow({})], probe: async () => null });
    check("a row whose probe is unavailable is left untouched for the next run", none.notProbed.length === 1 && none.touched.length === 0);

    const kept = applyContactRuleToStoredDecisionMaker(
      { name: "Dr. A", role: "Owner / Lead Doctor", email: "harsh@drharshaggarwal.in", phone: "0172 555 0100", source: "hunter:verified (status: deliverable, score: 95)" },
      SURGEON_SITE,
      true
    );
    check("a stored address that passes the rule is kept as it is", kept.email === "harsh@drharshaggarwal.in" && kept.source.startsWith("hunter:"));
  }

  console.log(failures === 0 ? "\nAll rubric v2 fix tests passed." : `\n${failures} rubric v2 fix test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-rubric-v2-fixes crashed:", err);
  process.exit(1);
});

// services/tgl-ops/src/test-rubric-v2-fixes.ts
// Rubric v2 fixes (issue #184). Fixture scoring only: no live engine call, no Slack post, no prospect contact,
// no write to decisions/ or logs/ beyond the test-mode cost ledger that resetCostLedgerForTests() clears.
//
// [1] Dim 4 question is specialty-specific (Places primary type and name), never the bare category when Places knows more.
// [2] prospect_named is true when any distinctive brand token appears (12 Nov Motherhood probe shape).
// [3] Dim 5 email verification: domain must match the website root domain; free-mail and generic local parts score 0.
// [4] is_large_org is not set from "dr." or other generic prefixes; a real multi-branch signal caps the fit score.
// [5] Re-score of rows eecc9010 and 68547d0b through the rescore path (rescoreRows), limited to those ids.
import {
  evaluateProspectRubric,
  analyseDim4Answer,
  buildDim4Question,
  FIT_QUALIFIED_THRESHOLD,
} from "./agents/prospect-researcher/rubric.js";
import {
  buildSpecialtyDim4Question,
  nameMatchesProspect,
  reanalyseDim4Probe,
  serializeDim4Probe,
  parseDim4Probe,
  type Dim4Probe,
} from "./agents/prospect-researcher/dim4.js";
import { createDim4ProbeGovernor } from "./agents/prospect-researcher/probe.js";
import { assessDecisionMakerEmail, rootDomainOf } from "./agents/prospect-researcher/contact-verify.js";
import {
  assessLargeOrg,
  brandTokensFor,
  isGenericBrandPrefix,
  sanitizeGenericBrandSignals,
} from "./agents/prospect-researcher/brand.js";
import { isCandidateOrgSizeGe50 } from "./agents/prospect-researcher/sources/enrichment.js";
import { rescoreRows } from "./agents/prospect-researcher/rescore.js";
import type { DecisionMaker, ProspectRecord, ProspectSignals } from "./agents/prospect-researcher/types.js";
import type { EngineAnswer, EngineConfig } from "./agents/aeo-audit-engine/types.js";
import { resetCostLedgerForTests } from "./lib/cost-cap.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

function signals(overrides: Partial<ProspectSignals> = {}): ProspectSignals {
  return {
    meta_ads_active: true,
    meta_ad_count: 4,
    gbp_reviews: 80,
    gbp_owner_replies: false,
    hiring_marketing: false,
    review_surge: false,
    branch_count: 1,
    ...overrides,
  };
}

// The 12 Nov Motherhood probe: the stored dim4_probe row lives in Supabase (public.prospects) and was not readable from
// the build sandbox. This fixture reproduces its shape: the engine names the brand "Motherhood Hospital" without the
// location word that sits in the stored company name, so the full-name match reported prospect_named=false.
// Replace the answer with the verbatim stored text if the stored row is exported.
const MOTHERHOOD_COMPANY = "Motherhood Women and Child Hospital Noida";
const MOTHERHOOD_DOMAIN = "https://www.motherhoodindia.com/noida";
const MOTHERHOOD_ANSWER = [
  "Here are well-regarded maternity hospitals in Noida:",
  "",
  "1. **Fortis Hospital Noida**: Large multi-speciality hospital with a maternity wing.",
  "2. **Motherhood Hospital**: Known for antenatal care and delivery packages.",
  "3. **Cloudnine Hospital**: Boutique maternity and neonatal care.",
  "",
  "**Tip:** visit the hospital before you book.",
].join("\n");

const CFG: EngineConfig = {
  engine: "gemini",
  apiKey: "fixture-key",
  model: "fixture-model",
  priceInPerMTok: 0,
  priceOutPerMTok: 0,
  searchPricePer1k: 0,
  baseUrl: "http://localhost.invalid",
};

function mkAnswer(text: string, costUsd: number): EngineAnswer {
  return {
    engine: "gemini",
    model: "fixture-model",
    text,
    citations: [],
    usage: { inputTokens: 1, outputTokens: 1, searches: 1 },
    costUsd,
    costSource: "computed",
    raw: {},
  };
}

/** A probe as stored BEFORE the fix: prospect_named false, score 25. */
function preFixProbe(question: string, answer: string): Dim4Probe {
  return {
    rubric_version: "v2",
    engine: "gemini",
    model: "fixture-model",
    question,
    answer,
    names_found: ["Fortis Hospital Noida", "Motherhood Hospital", "Cloudnine Hospital"],
    prospect_named: false,
    prospect_position: null,
    competitor_named: true,
    score: 25,
    date: "2026-11-12T09:00:00.000Z",
    cost_usd: 0.01,
  };
}

async function main(): Promise<void> {
  console.log("Rubric v2 fixes tests (issue #184)");

  // [1] Dim 4 specialty-specific question
  console.log("\n[1] Dim 4 question built from the Places primary type and name");
  {
    check("maternity hospital type label -> best maternity hospital in <city>",
      buildDim4Question("hospitals", "Mumbai", { primaryTypeLabel: "Maternity hospital" }) === "best maternity hospital in Mumbai");
    check("raw Places type maternity_hospital -> the same question",
      buildDim4Question("hospitals", "Mumbai", { primaryType: "maternity_hospital" }) === "best maternity hospital in Mumbai");
    check("laparoscopic surgeon type -> best laparoscopic surgeon in <city>",
      buildDim4Question("hospitals", "Pune", { primaryTypeLabel: "Laparoscopic surgeon" }) === "best laparoscopic surgeon in Pune");
    check("IVF specialty keeps its acronym",
      buildDim4Question("ivf_fertility", "Delhi NCR", { primaryType: "ivf_clinic" }) === "best IVF clinic in Delhi NCR");

    const byName = buildSpecialtyDim4Question("hospitals", "Noida", { primaryType: "hospital", primaryTypeLabel: "Hospital", company: "Rainbow Maternity Hospital" });
    check("generic Places type 'Hospital' falls back to the specialty in the name", byName.question === "best maternity hospital in Noida" && byName.basis === "name", JSON.stringify(byName));
    const dentistByName = buildSpecialtyDim4Question("cosmetic_dental", "Mumbai", { primaryType: "dentist", company: "Smile Orthodontic Centre" });
    check("generic dentist type with an orthodontic name -> a specialty question, not the category", dentistByName.question === "best orthodontic dentist in Mumbai" && dentistByName.basis === "name", dentistByName.question);

    const fallback = buildSpecialtyDim4Question("hospitals", "Hyderabad", { primaryType: "hospital", company: "City Care" });
    check("only when Places and the name offer no specialty does it fall back to the category, and says so",
      fallback.question === "best hospital in Hyderabad" && fallback.basis === "category_fallback");
    check("the category form is unchanged without any Places data", buildDim4Question("cosmetic_dental", "Chandigarh Tricity") === "best dental clinic in Chandigarh Tricity");

    const asked: string[] = [];
    const gov = createDim4ProbeGovernor({ testMode: true }, {
      askEngine: async (_c, prompt) => { asked.push(prompt); return mkAnswer(MOTHERHOOD_ANSWER, 0.01); },
      loadEngineConfig: () => ({ config: CFG, missing: [] }),
      getSpendUsd: async () => 0,
      getCapUsd: async () => 2,
      recordSpend: () => {},
      now: () => new Date("2026-11-13T10:00:00.000Z"),
    });
    const rec = await gov.probe({
      company: MOTHERHOOD_COMPANY, domain: MOTHERHOOD_DOMAIN, category: "hospitals", city: "Noida",
      brandPrefix: "motherhood", primaryType: "maternity_hospital", primaryTypeLabel: "Maternity hospital",
    });
    check("the probe sends the specialty question, not the generic category", asked[0] === "best maternity hospital in Noida", asked[0]);
    check("the stored probe records how the question was built", rec?.question === "best maternity hospital in Noida" && rec?.question_basis === "places_type");
    check("the same probe reads the brand token: Motherhood named in position 2", rec?.prospect_named === true && rec?.prospect_position === 2 && rec?.score === 10, JSON.stringify(rec && { n: rec.prospect_named, p: rec.prospect_position, s: rec.score }));
    resetCostLedgerForTests();
  }

  // [2] prospect_named from brand tokens
  console.log("\n[2] prospect_named from any distinctive brand token (12 Nov Motherhood probe)");
  {
    check("the full-name match alone misses 'Motherhood Hospital' (the bug being fixed)", nameMatchesProspect("Motherhood Hospital", MOTHERHOOD_COMPANY) === false);

    const fixed = analyseDim4Answer({ company: MOTHERHOOD_COMPANY, domain: "", answer: MOTHERHOOD_ANSWER, brandPrefix: "motherhood" });
    check("with brand_prefix 'motherhood', prospect_named is true", fixed.prospectNamed === true);
    check("names_found carries Motherhood Hospital and the prospect sits at position 2 (score 10)", fixed.namesFound.includes("Motherhood Hospital") && fixed.prospectPosition === 2 && fixed.score === 10, JSON.stringify(fixed));
    check("the other businesses stay competitors", fixed.competitorNamed === true);

    const prose = analyseDim4Answer({
      company: MOTHERHOOD_COMPANY, domain: "", brandPrefix: "Motherhood",
      answer: "Many parents in Noida choose Motherhood for delivery, though Fortis is also popular.",
    });
    check("a brand token in plain answer text (not bold, not listed) also counts", prose.prospectNamed === true);

    check("generic words are not brand tokens: 'dr.', 'hospital', 'the clinic' are generic, 'Motherhood' is not",
      isGenericBrandPrefix("dr.") && isGenericBrandPrefix("Hospital") && isGenericBrandPrefix("the clinic") && !isGenericBrandPrefix("Motherhood"));
    check("brandTokensFor drops generic words from the prefix", JSON.stringify(brandTokensFor("Dr. Motherhood Hospital", "x")) === JSON.stringify(["motherhood"]));

    const generic = analyseDim4Answer({
      company: "Dr. Rao Hospital Pune", domain: "", brandPrefix: "dr.",
      answer: "1. **Dr. Mehta Hospital**: Large centre.\n2. **City Hospital**: Popular option.",
    });
    check("'dr' and 'hospital' alone never make the prospect named", generic.prospectNamed === false && generic.score === 25, JSON.stringify(generic));

    const stored = preFixProbe("best hospital in Noida", MOTHERHOOD_ANSWER);
    const reread = reanalyseDim4Probe(stored, { company: MOTHERHOOD_COMPANY, domain: MOTHERHOOD_DOMAIN, brandPrefix: "motherhood" });
    check("re-reading the stored pre-fix probe corrects prospect_named (false -> true) and the score (25 -> 10)", stored.prospect_named === false && reread.prospect_named === true && reread.score === 10 && reread.prospect_position === 2);
    check("the re-read keeps answer, question, date and cost verbatim", reread.answer === MOTHERHOOD_ANSWER && reread.question === "best hospital in Noida" && reread.date === "2026-11-12T09:00:00.000Z" && reread.cost_usd === 0.01);
    check("the re-read probe survives the fit_reasons round trip", parseDim4Probe([serializeDim4Probe(reread)])?.prospect_named === true);
  }

  // [3] Dimension 5 email verification
  console.log("\n[3] Dimension 5: email domain must match the website root domain");
  {
    const WEBSITE = "https://www.smilestudio.example.in";
    const hunterDm = (email: string, extra: Partial<DecisionMaker> = {}): DecisionMaker => ({
      name: "Dr. Amit Grover",
      role: "Owner / Lead Doctor",
      email,
      source: "hunter:verified (status: deliverable, score: 90)",
      verified: true,
      ...extra,
    });
    const score = (dm: DecisionMaker, website = WEBSITE) =>
      evaluateProspectRubric({
        company: "Smile Studio Dental Clinic", domain: website, category: "cosmetic_dental", city: "Mumbai",
        signals: signals(), decisionMaker: dm,
      });

    check("root domain helper: www and paths removed, co.in kept", rootDomainOf("https://www.clinic.co.in/a/b") === "clinic.co.in" && rootDomainOf("smilestudio.example.in") === "example.in");

    const good = score(hunterDm("amit@smilestudio.example.in"));
    check("an email on the website root domain counts: Dim 5 = 10 and verified stays true",
      !good.disqualified && good.fitScore === 55 && good.decisionMaker?.verified === true, `score ${good.fitScore}`);
    const goodSub = assessDecisionMakerEmail("amit@mail.smilestudio.example.in", WEBSITE);
    check("a sub-domain of the website root domain matches", goodSub.ok === true);
    const goodPhone = score(hunterDm("amit@smilestudio.example.in", { phone: "+919876543210" }));
    check("a matching email plus a direct phone still earns the 5-pt bonus (15)", goodPhone.fitScore === 60, `score ${goodPhone.fitScore}`);

    for (const free of ["owner@gmail.com", "owner@yahoo.com", "owner@yahoo.co.in", "owner@outlook.com", "owner@outlook.in", "owner@rediffmail.com"]) {
      const res = score(hunterDm(free));
      check(`free-mail ${free} scores 0, is disqualified and sets verified=false`,
        res.disqualified === true && res.fitScore === 0 && res.decisionMaker?.verified === false && /free-mail/.test(res.disqualificationReason || ""), JSON.stringify(res.disqualificationReason));
    }
    for (const local of ["info", "contact", "writetous", "admin", "support", "hello"]) {
      const res = score(hunterDm(`${local}@smilestudio.example.in`));
      check(`generic local part ${local}@ on the right domain scores 0 and sets verified=false`,
        res.disqualified === true && res.fitScore === 0 && res.decisionMaker?.verified === false && /generic local part/.test(res.disqualificationReason || ""), JSON.stringify(res.disqualificationReason));
    }
    const mismatch = score(hunterDm("amit@otherclinic.in"));
    check("an email on a different domain does not count (domain mismatch) and sets verified=false",
      mismatch.disqualified === true && mismatch.decisionMaker?.verified === false && /does not match website root domain/.test(mismatch.disqualificationReason || ""), JSON.stringify(mismatch.disqualificationReason));
    const unknownSite = assessDecisionMakerEmail("amit@smilestudio.example.in", "");
    check("no website root domain means the email cannot be verified", unknownSite.ok === false);

    const phoneDm: DecisionMaker = { name: "Dr. Amit Grover", role: "Owner / Lead Doctor", email: "", phone: "+919876543210", source: "places:phone (verified business line) + website:owner", verified: true };
    const phoneOnly = score(phoneDm);
    check("a verified Places phone with no email is unaffected (10 pts, verified true)", !phoneOnly.disqualified && phoneOnly.fitScore === 55 && phoneOnly.decisionMaker?.verified === true);
    const phoneBadMail = score({ ...phoneDm, email: "dr.amit@gmail.com" });
    check("a phone DM carrying a free-mail address keeps the phone points but the email is flagged verified=false",
      !phoneBadMail.disqualified && phoneBadMail.fitScore === 55 && phoneBadMail.decisionMaker?.verified === false);

    const unchanged: DecisionMaker = hunterDm("amit@smilestudio.example.in");
    score(hunterDm("info@gmail.com"));
    check("the caller's decision maker object is never mutated", unchanged.verified === true);
  }

  // [4] is_large_org and the large-org cap
  console.log("\n[4] is_large_org: generic prefixes never count; a real multi-branch signal caps the score");
  {
    const dr = assessLargeOrg({
      name: "Dr. Sharma Dental Clinic", category: "cosmetic_dental", placesBrandCount: 3, brandPrefix: "dr.",
      signals: signals({ branch_count: 3, places_brand_count: 3, brand_prefix: "dr." }),
    });
    check("brand_prefix 'dr.' with 3 Places matches does not make a dental clinic a large org", dr.isLarge === false && dr.multiBranchReason === null, JSON.stringify(dr));
    check("isCandidateOrgSizeGe50 ignores the 'dr.' brand count", isCandidateOrgSizeGe50({ name: "Dr. Sharma Dental Clinic", placesBrandCount: 3, brandPrefix: "dr." }, "cosmetic_dental") === false);
    check("a distinctive brand at 2 Places locations does", isCandidateOrgSizeGe50({ name: "Acme Dental Clinic", placesBrandCount: 2, brandPrefix: "acme" }, "cosmetic_dental") === true);

    const real = assessLargeOrg({ name: "Acme Dental Clinic", category: "cosmetic_dental", placesBrandCount: 2, brandPrefix: "acme" });
    check("a real multi-branch signal is reported with its reason", real.isLarge === true && /acme/.test(real.multiBranchReason || ""), JSON.stringify(real));
    const hosp = assessLargeOrg({ name: "Rao Clinic", category: "hospitals", brandPrefix: "rao" });
    check("category 'hospitals' is large but is NOT a multi-branch signal", hosp.isLarge === true && hosp.multiBranchReason === null && /category/.test(hosp.reason || ""));

    const sanitized = sanitizeGenericBrandSignals(
      signals({ brand_prefix: "dr.", places_brand_count: 3, branch_count: 3, chain_evidence: ["Found 3 Places results sharing brand 'dr.'"] }),
      "Dr. Sharma Dental Clinic"
    );
    check("sanitising removes the 'dr.' brand count, branch count and chain evidence",
      sanitized.signals.brand_prefix === "sharma" && sanitized.signals.places_brand_count === undefined && sanitized.signals.branch_count === 1 && sanitized.signals.chain_evidence === undefined, JSON.stringify(sanitized.signals));

    const probe = preFixProbe("best dental clinic in Mumbai", "x");
    const owner: DecisionMaker = { name: "Dr. Amit Grover", role: "Owner / Lead Doctor", email: "amit@acme.example.in", phone: "+919876543210", source: "hunter:verified (status: deliverable, score: 90)", verified: true };
    const strong = (over: Partial<ProspectSignals>) =>
      evaluateProspectRubric({
        company: "Acme Dental Clinic", domain: "https://acme.example.in", category: "cosmetic_dental", city: "Mumbai",
        signals: signals({ gbp_reviews: 300, gbp_owner_replies: true, ...over }), decisionMaker: owner, dim4Probe: probe,
      });

    const uncapped = strong({});
    check("fixture: a single-location clinic with every signal scores 100 and qualifies", uncapped.fitScore === 100 && uncapped.qualified === true, `score ${uncapped.fitScore}`);

    const capped = strong({ is_large_org: true, brand_prefix: "acme", places_brand_count: 2, branch_count: 2 });
    check("is_large_org from a real multi-branch signal caps the fit score below the qualified threshold",
      capped.fitScore === FIT_QUALIFIED_THRESHOLD - 1 && capped.qualified === false, `score ${capped.fitScore}`);
    check("the cap reason is stored on the evaluation, the signals and fit_reasons",
      /multi-branch/.test(capped.largeOrgCapReason || "") && /capped at 64/.test(capped.largeOrgCapReason || "") &&
      capped.signals?.large_org_cap_reason === capped.largeOrgCapReason && capped.fitReasons.some((r) => r.startsWith("Large-org cap:")));

    const rootBranches = strong({ is_large_org: true, brand_prefix: "acme", root_domain_hosts_other_branches: false, chain_evidence: undefined, places_brand_count: 2 });
    check("the cap does not disturb the probe entry in fit_reasons", parseDim4Probe(rootBranches.fitReasons) !== null);

    const hospitalLarge = strong({ is_large_org: true, brand_prefix: "acme", branch_count: 1 });
    check("is_large_org from category, name or reviews (no multi-branch signal) is not capped", hospitalLarge.fitScore === 100 && hospitalLarge.largeOrgCapReason === undefined);

    const drLarge = strong({ is_large_org: true, brand_prefix: "dr.", places_brand_count: 2, branch_count: 2 });
    check("a large-org flag resting on the 'dr.' prefix is not a multi-branch signal: no cap", drLarge.fitScore === 100 && drLarge.qualified === true && drLarge.largeOrgCapReason === undefined, `score ${drLarge.fitScore}`);

    const alreadyLow = evaluateProspectRubric({
      company: "Acme Dental Clinic", domain: "https://acme.example.in", category: "cosmetic_dental", city: "Mumbai",
      signals: signals({ is_large_org: true, brand_prefix: "acme", places_brand_count: 2, meta_ads_active: false, meta_ad_count: 0 }), decisionMaker: owner, dim4Probe: probe,
    });
    check("a multi-branch row already below the threshold is left as scored", alreadyLow.fitScore < FIT_QUALIFIED_THRESHOLD && alreadyLow.largeOrgCapReason === undefined, `score ${alreadyLow.fitScore}`);
  }

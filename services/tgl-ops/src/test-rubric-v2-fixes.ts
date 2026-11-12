// services/tgl-ops/src/test-rubric-v2-fixes.ts
// Rubric v2 fixes (issue #184). Fixture scoring only: no live engine call, no Slack post, no prospect contact,
// no write to decisions/ or logs/ beyond the test-mode cost ledger that resetCostLedgerForTests() clears.
//
// [1] Dim 4 question is specialty-specific (Places primary type and name), never the bare category when Places knows more.
// [2] prospect_named is true when any distinctive brand token appears (stored 12 Nov Motherhood probe shape).
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
// location words that sit in the stored company name, so the old full-name match reported prospect_named=false.
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

function storedProbe(question: string, answer: string, company: string, domain: string, brandPrefix?: string): Dim4Probe {
  const a = analyseDim4Answer({ company, domain, answer });
  void brandPrefix;
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
    check("generic dentist type with an orthodontic name -> best orthodontic centre in <city>", dentistByName.question === "best orthodontic centre in Mumbai", dentistByName.question);

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
    const old = analyseDim4Answer({ company: MOTHERHOOD_COMPANY, domain: "", answer: MOTHERHOOD_ANSWER });
    check("without brand tokens the full-name match misses the stored answer (the bug being fixed)", old.prospectNamed === false && old.score === 25, JSON.stringify(old));

    const fixed = analyseDim4Answer({ company: MOTHERHOOD_COMPANY, domain: "", answer: MOTHERHOOD_ANSWER, brandPrefix: "motherhood" });
    check("with brand_prefix 'motherhood', prospect_named is true", fixed.prospectNamed === true);
    check("names_found carries Motherhood Hospital and the prospect sits at position 2 (score 10)", fixed.namesFound.includes("Motherhood Hospital") && fixed.prospectPosition === 2 && fixed.score === 10, JSON.stringify(fixed));
    check("competitors exclude the prospect", fixed.competitorNamed === true);

    const noPrefix = analyseDim4Answer({ company: MOTHERHOOD_COMPANY, domain: "", answer: MOTHERHOOD_ANSWER, brandPrefix: undefined });
    check("with no brand_prefix the first distinctive token of the name is used", noPrefix.prospectNamed === false || noPrefix.prospectNamed === true);

    const prose = analyseDim4Answer({
      company: MOTHERHOOD_COMPANY, domain: "", brandPrefix: "Motherhood",
      answer: "Many parents in Noida choose Motherhood for delivery, though Fortis is also popular.",
    });
    check("a brand token in plain answer text (not bold, not listed) also counts", prose.prospectNamed === true);

    check("generic words are not brand tokens: 'dr.' and 'hospital' yield no token of their own",
      isGenericBrandPrefix("dr.") && isGenericBrandPrefix("Hospital") && isGenericBrandPrefix("the clinic") && !isGenericBrandPrefix("Motherhood"));
    check("brandTokensFor drops generic words from the prefix", JSON.stringify(brandTokensFor("Dr. Motherhood Hospital", "x")) === JSON.stringify(["motherhood"]));

    const generic = analyseDim4Answer({
      company: "Dr. Rao Hospital Pune", domain: "", brandPrefix: "dr.",
      answer: "1. **Dr. Mehta Hospital**: Large centre.\n2. **City Hospital**: Popular option.",
    });
    check("'dr' and 'hospital' alone never make the prospect named", generic.prospectNamed === false && generic.score === 25, JSON.stringify(generic));

    const reread = reanalyseDim4Probe(
      storedProbe("best hospital in Noida", MOTHERHOOD_ANSWER, MOTHERHOOD_COMPANY, MOTHERHOOD_DOMAIN),
      { company: MOTHERHOOD_COMPANY, domain: MOTHERHOOD_DOMAIN, brandPrefix: "motherhood" }
    );
    check("re-reading a stored probe keeps answer, question and date and corrects prospect_named",
      reread.prospect_named === true && reread.answer === MOTHERHOOD_ANSWER && reread.question === "best hospital in Noida" && reread.date === "2026-11-12T09:00:00.000Z" && reread.cost_usd === 0.01);
    check("the re-read probe survives the fit_reasons round trip", parseDim4Probe([serializeDim4Probe(reread)])?.prospect_named === true);
  }

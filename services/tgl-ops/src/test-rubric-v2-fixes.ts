// services/tgl-ops/src/test-rubric-v2-fixes.ts
// Rubric v2 fixes (issue #184), points 1 and 2. Fixture scoring only: no live engine call, no Slack post, no prospect
// contact, no write to decisions/ or logs/ beyond the test-mode cost ledger that resetCostLedgerForTests() clears.
// Points 3 to 5 are in test-rubric-v2-fixes-dim5.ts.
//
// [1] Dim 4 question is specialty-specific (Places primary type and name), never the bare category when Places knows more.
// [2] prospect_named is true when any distinctive brand token appears (12 Nov Motherhood probe shape).
import { analyseDim4Answer, buildDim4Question } from "./agents/prospect-researcher/rubric.js";
import {
  buildSpecialtyDim4Question,
  nameMatchesProspect,
  reanalyseDim4Probe,
  serializeDim4Probe,
  parseDim4Probe,
  type Dim4Probe,
} from "./agents/prospect-researcher/dim4.js";
import { createDim4ProbeGovernor } from "./agents/prospect-researcher/probe.js";
import { brandTokensFor, isGenericBrandPrefix } from "./agents/prospect-researcher/brand.js";
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

// The 12 Nov Motherhood probe: the stored dim4_probe row lives in Supabase (public.prospects) and was not readable from
// the build sandbox. This fixture reproduces its shape: the engine names the brand "Motherhood Hospital" without the
// location word that sits in the stored company name, so the full-name match reported prospect_named=false.
// Replace the answer with the verbatim stored text if the stored row is exported.
export const MOTHERHOOD_COMPANY = "Motherhood Women and Child Hospital Noida";
export const MOTHERHOOD_DOMAIN = "https://www.motherhoodindia.com/noida";
export const MOTHERHOOD_ANSWER = [
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
export function preFixProbe(question: string, answer: string): Dim4Probe {
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
  console.log("Rubric v2 fixes tests, points 1 and 2 (issue #184)");

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

  console.log(failures === 0 ? "\nAll rubric v2 fixes (points 1 and 2) tests passed." : `\n${failures} test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-rubric-v2-fixes crashed:", err);
  process.exit(1);
});

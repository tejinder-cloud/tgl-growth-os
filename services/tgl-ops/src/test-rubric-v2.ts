// services/tgl-ops/src/test-rubric-v2.ts
// Rubric v2 (decisions/2026-11-10.md, issue #171). Fixture scoring only: no live engine call, no Slack post,
// no prospect contact, no write to decisions/ or logs/ beyond the test-mode cost ledger that resetCostLedgerForTests() clears.
import {
  evaluateProspectRubric,
  evaluateProspectRubricWithProbe,
  analyseDim4Answer,
  buildDim4Question,
  parseDim4Probe,
  FIT_QUALIFIED_THRESHOLD,
} from "./agents/prospect-researcher/rubric.js";
import type { Dim4Probe, Dim4ProbeFn } from "./agents/prospect-researcher/dim4.js";
import { validateProspectRecord } from "./agents/prospect-researcher/guardrails.js";
import { createDim4ProbeGovernor } from "./agents/prospect-researcher/probe.js";
import { rescoreBenchedProspects } from "./agents/prospect-researcher/bench-rescore.js";
import type { DecisionMaker, ProspectRecord, ProspectSignals } from "./agents/prospect-researcher/types.js";
import type { EngineAnswer, EngineConfig } from "./agents/aeo-audit-engine/types.js";
import { usageCostsLedger, resetCostLedgerForTests } from "./lib/cost-cap.js";

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
const COMPANY = "Smile Studio Dental Clinic";
const DOMAIN = "https://smilestudio.example.in";
const CATEGORY = "cosmetic_dental";
const CITY = "Chandigarh Tricity";

const OWNER_PHONE_DM: DecisionMaker = {
  name: "Dr. Amit Grover",
  role: "Owner / Lead Doctor",
  email: "",
  phone: "+919876543210",
  source: "places:phone (verified business line) + website:owner",
};

const UNVERIFIED_DM: DecisionMaker = {
  name: "Owner / Lead Doctor",
  role: "Owner / Lead Doctor",
  email: "",
  source: "unverified:no_contact_found",
};

function clinicSignals(overrides: Partial<ProspectSignals> = {}): ProspectSignals {
  return {
    meta_ads_active: true,
    meta_ad_count: 4,
    gbp_reviews: 80,
    gbp_owner_replies: false,
    hiring_marketing: true, // retired under v2: must not add points
    review_surge: true, // retired under v2: must not add points
    branch_count: 1,
    ...overrides,
  };
}

const ANSWER_COMPETITORS_ONLY = [
  "Here are well-regarded options for cosmetic dentistry:",
  "",
  "1. **Apollo White Dental**: Known for implants and smile design.",
  "2. **Dr. Kapoor's Dental Studio**: Veneers and aligners.",
  "",
  "**Tip:** check reviews before booking.",
].join("\n");

const ANSWER_PROSPECT_FIRST = [
  "Top picks:",
  "",
  "1. **Smile Studio Dental Clinic**: Single-location practice with strong reviews.",
  "2. **Clove Dental**: National chain.",
  "3. **Apollo White Dental**: National chain.",
].join("\n");

const ANSWER_PROSPECT_SECOND = [
  "Top picks:",
  "",
  "1. **Clove Dental**: National chain.",
  "2. **Smile Studio Dental Clinic**: Single-location practice.",
  "3. **Apollo White Dental**: National chain.",
].join("\n");

function mkProbe(answer: string, company = COMPANY, domain = DOMAIN): Dim4Probe {
  const a = analyseDim4Answer({ company, domain, answer });
  return {
    rubric_version: "v2",
    engine: "gemini",
    model: "fixture-model",
    question: buildDim4Question(CATEGORY, CITY),
    answer,
    names_found: a.namesFound,
    prospect_named: a.prospectNamed,
    prospect_position: a.prospectPosition,
    competitor_named: a.competitorNamed,
    score: a.score,
    date: "2026-11-10T10:00:00.000Z",
    cost_usd: 0.0123,
  };
}

function dimLine(reasons: string[], n: number): string {
  return reasons.find((r) => r.startsWith(`Dim ${n}`)) || "";
}

function fixedProbe(answer: string): { fn: Dim4ProbeFn; calls: () => number } {
  let n = 0;
  return {
    fn: async ({ company, domain }) => {
      n++;
      return mkProbe(answer, company, domain);
    },
    calls: () => n,
  };
}

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

function benchRow(overrides: Partial<ProspectRecord> = {}): ProspectRecord {
  return {
    tenant_id: "tgl",
    company: COMPANY,
    category: CATEGORY,
    city: CITY,
    website: "smilestudio.example.in",
    door: "aeo",
    fit_score: 58,
    fit_reasons: [
      "Dim 1 (AI Dependence): High-anxiety category (+25 pts)",
      "Dim 2 (Active Paid Budget): Active Meta Ad Library campaigns (+15 pts) [Score: 15/25]",
      "Dim 3 (GBP & Hiring): GBP established (+5 pts) [Score: 5/20]",
      "Dim 4 (Scale & Growth): Single location footprint (0 pts) [Score: 0/15]",
      "Dim 5 (DM Reachability): Verified business phone (+10 pts) [Score: 10/15]",
    ],
    decision_maker: OWNER_PHONE_DM,
    signals: clinicSignals(),
    status: "bench",
    source_refs: ["places:place_id:fixture", "dns:pass:203.0.113.10"],
    created_at: "2026-11-01T00:00:00.000Z",
    rescored_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log("Rubric v2 tests (issue #171)");

  // 1. Single-location clinic, 25-pt probe -> 80
  console.log("\n[1] Single-location clinic with a 25-pt probe");
  {
    const probe = mkProbe(ANSWER_COMPETITORS_ONLY);
    check("probe fixture: competitor named, prospect absent scores 25", probe.score === 25 && !probe.prospect_named && probe.competitor_named, JSON.stringify(probe.names_found));
    const res = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: OWNER_PHONE_DM, dim4Probe: probe,
    });
    check("fit score is 80 (25 + 15 + 5 + 25 + 10)", res.fitScore === 80, `got ${res.fitScore}`);
    check("qualified", res.qualified === true);
    check("Dim 2 scores 15/15 with Meta ads", /\[Score: 15\/15\]/.test(dimLine(res.fitReasons, 2)), dimLine(res.fitReasons, 2));
    check("Dim 3 scores 5/20 and ignores hiring_marketing", /\[Score: 5\/20\]/.test(dimLine(res.fitReasons, 3)), dimLine(res.fitReasons, 3));
    check("Dim 4 scores 25/25", /\[Score: 25\/25\]/.test(dimLine(res.fitReasons, 4)), dimLine(res.fitReasons, 4));
    const stored = parseDim4Probe(res.fitReasons);
    check("dim4_probe is stored under fit_reasons with engine, question, verbatim answer, names and date",
      !!stored && stored.engine === "gemini" && stored.question === "best dental clinic in Chandigarh Tricity" &&
      stored.answer === ANSWER_COMPETITORS_ONLY && stored.names_found.length === 2 && stored.date === "2026-11-10T10:00:00.000Z");
    check("fit_reasons keeps one entry per dimension plus dim4_probe", res.fitReasons.length === 6, `got ${res.fitReasons.length}`);
    const noProbe = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: OWNER_PHONE_DM,
    });
    check("without a probe Dim 4 is 0 and says not probed", noProbe.fitScore === 55 && /Not probed/.test(dimLine(noProbe.fitReasons, 4)), `got ${noProbe.fitScore}`);
  }

  // 2. Dimension 4 outcomes
  console.log("\n[2] Dimension 4 outcomes");
  {
    const first = mkProbe(ANSWER_PROSPECT_FIRST);
    check("prospect named first (chains listed after it) -> dim4 = 0", first.score === 0 && first.prospect_position === 1, `score ${first.score} pos ${first.prospect_position}`);
    const resFirst = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: OWNER_PHONE_DM, dim4Probe: first,
    });
    check("Dim 4 line reads 0/25 and total is 55", /\[Score: 0\/25\]/.test(dimLine(resFirst.fitReasons, 4)) && resFirst.fitScore === 55, `got ${resFirst.fitScore}`);
    check("55 is not qualified", resFirst.qualified === false);

    const second = mkProbe(ANSWER_PROSPECT_SECOND);
    check("prospect named but not first -> dim4 = 10", second.score === 10 && second.prospect_position === 2, `score ${second.score} pos ${second.prospect_position}`);

    const chainFirstAbsent = mkProbe("1. **Clove Dental**: chain.\n2. **Apollo White Dental**: chain.");
    check("a chain named first and prospect absent -> dim4 = 25", chainFirstAbsent.score === 25);

    const nobody = mkProbe("I could not find specific recommendations for that search.");
    check("answer naming nobody -> dim4 = 0 (no observed gap)", nobody.score === 0 && nobody.names_found.length === 0);

    check("question template per category", buildDim4Question("ivf_fertility", "Mumbai") === "best IVF clinic in Mumbai" && buildDim4Question("hospitals", "Hyderabad") === "best hospital in Hyderabad");
  }

  // 3. No-spend candidate
  console.log("\n[3] No-spend candidate");
  {
    const res = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals({ meta_ads_active: false, meta_ad_count: 0, gbp_reviews: 30 }),
      decisionMaker: OWNER_PHONE_DM, dim4Probe: mkProbe(ANSWER_COMPETITORS_ONLY),
    });
    check("Dim 2 = 0 when no spend observed", /\[Score: 0\/15\]/.test(dimLine(res.fitReasons, 2)), dimLine(res.fitReasons, 2));
    check("below 65 (25 + 0 + 0 + 25 + 10 = 60)", res.fitScore === 60 && res.qualified === false, `got ${res.fitScore}`);

    const directory = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals({ meta_ads_active: false, meta_ad_count: 0, paid_directory_listings: ["Practo"] }),
      decisionMaker: OWNER_PHONE_DM, dim4Probe: mkProbe(ANSWER_COMPETITORS_ONLY),
    });
    check("a paid directory listing (Practo) counts for Dim 2", /\[Score: 15\/15\]/.test(dimLine(directory.fitReasons, 2)));
    const rebuilt = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals({ meta_ads_active: false, meta_ad_count: 0, site_rebuilt_last_12m: true }),
      decisionMaker: OWNER_PHONE_DM, dim4Probe: mkProbe(ANSWER_COMPETITORS_ONLY),
    });
    check("a site rebuilt in the last 12 months counts for Dim 2", /\[Score: 15\/15\]/.test(dimLine(rebuilt.fitReasons, 2)));
  }

  // 4. Threshold 65
  console.log("\n[4] Threshold 65");
  {
    check("FIT_QUALIFIED_THRESHOLD is 65", FIT_QUALIFIED_THRESHOLD === 65);
    const atThreshold = evaluateProspectRubric({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals({ meta_ads_active: false, meta_ad_count: 0 }),
      decisionMaker: OWNER_PHONE_DM, dim4Probe: mkProbe(ANSWER_COMPETITORS_ONLY),
    });
    check("exactly 65 qualifies (25 + 0 + 5 + 25 + 10)", atThreshold.fitScore === 65 && atThreshold.qualified === true, `got ${atThreshold.fitScore}`);

    const record = (score: number, status: ProspectRecord["status"]) => benchRow({ fit_score: score, status });
    check("write gate accepts 65 for a new row", validateProspectRecord(record(65, "new")).valid === true);
    check("write gate rejects 64 for a new row", validateProspectRecord(record(64, "new")).valid === false);
    check("write gate accepts a benched row below 65", validateProspectRecord(record(58, "bench")).valid === true);
    const withProbeEntry = benchRow({ fit_score: 80, status: "new", fit_reasons: [...benchRow().fit_reasons, "dim4_probe: {}"] });
    check("write gate accepts the sixth dim4_probe entry", validateProspectRecord(withProbeEntry).valid === true);
  }

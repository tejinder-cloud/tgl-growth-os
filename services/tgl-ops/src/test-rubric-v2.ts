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

  // 5. The probe is never called for a rejected candidate
  console.log("\n[5] Probe never called for Dimension 5 (or Playbook C) disqualification");
  {
    const dq = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const dim5 = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: UNVERIFIED_DM, probe: dq.fn,
    });
    check("Dimension 5 disqualification: disqualified, score 0", dim5.disqualified === true && dim5.fitScore === 0);
    check("Dimension 5 disqualification: probe never called", dq.calls() === 0 && dim5.probeCalled === false, `calls ${dq.calls()}`);

    const chain = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const playbookC = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals({ places_brand_count: 3, branch_count: 3 }), decisionMaker: OWNER_PHONE_DM, probe: chain.fn,
    });
    check("Playbook C chain: disqualified and probe never called", playbookC.disqualified === true && chain.calls() === 0);

    const ok = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const passed = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: OWNER_PHONE_DM, probe: ok.fn,
    });
    check("a candidate that passed Dimension 5 is probed exactly once and scores 80", ok.calls() === 1 && passed.fitScore === 80 && passed.probeCalled === true, `calls ${ok.calls()} score ${passed.fitScore}`);

    const unavailable = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: OWNER_PHONE_DM, probe: async () => null,
    });
    check("a probe that returns nothing is never scored as qualified", unavailable.probeUnavailable === true && unavailable.qualified === false);

    const bench = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const benchDq = await rescoreBenchedProspects({ prospects: [benchRow({ decision_maker: UNVERIFIED_DM })], probe: bench.fn });
    check("benched row failing Dimension 5 is rejected without a probe", benchDq.rejected.length === 1 && bench.calls() === 0);
  }

  // 6. Cost: probe recorded under prospect-researcher; stops at the daily cap and reports the shortfall
  console.log("\n[6] Probe cost, daily cap and shortfall");
  {
    let spent = 0;
    const recorded: { usd: number; details: string }[] = [];
    const questions: string[] = [];
    const gov = createDim4ProbeGovernor({ testMode: true }, {
      askEngine: async (_cfg, prompt) => { questions.push(prompt); return mkAnswer(ANSWER_COMPETITORS_ONLY, 0.015); },
      loadEngineConfig: () => ({ config: CFG, missing: [] }),
      getSpendUsd: async () => spent,
      getCapUsd: async () => 0.02,
      recordSpend: (usd, details) => { spent += usd; recorded.push({ usd, details }); },
      now: () => new Date("2026-11-10T10:00:00.000Z"),
    });
    const input = { company: COMPANY, domain: DOMAIN, category: CATEGORY, city: "Mumbai" };
    const r1 = await gov.probe(input);
    const r2 = await gov.probe(input);
    const r3 = await gov.probe(input);
    const r4 = await gov.probe(input);
    check("first two probes run (spend under the cap before each call)", !!r1 && !!r2 && questions.length === 2);
    check("question is built from category and city", questions[0] === "best dental clinic in Mumbai", questions[0]);
    check("probe record carries engine, model, verbatim answer, date and cost", r1?.engine === "gemini" && r1?.answer === ANSWER_COMPETITORS_ONLY && r1?.date === "2026-11-10T10:00:00.000Z" && r1?.cost_usd === 0.015);
    check("every completed probe is recorded as spend", recorded.length === 2 && Math.abs(gov.stats.costUsd - 0.03) < 1e-9);
    check("probing stops once the daily cap is reached", r3 === null && r4 === null && questions.length === 2);
    check("shortfall is counted and reported", gov.stats.skippedCap === 2 && /2 of 4 candidate\(s\) not scored/.test(gov.shortfallReport() || "") && /daily cap/.test(gov.shortfallReport() || ""), gov.shortfallReport() || "none");

    const missing = createDim4ProbeGovernor({ testMode: true }, {
      askEngine: async () => { throw new Error("must not be called"); },
      loadEngineConfig: () => ({ missing: ["GEMINI_API_KEY"] }),
      getSpendUsd: async () => 0, getCapUsd: async () => 2, recordSpend: () => {},
    });
    check("missing engine configuration yields no probe and a reported shortfall", (await missing.probe(input)) === null && missing.stats.skippedUnavailable === 1 && /GEMINI_API_KEY/.test(missing.shortfallReport() || ""));

    const blocked = createDim4ProbeGovernor({ testMode: true });
    check("test mode never reaches a live engine unless a fake is injected", (await blocked.probe(input)) === null && /test mode/.test(blocked.stats.haltedReason || ""));

    // Ledger: the default recorder writes to usage_costs under prospect-researcher
    resetCostLedgerForTests();
    const ledgerGov = createDim4ProbeGovernor({ testMode: true }, {
      askEngine: async () => mkAnswer(ANSWER_COMPETITORS_ONLY, 0.0123),
      loadEngineConfig: () => ({ config: CFG, missing: [] }),
      getSpendUsd: async () => 0,
      getCapUsd: async () => 2,
    });
    await ledgerGov.probe(input);
    const entry = usageCostsLedger.find((e) => e.agent === "prospect-researcher" && e.apiName === "gemini-dim4-probe");
    check("probe cost lands in usage_costs under prospect-researcher", !!entry && entry.costType === "api" && entry.totalCostUsd === 0.0123, JSON.stringify(entry));
    resetCostLedgerForTests();
  }

  // 7. Rotation: benched candidates are re-scored under v2
  console.log("\n[7] Benched candidates re-scored under v2");
  {
    const probe = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const alreadyV2 = benchRow({ company: "Already Scored Clinic", website: "already.example.in", fit_reasons: [...benchRow().fit_reasons, `dim4_probe: ${JSON.stringify(mkProbe(ANSWER_COMPETITORS_ONLY))}`] });
    const result = await rescoreBenchedProspects({
      prospects: [
        benchRow({ status: "bench" }),
        benchRow({ company: "Nurture Clinic", website: "nurture.example.in", status: "nurture", fit_score: 52 }),
        benchRow({ company: "New Clinic", website: "new.example.in", status: "new", fit_score: 75 }),
        benchRow({ company: "Too Low Clinic", website: "low.example.in", status: "bench", fit_score: 40 }),
        alreadyV2,
      ],
      probe: probe.fn,
      now: () => new Date("2026-11-10T11:00:00.000Z"),
    });
    check("only nurture/bench rows scoring 50 to 69 without a v2 probe are eligible", result.eligible === 2 && probe.calls() === 2, `eligible ${result.eligible} calls ${probe.calls()}`);
    check("a benched row that now scores 65 or above is promoted to new with the probe stored", result.promoted.length === 2 && result.promoted.every((p) => p.status === "new" && p.fit_score === 80 && parseDim4Probe(p.fit_reasons) !== null));
    check("rescored_at is stamped", result.promoted[0].rescored_at === "2026-11-10T11:00:00.000Z");

    const weak = await rescoreBenchedProspects({
      prospects: [benchRow({ signals: clinicSignals({ meta_ads_active: false, meta_ad_count: 0, gbp_reviews: 30 }) })],
      probe: fixedProbe(ANSWER_COMPETITORS_ONLY).fn,
    });
    check("a benched row scoring 50 to 64 under v2 stays benched", weak.stillBenched.length === 1 && weak.stillBenched[0].fit_score === 60 && weak.stillBenched[0].status === "bench");

    const none = await rescoreBenchedProspects({ prospects: [benchRow()], probe: async () => null });
    check("a row whose probe is unavailable is left untouched for the next run", none.notProbed.length === 1 && none.touched.length === 0);
  }

  console.log(failures === 0 ? "\nAll rubric v2 tests passed." : `\n${failures} rubric v2 test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-rubric-v2 crashed:", err);
  process.exit(1);
});

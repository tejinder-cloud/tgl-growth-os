// services/tgl-ops/src/test-bench-save.ts
// Issue #177: candidates scored FIT_BENCH_FLOOR (50) to below FIT_QUALIFIED_THRESHOLD (65) under rubric v2 are saved
// with status "bench" instead of being dropped at Gate 8. Fixture scoring only: no live engine call, no Slack post,
// no Supabase write (test-mode upsert is a dry run), no prospect contact, no write to decisions/ or logs/.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  evaluateProspectRubric,
  evaluateProspectRubricWithProbe,
  analyseDim4Answer,
  buildDim4Question,
  parseDim4Probe,
} from "./agents/prospect-researcher/rubric.js";
import type { Dim4Probe, Dim4ProbeFn } from "./agents/prospect-researcher/dim4.js";
import { FIT_BENCH_FLOOR, FIT_QUALIFIED_THRESHOLD } from "./agents/prospect-researcher/threshold.js";
import {
  routeGate8,
  routeScoredCandidate,
  type Gate8Evaluation,
  type Gate8Lists,
  type ScoredCandidate,
} from "./agents/prospect-researcher/bench-save.js";
import { rescoreBenchedProspects } from "./agents/prospect-researcher/bench-rescore.js";
import { setMockProspectRecordsForTests, upsertProspectRecords } from "./agents/prospect-researcher/db.js";
import { rescoreProspects } from "./agents/prospect-researcher/worker.js";
import { createMemoryStore, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import type { DecisionMaker, ProspectRecord, ProspectSignals } from "./agents/prospect-researcher/types.js";

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
const DOMAIN = "smilestudio.example.in";
const CATEGORY = "cosmetic_dental";
const CITY = "Chandigarh Tricity";
const SOURCE_REFS = ["places:place_id:fixture", "dns:pass:203.0.113.10"];

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
    hiring_marketing: false,
    review_surge: false,
    branch_count: 1,
    ...overrides,
  };
}

const ANSWER_COMPETITORS_ONLY = [
  "Here are well-regarded options for cosmetic dentistry:",
  "",
  "1. **Apollo White Dental**: Known for implants and smile design.",
  "2. **Dr. Kapoor's Dental Studio**: Veneers and aligners.",
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
    date: "2026-11-11T10:00:00.000Z",
    cost_usd: 0.0123,
  };
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

/** Real v2 fit_reasons (five dimension entries plus the dim4_probe record) to hang a chosen score on. */
const REAL_REASONS = evaluateProspectRubric({
  company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
  signals: clinicSignals(), decisionMaker: OWNER_PHONE_DM, dim4Probe: mkProbe(ANSWER_COMPETITORS_ONLY),
}).fitReasons;

/**
 * The rubric scores in steps of 5, so a 58 cannot come out of evaluateProspectRubric. The routing is a function of the
 * evaluation result, so the 58 / 45 cases are built directly as evaluation results carrying real v2 fit_reasons.
 */
function evalAt(fitScore: number, extra: Partial<Gate8Evaluation> = {}): Gate8Evaluation {
  return {
    fitScore,
    qualified: fitScore >= FIT_QUALIFIED_THRESHOLD,
    fitReasons: [...REAL_REASONS],
    ...extra,
  };
}

function candidate(evaluation: Gate8Evaluation, overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    company: COMPANY,
    category: CATEGORY,
    city: CITY,
    website: DOMAIN,
    evaluation,
    decisionMaker: OWNER_PHONE_DM,
    signals: clinicSignals(),
    sourceRefs: SOURCE_REFS,
    now: () => new Date("2026-11-11T11:00:00.000Z"),
    ...overrides,
  };
}

function freshLists(): Gate8Lists {
  return { qualified: [], benched: [] };
}

async function main(): Promise<void> {
  console.log("Benched candidate save tests (issue #177)");

  // 1. 58 points: saved as bench, not on the qualified list
  console.log("\n[1] A 58-point candidate is saved as bench and is not in the qualified list");
  {
    check("thresholds are 50 and 65", FIT_BENCH_FLOOR === 50 && FIT_QUALIFIED_THRESHOLD === 65);
    const lists = freshLists();
    const dmWithExtras = {
      ...OWNER_PHONE_DM,
      verified: true,
      personal_email: "amit.private@example.com",
      linkedin: "https://linkedin.example/in/amit",
      home_address: "12 Example Lane",
    } as unknown as DecisionMaker;
    const res = routeScoredCandidate(candidate(evalAt(58), { decisionMaker: dmWithExtras }), lists);
    check("routed as bench and placed", res.route === "bench" && res.placed === true, JSON.stringify(res.route));
    check("qualified list is empty", lists.qualified.length === 0);
    check("bench list holds exactly one row", lists.benched.length === 1);

    const row = lists.benched[0];
    check("status is bench", row?.status === "bench", row?.status);
    check("company, category, city, website, door and fit_score are stored",
      row?.company === COMPANY && row?.category === CATEGORY && row?.city === CITY && row?.website === DOMAIN && row?.door === "aeo" && row?.fit_score === 58);
    check("tenant is tgl", row?.tenant_id === "tgl");
    check("fit_reasons keeps the five dimension entries", [1, 2, 3, 4, 5].every((n) => row?.fit_reasons.some((r) => r.startsWith(`Dim ${n}`))));
    const stored = parseDim4Probe(row?.fit_reasons || []);
    check("fit_reasons includes the dim4_probe record when a probe ran", !!stored && stored.engine === "gemini" && stored.answer === ANSWER_COMPETITORS_ONLY);
    const dmKeys = Object.keys(row?.decision_maker || {}).sort().join(",");
    check("decision_maker is limited to name, role, work email, work phone (plus the verification source tag)", dmKeys === "email,name,phone,role,source", dmKeys);
    check("decision_maker keeps name, role and phone", row?.decision_maker.name === "Dr. Amit Grover" && row?.decision_maker.role === "Owner / Lead Doctor" && row?.decision_maker.phone === "+919876543210");
    check("personal and extra contact fields are dropped",
      !("personal_email" in (row?.decision_maker || {})) && !("linkedin" in (row?.decision_maker || {})) && !("home_address" in (row?.decision_maker || {})) && !("verified" in (row?.decision_maker || {})));

    const noPhone = routeScoredCandidate(
      candidate(evalAt(58), { decisionMaker: { name: "Dr. Neha Rao", role: "Owner / Lead Doctor", email: "neha@clinic.example.in", source: "hunter:deliverable" } }),
      freshLists()
    );
    check("a work phone that was never found is not invented", noPhone.record !== undefined && !("phone" in noPhone.record.decision_maker));

    const dry = await upsertProspectRecords(lists.benched, { testMode: true });
    check("the bench row goes through the prospects write path (test mode is a dry run)", dry.upsertedCount === 1 && dry.persistedToSupabase === false);

    const store = createMemoryStore([{ ...row, id: "bench-1" } as OutreachProspect, { ...row, id: "bench-2", status: "nurture" } as OutreachProspect]);
    check("the outreach sequencer never enrols a benched row", (await store.loadEnrollable(10)).length === 0);
  }

  // 2. 45 points: not saved
  console.log("\n[2] A 45-point candidate is not saved as bench");
  {
    const lists = freshLists();
    const res = routeScoredCandidate(candidate(evalAt(45)), lists);
    check("routed as rejected", res.route === "rejected" && res.placed === false && res.record === undefined);
    check("neither list receives it", lists.benched.length === 0 && lists.qualified.length === 0);
  }

  // 3. Disqualified: never saved as bench
  console.log("\n[3] A disqualified candidate is never saved as bench");
  {
    const lists = freshLists();
    const forced = routeScoredCandidate(candidate(evalAt(58, { disqualified: true })), lists);
    check("disqualified with a 58 in the score field is still rejected", forced.route === "rejected" && lists.benched.length === 0 && lists.qualified.length === 0);

    const probe = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const chainSignals = clinicSignals({ places_brand_count: 3, branch_count: 3 });
    const chain = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: chainSignals, decisionMaker: OWNER_PHONE_DM, probe: probe.fn,
    });
    const chainRoute = routeScoredCandidate(candidate(chain, { signals: chainSignals }), lists);
    check("Playbook C chain (real rubric result) is rejected, probe never called", chain.disqualified === true && chainRoute.route === "rejected" && probe.calls() === 0);

    const dim5 = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: clinicSignals(), decisionMaker: UNVERIFIED_DM, probe: probe.fn,
    });
    const dim5Route = routeScoredCandidate(candidate(dim5, { decisionMaker: UNVERIFIED_DM }), lists);
    check("Dimension 5 disqualification (real rubric result) is rejected", dim5.disqualified === true && dim5Route.route === "rejected");
    check("nothing was saved for any disqualified candidate", lists.benched.length === 0 && lists.qualified.length === 0);
  }

  // 4. Band boundaries and a real rubric result
  console.log("\n[4] Score bands");
  {
    check("49 is rejected", routeGate8(evalAt(49)) === "rejected");
    check("50 is benched (the floor is inclusive)", routeGate8(evalAt(50)) === "bench");
    check("64 is benched", routeGate8(evalAt(64)) === "bench");
    check("65 qualifies", routeGate8(evalAt(65)) === "qualified");

    const lists = freshLists();
    const q = routeScoredCandidate(candidate(evalAt(80)), lists);
    check("a qualified candidate still lands on the qualified list with status new", q.route === "qualified" && lists.qualified.length === 1 && lists.qualified[0].status === "new" && lists.benched.length === 0);

    const weakSignals = clinicSignals({ meta_ads_active: false, meta_ad_count: 0, gbp_reviews: 30 });
    const real = await evaluateProspectRubricWithProbe({
      company: COMPANY, domain: DOMAIN, category: CATEGORY, city: CITY,
      signals: weakSignals, decisionMaker: OWNER_PHONE_DM, probe: fixedProbe(ANSWER_COMPETITORS_ONLY).fn,
    });
    const realLists = freshLists();
    const realRoute = routeScoredCandidate(candidate(real, { signals: weakSignals }), realLists);
    check("a real rubric v2 result of 60 is benched with its probe stored", real.fitScore === 60 && realRoute.route === "bench" && realLists.benched.length === 1 && parseDim4Probe(realLists.benched[0].fit_reasons) !== null, `score ${real.fitScore}`);

    // 5. Monday re-score and v2 bench re-score read the saved rows
    console.log("\n[5] Monday re-score and the v2 bench re-score read benched rows");
    const saved: ProspectRecord = { ...realLists.benched[0] };
    setMockProspectRecordsForTests([saved]);
    try {
      const monday = await rescoreProspects({ testMode: true });
      const after = monday.records[0];
      check("Monday re-score reads the bench row and keeps it benched (not rejected)",
        monday.totalRescored === 1 && after.status === "bench" && after.fit_score >= FIT_BENCH_FLOOR && after.fit_score < FIT_QUALIFIED_THRESHOLD,
        `${after?.status} ${after?.fit_score}`);
    } finally {
      setMockProspectRecordsForTests(null);
    }

    const v1Row: ProspectRecord = {
      ...saved,
      fit_score: 58,
      fit_reasons: saved.fit_reasons.filter((r) => !r.startsWith("dim4_probe")),
    };
    const rotationProbe = fixedProbe(ANSWER_COMPETITORS_ONLY);
    const rotation = await rescoreBenchedProspects({ prospects: [v1Row, saved], probe: rotationProbe.fn });
    check("bench-rescore picks up the bench row without a v2 probe and does not re-probe one that has it",
      rotation.eligible === 1 && rotationProbe.calls() === 1, `eligible ${rotation.eligible} calls ${rotationProbe.calls()}`);
  }

  // 6. Worker wiring (static read): Gate 8 uses the router, shortfall line carries "N benched", bench block never notifies
  console.log("\n[6] Worker wiring");
  {
    const src = fs.readFileSync(path.join(config.repoRoot, "services/tgl-ops/src/agents/prospect-researcher/worker.ts"), "utf8");
    check("worker routes Gate 8 through routeScoredCandidate", src.includes("routeScoredCandidate(") && !src.includes("[Gate 8 Dropped] '${cand.name}': fit score ${rubricResult.fitScore} below cutoff"));
    check("shortfall line gains N benched", src.includes("${funnel.benched} benched"));
    const start = src.indexOf("// 6b. Save candidates benched this run");
    const end = src.indexOf("// Insert failure alert");
    const block = start >= 0 && end > start ? src.slice(start, end) : "";
    check("the bench save block exists and posts nothing", block.includes("upsertProspectRecords(benchedProspects") && !/postLine|postCard|postFile|postTop25ReviewCard/.test(block));
    check("the review card and CSV use the qualified list only", src.includes("const rowsToCard = isTest || savedCount > 0 ? qualifiedProspects : [];") && !/prospects:\s*benchedProspects/.test(src));
  }

  console.log(failures === 0 ? "\nAll benched candidate save tests passed." : `\n${failures} benched candidate save test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-bench-save crashed:", err);
  process.exit(1);
});

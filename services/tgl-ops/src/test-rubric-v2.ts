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

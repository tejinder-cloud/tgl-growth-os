// services/tgl-ops/src/test-prospect-targets.ts
// Offline checks for the widened prospect researcher (24 Nov 2026): the tiered rotation (40/40/20), all six
// industries, the city list, several runs a day, decision A (an email published on the business's own website is
// usable for any size, info@ included) and decision B (outreach starts at fit 65). No network, no Slack, no writes.
import assert from "node:assert/strict";
import { nextState, pairFor, parseResearchBrief } from "./agents/prospect-researcher/rotation.js";
import { CITIES, INDUSTRIES, TIER_PATTERN, citiesInTier, runsPerDay } from "./agents/prospect-researcher/targets.js";
import { buildPlacesQueries, categoryPhrase, METRO_AREAS } from "./agents/prospect-researcher/sources/places.js";
import { sanitizeDecisionMaker } from "./agents/prospect-researcher/guardrails.js";
import { evaluateProspectRubric } from "./agents/prospect-researcher/rubric.js";
import { MIN_FIT_SCORE, createMemoryStore, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import type { RotationState } from "./agents/prospect-researcher/types.js";

async function main() {
  // --- targets ---
  assert.deepEqual(INDUSTRIES.map((i) => i.key), ["hospitals", "cosmetic_dental", "ivf_fertility", "high_ticket_coaching", "hotels", "real_estate"]);
  assert.equal(citiesInTier(1).length, 8);
  assert.equal(citiesInTier(2).length, 10);
  assert.equal(citiesInTier(3).length, 8);
  assert.equal(new Set(CITIES.map((c) => c.name)).size, CITIES.length, "no city listed twice");
  assert.equal(categoryPhrase("hotels"), "boutique hotel");
  assert.equal(categoryPhrase("real_estate"), "real estate developer builder");
  assert.equal(categoryPhrase("cosmetic_dental"), "dental implant cosmetic clinic", "existing phrases unchanged");
  assert.ok(METRO_AREAS["Chandigarh Tricity"].includes("Mohali"), "area list still feeds competitor place words");
  assert.deepEqual(buildPlacesQueries("Patiala", "hotels", 4, 0), ["boutique hotel in Patiala"], "a city without areas gets one search");
  assert.equal(buildPlacesQueries("Delhi NCR", "hospitals", 4, 0).length, 4);

  // --- rotation: 40/40/20 and every industry ---
  const v1: RotationState = { version: 1, currentCityIndex: 3, currentCategoryIndex: 2, completedRunsCount: 40, lastRunAt: "2026-11-22T04:00:00Z" };
  let state = v1;
  const tiers = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
  const seenIndustries = new Set<string>();
  const seenCities = new Set<string>();
  const firstPairs: string[] = [];
  for (let i = 0; i < 30; i++) {
    const p = pairFor(state);
    tiers[p.tier]++;
    seenIndustries.add(p.category);
    seenCities.add(p.city);
    if (i < 6) firstPairs.push(`${p.tier}:${p.city}:${p.category}`);
    state = nextState(state, new Date("2026-11-25T04:00:00Z"));
  }
  assert.deepEqual(tiers, { 1: 12, 2: 12, 3: 6 }, "40% Tier 1, 40% Tier 2, 20% Tier 3");
  assert.equal(seenIndustries.size, 6, "all six industries come round");
  assert.ok(seenCities.has("Patiala") && seenCities.has("Ludhiana") && seenCities.has("Pune"), "Tier 2 and 3 cities and new Tier 1 cities are searched");
  assert.deepEqual(firstPairs.slice(0, 3), ["1:Delhi NCR:ivf_fertility", "2:Chandigarh Tricity:high_ticket_coaching", "1:Mumbai:hotels"], "an old state file starts the tiered rotation and keeps its industry position");
  assert.equal(state.version, 2);
  assert.equal(state.completedRunsCount, 70);
  assert.equal(TIER_PATTERN.length, 5);

  // --- briefs name any configured city and industry ---
  assert.deepEqual(pick(parseResearchBrief("Ludhiana hotels, 20 names")), { city: "Ludhiana", category: "hotels" });
  assert.deepEqual(pick(parseResearchBrief("dental clinics in Gurugram")), { city: "Delhi NCR", category: "cosmetic_dental" });
  assert.deepEqual(pick(parseResearchBrief("real estate developers in Pune")), { city: "Pune", category: "real_estate" });
  assert.deepEqual(pick(parseResearchBrief("Mohali IVF")), { city: "Chandigarh Tricity", category: "ivf_fertility" });

  // --- runs a day ---
  assert.equal(runsPerDay({}), 3);
  assert.equal(runsPerDay({ PROSPECT_RUNS_PER_DAY: "5" }), 5);
  assert.equal(runsPerDay({ PROSPECT_RUNS_PER_DAY: "40" }), 6, "capped at 6");
  assert.equal(runsPerDay({ PROSPECT_RUNS_PER_DAY: "x" }), 3);

  // --- decision A: info@ kept when published on the business's own website, removed otherwise ---
  const published = sanitizeDecisionMaker({ name: "Contact found, DM unknown", role: "DM unknown", email: "Info@CityHospital.in", source: "website:published_email (own domain; verifier: deliverable)" }, "City Hospital");
  assert.equal(published.email, "info@cityhospital.in");
  const guessed = sanitizeDecisionMaker({ name: "A", role: "B", email: "info@cityhospital.in", source: "hunter:verified" }, "City Hospital");
  assert.equal(guessed.email, "", "a generic inbox from anywhere else is still removed");

  // Rubric: a published inbox counts for a larger organisation too (10 of 15), named as "DM unknown".
  const largeDm = { name: "Contact found, DM unknown", role: "DM unknown", email: "info@cityhospital.in", source: "website:published_email (own domain; verifier: deliverable)" };
  const largeEval = evaluateProspectRubric({ company: "City Hospital", domain: "cityhospital.in", category: "hospitals", city: "Ludhiana", signals: { is_large_org: true, branch_count: 1 } as any, decisionMaker: largeDm as any });
  assert.ok(largeEval.fitReasons.some((r) => /Published business email, on its own domain, for a larger organisation; decision maker not named \(\+10 pts\)/.test(r)), largeEval.fitReasons.join("\n"));
  const noContact = evaluateProspectRubric({ company: "City Hospital", domain: "cityhospital.in", category: "hospitals", city: "Ludhiana", signals: { is_large_org: true, branch_count: 1 } as any, decisionMaker: { name: "Contact found, DM unknown", role: "DM unknown", email: "", source: "" } as any });
  assert.ok(noContact.fitReasons.some((r) => /Dim 5 .*0 pts/.test(r)), "without the published inbox it stays at 0");

  // --- decision B: outreach from fit 65 ---
  assert.equal(MIN_FIT_SCORE, 65);
  const row = (id: string, fit: number) => ({ id, tenant_id: "tgl", company: id, website: "https://x.example", category: "hotels", city: "Patiala", door: "aeo", status: "reviewed", fit_score: fit, fit_reasons: [], decision_maker: { name: "Owner", email: `${id}@x.example` }, signals: {} }) as unknown as OutreachProspect;
  const store = createMemoryStore([row("a", 66), row("b", 64), row("c", 72)]);
  assert.deepEqual((await store.loadEnrollable(10)).map((p) => p.id).sort(), ["a", "c"], "65 and above can be enrolled; 64 cannot");

  console.log("test-prospect-targets: all checks passed");
}

function pick(b: { city?: string; category?: string }) {
  return { city: b.city, category: b.category };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

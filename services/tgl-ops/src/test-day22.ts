// Day 22 — recommendations: evidence from stored rows, validated model output, numbers only from code.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = "claude-test";
process.env.ANTHROPIC_PRICE_IN = "3";
process.env.ANTHROPIC_PRICE_OUT = "15";
import assert from "node:assert/strict";
import { promptEvidence, containsName } from "./agents/aeo-recommender/gather.js";
import { validateRecommendations, buildUserMessage, proposeRecommendations } from "./agents/aeo-recommender/propose.js";
import { isDue } from "./agents/aeo-recommender/worker.js";
import type { RecEvidence } from "./agents/aeo-recommender/types.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; }
}

async function main() {
const prompts = [
  { id: "p1", text: "Best AEO agencies in India", language: "en", journey_phase: "consideration" },
  { id: "p2", text: "Is The Growth Lab a good choice for AEO?", language: "en", journey_phase: "decision" },
];
const answers = [
  { prompt_id: "p1", engine: "chatgpt", mentioned: false, competitors_mentioned: ["Wevia"], text: "Top picks: Wevia, Automize Media Labs…", created_at: "2026-11-04T01:00:00Z" },
  { prompt_id: "p1", engine: "chatgpt", mentioned: true, competitors_mentioned: [], text: "old", created_at: "2026-11-03T01:00:00Z" },
  { prompt_id: "p1", engine: "perplexity", mentioned: false, competitors_mentioned: [], text: "Dovetail…", created_at: "2026-11-04T01:00:00Z" },
  { prompt_id: "p2", engine: "chatgpt", mentioned: true, competitors_mentioned: [], text: "Yes…", created_at: "2026-11-04T01:00:00Z" },
];
const pe = promptEvidence(prompts, answers, ["The Growth Lab"]);

await t("prompt evidence: latest answer per engine, branded flag, excerpt only from an answer that didn't name them", () => {
  assert.deepEqual(pe[0], { ref: "P1", id: "p1", text: prompts[0].text, language: "en", stage: "consideration", branded: false,
    enginesAsked: ["chatgpt", "perplexity"], enginesNamed: [], competitorsNamed: ["Wevia"], excerpt: "Top picks: Wevia, Automize Media Labs…" });
  assert.equal(pe[1].branded, true); assert.deepEqual(pe[1].enginesNamed, ["chatgpt"]); assert.equal(pe[1].excerpt, null);
  assert.equal(containsName("TGL Labs", ["GL"]), false);
});

const ev: RecEvidence = {
  brandId: "b1", tenantId: "tgl", name: "The Growth Lab", domain: "thegrowthlab.co.in", platform: "wordpress", languages: ["en", "hinglish"],
  market: { product: "AEO", icp: "clinics", location: "India" }, competitors: ["Wevia"], from: "2026-10-29", to: "2026-11-04", totalAnswers: 78, namedAnswers: 12,
  prompts: pe,
  sites: [
    { ref: "S1", domain: "agencies.semrush.com", channelType: "directory", answers: 9, withoutYou: 8, namedYou: 1, competitorNotYou: 2, competitors: ["Wevia"], urls: ["https://agencies.semrush.com/list/chandigarh/"] },
    { ref: "S2", domain: "reddit.com", channelType: "forum", answers: 4, withoutYou: 3, namedYou: 1, competitorNotYou: 0, competitors: [], urls: [] },
  ],
  ownCited: 0, site: { url: "https://thegrowthlab.co.in/", ok: true, title: "Home - The Growth Lab", description: "Growth partners", headings: ["We generate clients"], text: "Lead generation, AI automation, SEO + GEO." },
};
const good = {
  recommendations: [
    { title: "Get listed on the agency directories AI cites", body: "AI leans on agency directories when it lists AEO firms; a complete profile there puts you in the pool it reads.", category: "offsite", impact: 4, ease: 5, prompt_refs: ["P1"], site_refs: ["S1"],
      asset: { kind: "directory_list", title: "Directory checklist", content: "Create a profile, add AEO as a service, add Chandigarh and India-wide coverage, link your site." } },
    { title: "Publish an AEO services page that answers buyers' questions", body: "No page on your site answers 'best AEO agency in India' directly, so AI has nothing of yours to cite.", category: "content", impact: 5, ease: 3, prompt_refs: ["P1"], site_refs: [],
      asset: { kind: "page_draft", title: "AEO services page", content: "# AEO services in India\n\n## What AEO is\n…\n## Who we help\nClinics, coaching institutes … [add a client result]" } },
    { title: "Add Organization schema", body: "Structured data tells AI engines who you are and what you offer.", category: "technical", impact: 3, ease: 5, prompt_refs: ["P2"], site_refs: [],
      asset: { kind: "json_ld", title: "Organization JSON-LD", content: "```json\n{\"@context\":\"https://schema.org\",\"@type\":\"Organization\",\"name\":\"The Growth Lab\",\"url\":\"https://thegrowthlab.co.in\"}\n```" } },
    { title: "Boost visibility by 40%", body: "Do this to get 40% more answers.", category: "content", impact: 5, ease: 5, prompt_refs: ["P1"], site_refs: [], asset: { kind: "faq_block", title: "x", content: "Q: … A: … long enough content here for the check." } },
    { title: "Join forum threads", body: "Be helpful where buyers ask.", category: "offsite", impact: 3, ease: 4, prompt_refs: ["P9"], site_refs: ["S7"], asset: { kind: "thread_list", title: "x", content: "Answer questions honestly, link only when useful." } },
    { title: "Broken schema", body: "Add schema.", category: "technical", impact: 3, ease: 5, prompt_refs: ["P1"], site_refs: [], asset: { kind: "json_ld", title: "x", content: "{not json at all, sorry about that friend}" } },
  ],
};

await t("validation: keeps evidenced recs, drops invented numbers / unknown ids / invalid JSON-LD; sorted by impact × ease", () => {
  const { recs, dropped } = validateRecommendations(good, ev);
  assert.deepEqual(recs.map((r) => r.title), ["Get listed on the agency directories AI cites", "Publish an AEO services page that answers buyers' questions", "Add Organization schema"]);
  assert.equal(dropped.length, 3);
  assert.ok(dropped.some((d) => d.includes("states a number")));
  assert.ok(dropped.some((d) => d.includes("no valid evidence")));
  assert.ok(dropped.some((d) => d.includes("not valid JSON")));
});

await t("assets: directory list built from the cited sites (not the model); JSON-LD normalised; evidence counts come from stored data", () => {
  const { recs } = validateRecommendations(good, ev);
  const dir = recs[0];
  assert.ok(dir.asset.content.startsWith("## Sites to get listed on\n- **agencies.semrush.com**\n  - https://agencies.semrush.com/list/chandigarh/"));
  assert.ok(dir.asset.content.includes("## How to do it"));
  assert.deepEqual((dir.evidence as any).sites, [{ domain: "agencies.semrush.com", answers_without_you: 8, competitor_named: 2, competitors: ["Wevia"] }]);
  assert.equal((dir.evidence as any).answers_without_you, 66);
  const ld = recs[2];
  assert.equal(ld.asset.format, "json");
  assert.equal(JSON.parse(ld.asset.content).name, "The Growth Lab");
});

await t("prompt: evidence ids, site text and the no-numbers rule reach the model", async () => {
  const msg = buildUserMessage(ev);
  assert.ok(msg.includes('P1. "Best AEO agencies in India"') && msg.includes("S1. agencies.semrush.com [directory] · names instead: Wevia"));
  assert.ok(msg.includes("excerpt of an answer that did not name them: Top picks"));
  assert.ok(!msg.includes("78") && !msg.includes("66"));   // totals are not shown to the model, so it can't echo them
  let seen: any;
  const fake = { messages: { create: async (req: any) => { seen = req; return { usage: { input_tokens: 10000, output_tokens: 4000 }, content: [{ type: "tool_use", name: "propose_recommendations", input: good }] }; } } } as any;
  const out = await proposeRecommendations(ev, fake);
  assert.equal(seen.tool_choice.name, "propose_recommendations");
  assert.ok(seen.system.includes("Never write counts"));
  assert.equal(out.recs.length, 3);
  assert.equal(out.usd, (10000 * 3 + 4000 * 15) / 1e6);
});

await t("schedule: first batch after the first run; then weekly, only if a newer run exists", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  assert.equal(isDue(null, null, now), false);
  assert.equal(isDue(null, "2026-11-04", now), true);
  assert.equal(isDue("2026-11-10T10:00:00Z", "2026-11-12", now), false);   // under a week
  assert.equal(isDue("2026-11-04T10:00:00Z", "2026-11-12", now), true);
  assert.equal(isDue("2026-11-04T10:00:00Z", "2026-11-03", now), false);   // no new run since
});

console.log(`\nDay 22: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// services/tgl-ops/src/test-day19.ts — Setup-verification queue (plan Day 19). Fixtures only.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "test-model";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { extractSite, marketQuestion, evidenceCorpus } from "./agents/aeo-strategist/evidence.js";
import { validateProposal, proposeChanges, buildUserMessage, changeCount, extractJson, normalizeLanguage, normalizeStage } from "./agents/aeo-strategist/propose.js";
import { ALLOWED_LANGUAGES, ALLOWED_STAGES } from "./agents/aeo-strategist/types.js";
import { buildReviewBlocks, readSelection, decidedBlocks } from "./agents/aeo-strategist/card.js";
import { planApply, describePlan, planSize } from "./agents/aeo-strategist/apply.js";
import type { Evidence, SetupSnapshot } from "./agents/aeo-strategist/types.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; }
}

const snap: SetupSnapshot = {
  brandId: "b1", tenantId: "t_1", tenantName: "Navkiran", name: "Navkiran Nursing Classes", domain: "navkiran.example", platform: "wordpress",
  languages: ["en", "hinglish"], variants: ["Navkiran"],
  market: { id: "m1", product: "coaching", icp: "students", location: "Mohali" },
  competitors: [{ id: "c1", name: "ABC Academy", domain: "abc.example" }, { id: "c2", name: "Google", domain: null }],
  prompts: Array.from({ length: 9 }, (_, i) => ({ id: `p${i + 1}`, text: `question number ${i + 1}`, language: "en", journey_phase: "consideration" as const })),
  plan: "trial", promptLimit: 10, submittedAt: "2026-10-31T09:00:00Z",
};
const ev: Evidence = {
  site: extractSite(`<html><head><title>Navkiran Nursing Classes | BSc Nursing Entrance Coaching Mohali</title><meta name="description" content="AIIMS &amp; PGI nursing entrance coaching"></head><body><h1>BSc Nursing Entrance Coaching</h1><script>var x=1</script><p>Batches in Mohali &amp; Kharar</p></body></html>`, "https://navkiran.example/"),
  aiQuestion: "Who are the best coaching providers in Mohali for students?",
  aiAnswer: "Top options include Sukhmani Nursing Academy (sukhmani.example) and Elite Nursing Institute, plus ABC Academy.",
  aiEngine: "perplexity (openai/gpt-6-luna)",
};

async function main() {
await t("site snapshot: title, decoded description, headings, scripts stripped", () => {
  assert.equal(ev.site!.title, "Navkiran Nursing Classes | BSc Nursing Entrance Coaching Mohali");
  assert.equal(ev.site!.description, "AIIMS & PGI nursing entrance coaching");
  assert.deepEqual(ev.site!.headings, ["BSc Nursing Entrance Coaching"]);
  assert.doesNotMatch(ev.site!.text, /var x/);
  assert.match(ev.site!.text, /Mohali & Kharar/);
});
await t("market question is neutral (no brand name)", () => {
  const q = marketQuestion(snap)!;
  assert.match(q, /coaching providers in Mohali for students/);
  assert.doesNotMatch(q, /Navkiran/);
  assert.equal(marketQuestion({ ...snap, market: null }), null);
});
await t("validation: competitors must appear in evidence; existing/brand names skipped; removals must exist", () => {
  const p = validateProposal({
    summary: "Add the two academies AI names.",
    competitors_add: [
      { name: "Sukhmani Nursing Academy", domain: "https://www.sukhmani.example/about", evidence_quote: "Sukhmani Nursing Academy (sukhmani.example)" },
      { name: "Elite Nursing Institute", domain: null, evidence_quote: "Elite Nursing Institute" },
      { name: "Imaginary Coaching Hub", domain: "imaginary.example", evidence_quote: "—" },
      { name: "ABC Academy", domain: null },
      { name: "Navkiran", domain: null },
    ],
    competitors_remove: [{ name: "google", reason: "not a competitor" }, { name: "Nobody", reason: "x" }],
  }, snap, ev);
  assert.deepEqual(p.competitorsAdd.map((c) => [c.name, c.domain]), [["Sukhmani Nursing Academy", "sukhmani.example"], ["Elite Nursing Institute", null]]);
  assert.deepEqual(p.competitorsRemove.map((c) => c.id), ["c2"]);
  assert.equal(p.dropped.length, 1);
  assert.match(p.dropped[0], /Imaginary Coaching Hub/);
});
await t("validation: prompt retire by number, adds respect languages and plan limit, no duplicates", () => {
  const p = validateProposal({
    prompts_retire: [{ number: 2, reason: "vague" }, { number: 99, reason: "x" }],
    prompts_add: [
      { text: "Mohali mein best nursing coaching kaunsi hai?", language: "hinglish", journey_phase: "consideration", reason: "city intent" },
      { text: "question number 3", language: "en", journey_phase: "decision", reason: "dup" },
      { text: "ਮੋਹਾਲੀ ਵਿੱਚ ਨਰਸਿੰਗ ਕੋਚਿੰਗ", language: "pa", journey_phase: "awareness", reason: "punjabi" },
      { text: "Which nursing coaching in Mohali has the best AIIMS results?", language: "en", journey_phase: "decision", reason: "proof" },
      { text: "Is Navkiran good for PGI nursing entrance?", language: "en", journey_phase: "decision", reason: "brand" },
    ],
  }, snap, ev);
  assert.deepEqual(p.promptsRetire.map((x) => x.id), ["p2"]);
  // 9 prompts − 1 retired = 8 → room for 2 under the 10 limit
  assert.deepEqual(p.promptsAdd.map((x) => x.language), ["hinglish", "en"]);
  assert.ok(p.dropped.some((d) => /language/.test(d)));
  assert.ok(p.dropped.some((d) => /limit/.test(d)));
});
await t("validation: market change only for fields that actually differ", () => {
  const p = validateProposal({ market_change: { product: "BSc nursing entrance coaching", location: "mohali", reason: "site says nursing" } }, snap, ev);
  assert.deepEqual(p.market, { product: "BSc nursing entrance coaching", reason: "site says nursing" });
  assert.equal(validateProposal({ market_change: { location: "Mohali", reason: "same" } }, snap, ev).market, null);
});
await t("proposeChanges: calls the model with setup + both evidence blocks, prices the call, validates the reply", async () => {
  let seen: any;
  const fake = { messages: { create: async (req: any) => { seen = req; return {
    content: [{
      type: "tool_use",
      id: "call_1",
      name: "propose_setup_check",
      input: {
        summary: "Fine overall.",
        market_change: null,
        competitors_add: [{
          name: "Elite Nursing Institute",
          domain: null,
          prompt: "Who are the best coaching providers in Mohali for students?",
          engine: "perplexity",
          verbatim_excerpt: "Elite Nursing Institute",
        }],
        competitors_remove: [],
        prompts_retire: [],
        prompts_add: [],
      },
    }],
    usage: { input_tokens: 2000, output_tokens: 300 } }; } } } as any;
  const r = await proposeChanges(snap, ev, fake);
  assert.equal(seen.tools?.[0]?.name, "propose_setup_check");
  assert.deepEqual(seen.tool_choice, { type: "tool", name: "propose_setup_check" });
  assert.equal(seen.max_tokens, 4096);
  assert.match(seen.messages[0].content, /EVIDENCE 2 — live AI answer from perplexity/);
  assert.match(seen.messages[0].content, /9\. \[en · consideration\] question number 9/);
  assert.equal(r.proposal.competitorsAdd[0].name, "Elite Nursing Institute");
  assert.equal(Number(r.usd.toFixed(4)), Number((2000 * 3 / 1e6 + 300 * 15 / 1e6).toFixed(4)));
  assert.equal(changeCount(r.proposal), 1);
});

await t("proposeChanges handles Hinglish prompt containing internal quotes via tool_use without parse error", async () => {
  const fake = {
    messages: {
      create: async () => ({
        content: [
          {
            type: "tool_use",
            id: "call_hinglish",
            name: "propose_setup_check",
            input: {
              summary: "Added Hinglish prompt with internal quotes.",
              market_change: null,
              competitors_add: [],
              competitors_remove: [],
              prompts_retire: [{ number: 1, reason: "replaced" }],
              prompts_add: [
                {
                  text: 'Mohali mein "best nursing coaching" kaunsi hai?',
                  language: "hinglish",
                  journey_phase: "consideration",
                  reason: "buyer intent with quotes",
                },
                {
                  text: 'ChatGPT par "top results" kaise dekhein',
                  language: "hinglish",
                  journey_phase: "awareness",
                  reason: "AEO discovery with quotes",
                },
              ],
            },
          },
        ],
        usage: { input_tokens: 1500, output_tokens: 200 },
      }),
    },
  } as any;
  const r = await proposeChanges(snap, ev, fake);
  assert.equal(r.proposal.promptsAdd.length, 2);
  assert.equal(r.proposal.promptsAdd[0].text, 'Mohali mein "best nursing coaching" kaunsi hai?');
  assert.equal(r.proposal.promptsAdd[0].language, "hinglish");
  assert.equal(r.proposal.promptsAdd[1].text, 'ChatGPT par "top results" kaise dekhein');
});

await t("competitor evidence: must be verbatim excerpt from live AI answer with prompt and engine; site tagline is rejected", () => {
  const customEv: Evidence = {
    site: extractSite(`<html><head><title>Super Academy</title></head><body><h1>Official Site Tagline: Best coaching in town</h1><p>Welcome to Super Academy</p></body></html>`, "https://super.example/"),
    aiQuestion: "Who are the best test prep coaching centers?",
    aiAnswer: "Top centers include Alpha Classes (alpha.example) and Beta Institute.",
    aiEngine: "perplexity (sonar-pro)",
  };

  const p = validateProposal({
    summary: "Testing evidence rules",
    competitors_add: [
      // 1. Valid: in AI answer, verbatim excerpt, prompt and engine named
      {
        name: "Alpha Classes",
        domain: "alpha.example",
        prompt: "Who are the best test prep coaching centers?",
        engine: "perplexity (sonar-pro)",
        verbatim_excerpt: "Alpha Classes (alpha.example)",
      },
      // 2. Invalid: excerpt from site tagline instead of AI answer
      {
        name: "Beta Institute",
        domain: "beta.example",
        prompt: "Who are the best test prep coaching centers?",
        engine: "perplexity (sonar-pro)",
        verbatim_excerpt: "Official Site Tagline: Best coaching in town",
      },
      // 3. Invalid: competitor only found on site, not in AI answer
      {
        name: "Super Academy",
        domain: "super.example",
        prompt: "Who are the best test prep coaching centers?",
        engine: "perplexity (sonar-pro)",
        verbatim_excerpt: "Welcome to Super Academy",
      },
      // 4. Invalid: missing prompt and engine
      {
        name: "Beta Institute",
        domain: "beta.example",
        prompt: "",
        engine: "",
        verbatim_excerpt: "Beta Institute",
      },
    ],
    competitors_remove: [],
    prompts_retire: [],
    prompts_add: [],
  }, { ...snap, market: null, competitors: [] }, { ...customEv, aiQuestion: null, aiEngine: null });

  assert.equal(p.competitorsAdd.length, 1);
  assert.equal(p.competitorsAdd[0].name, "Alpha Classes");
  assert.equal(p.competitorsAdd[0].evidence, "Alpha Classes (alpha.example)");
  assert.equal(p.competitorsAdd[0].prompt, "Who are the best test prep coaching centers?");
  assert.equal(p.competitorsAdd[0].engine, "perplexity (sonar-pro)");

  assert.ok(p.dropped.some((d) => d.includes("Beta Institute") && d.includes("site tagline is not evidence")));
  assert.ok(p.dropped.some((d) => d.includes("Super Academy") && d.includes("site tagline is not evidence")));
  assert.ok(p.dropped.some((d) => d.includes("Beta Institute") && d.includes("prompt and engine must be named")));
});

await t("proposeChanges fallback retry on tool failure and logs raw reply to aeo-strategist.md on parse error", async () => {
  let callCount = 0;
  const invalidRawText = "Raw invalid reply that fails to parse {broken: json [";
  const fake = {
    messages: {
      create: async () => {
        callCount++;
        if (callCount === 1) {
          // Tool call fails (e.g. no tool block)
          return { content: [{ type: "text", text: "Something went wrong without tool" }], usage: { input_tokens: 100, output_tokens: 20 } };
        }
        // Fallback returns invalid text
        return { content: [{ type: "text", text: invalidRawText }], usage: { input_tokens: 100, output_tokens: 20 } };
      },
    },
  } as any;

  await assert.rejects(async () => {
    await proposeChanges(snap, ev, fake);
  }, /model returned no JSON object/);

  assert.equal(callCount, 2, "Expected fallback retry to be called after primary tool failure");

  // Verify that appendLog wrote the raw reply to logs/.test/<date>/aeo-strategist.md
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(config.repoRoot, "logs/.test", today, "aeo-strategist.md");
  assert.ok(fs.existsSync(logFile), `Expected log file ${logFile} to exist`);
  const logContent = fs.readFileSync(logFile, "utf8");
  assert.ok(logContent.includes("proposal parse failure:"), "Log must mention proposal parse failure");
  assert.ok(logContent.includes("Raw invalid reply that fails to parse"), "Log must contain the raw reply text");
});

await t("extractJson: parses XML <invoke> parameter tags and strips outer markdown text", () => {
  // Test 1: Exactly the 16:40 XML payload shape
  const xmlPayload = `<invoke name="propose_setup_check">
<parameter name="market">null</parameter>
<parameter name="competitors_add">[{"name":"Digital Patron","website":"digitalpatron.in","engine":"perplexity","prompt":"Who are the best performance marketing providers in chandigarh for coaching institutes? Name specific businesses and their websites.","evidence_excerpt":"**Digital Patron** — Strongest stated fit for education admissions funnels and lead tracking. Website: **digitalpatron.in**."}]</parameter>
<parameter name="competitors_remove">[]</parameter>
<parameter name="prompts_retire">[]</parameter>
<parameter name="prompts_add">[]</parameter>
<parameter name="summary">"Added Digital Patron from Perplexity."</parameter>
</invoke>`;

  const parsed = extractJson(xmlPayload);
  assert.equal(parsed.market, null);
  assert.equal(parsed.competitors_add.length, 1);
  assert.equal(parsed.competitors_add[0].name, "Digital Patron");
  assert.equal(parsed.competitors_add[0].website, "digitalpatron.in");
  assert.equal(parsed.summary, "Added Digital Patron from Perplexity.");

  // Test 2: Standard JSON surrounded by markdown commentary
  const markdownWrapped = "Here is the proposal based on the evidence:\n```json\n{\"summary\": \"Clean proposal.\", \"competitors_add\": []}\n```\nHope this helps!";
  const parsedMd = extractJson(markdownWrapped);
  assert.equal(parsedMd.summary, "Clean proposal.");
  assert.deepEqual(parsedMd.competitors_add, []);
});

await t("review b13c2187 validation: 10 multi-vertical prompts pass even with languages: ['en'] and setupNote: null", () => {
  const b13cSnap: SetupSnapshot = {
    brandId: "brand_tgl_zero",
    tenantId: "tgl",
    tenantName: "The Growth Lab",
    name: "The Growth Lab",
    domain: "thegrowthlab.co.in",
    platform: "custom",
    languages: ["en"], // Only 'en' in DB snapshot
    variants: ["TGL", "Growth Lab"],
    market: {
      id: "m_tgl",
      product: "AI visibility (AEO/GEO) and AI automation",
      icp: "hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands across India",
      location: "India-wide, Chandigarh home",
    },
    competitors: [
      { id: "c_ls", name: "LeadSquared", domain: "leadsquared.com" },
      { id: "c_cp", name: "Classplus", domain: "classplusapp.com" },
    ],
    prompts: [
      { id: "p1", text: "How to scale student admissions from Meta ads without hiring more counsellors", language: "en", journey_phase: "consideration" },
      { id: "p2", text: "Best agencies to improve lead quality and counselling conversion for test prep institutes", language: "en", journey_phase: "consideration" },
    ],
    plan: "internal",
    promptLimit: 50,
    submittedAt: "2026-11-03T16:35:00Z",
    setupStatus: "needs_changes",
    setupNote: null, // No note present in snapshot
  };

  const b13cEv: Evidence = {
    site: extractSite("<html><head><title>The Growth Lab | AI Visibility & Automation</title></head><body><h1>AEO & GEO Operators</h1><p>Scalify Labs: We help scale brands with ads.</p></body></html>", "https://thegrowthlab.co.in/"),
    aiQuestion: "Who are the best AI visibility and generative search optimization agencies in India for hospitals, coaching institutes and hotels?",
    aiAnswer: "Top providers in India include SingleInterface (powers multi-location AI search visibility and local brand discoverability across digital agents), Performics India (leads generative search engine optimization for enterprise healthcare and consumer brands), Schbang (delivers AI-first search discoverability for consumer brands and hospitality), and Digital Pundit (provides emerging search visibility solutions).",
    aiEngine: "perplexity (sonar-pro)",
  };

  // The 10 prompts from review b13c2187
  const rawProposal = {
    summary: "Re-proposed 10 multi-vertical buyer prompts and competitors from live search answers.",
    market_change: null,
    competitors_add: [
      {
        name: "SingleInterface",
        website: "singleinterface.com", // 'website' key alias
        prompt: "Who are the best AI visibility agencies in India?",
        engine: "perplexity",
        evidence_excerpt: "powers multi-location AI search visibility and local brand discoverability", // 'evidence_excerpt' alias
      },
      // Scalify Labs is on the site, but NOT in aiAnswer
      {
        name: "Scalify Labs",
        website: "scalifylabs.com",
        prompt: "Who are the best AI visibility agencies in India?",
        engine: "perplexity",
        evidence_excerpt: "Scalify Labs: We help scale brands with ads.",
      },
    ],
    competitors_remove: [],
    prompts_retire: [],
    prompts_add: [
      { text: "Best AI visibility and generative engine optimization (GEO) agencies in India", language: "en", journey_phase: "decision", reason: "GEO/AEO agency intent" },
      { text: "Top AI search marketing agencies for hospitals and healthcare clinics", language: "English", journey_phase: "consideration", reason: "Healthcare AI search intent" },
      { text: "Leading AI automation and visibility consultants for real estate and luxury hotels", language: "en", journey_phase: "consideration", reason: "Real estate / hospitality AI visibility intent" },
      { text: "ChatGPT par brand recommendation kaise badhaye for D2C brands", language: "hinglish", journey_phase: "awareness", reason: "D2C ChatGPT visibility intent" },
      { text: "Hospital ya clinic ke liye AEO agency choose karte waqt kya dekhna chahiye", language: "Hinglish", journey_phase: "consideration", reason: "Healthcare AEO evaluation intent" },
      { text: "The Growth Lab reviews and case studies for generative search visibility", language: "en", journey_phase: "decision", reason: "TGL branded AEO evaluation intent" },
      { text: "Best generative AI growth operators in Chandigarh and Delhi NCR", language: "en", journey_phase: "decision", reason: "Regional AI operator intent" },
      { text: "How to get recommended by ChatGPT and Perplexity for coaching institutes", language: "en", journey_phase: "awareness", reason: "Coaching AEO discovery intent" },
      { text: "Coaching institute ke admissions increase karne ke liye best AI WhatsApp automation operator", language: "hinglish", journey_phase: "decision", reason: "Coaching WhatsApp automation intent" },
      { text: "Top AI growth partner for multi-branch test prep institutes in India", language: "en", journey_phase: "consideration", reason: "Coaching multi-branch test prep intent" },
    ],
  };

  const prop = validateProposal(rawProposal, b13cSnap, b13cEv);

  // Assert all 10 prompts pass validation
  assert.equal(prop.promptsAdd.length, 10, "All 10 prompts from review b13c2187 must pass validation");
  const rejectedPrompts = prop.dropped.filter((d) => d.startsWith("prompt "));
  assert.equal(rejectedPrompts.length, 0, "No prompts should be rejected for language/stage");

  // Assert Scalify Labs is rejected because its evidence is a site tagline, not in AI answer
  assert.equal(prop.competitorsAdd.length, 1);
  assert.equal(prop.competitorsAdd[0].name, "SingleInterface");
  assert.equal(prop.competitorsAdd[0].domain, "singleinterface.com");
  assert.ok(prop.dropped.some((d) => d.includes("Scalify Labs") && d.includes("site tagline is not evidence")));
});

const proposal = validateProposal({
  summary: "Two competitors AI names are missing; one prompt is vague.",
  market_change: { product: "BSc nursing entrance coaching", reason: "site" },
  competitors_add: [{ name: "Sukhmani Nursing Academy", domain: "sukhmani.example", evidence_quote: "Sukhmani Nursing Academy" }, { name: "Elite Nursing Institute", evidence_quote: "Elite Nursing Institute" }],
  competitors_remove: [{ name: "Google", reason: "search engine, not a competitor" }],
  prompts_retire: [{ number: 2, reason: "vague" }],
  prompts_add: [{ text: "Mohali mein best nursing coaching kaunsi hai?", language: "hinglish", journey_phase: "consideration", reason: "city" }, { text: "Which nursing coaching in Mohali has the best AIIMS results?", language: "en", journey_phase: "decision", reason: "proof" }],
}, snap, ev);

await t("card: every change is a pre-ticked box; Slack limits respected; three decisions", () => {
  const blocks = buildReviewBlocks(snap, proposal, "11111111-2222", "site ✓ · AI answer ✓ · $0.0123");
  const boxes = blocks.filter((b) => b.type === "actions" && b.elements[0].type === "checkboxes");
  assert.deepEqual(boxes.map((b) => b.block_id), ["setup_mk", "setup_ca", "setup_cr", "setup_pr", "setup_pa"]);
  for (const b of boxes) {
    assert.deepEqual(b.elements[0].initial_options, b.elements[0].options);
    for (const o of b.elements[0].options) { assert.ok(o.text.text.length <= 75); if (o.description) assert.ok(o.description.text.length <= 75); }
  }
  const decision = blocks.find((b) => b.block_id === "setup_decision");
  assert.deepEqual(decision.elements.map((e: any) => e.action_id), ["setup_approve", "setup_approve_asis", "setup_changes"]);
  assert.ok(decision.elements.every((e: any) => e.value === "11111111-2222"));
  const none = buildReviewBlocks(snap, { ...proposal, market: null, competitorsAdd: [], competitorsRemove: [], promptsRetire: [], promptsAdd: [] }, "r", "x");
  assert.deepEqual(none.find((b) => b.block_id === "setup_decision").elements.map((e: any) => [e.action_id, e.text.text]), [["setup_approve_asis", "Approve setup"], ["setup_changes", "Needs changes"]]);
});
await t("selection: unticked items are not applied; prompt adds trimmed to the plan limit", () => {
  const state = { setup_ca: { setup_select_setup_ca: { type: "checkboxes", selected_options: [{ value: "ca:1" }] } },
    setup_pa: { setup_select_setup_pa: { type: "checkboxes", selected_options: [{ value: "pa:0" }, { value: "pa:1" }] } },
    setup_cr: { setup_select_setup_cr: { type: "checkboxes", selected_options: [] } } };
  const plan = planApply(snap, proposal, readSelection(state));
  assert.equal(plan.market, null);
  assert.deepEqual(plan.competitorsAdd.map((c) => c.name), ["Elite Nursing Institute"]);
  assert.equal(plan.competitorsRemove.length, 0);
  assert.equal(plan.promptsRetire.length, 0);
  assert.equal(plan.promptsAdd.length, 1); // 9 active, no retire → room for 1
  assert.equal(planSize(plan), 2);
  assert.equal(describePlan(plan), "+ competitors: Elite Nursing Institute · + 1 prompt(s)");
});
await t("decided card keeps the setup summary, drops boxes and buttons", () => {
  const blocks = buildReviewBlocks(snap, proposal, "r", "x");
  const done = decidedBlocks(blocks, "Verified");
  assert.ok(!done.some((b) => b.type === "actions"));
  assert.ok(!done.some((b) => String(b.block_id ?? "").endsWith("_label")));
  assert.equal(done[done.length - 1].text.text, "Verified");
  assert.match(evidenceCorpus(ev), /Elite Nursing Institute/);
  assert.match(buildUserMessage(snap, ev), /EVIDENCE 1 — customer's homepage/);
});

await t("needs_changes note propagates into user message and respects reviewer instructions", () => {
  const tglSnap: SetupSnapshot = {
    brandId: "brand_tgl_zero",
    tenantId: "tgl",
    tenantName: "The Growth Lab",
    name: "The Growth Lab",
    domain: "thegrowthlab.co.in",
    platform: "custom",
    languages: ["en"],
    variants: ["TGL", "Growth Lab"],
    market: {
      id: "m_tgl",
      product: "AI visibility (AEO/GEO) and AI automation",
      icp: "hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands across India",
      location: "India-wide, Chandigarh home",
    },
    competitors: [
      { id: "c_ls", name: "LeadSquared", domain: "leadsquared.com" },
      { id: "c_cp", name: "Classplus", domain: "classplusapp.com" },
    ],
    prompts: [
      { id: "p1", text: "How to scale student admissions from Meta ads without hiring more counsellors", language: "en", journey_phase: "consideration" },
      { id: "p2", text: "Best agencies to improve lead quality and counselling conversion for test prep institutes", language: "en", journey_phase: "consideration" },
    ],
    plan: "internal",
    promptLimit: 50,
    submittedAt: "2026-11-02T12:33:05Z",
    setupStatus: "needs_changes",
    setupNote:
      "Market wording is outdated. TGL = AI visibility (AEO/GEO) + growth, for any business whose customers ask AI before buying: hospitals, clinics, coaching, hotels, real estate; India-wide, Chandigarh home. Redo the 10 prompts for that market (>=6 AEO/AI-visibility intents, <=3 coaching, en + hinglish) and re-propose competitors from the live answers for those prompts. Keep your two prompt retirements. · review 9779874b-141f-4db7-a541-c6227e4106f7",
  };

  const userMsg = buildUserMessage(tglSnap, ev);
  assert.match(userMsg, /REVIEWER FEEDBACK \/ INSTRUCTIONS/);
  assert.match(userMsg, /review 9779874b-141f-4db7-a541-c6227e4106f7/);
  assert.match(userMsg, /Redo the 10 prompts for that market/);
});

await t("TGL setup re-proposal: 10 prompts (>=6 AEO, <=3 coaching, en + hinglish), live competitors with quotes, 2 retirements, unverified", () => {
  const tglSnap: SetupSnapshot = {
    brandId: "brand_tgl_zero",
    tenantId: "tgl",
    tenantName: "The Growth Lab",
    name: "The Growth Lab",
    domain: "thegrowthlab.co.in",
    platform: "custom",
    languages: ["en"],
    variants: ["TGL", "Growth Lab"],
    market: {
      id: "m_tgl",
      product: "AI visibility (AEO/GEO) and AI automation",
      icp: "hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands across India",
      location: "India-wide, Chandigarh home",
    },
    competitors: [
      { id: "c_ls", name: "LeadSquared", domain: "leadsquared.com" },
      { id: "c_cp", name: "Classplus", domain: "classplusapp.com" },
    ],
    prompts: [
      { id: "p1", text: "How to scale student admissions from Meta ads without hiring more counsellors", language: "en", journey_phase: "consideration" },
      { id: "p2", text: "Best agencies to improve lead quality and counselling conversion for test prep institutes", language: "en", journey_phase: "consideration" },
    ],
    plan: "internal",
    promptLimit: 50,
    submittedAt: "2026-11-02T12:33:05Z",
    setupStatus: "needs_changes",
    setupNote:
      "Market wording is outdated. TGL = AI visibility (AEO/GEO) + growth, for any business whose customers ask AI before buying: hospitals, clinics, coaching, hotels, real estate; India-wide, Chandigarh home. Redo the 10 prompts for that market (>=6 AEO/AI-visibility intents, <=3 coaching, en + hinglish) and re-propose competitors from the live answers for those prompts. Keep your two prompt retirements. · review 9779874b-141f-4db7-a541-c6227e4106f7",
  };

  const tglEvidence: Evidence = {
    site: extractSite("<html><head><title>The Growth Lab | AI Visibility & Automation</title></head><body><h1>AEO & GEO Operators</h1><p>We help businesses be recommended by ChatGPT, Perplexity and Gemini.</p></body></html>", "https://thegrowthlab.co.in/"),
    aiQuestion: "Who are the best AI visibility and generative search optimization agencies in India for hospitals, coaching institutes and hotels?",
    aiAnswer: "Top providers in India include SingleInterface (powers multi-location AI search visibility and local brand discoverability across digital agents), Performics India (leads generative search engine optimization for enterprise healthcare and consumer brands), Schbang (delivers AI-first search discoverability for consumer brands and hospitality), and Digital Pundit (provides emerging search visibility solutions).",
    aiEngine: "perplexity (sonar-pro)",
  };

  const rawProposal = {
    summary: "Re-proposed 10 multi-vertical buyer prompts across healthcare, coaching, hospitality, real estate and D2C (7 AI-visibility intents, 3 coaching intents, English + Hinglish) and competitors from live search answers. Kept two prompt retirements.",
    market_change: {
      product: "AI visibility (AEO/GEO) and AI automation",
      icp: "hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands across India",
      location: "India-wide, Chandigarh home",
      reason: "Multi-vertical positioning requested by Architect.",
    },
    competitors_add: [
      { name: "SingleInterface", domain: "singleinterface.com", evidence_quote: "SingleInterface powers multi-location AI search visibility and local brand discoverability across digital agents" },
      { name: "Performics", domain: "performics.com", evidence_quote: "Performics India leads generative search engine optimization for enterprise healthcare and consumer brands" },
      { name: "Schbang", domain: "schbang.com", evidence_quote: "Schbang delivers AI-first search discoverability for consumer brands and hospitality" },
      { name: "Digital Pundit", domain: "digitalpundit.in", evidence_quote: "Digital Pundit provides emerging search visibility solutions" },
    ],
    competitors_remove: [
      { name: "LeadSquared", reason: "Coaching CRM, not an AI visibility agency" },
      { name: "Classplus", reason: "Coaching app, not an AI visibility agency" },
    ],
    prompts_retire: [
      { number: 1, reason: "Ad-spend specific coaching intent, replaced by multi-vertical generative AI visibility" },
      { number: 2, reason: "General agency coaching intent, replaced by multi-vertical generative AI visibility" },
    ],
    prompts_add: [
      { text: "Best AI visibility and generative engine optimization (GEO) agencies in India", language: "en", journey_phase: "decision", reason: "GEO/AEO agency intent" },
      { text: "Top AI search marketing agencies for hospitals and healthcare clinics", language: "en", journey_phase: "consideration", reason: "Healthcare AI search intent" },
      { text: "Leading AI automation and visibility consultants for real estate and luxury hotels", language: "en", journey_phase: "consideration", reason: "Real estate / hospitality AI visibility intent" },
      { text: "ChatGPT par brand recommendation kaise badhaye for D2C brands", language: "hinglish", journey_phase: "awareness", reason: "D2C ChatGPT visibility intent" },
      { text: "Hospital ya clinic ke liye AEO agency choose karte waqt kya dekhna chahiye", language: "hinglish", journey_phase: "consideration", reason: "Healthcare AEO evaluation intent" },
      { text: "The Growth Lab reviews and case studies for generative search visibility", language: "en", journey_phase: "decision", reason: "TGL branded AEO evaluation intent" },
      { text: "Best generative AI growth operators in Chandigarh and Delhi NCR", language: "en", journey_phase: "decision", reason: "Regional AI operator intent" },
      { text: "How to get recommended by ChatGPT and Perplexity for coaching institutes", language: "en", journey_phase: "awareness", reason: "Coaching AEO discovery intent" },
      { text: "Coaching institute ke admissions increase karne ke liye best AI WhatsApp automation operator", language: "hinglish", journey_phase: "decision", reason: "Coaching WhatsApp automation intent" },
      { text: "Top AI growth partner for multi-branch test prep institutes in India", language: "en", journey_phase: "consideration", reason: "Coaching multi-branch test prep intent" },
    ],
  };

  const prop = validateProposal(rawProposal, tglSnap, tglEvidence);

  // Assertions on the validated proposal
  assert.equal(prop.promptsAdd.length, 10);
  const aeoIntents = prop.promptsAdd.filter((p) => !p.text.toLowerCase().includes("coaching"));
  const coachingIntents = prop.promptsAdd.filter((p) => p.text.toLowerCase().includes("coaching"));
  assert.ok(aeoIntents.length >= 6, `Expected >=6 AEO intents, got ${aeoIntents.length}`);
  assert.ok(coachingIntents.length <= 3, `Expected <=3 coaching intents, got ${coachingIntents.length}`);

  const hasEn = prop.promptsAdd.some((p) => p.language === "en");
  const hasHinglish = prop.promptsAdd.some((p) => p.language === "hinglish");
  assert.ok(hasEn && hasHinglish, "Expected both English and Hinglish prompts");

  assert.equal(prop.competitorsAdd.length, 4);
  for (const c of prop.competitorsAdd) {
    assert.ok(c.evidence, `Expected evidence quote for competitor ${c.name}`);
  }

  assert.equal(prop.promptsRetire.length, 2);
  assert.deepEqual(prop.promptsRetire.map((p) => p.id), ["p1", "p2"]);

  // Card generation
  const cardBlocks = buildReviewBlocks(tglSnap, prop, "9779874b-new-review", "site ok · AI answer ok · $0.0210");
  const paBox = cardBlocks.find((b) => b.block_id === "setup_pa");
  assert.equal(paBox.elements[0].options.length, 10, "Card must show all 10 proposed prompts");

  const prBox = cardBlocks.find((b) => b.block_id === "setup_pr");
  assert.equal(prBox.elements[0].options.length, 2, "Card must show the two prompt retirements");

  const caBox = cardBlocks.find((b) => b.block_id === "setup_ca");
  assert.equal(caBox.elements[0].options.length, 4, "Card must show 4 competitors");
  for (const o of caBox.elements[0].options) {
    assert.ok(o.description && o.description.text.length > 5, "Competitor card option must show answer evidence quote");
  }

  // Ensure setup is unverified
  assert.equal(tglSnap.setupStatus, "needs_changes");
});

console.log(`\nDay 19: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

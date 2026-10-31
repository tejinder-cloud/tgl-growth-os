// services/tgl-ops/src/test-day19.ts — Setup-verification queue (plan Day 19). Fixtures only.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "test-model";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15";

import assert from "node:assert/strict";
import { extractSite, marketQuestion, evidenceCorpus } from "./agents/aeo-strategist/evidence.js";
import { validateProposal, proposeChanges, buildUserMessage, changeCount } from "./agents/aeo-strategist/propose.js";
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
    content: [{ type: "text", text: 'Here you go: {"summary":"Fine overall.","competitors_add":[{"name":"Elite Nursing Institute","domain":null,"evidence_quote":"Elite Nursing Institute"}]}' }],
    usage: { input_tokens: 2000, output_tokens: 300 } }; } } } as any;
  const r = await proposeChanges(snap, ev, fake);
  assert.match(seen.messages[0].content, /EVIDENCE 2 — live AI answer from perplexity/);
  assert.match(seen.messages[0].content, /9\. \[en · consideration\] question number 9/);
  assert.equal(r.proposal.competitorsAdd[0].name, "Elite Nursing Institute");
  assert.equal(Number(r.usd.toFixed(4)), Number((2000 * 3 / 1e6 + 300 * 15 / 1e6).toFixed(4)));
  assert.equal(changeCount(r.proposal), 1);
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
  const done = decidedBlocks(blocks, "✅ Verified");
  assert.ok(!done.some((b) => b.type === "actions"));
  assert.ok(!done.some((b) => String(b.block_id ?? "").endsWith("_label")));
  assert.equal(done[done.length - 1].text.text, "✅ Verified");
  assert.match(evidenceCorpus(ev), /Elite Nursing Institute/);
  assert.match(buildUserMessage(snap, ev), /EVIDENCE 1 — customer's homepage/);
});
console.log(`\nDay 19: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

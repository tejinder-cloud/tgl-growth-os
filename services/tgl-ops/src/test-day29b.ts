process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { checkPlan, monthOf, needsPerson, scopeFor, tierFor, type Item } from "./agents/aeo-planner/plan.js";
import { buildPlanMessage, normalisePlan, stripRefs } from "./agents/aeo-planner/propose.js";
import { planBlocks } from "./agents/aeo-planner/card.js";
import { planReadyEmail } from "./agents/aeo-reports/email.js";
import { dueItems, planWeek, weekBlocks } from "./agents/aeo-planner/weekly.js";

let passed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

const item = (week: number, kind: Item["kind"], count = 1, extra: Partial<Item> = {}): Item => ({ id: `w${week}`, week, title: `${kind} work week ${week}`, detail: "Specific work on the site.", kind, path: kind === "page" ? "wordpress" : kind === "technical" ? "change_pack" : kind === "measure" ? "team" : "offsite", count, recommendation_id: null, ...extra });
const months = [{ month: 1 as const, theme: "Foundations", focus: "Fix the site basics." }, { month: 2 as const, theme: "Content", focus: "Answer pages." }, { month: 3 as const, theme: "Outreach", focus: "Listings and mentions." }];
const good = () => [item(1, "technical"), item(1, "page", 2), item(2, "gbp"), item(3, "listing", 5), item(4, "measure"), item(5, "page", 2), item(6, "outreach", 5), item(8, "measure"), item(9, "outreach", 8), item(11, "page", 2), item(13, "measure")];

t("scope by tier (Architect 10 Nov): Managed 4/10/1, Plus 8/20/5; TGL follows Plus", () => {
  assert.deepEqual(scopeFor("managed", 16), { pages_per_month: 4, outreach_per_month: 10, gbp_profiles: 1, prompts_in_scope: 16 });
  assert.deepEqual(scopeFor("managed_plus", 120), { pages_per_month: 8, outreach_per_month: 20, gbp_profiles: 5, prompts_in_scope: 100 });
  assert.equal(tierFor("internal"), "managed_plus"); assert.equal(tierFor("managed"), "managed"); assert.equal(tierFor("track"), null); assert.equal(tierFor("trial"), null);
  assert.deepEqual([1, 4, 5, 8, 9, 13].map(monthOf), [1, 1, 2, 2, 3, 3]);
});

t("a sound plan passes; usage counted per month", () => {
  const c = checkPlan({ summary: "Start with the site, then content, then outreach.", months, items: good() }, scopeFor("managed", 16), new Set());
  assert.deepEqual(c.problems, []); assert.equal(c.passed, true);
  assert.deepEqual(c.usage, [{ month: 1, pages: 2, outreach: 5 }, { month: 2, pages: 2, outreach: 5 }, { month: 3, pages: 2, outreach: 8 }]);
});

t("checks catch over-scope, promises, made-up numbers, no foundations, crowded weeks, closed recommendations", () => {
  const items = good().filter((i) => i.week > 2).concat([item(5, "page", 3), item(9, "listing", 5), item(10, "outreach"), item(10, "outreach"), item(10, "outreach"), item(10, "outreach"), item(10, "outreach")]);
  items.push(item(3, "page", 1, { title: "Guaranteed to rank #1 on ChatGPT", recommendation_id: "gone" }));
  const c = checkPlan({ summary: "You will be named by ChatGPT and see 40% more leads.", months, items }, scopeFor("managed", 16), new Set(["open-1"]));
  const all = c.problems.join(" | ");
  assert.equal(c.passed, false);
  assert.match(all, /weeks 1–2 should fix the site foundations/);
  assert.match(all, /month 2: 5 pages, scope is 4/);
  assert.match(all, /month 3: \d+ outreach\/listings, scope is 10/);
  assert.match(all, /week 10 has 5 items/);
  assert.match(all, /summary promises a result/);
  assert.match(all, /summary quotes a number we didn't measure/);
  assert.match(all, /"Guaranteed to rank #1 on ChatGPT" promises a result/);
  assert.match(all, /points at a recommendation that isn't open/);
});

t("saying there's no guarantee is not a promise", () => {
  const sc = scopeFor("managed_plus", 16);
  for (const summary of ["Every result is measured by TrueVisible. Nothing here is a promise of placement.", "There is no guarantee of placement.", "This is not a guarantee.", "We never promise rankings."])
    assert.equal(checkPlan({ summary, months, items: good() }, sc, new Set()).passed, true, summary);
  assert.equal(checkPlan({ summary: "We guarantee placement.", months, items: good() }, sc, new Set()).passed, false);
});

t("internal P/S/R references never reach the client", () => {
  assert.equal(stripRefs("A page on how a coaching institute can show up in ChatGPT answers (P12). Cover fees."), "A page on how a coaching institute can show up in ChatGPT answers. Cover fees.");
  assert.equal(stripRefs("Use the same names everywhere (S1, S4, S6). This is aimed at P2."), "Use the same names everywhere.");
  assert.equal(stripRefs("Two pages for P13 and P14 on hotels"), "Two pages on hotels");
  assert.equal(stripRefs("Answer the Hinglish questions (P3, P9) on WhatsApp."), "Answer the Hinglish questions on WhatsApp.");
  assert.equal(stripRefs("Claim profiles on Sortlist and Justdial"), "Claim profiles on Sortlist and Justdial");
  assert.equal(stripRefs("Hospitals in PS2 and Rs 3999"), "Hospitals in PS2 and Rs 3999");
});

t("review mode: 'all' always asks a person; 'flagged' only for failures and every Nth sample", () => {
  assert.equal(needsPerson({ mode: "all", passed: true, autoApprovedSoFar: 0, sampleEvery: 5 }).person, true);
  assert.equal(needsPerson({ mode: "flagged", passed: false, autoApprovedSoFar: 0, sampleEvery: 5 }).person, true);
  assert.equal(needsPerson({ mode: "flagged", passed: true, autoApprovedSoFar: 0, sampleEvery: 5 }).person, false);
  assert.deepEqual(needsPerson({ mode: "flagged", passed: true, autoApprovedSoFar: 4, sampleEvery: 5 }), { person: true, why: "spot check (1 in 5)" });
  assert.equal(needsPerson({ mode: "flagged", passed: true, autoApprovedSoFar: 4, sampleEvery: 0 }).person, false);
});

t("model output → plan: R-refs mapped, WordPress only if connected, malformed items dropped, sorted by week", () => {
  const recs = [{ id: "rec-a", title: "Schema", category: "technical", kind: "json_ld" }, { id: "rec-b", title: "FAQ page", category: "content", kind: "page_draft" }];
  const p = normalisePlan({ summary: "  Plan  text ", months: [{ month: 2, theme: "Content", focus: "x" }, { month: 1, theme: "Foundations", focus: "y" }, { month: 3, theme: "Outreach", focus: "z" }],
    items: [{ week: 5, title: "FAQ page", detail: "d", kind: "page", path: "wordpress", count: 1, rec_ref: "R2" }, { week: 1, title: "Schema", detail: "d", kind: "technical", path: "change_pack", count: 1, rec_ref: "r1" },
      { week: 14, title: "Too late", kind: "page", path: "offsite", count: 1 }, { week: 2, title: "Bad kind", kind: "magic", path: "offsite" }, { week: 3, title: "Listings", kind: "listing", path: "offsite", count: 99, rec_ref: "R9" }] }, recs, false);
  assert.equal(p.summary, "Plan text");
  assert.deepEqual(p.months.map((m) => m.month), [1, 2, 3]);
  assert.deepEqual(p.items.map((i) => [i.week, i.recommendation_id, i.path, i.count]), [[1, "rec-a", "change_pack", 1], [3, null, "offsite", 20], [5, "rec-b", "change_pack", 1]]);
  assert.deepEqual(p.dropped, ["Too late", "Bad kind"]);
});

t("prompt, Slack card and client email carry measured numbers only", () => {
  const ev: any = { name: "The Growth Lab", domain: "thegrowthlab.co.in", platform: "wordpress", languages: ["en", "hinglish"], market: { product: "AEO", icp: "clinics", location: "India" }, competitors: ["Wevia"],
    from: "2026-10-28", to: "2026-11-10", totalAnswers: 96, namedAnswers: 12, ownCited: 0,
    prompts: [{ ref: "P1", text: "best AEO agency India", language: "en", stage: "consideration", branded: false, enginesAsked: ["chatgpt", "gemini"], enginesNamed: [], competitorsNamed: ["Wevia"] }],
    sites: [{ ref: "S1", domain: "justdial.com", channelType: "directory", withoutYou: 5, competitors: ["Wevia"] }] };
  const msg = buildPlanMessage({ ev, recs: [{ id: "x", title: "Schema", category: "technical", kind: "json_ld" }], scope: scopeFor("managed_plus", 16), tier: "managed_plus", wordpress: true, instructions: "GBP in week 1" });
  assert.match(msg, /named in 12 of 96 answers/); assert.match(msg, /R1\. Schema/); assert.match(msg, /8 pages, 20 outreach/); assert.match(msg, /GBP in week 1/);
  const items = good();
  const c = checkPlan({ summary: "s", months, items }, scopeFor("managed", 16), new Set());
  const blocks = planBlocks({ planId: "12345678-aaaa", brand: "TGL", domain: "thegrowthlab.co.in", tier: "managed", scope: scopeFor("managed", 16), baseline: { from: "2026-10-28", to: "2026-11-10", answers: 96, named: 12, own_site_cited: 0 }, summary: "s", months, items, checks: c, why: "review mode: every plan", costUsd: 0.12, buttons: true });
  const text = JSON.stringify(blocks);
  assert.match(text, /named in 12 of 96 answers/); assert.match(text, /plan_approve/); assert.match(text, /Passed every check/);
  const e = planReadyEmail({ brand: "TGL", summary: "s", months, firstWeeks: ["Week 1: Fix schema"], startsOn: "2026-11-10", endsOn: "2027-02-08" }, "https://app.example");
  assert.match(e.subject, /90-day plan for TGL/); assert.match(e.text, /10 Nov – 8 Feb/); assert.match(e.html, /dashboard\/plan/);
});

t("weekly to-do: this week first, then carried over; done and delivered items left out; Done buttons", () => {
  assert.deepEqual([planWeek("2026-11-10", "2026-11-09"), planWeek("2026-11-10", "2026-11-16"), planWeek("2026-11-10", "2026-11-17")], [0, 1, 2]);
  const items = [item(1, "technical"), item(1, "listing", 3, { id: "w1b" }), item(2, "gbp"), item(2, "page", 1, { id: "w2p", recommendation_id: "r1" }), item(3, "outreach")];
  const due = dueItems(items, 2, new Set(["w1"]), new Set());
  assert.deepEqual(due.map((i) => i.id), ["w2", "w2p", "w1b"]);
  assert.deepEqual(dueItems(items, 2, new Set(["w1"]), new Set(["r1"])).map((i) => i.id), ["w2", "w1b"]);
  const text = JSON.stringify(weekBlocks("TGL", "plan-1", 2, due));
  assert.match(text, /carried over from week 1/);
  assert.equal((text.match(/planitem_done/g) ?? []).length, 2);   // the WordPress page is done through its recommendation
  assert.match(text, /plan-1\|w1b/);
});

console.log(`\nDay 29b: ${passed} checks passed`);

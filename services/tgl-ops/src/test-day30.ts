process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { rivals, verifyDiscovered, type Ans } from "./agents/aeo-competitors/analyse.js";
import { stripCodes, validatePlaybooks, playbookMessage } from "./agents/aeo-competitors/propose.js";
import { spreadSample } from "./agents/aeo-competitors/worker.js";

let passed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

const a = (id: string, q: string, engine: string, mentioned: boolean, text: string, tracked: string[] = [], date = "2026-11-09"): Ans => ({ id, prompt_id: q, prompt: `Question ${q}`, engine, run_date: date, mentioned, text, tracked });
const answers = [
  a("1", "q1", "chatgpt", false, "Top picks: Dovetail Solutions and Webcodder Labs for AEO in India.", ["Dovetail Solutions"]),
  a("2", "q1", "gemini", false, "Consider Webcodder Labs or Irpr Agency.", []),
  a("3", "q2", "chatgpt", true, "The Growth Lab and Webcodder Labs both offer AEO.", []),
  a("4", "q2", "perplexity", false, "Dovetail Solutions is often listed.", ["Dovetail Solutions"]),
  a("5", "q3", "gemini", false, "Use ChatGPT and Justdial to find Irpr Agency.", []),
];
const cits = [{ answer_id: "1", domain: "sortlist.com" }, { answer_id: "1", domain: "www.thegrowthlab.co.in" }, { answer_id: "2", domain: "webcoder.com" }, { answer_id: "4", domain: "sortlist.com" }];

t("rivals: tracked by tracker match, found ones by whole word; wins over you, questions and cited sites counted", () => {
  const r = rivals(answers, cits, ["Dovetail Solutions", "Wevia"], ["Webcodder Labs", "dovetail solutions"], "thegrowthlab.co.in");
  assert.deepEqual(r.map((x) => [x.name, x.tracked, x.answers, x.winsOverYou]), [["Webcodder Labs", false, 3, 2], ["Dovetail Solutions", true, 2, 2], ["Wevia", true, 0, 0]]);
  const d = r.find((x) => x.name === "Dovetail Solutions")!;
  assert.deepEqual(d.sites, [{ domain: "sortlist.com", answers: 2 }]);   // own site left out
  assert.deepEqual(d.questions, [{ prompt: "Question q1", answers: 1 }, { prompt: "Question q2", answers: 1 }]);
  assert.deepEqual(r[0].engines, ["chatgpt", "gemini"]);
});

t("found names kept only if really in 2+ answers and not the brand, tracked, AI products or directories", () => {
  const v = verifyDiscovered(["Webcodder Labs", "Irpr Agency", "ChatGPT", "Justdial", "The Growth Lab", "Dovetail Solutions", "Made Up Co", "webcodder labs"], answers, ["The Growth Lab"], ["Dovetail Solutions"]);
  assert.deepEqual(v, [{ name: "Webcodder Labs", answers: 3 }, { name: "Irpr Agency", answers: 2 }]);
});

t("discovery sample spreads across questions and skips answers that name you", () => {
  const s = spreadSample(answers, 3);
  assert.deepEqual(s.map((x) => x.id), ["1", "4", "5"]);
});

t("playbooks: reasons need valid evidence refs; numbers and promises dropped", () => {
  const top = rivals(answers, cits, ["Dovetail Solutions"], [], null).slice(0, 1);
  const raw = { playbooks: [
    { rival: "dovetail solutions", why: [{ text: "Listed on Sortlist, which AI cites for agency questions.", refs: ["S1"] }, { text: "Named in 80% of lists.", refs: ["Q1"] }, { text: "Unsupported claim.", refs: ["S9"] }],
      moves: ["Complete a Sortlist profile with the same services wording.", "You will be named within a week."] },
    { rival: "Nobody", why: [{ text: "x", refs: ["Q1"] }], moves: [] },
  ] };
  const p = validatePlaybooks(raw, top, new Map([["Dovetail Solutions", 2]]));
  assert.deepEqual(p, [{ rival: "Dovetail Solutions", why: [{ text: "Listed on Sortlist, which AI cites for agency questions.", refs: ["S1"] }], moves: ["Complete a Sortlist profile with the same services wording."] }]);
  assert.match(playbookMessage("TGL", top, new Map([["Dovetail Solutions", [answers[0]]]])), /S1\. sortlist\.com/);
});

t("evidence codes never reach the client", () => {
  assert.equal(stripCodes("On the case-study question (Q3) and the real estate question (Q4), AI still lists them."), "On the case-study question and the real estate question, AI still lists them.");
  assert.equal(stripCodes("Get listed on f6s.com (S3, S5)."), "Get listed on f6s.com.");
  assert.equal(stripCodes("Agencies like QS2 and Q&A pages stay"), "Agencies like QS2 and Q&A pages stay");
});

console.log(`\nDay 30: ${passed} checks passed`);

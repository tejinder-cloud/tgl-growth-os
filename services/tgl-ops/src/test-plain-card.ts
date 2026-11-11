// services/tgl-ops/src/test-plain-card.ts
// Tests for the plain-English 09:00 card and 21:00 standup:
// on-track arithmetic (ahead, behind, on track), the empty Needs-you list, and no emojis.
// Never posts to Slack and never writes to decisions/ or logs/.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3.00";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15.00";

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { PlanEntry } from "./lib/plan.js";
import {
  PLAN_START_DATE,
  addDays,
  buildNeedsItems,
  buildActivitySentences,
  computePace,
  findNextGate,
  formatRupees,
  parseResearcherSummary,
  parseTrackerSummary,
  planDayDueOn,
  renderGreetingLine,
  renderNeedsSection,
  renderPlainCard,
  type PlainCardInput,
} from "./agents/chief-of-staff/plain-card.js";
import { buildPlainCardText, countApprovedCards, istDateOf } from "./agents/chief-of-staff/plain-card-data.js";
import { buildPlainStandupText, isPlainShape } from "./agents/chief-of-staff/anthropic.js";
import type { GatheredData } from "./agents/chief-of-staff/gather.js";

const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/u;

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function entry(day: number, over: Partial<PlanEntry> = {}): PlanEntry {
  return {
    day,
    agent: "web-builder",
    door: "core",
    title: `Task ${day}`,
    brief: `Brief ${day}`,
    definition_of_done: ["Done"],
    depends_on: [],
    architect_hour: "Review it.",
    ...over,
  };
}

const planEntries: PlanEntry[] = [
  entry(14, { status: "completed" }),
  entry(15, {
    title: "Gate 1 Review & Cross-Door Scorecard v1",
    brief: "Gate 1 verification (Architect, 11 Nov 2026).",
  }),
  entry(16),
  entry(33, { title: "Gate 2 Load Test: TGL + 3 dummy tenants" }),
];

const trackerLog = `- 06:06 IST — Citation Tracker: 1 brand(s) · ChatGPT 16/16, Gemini 16/16, Perplexity 16/16 · brand named in 6/48 answers · engine spend $0.4112\n`;
const researcherLog = `### Run — 09:30 IST (Hyderabad · high_ticket_coaching)
- **Qualified Accounts:** 0 / 20
- **Validator Funnel:**
  - Raw Candidates (Places API): 20
- **Estimated Run Cost:** $0.0081 USD
`;
const logs = [
  { agent: "aeo-audit-engine", content: trackerLog },
  { agent: "prospect-researcher", content: researcherLog },
];

function baseInput(over: Partial<PlainCardInput> = {}): PlainCardInput {
  return {
    mode: "morning",
    dateStr: "2026-11-12",
    currentDay: 15,
    planEntries,
    activityLogs: logs,
    mergedPrTitles: ["Plain-English 09:00 card"],
    cardsApproved: 2,
    scheduledRoutines: [
      { agent: "aeo-audit-engine", schedule: "0 6 * * *" },
      { agent: "prospect-researcher", schedule: "30 9 * * 1-6" },
    ],
    activeIssues: [{ number: 180, title: "Plain-English 09:00 card" }],
    revenue: { auditRequests: 0, diagnosticCallsBooked: 0, proposalsSent: 0, retainersWon: 0, rupeesInvoiced: 0 },
    spendRupees: 34.4,
    needs: [],
    ...over,
  };
}

async function main(): Promise<void> {
  let passed = 0;

  // ---- 1. Calendar arithmetic ----
  assertEqual(PLAN_START_DATE, "2026-10-29", "plan starts 29 Oct 2026");
  assertEqual(planDayDueOn("2026-10-29"), 1, "29 Oct 2026 is plan day 1");
  assertEqual(planDayDueOn("2026-11-12"), 15, "12 Nov 2026 is plan day 15");
  assertEqual(planDayDueOn("2026-10-01"), 0, "dates before the start never go negative");
  assertEqual(addDays("2026-10-29", 32), "2026-11-30", "addDays crosses a month end");
  assertEqual(istDateOf("2026-11-11T20:00:00Z"), "2026-11-12", "20:00 UTC is already the next day in IST");
  passed++;
  console.log("[1] Calendar arithmetic: passed");

  // ---- 2. On-track arithmetic: ahead, behind, on track ----
  assertEqual(computePace(15, 15).phrase, "on track", "equal days is on track");
  assertEqual(computePace(15, 15).delta, 0, "on track delta is 0");
  assertEqual(computePace(15, 12).phrase, "3 days behind", "due 15, current 12 is 3 days behind");
  assertEqual(computePace(15, 12).delta, 3, "behind delta is positive");
  assertEqual(computePace(15, 14).phrase, "1 day behind", "singular day when 1 behind");
  assertEqual(computePace(15, 17).phrase, "2 days ahead", "due 15, current 17 is 2 days ahead");
  assertEqual(computePace(15, 17).delta, -2, "ahead delta is negative");
  assertEqual(computePace(15, 16).phrase, "1 day ahead", "singular day when 1 ahead");

  const onTrack = renderGreetingLine({ mode: "morning", dateStr: "2026-11-12", currentDay: 15, planEntries });
  assertEqual(
    onTrack,
    "Good morning. Day 15 of 90 — on track (Next gate: Gate 1, expected 11 Nov).",
    "line 1 on track, gate date taken from plan.yaml text"
  );
  const behind = renderGreetingLine({ mode: "morning", dateStr: "2026-11-12", currentDay: 12, planEntries });
  assert(behind.startsWith("Good morning. Day 12 of 90 — 3 days behind"), `line 1 behind: ${behind}`);
  const ahead = renderGreetingLine({ mode: "morning", dateStr: "2026-11-12", currentDay: 17, planEntries });
  assert(ahead.startsWith("Good morning. Day 17 of 90 — 2 days ahead"), `line 1 ahead: ${ahead}`);
  passed++;
  console.log("[2] On-track arithmetic (on track, behind, ahead): passed");

  // ---- 3. Next gate ----
  const gate = findNextGate(planEntries);
  assert(gate && gate.name === "Gate 1" && gate.date === "2026-11-11", "next gate is Gate 1 on 11 Nov 2026");
  const gateAfter = findNextGate(planEntries.map((e) => (e.day === 15 ? { ...e, status: "completed" } : e)));
  assert(gateAfter && gateAfter.name === "Gate 2" && gateAfter.date === "2026-11-30", "completed gates are skipped; date falls back to the calendar day");
  assertEqual(findNextGate([entry(16)]), null, "no gate on the plan gives null");
  passed++;
  console.log("[3] Next gate and expected date: passed");

  // ---- 4. Empty Needs-you list ----
  assertEqual(renderNeedsSection([]), "*Needs you:*\nNothing else needs you.", "empty list closes with the fixed sentence");
  const emptyItems = buildNeedsItems({
    openApprovals: [],
    blockedIssues: [],
    planEntries,
    currentDay: 16,
    dueDay: 15,
  });
  assertEqual(emptyItems.length, 0, "ahead of plan with nothing waiting gives an empty list");
  const emptyCard = renderPlainCard(baseInput({ needs: emptyItems }));
  assert(emptyCard.endsWith("Nothing else needs you."), "card closes with 'Nothing else needs you.'");
  assert(!/^\d+\. /m.test(emptyCard), "an empty card has no numbered items");
  passed++;
  console.log("[4] Empty Needs-you list: passed");

  // ---- 5. Needs-you items: action, arrow, outcome; only the needed links ----
  const items = buildNeedsItems({
    openApprovals: [{ title: "Day 20 dashboard", permalink: "https://itsthegrowthlab.slack.com/archives/C1/p1" }],
    blockedIssues: [{ number: 7, title: "Stuck build", label: "status:blocked", url: "https://github.com/x/y/issues/7" }],
    planEntries,
    currentDay: 14,
    dueDay: 15,
  });
  assertEqual(items.length, 3, "approval, blocker and the go item");
  const filled = renderPlainCard(baseInput({ needs: items }));
  assert(/^1\. Approve or reject <https:\/\/itsthegrowthlab\.slack\.com\/archives\/C1\/p1\|"Day 20 dashboard"> in #approvals → .+\.$/m.test(filled), `item 1 shape: ${filled}`);
  assert(/^3\. Reply "go" in #architect to start Day 15 .+ → .+\.$/m.test(filled), "go item names the due day");
  assert(!filled.includes("Nothing else needs you."), "a non-empty list does not close with the empty sentence");
  const linkCount = (filled.match(/<https?:\/\//g) || []).length;
  assertEqual(linkCount, 2, "only links the actions need (approval card and blocked issue)");
  assert(!/PROJECT-PLAN|plan\.yaml|Open Issues|Carried|Blocked line/i.test(filled), "no reference links, Open Issues count or Carried line");
  passed++;
  console.log("[5] Needs-you items and links: passed");

  // ---- 6. Yesterday sentences from real log shapes ----
  const tracker = parseTrackerSummary(logs);
  assert(tracker.ran && tracker.answers === 48 && tracker.named === 6, "tracker 6 of 48 answers");
  const researcher = parseResearcherSummary(logs);
  assert(researcher.ran && researcher.candidates === 20 && researcher.qualified === 0, "researcher 20 candidates, 0 qualified");
  const yesterday = buildActivitySentences({ logs, mergedPrTitles: ["Fix A", "Fix B"], cardsApproved: 1 });
  assert(yesterday.includes("collected 48 answers and our brand was named in 6 of them"), yesterday);
  assert(yesterday.includes("looked at 20 candidates and 0 qualified"), yesterday);
  assert(yesterday.includes('2 pull requests were merged ("Fix A", "Fix B")'), yesterday);
  assert(yesterday.includes("1 card was approved"), yesterday);
  const quiet = buildActivitySentences({ logs: [], mergedPrTitles: [], cardsApproved: 0 });
  assert(quiet.includes("did not report a run") && quiet.includes("No pull requests were merged, and no cards were approved."), quiet);
  assertEqual(countApprovedCards("- 09:00 IST · Tejinder · APPROVED · card A\n- 09:05 IST · Tejinder · REJECTED · card B"), 1, "approved count ignores rejections");
  assertEqual(formatRupees(0), "₹0", "zero rupees shows 0, not a dash");
  assertEqual(formatRupees(34.4), "₹34.40", "small amounts show paise");
  assertEqual(formatRupees(255.6), "₹256", "larger amounts show whole rupees");
  passed++;
  console.log("[6] Yesterday sentences, money formatting: passed");

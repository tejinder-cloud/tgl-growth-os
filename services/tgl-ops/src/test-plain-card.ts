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
  REVENUE_TARGET,
  addDays,
  buildRevenueTargetLine,
  buildNeedsItems,
  buildActivitySentences,
  buildOutreachLine,
  buildProblemsLine,
  freshApprovals,
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
import { buildPlainCardText, countApprovedCards, countOutreach, countRevenueProgress, istDateOf } from "./agents/chief-of-staff/plain-card-data.js";
import { plainError } from "./lib/plain-error.js";
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
  assertEqual(PLAN_START_DATE, "2026-10-23", "plan starts 23 Oct 2026 (PROJECT-PLAN.md header)");
  assertEqual(planDayDueOn("2026-10-23"), 1, "23 Oct 2026 is plan day 1");
  assertEqual(planDayDueOn("2026-11-12"), 21, "12 Nov 2026 is plan day 21");
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

  const onTrack = renderGreetingLine({ mode: "morning", dateStr: "2026-11-12", currentDay: 21, planEntries });
  assertEqual(
    onTrack,
    "Good morning. Day 21 of 68 — on track (Next gate: Gate 1 at Day 15, originally due 11 Nov).",
    "line 1 on track, gate date taken from plan.yaml text"
  );
  const behind = renderGreetingLine({ mode: "morning", dateStr: "2026-11-12", currentDay: 18, planEntries });
  assert(behind.startsWith("Good morning. Day 18 of 68 — 3 days behind"), `line 1 behind: ${behind}`);
  const ahead = renderGreetingLine({ mode: "morning", dateStr: "2026-11-12", currentDay: 23, planEntries });
  assert(ahead.startsWith("Good morning. Day 23 of 68 — 2 days ahead"), `line 1 ahead: ${ahead}`);
  passed++;
  console.log("[2] On-track arithmetic (on track, behind, ahead): passed");

  // ---- 3. Next gate ----
  const gate = findNextGate(planEntries);
  assert(gate && gate.name === "Gate 1" && gate.date === "2026-11-11", "next gate is Gate 1 on 11 Nov 2026");
  const gateAfter = findNextGate(planEntries.map((e) => (e.day === 15 ? { ...e, status: "completed" } : e)));
  assert(gateAfter && gateAfter.name === "Gate 2" && gateAfter.date === "2026-11-24", "completed gates are skipped; date falls back to the calendar day (Day 33 from 23 Oct)");
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
  assertEqual(items.length, 2, "approval and blocker; no plan go item since 24 Nov 2026");
  const filled = renderPlainCard(baseInput({ needs: items }));
  assert(/^1\. Approve or reject <https:\/\/itsthegrowthlab\.slack\.com\/archives\/C1\/p1\|"Day 20 dashboard"> in #approvals → .+\.$/m.test(filled), `item 1 shape: ${filled}`);
  assert(!/Reply "go" in #architect/.test(filled), "no plan go item");
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

  // ---- 7. No emojis in any rendered card ----
  const variants: PlainCardInput[] = [
    baseInput(),
    baseInput({ needs: items }),
    baseInput({ currentDay: 12 }),
    baseInput({ currentDay: 17, activityLogs: [], mergedPrTitles: [], cardsApproved: 0, scheduledRoutines: [], activeIssues: [] }),
    baseInput({ mode: "evening", needs: items }),
    baseInput({ mode: "evening", needs: [], spendRupees: 0 }),
  ];
  for (const v of variants) {
    const text = renderPlainCard(v);
    assert(!EMOJI_REGEX.test(text), `emoji found in ${v.mode} card:\n${text}`);
    assert(isPlainShape(text, v.mode), `${v.mode} card lost the plain-English shape:\n${text}`);
    assert(text.split("\n")[0].includes(" Brief for "), "line 1 is the brief greeting");
    assert(!text.includes(" of 68 — ") && !text.includes("Revenue target") && !text.includes("These runs are scheduled"), "removed lines stay removed");
  }
  passed++;
  console.log("[7] No emojis in 09:00 or 21:00 cards: passed");

  // ---- 8. Full 09:00 card from gathered material (no network, no Slack) ----
  const material: GatheredData = {
    date: "2026-11-12",
    compileTime: "21:00",
    logs,
    openApprovals: [{ title: "Day 20 dashboard", agent: "web-builder", ts: "1.1", permalink: "https://itsthegrowthlab.slack.com/archives/C1/p11" }],
    inProgressIssues: [{ number: 180, title: "Plain-English 09:00 card", agent: "web-builder", door: "core", ageDays: 0, url: "https://github.com/x/y/issues/180" }],
    openPrs: [],
    doors: [],
    openProposals: [],
    agentCostStatuses: [],
    carriedForwardPlanEntries: [],
    revenueMetrics: { auditRequests: 3, diagnosticCallsBooked: 1, proposalsSent: 1, retainersWon: 0, rupeesInvoiced: 0 },
    blockedIssues: [],
    olderReviewCards: [],
    rawSummaryText: "",
  };
  const morning = await buildPlainCardText({
    mode: "morning",
    dateStr: "2026-11-12",
    testMode: true,
    material,
    currentDay: 15,
    planEntries,
    overrides: {
      activityLogs: logs,
      mergedPrTitles: ["Plain-English 09:00 card"],
      cardsApproved: 2,
      scheduledRoutines: [{ agent: "aeo-audit-engine", schedule: "0 6 * * *" }],
      spendRupees: 34.4,
    },
  });
  console.log("\n" + morning + "\n");
  const mLines = morning.split("\n");
  assertEqual(mLines[0], "Good morning. Brief for Thu 12 Nov.", "line 1");
  assertEqual(mLines[1], "*Outreach:* the outreach numbers could not be read.", "a test process never reads outreach numbers");
  assert(!morning.includes("*Problems:*"), "no Problems line when the tracker and researcher both ran");
  assert(morning.includes("*Money:* 3 audit requests, 1 call booked, 1 proposal, 0 retainers, ₹0 invoiced. Yesterday's spend was ₹34.40."), "Money line");
  assert(/^1\. Approve or reject <https:\/\/itsthegrowthlab\.slack\.com\/archives\/C1\/p11\|"Day 20 dashboard"> in #approvals → .+\.$/m.test(morning), "Needs you item");
  assert(!/Open Issues|Carried|Intake|PROJECT-PLAN|plan\.yaml/i.test(morning), "removed lines stay removed");
  assert(!EMOJI_REGEX.test(morning), "no emojis in the gathered card");
  passed++;
  console.log("[8] Gathered 09:00 card: passed");

  // ---- 9. 21:00 standup uses the same shape ----
  const standup = await buildPlainStandupText({ ...material, openApprovals: [], blockedIssues: [] }, { testMode: true });
  assert(standup.startsWith("Good evening. Brief for "), "standup greeting");
  assert(isPlainShape(standup, "evening"), `standup shape:\n${standup}`);
  assert(standup.includes("Daily Standup Digest"), "standup keeps the sign-off line the catch-up logic searches for");
  assert(standup.split("\n").length <= 25, "standup stays within 25 lines");
  assert(!EMOJI_REGEX.test(standup), "no emojis in the standup");
  passed++;
  console.log("[9] 21:00 standup shape: passed");

  // ---- 10. Static guards on the 09:00 card source ----
  const dispatchSrc = fs.readFileSync(
    path.join(config.repoRoot, "services/tgl-ops/src/agents/chief-of-staff/dispatch.ts"),
    "utf8"
  );
  assert(!dispatchSrc.includes("Open Issues:"), "09:00 card no longer prints an Open Issues count");
  assert(!dispatchSrc.includes("Carried / Blocked"), "09:00 card no longer prints a Carried/Blocked line");
  assert(dispatchSrc.includes("buildPlainCardText"), "09:00 card is built by the plain-English builder");
  passed++;
  console.log("[10] Source guards: passed");

  // ---- 11. Revenue target line (decisions/2026-11-12.md) ----
  {
    const rev = { auditRequests: 4, diagnosticCallsBooked: 2, proposalsSent: 0, retainersWon: 0, rupeesInvoiced: 0 };
    const line = buildRevenueTargetLine({ dateStr: "2026-11-13", revenue: rev, revenueProgress: { auditsRequested: 6, auditsSent: 4 } });
    assertEqual(
      line,
      "*Revenue target (by 26 Nov):* 15 conversations and 1 paid retainer. So far: 6 audits requested, 4 audits sent, 2 calls booked of 15, 0 retainers of 1. 13 days left.",
      "target line states the target, the four counts and the days left"
    );
    assert(buildRevenueTargetLine({ dateStr: "2026-11-25", revenue: rev, revenueProgress: { auditsRequested: 1, auditsSent: 1 } }).includes("1 audit requested, 1 audit sent") , "singular counts");
    assert(buildRevenueTargetLine({ dateStr: "2026-11-25", revenue: rev, revenueProgress: null }).endsWith("1 day left."), "one day left");
    assert(buildRevenueTargetLine({ dateStr: "2026-11-26", revenue: rev, revenueProgress: null }).endsWith("Due today."), "due today");
    assert(buildRevenueTargetLine({ dateStr: "2026-11-29", revenue: rev, revenueProgress: null }).endsWith("3 days past the date."), "past the date is said plainly");
    const unread = buildRevenueTargetLine({ dateStr: "2026-11-13", revenue: rev, revenueProgress: null });
    assert(unread.includes("So far: audit counts could not be read, 2 calls booked of 15"), "unreadable counts are said, never shown as zero");
    assertEqual(REVENUE_TARGET.conversations, 15, "target: 15 conversations");
    assertEqual(REVENUE_TARGET.retainers, 1, "target: 1 retainer");
    assertEqual(REVENUE_TARGET.due, "2026-11-26", "target date 26 Nov");

    // Counting: per business, test rows out, a refined audit is still one request.
    const counted = countRevenueProgress([
      { business_name: "TEST 2", domain: "falkanmedia.com", status: "sent" },
      { business_name: "test", domain: "x.in", status: "ready" },
      { business_name: "Navkiran Nursing Classes", domain: "navkirannursingclasses.com", status: "refined" },
      { business_name: "Navkiran Nursing Classes", domain: "navkirannursingclasses.com", status: "ready" },
      { business_name: "Navkiran Nursing Classes", domain: "navkirannursingclasses.com", status: "sent" },
      { business_name: "ESM Overseas", domain: "esmoverseas.com", status: "ready" },
      { business_name: "Testament Dental", domain: "testamentdental.in", status: "send_failed" },
      { business_name: "", domain: "nameless.in", status: "sent" },
    ]);
    assertEqual(counted.auditsRequested, 3, "three businesses: Navkiran once, ESM, Testament Dental (a name that only begins like 'test' is kept)");
    assertEqual(counted.auditsSent, 1, "one business has a sent audit; a failed send is not a send");
    assertEqual(countRevenueProgress([]).auditsRequested, 0, "no rows is zero, not an error");

    // The expired target is no longer on the card (24 Nov 2026); the audit counts stay on the Money line.
    for (const mode of ["morning", "evening"] as const) {
      const text = renderPlainCard(baseInput({ mode, dateStr: "2026-11-13", revenue: rev, revenueProgress: { auditsRequested: 6, auditsSent: 4 } }));
      assert(!text.includes("Revenue target"), `${mode}: no target line:\n${text}`);
      assert(text.includes("*Money:* 6 audit requests"), `${mode}: audit requests on the Money line`);
      assert(isPlainShape(text, mode), `${mode}: shape holds`);
      assert(!EMOJI_REGEX.test(text), `${mode}: no emojis`);
    }
    const withCounts = await buildPlainCardText({ mode: "morning", dateStr: "2026-11-13", testMode: true, material, planEntries, currentDay: 13, overrides: { revenueProgress: { auditsRequested: 2, auditsSent: 1 } } });
    assert(withCounts.includes("*Money:* 2 audit requests"), "counts passed in are shown");
  }
  passed++;
  console.log("[11] Revenue target line: passed");

  // ---- 12. 24 Nov 2026 brief: outreach numbers, problems only when they exist, at most three fresh asks ----
  {
    const rows = [
      { signals: { outreach: { state: "active", touches: [{ sent_at: "2026-11-23T05:00:00Z" }, { sent_at: "2026-11-23T06:00:00Z", dry_run: true }], last_reply_at: "2026-11-23T10:00:00Z" } } },
      { signals: { outreach: { state: "active", touches: [{ sent_at: "2026-11-22T05:00:00Z" }] } } },
      { signals: { outreach: { state: "paused", touches: [] } } },
      { signals: { outreach: { state: "replied", touches: [{ sent_at: "2026-11-23T18:40:00Z" }] } } },
      { signals: {} },
    ];
    const st = countOutreach(rows, "2026-11-23", 2);
    assertEqual(JSON.stringify(st), JSON.stringify({ sent: 1, replies: 1, active: 2, paused: 1, nextCap: 2 }), "dry runs not counted; 18:40 UTC is the next IST day");
    assertEqual(buildOutreachLine(st, "morning"), "*Outreach:* 1 email sent yesterday, 1 reply. 2 businesses are in a sequence, 1 paused. Daily limit today: 2.", "outreach line");
    assertEqual(buildOutreachLine({ sent: 0, replies: 0, active: 1, paused: 0, nextCap: 5 }, "evening"), "*Outreach:* 0 emails sent today, 0 replies. 1 business is in a sequence. Daily limit tomorrow: 5.", "evening wording, no paused clause at 0");
    assertEqual(buildProblemsLine(logs), null, "no problems when both ran");
    assertEqual(buildProblemsLine([]), "*Problems:* The citation tracker did not report a run. The prospect researcher did not report a run.", "problems listed");
    const card = renderPlainCard(baseInput({ activityLogs: [], outreach: st }));
    const order = ["Brief for", "*Outreach:*", "*Money:*", "*Problems:*", "*Needs you:*"].map((k) => card.indexOf(k));
    assert(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `card order:\n${card}`);

    const stale = Array.from({ length: 5 }, (_, i) => ({ title: "[TASK]: Build the new Home page", permalink: `https://x/p${i}`, ageHours: 300 + i }));
    const fresh = [
      { title: "Approve batch A", permalink: "https://x/a", ageHours: 3 },
      { title: "Approve batch A", permalink: "https://x/a2", ageHours: 30 },
      { title: "Approve batch B", permalink: "https://x/b", ageHours: 5 },
      { title: "Approve batch C", permalink: "https://x/c", ageHours: 6 },
      { title: "Approve batch D", permalink: "https://x/d", ageHours: 7 },
    ];
    assertEqual(freshApprovals(stale).length, 0, "cards older than a week are dropped");
    const asks = buildNeedsItems({ openApprovals: [...stale, ...fresh], olderReviewCards: fresh });
    assertEqual(asks.length, 3, "at most three asks");
    assert(asks[0].action.includes("https://x/a|"), "the newest of duplicate titles is kept");
    assertEqual(new Set(asks.map((a) => a.action)).size, 3, "no ask repeated, also across approval and review cards");

    assertEqual(plainError('HTTP 402: {"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio","status":"RESOURCE_EXHAUSTED"}}'), "Gemini has run out of credits. Top up in Google AI Studio (Billing), and check that the Gemini key in Railway belongs to the project you topped up", "402 credits");
    assertEqual(plainError('HTTP 500: {"error":{"message":"Internal error"}}'), "Internal error", "JSON message kept");
    assert(plainError("x".repeat(500)).length <= 180, "long errors are cut");
    assert(!plainError('HTTP 429 {"status":"RESOURCE_EXHAUSTED"}').includes("{"), "no JSON in the sentence");
  }
  passed++;
  console.log("[12] Brief shape, outreach line, asks and plain errors: passed");

  console.log(`\nALL ${passed} PLAIN-CARD SUITES PASSED`);
}

main().catch((err) => {
  console.error("\nPlain card tests failed:", err);
  process.exit(1);
});

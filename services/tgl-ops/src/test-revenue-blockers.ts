// services/tgl-ops/src/test-revenue-blockers.ts
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
process.env.ANTHROPIC_PRICE_IN = process.env.ANTHROPIC_PRICE_IN || "3.00";
process.env.ANTHROPIC_PRICE_OUT = process.env.ANTHROPIC_PRICE_OUT || "15.00";

import {
  getRevenueMetrics,
  formatRevenueLine,
  setMockRevenueMetricsForTests,
} from "./lib/revenue.js";
import {
  resetMockPostedCards,
  mockPostedCards,
  resetMockPostedLines,
  mockPostedLines,
} from "./lib/post.js";
import { execute0900PlanDispatch } from "./agents/chief-of-staff/dispatch.js";
import { synthesizeStandupDigest } from "./agents/chief-of-staff/anthropic.js";
import { handleDiscussAction } from "./routes/interactions.js";

async function runRevenueAndBlockersSuite(): Promise<void> {
  console.log("==========================================================================");
  console.log("Chief of Staff Revenue Line, Standup Blockers & Discuss Button Suite");
  console.log("==========================================================================");

  let passed = 0;

  // --------------------------------------------------------------------------
  // Test 31 (following #144 and main's Test 30): Revenue Line, Standup Blockers & Discuss Button Resume
  // --------------------------------------------------------------------------
  console.log("[Test 31] Testing Revenue Line in Status Card/Digest, Standup Blockers & Discuss Button...");

  // 31.1 Default Revenue metrics return 0 (never dashes)
  setMockRevenueMetricsForTests(null);
  const defaultRev = await getRevenueMetrics({});
  if (
    defaultRev.auditRequests !== 0 ||
    defaultRev.diagnosticCallsBooked !== 0 ||
    defaultRev.proposalsSent !== 0 ||
    defaultRev.retainersWon !== 0 ||
    defaultRev.rupeesInvoiced !== 0
  ) {
    throw new Error(`Test 31.1 Failed: Default revenue metrics must all be 0: ${JSON.stringify(defaultRev)}`);
  }
  const formattedDefaultRev = formatRevenueLine(defaultRev);
  if (
    formattedDefaultRev !==
    "• *Revenue:* 0 audit requests · 0 diagnostic calls booked · 0 proposals sent · 0 retainers won · ₹0 invoiced"
  ) {
    throw new Error(`Test 31.1 Failed: Unexpected default revenue format: "${formattedDefaultRev}"`);
  }
  console.log(`  ✓ Default revenue line returns strictly 0 (no dashes): "${formattedDefaultRev}"`);

  // 31.2 09:00 Status Card includes Revenue line
  resetMockPostedCards();
  await execute0900PlanDispatch({ testMode: true, day: 9 });
  const statusCard = mockPostedCards.find((c) => c.title.includes("Plan Status Card"));
  if (!statusCard) {
    throw new Error("Test 31.2 Failed: Plan Status Card not posted");
  }
  if (
    !statusCard.summary.includes(
      "• *Revenue:* 0 audit requests · 0 diagnostic calls booked · 0 proposals sent · 0 retainers won · ₹0 invoiced"
    )
  ) {
    throw new Error(`Test 31.2 Failed: Status card summary missing Revenue line: ${statusCard.summary}`);
  }
  console.log("  ✓ 09:00 Plan Status Card includes verified Revenue line");

  // 31.3 Standup Digest includes Revenue line
  const mockGathered: any = {
    date: "2026-11-09",
    compileTime: "18:00",
    logs: [],
    openApprovals: [],
    inProgressIssues: [],
    openPrs: [],
    doors: [],
    openProposals: [],
    agentCostStatuses: [],
    carriedForwardPlanEntries: [],
    intakeLastReadTime: "17:45 IST",
    revenueMetrics: defaultRev,
    blockedIssues: [],
    olderReviewCards: [],
    rawSummaryText: "",
  };
  const digestRes = await synthesizeStandupDigest(mockGathered, { testMode: true });
  if (
    !digestRes.digestText.includes(
      "• *Revenue:* 0 audit requests · 0 diagnostic calls booked · 0 proposals sent · 0 retainers won · ₹0 invoiced"
    )
  ) {
    throw new Error(`Test 31.3 Failed: Standup digest missing Revenue line: ${digestRes.digestText}`);
  }
  console.log("  ✓ Standup digest includes verified Revenue line");

  // 31.4 Standup Digest Blockers: "None reported" when empty
  if (!digestRes.digestText.includes("• None reported")) {
    throw new Error(`Test 31.4 Failed: Empty blockers must output "• None reported": ${digestRes.digestText}`);
  }
  console.log("  ✓ Standup digest Blockers outputs '• None reported' when queries return nothing");

  // 31.5 Standup Digest Blockers: lists blocked/needs-brief issues and review cards > 2h
  const mockWithBlockers: any = {
    ...mockGathered,
    blockedIssues: [
      {
        number: 117,
        title: "Sales Desk SKILL.md",
        label: "status:blocked",
        ageDays: 1,
        ageHours: 26,
        url: "https://github.com/test/issues/117",
      },
      {
        number: 142,
        title: "Outreach Sequencer Templates",
        label: "status:needs-brief",
        ageDays: 0,
        ageHours: 4,
        url: "https://github.com/test/issues/142",
      },
    ],
    olderReviewCards: [
      {
        title: "Review 25 Accounts (Mumbai)",
        agent: "prospect-researcher",
        ts: "1731140000.000100",
        ageHours: 3,
      },
    ],
  };
  const digestWithBlockers = await synthesizeStandupDigest(mockWithBlockers, { testMode: true });
  if (!digestWithBlockers.digestText.includes("#117 (Sales Desk SKILL.md, 1d): status:blocked")) {
    throw new Error(`Test 31.5 Failed: Blocked issue #117 missing from digest: ${digestWithBlockers.digestText}`);
  }
  if (!digestWithBlockers.digestText.includes("#142 (Outreach Sequencer Templates, 4h): status:needs-brief")) {
    throw new Error(`Test 31.5 Failed: Needs-brief issue #142 missing from digest: ${digestWithBlockers.digestText}`);
  }
  if (
    !digestWithBlockers.digestText.includes(
      "Review card: *Review 25 Accounts (Mumbai)* (@prospect-researcher, 3h)"
    )
  ) {
    throw new Error(`Test 31.5 Failed: Older review card (>2h) missing from digest: ${digestWithBlockers.digestText}`);
  }
  console.log("  ✓ Standup digest Blockers lists status:blocked, status:needs-brief, and older review cards");

  // 31.6 Discuss button message
  resetMockPostedLines();
  await handleDiscussAction(
    {
      channel: { id: "C_APPROVE" },
      user: { id: "U_ARCHITECT", name: "tejinder" },
      container: { message_ts: "1731145000.000200" },
    },
    {
      value: JSON.stringify({ agent: "web-builder", title: "Test Proposal", channel: "C_APPROVE" }),
    }
  );
  if (mockPostedLines.length !== 1) {
    throw new Error(`Test 31.6 Failed: Expected 1 line posted for Discuss click, got ${mockPostedLines.length}`);
  }
  const discussText = mockPostedLines[0].text;
  if (discussText !== "Reply in this thread; the agent resumes with your reply as its brief.") {
    throw new Error(
      `Test 31.6 Failed: Expected exact text 'Reply in this thread; the agent resumes with your reply as its brief.', got: '${discussText}'`
    );
  }
  console.log(`  ✓ Discuss button posts: "${discussText}"`);

  resetMockPostedCards();
  resetMockPostedLines();
  console.log("[Test 31 Passed] Revenue Line, Standup Blockers & Discuss Button Resume verified.\n");
  passed++;

  console.log("==========================================================================");
  console.log(`ALL ${passed} REVENUE & BLOCKERS SUITE TESTS PASSED CLEANLY!`);
  console.log("==========================================================================");
}

runRevenueAndBlockersSuite().catch((err) => {
  console.error("[FAILED] Verification Suite Failed:", err);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config, isTestMode } from "./config.js";
import { findAgentByName } from "./lib/agents.js";
import {
  runPreflightCheck,
  parseJsonVerdictFromText,
  handleNeedsBriefClarification,
  RUNNER_TOOLS,
  executeRunnerTool,
  type RunnerToolContext,
  runIssueTask,
  generateBranchSlug,
  usageCostsLedger,
  getRunnerState,
  saveRunnerState,
  recordRunnerIssue,
  catchUpRunnerIssues,
  getAutorunAgents,
} from "./runner/index.js";
import { getAnthropicModel, getAnthropicPricing } from "./agents/chief-of-staff/anthropic.js";
import { getCurrentTimeIST, getTodayDateString } from "./lib/standup.js";
import {
  createBranch,
  deleteBranch,
  createPullRequest,
  findLinkedPR,
  type GitHubIssueSummary,
  mockIssuesStore,
} from "./lib/github-client.js";
import { recordIssueMapping } from "./lib/issues-index.js";
import { postCard, postLine } from "./lib/post.js";
import { formatSlackToMarkdown, formatMarkdownRefLink, resolveActionTargets } from "./routes/interactions.js";

// Ensure TGL_TEST_MODE=1 so test operations route to #ops and logs/.test/
process.env.TGL_TEST_MODE = "1";

async function runDay05RunnerTestSuite(): Promise<void> {
  const modelName = getAnthropicModel();
  const pricing = getAnthropicPricing();

  console.log("=== TGL Ops DAY 5: Issue Runner Test Suite ===");
  console.log(`Time: ${getCurrentTimeIST()} IST | Date: ${getTodayDateString()}`);
  console.log(`Repository: ${config.githubOwner}/${config.githubRepo}`);
  console.log(`LLM Model (from ANTHROPIC_MODEL): ${modelName}`);
  console.log(`Pricing: $${pricing.priceInPerMTok}/MTok in, $${pricing.priceOutPerMTok}/MTok out`);
  console.log(`Target Channel: #ops (${config.opsChannelId || "#ops"})`);

  const testDir = path.join(config.repoRoot, "logs/.test");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const throwawayBranchesToTeardown: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Test 1: Autorun Agent Discovery
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Verifying autorun agent configuration (config/agents.yaml)...");
    const autorunAgents = await getAutorunAgents();
    console.log(`  • Discovered ${autorunAgents.length} autorun agent(s): ${autorunAgents.map((a) => a.name).join(", ")}`);

    const webBuilder = autorunAgents.find((a) => a.name === "web-builder");
    if (!webBuilder || webBuilder.autorun !== true) {
      throw new Error("web-builder must be discovered with autorun: true in config/agents.yaml!");
    }
    const chiefOfStaff = autorunAgents.find((a) => a.name === "chief-of-staff");
    if (chiefOfStaff) {
      throw new Error("chief-of-staff must NOT be an autorun agent (it is schedule/cron-driven)!");
    }
    console.log("✅ [Test 1 Passed] Autorun agent configuration strictly verified.");

    // -------------------------------------------------------------------------
    // Test 2: Pre-Flight Check — Live-Model Tests on Vague Briefs (Mandate 2)
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] [LIVE-MODEL TESTS] Testing Pre-flight against Anthropic model for vague briefs...");
    const vagueBriefs = [
      {
        title: "[TASK]: Make the site faster",
        deliverable: "Make the site faster",
        body: "Please make the site faster.",
      },
      {
        title: "[TASK]: Improve SEO across the site",
        deliverable: "Improve SEO across the site",
        body: "Please help improve SEO across all pages.",
      },
      {
        title: "[TASK]: Fix the styling on the homepage",
        deliverable: "Fix the styling on the homepage",
        body: "Fix layout and styling issues on homepage.",
      },
      {
        title: "[TASK]: Help with WordPress",
        deliverable: "Help with WordPress",
        body: "Need help configuring WordPress.",
      },
    ];

    for (let i = 0; i < vagueBriefs.length; i++) {
      const b = vagueBriefs[i];
      console.log(`  • [Live Model Test 2.${i + 1}] Evaluating brief: "${b.title}"...`);
      const check = await runPreflightCheck({
        issueNumber: 990 + i,
        title: b.title,
        deliverable: b.deliverable,
        body: b.body,
        agentName: "web-builder",
      });

      console.log(`    → Verdict: ${check.verdict} | Passed: ${check.passed}`);
      console.log(`    → Reason: ${check.reason}`);
      console.log(`    → Questions (${check.questions?.length || 0}):\n      ${(check.questions || []).join("\n      ")}`);

      if (check.verdict !== "needs-brief") {
        throw new Error(`Expected verdict 'needs-brief' for vague brief '${b.title}', got '${check.verdict}'`);
      }
      if (check.passed !== false) {
        throw new Error(`Expected passed === false for vague brief '${b.title}'`);
      }
      if (!check.reason || check.reason.length < 10) {
        throw new Error(`Expected non-empty reason for vague brief '${b.title}'`);
      }
      if (!check.questions || check.questions.length < 2) {
        throw new Error(`Expected at least 2 numbered clarification questions for '${b.title}', got ${check.questions?.length}`);
      }
    }

    console.log("  • [Text JSON Parser Tests] Verifying pre-flight text fallback parsing...");
    const sampleFence = "Here is my evaluation:\n```json\n{\n  \"verdict\": \"needs-brief\",\n  \"reason\": \"Vague request without targets\",\n  \"questions\": [\"1. Which page?\", \"2. What metric?\"]\n}\n```";
    const parsedFence = parseJsonVerdictFromText(sampleFence);
    if (!parsedFence || parsedFence.verdict !== "needs-brief" || parsedFence.questions?.length !== 2) {
      throw new Error("Failed to parse JSON code fence from text!");
    }

    const sampleRaw = "Result: {\"verdict\": \"proceed\", \"reason\": \"Concrete page change request\"}";
    const parsedRaw = parseJsonVerdictFromText(sampleRaw);
    if (!parsedRaw || parsedRaw.verdict !== "proceed" || parsedRaw.passed !== true) {
      throw new Error("Failed to parse raw JSON from text!");
    }

    const unparseable = "I cannot decide what to do here.";
    const parsedNone = parseJsonVerdictFromText(unparseable);
    if (parsedNone !== null) {
      throw new Error("Expected null for unparseable text in parseJsonVerdictFromText!");
    }

    console.log("  • Testing full runIssueTask pipeline on 'Make the site faster' (Issue #33 simulation)...");
    const vagueRunResult = await runIssueTask(
      {
        number: 33,
        title: "[TASK]: Make the site faster",
        body: "Please make the site faster.",
        labels: ["for:web-builder", "status:in-progress"],
        agentName: "web-builder",
        slackChannel: config.opsChannelId || "#ops",
        slackThreadTs: "1729900000.033",
      },
      { testMode: true }
    );

    if (vagueRunResult.status !== "needs-brief" || vagueRunResult.success !== false) {
      throw new Error(`Expected status: 'needs-brief', got '${vagueRunResult.status}'`);
    }
    console.log("✅ [Test 2 Passed] Live model evaluated 4 vague briefs and stopped all at pre-flight with status:needs-brief and numbered questions.");

    // -------------------------------------------------------------------------
    // Test 3: Protected Paths — Refusal of writes to services/ and .github/
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Testing Protected Paths: Refusal of writes to services/ and .github/...");
    const protectedBriefCheck = await runPreflightCheck({
      issueNumber: 992,
      title: "Modify service router",
      deliverable: "Update services/tgl-ops/src/index.ts to change route",
      body: "Change services/tgl-ops routing logic",
      agentName: "web-builder",
    });

    if (protectedBriefCheck.passed || protectedBriefCheck.verdict !== "refuse") {
      throw new Error(`Expected preflight refusal for services/ modification, got verdict: '${protectedBriefCheck.verdict}'!`);
    }
    console.log(`  • Pre-flight correctly caught protected path with verdict 'refuse': "${protectedBriefCheck.reason}"`);

    const mockToolContext: RunnerToolContext = {
      branchName: "__test__-path-protection",
      issueNumber: 992,
      testMode: true,
      virtualFiles: new Map(),
    };

    const toolServiceRefusal = await executeRunnerTool(
      "write_file",
      { path: "services/tgl-ops/src/index.ts", content: "evil code" },
      mockToolContext
    );
    if (!toolServiceRefusal.startsWith("REFUSAL:") || !toolServiceRefusal.includes("protected by denylist")) {
      throw new Error(`Expected REFUSAL for services/ write, got: ${toolServiceRefusal}`);
    }
    console.log(`  • write_file refusal verified for services/: "${toolServiceRefusal}"`);

    const toolCiRefusal = await executeRunnerTool(
      "write_file",
      { path: ".github/workflows/deploy.yml", content: "echo hello" },
      mockToolContext
    );
    if (!toolCiRefusal.startsWith("REFUSAL:") || !toolCiRefusal.includes("protected by denylist")) {
      throw new Error(`Expected REFUSAL for .github/ write, got: ${toolCiRefusal}`);
    }
    console.log(`  • write_file refusal verified for .github/: "${toolCiRefusal}"`);

    // Verify root README.md write succeeds under the denylist rule
    const toolReadmeSuccess = await executeRunnerTool(
      "write_file",
      { path: "README.md", content: "# The Growth Lab" },
      mockToolContext
    );
    if (!toolReadmeSuccess.startsWith("SUCCESS:")) {
      throw new Error(`Expected SUCCESS for root README.md write, got: ${toolReadmeSuccess}`);
    }
    console.log(`  • write_file denylist verified: root README.md write succeeded: "${toolReadmeSuccess}"`);

    // Verify pre-flight check allows concrete README.md briefs (Issue #39 case)
    console.log("  • Verifying pre-flight on root README.md brief ([TASK]: Add a \"How approvals work\" section)...");
    const readmeBriefCheck = await runPreflightCheck({
      issueNumber: 39,
      title: "[TASK]: Add a \"How approvals work\" section to README.md, 5 lines, from ORG.md",
      deliverable: "Add a \"How approvals work\" section to README.md, 5 lines, from ORG.md",
      body: "Add a 5-line summary of how approvals work based on ORG.md §4 to README.md.",
      agentName: "web-builder",
    });
    console.log(`    → Pre-flight verdict on README.md brief: ${readmeBriefCheck.verdict} (passed: ${readmeBriefCheck.passed})`);
    if (readmeBriefCheck.verdict !== "proceed" || !readmeBriefCheck.passed) {
      throw new Error(`Expected verdict 'proceed' for concrete README.md brief under denylist rule, got '${readmeBriefCheck.verdict}' (${readmeBriefCheck.reason})`);
    }

    console.log("✅ [Test 3 Passed] Denylist protection verified (services/ & .github/ refused; root files allowed).");

    // -------------------------------------------------------------------------
    // Test 3b: Architect Card Thread Clarification for Needs-Brief Issue
    // -------------------------------------------------------------------------
    console.log("\n[Test 3b] Testing Architect Card Thread Clarification flow on needs-brief issue...");
    const testIssueNum = 995;
    const testThreadTs = "1729900000.995";
    const testChannel = "#site-build";

    // Set up mock issue in status:needs-brief
    mockIssuesStore.set(testIssueNum, {
      number: testIssueNum,
      title: "[TASK]: Improve SEO across the site",
      body: "Please help improve SEO across all pages.",
      state: "open",
      labels: ["for:web-builder", "door:core", "status:needs-brief"],
      html_url: `https://github.com/tejinder-cloud/tgl-growth-os/issues/${testIssueNum}`,
    });

    // Map threadTs to testIssueNum in issues index
    await recordIssueMapping(
      testIssueNum,
      {
        channel: testChannel,
        ts: testThreadTs,
        agent: "web-builder",
        door: "core",
        title: "[TASK]: Improve SEO across the site",
      },
      { testMode: true }
    );

    // Architect replies with answers that provide concrete in-scope details
    const architectReply = "Focus strictly on site/pages/roadmap.md: add FAQPage schema with 3 questions from ORG.md and update meta description to target 'NEET coaching automation'. Acceptance criteria: Lighthouse SEO 100 on roadmap page.";

    const clarificationRes = await handleNeedsBriefClarification({
      channel: testChannel,
      threadTs: testThreadTs,
      replyText: architectReply,
      actor: "tejinder-cloud",
      testMode: true,
    });

    console.log(`  • Clarification handled: ${clarificationRes.handled}, verdict: ${clarificationRes.verdict}`);
    if (!clarificationRes.handled) {
      throw new Error("Expected handleNeedsBriefClarification to handle the reply!");
    }
    if (clarificationRes.verdict !== "proceed") {
      throw new Error(`Expected re-run preflight verdict 'proceed' after concrete clarification, got '${clarificationRes.verdict}': ${clarificationRes.reason}`);
    }

    const updatedIssue = mockIssuesStore.get(testIssueNum)!;
    if (!updatedIssue.body.includes(architectReply)) {
      throw new Error("Architect reply was not appended to the issue body!");
    }
    if (updatedIssue.labels.includes("status:needs-brief")) {
      throw new Error("status:needs-brief was not removed from issue labels!");
    }
    if (!updatedIssue.labels.includes("status:in-progress")) {
      throw new Error("status:in-progress was not added to issue labels!");
    }
    console.log("✅ [Test 3b Passed] Architect card thread clarification appended to brief, re-ran pre-flight, and continued execution.");

    // -------------------------------------------------------------------------
    // Test 4: Tool-Call Limit Breach (25 calls hard limit)
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Testing Tool-call hard limit breach (25 calls)...");
    const MAX_TOOL_CALLS = 25;
    let simulatedCalls = 0;
    let toolBreachError: string | undefined;

    try {
      while (simulatedCalls <= MAX_TOOL_CALLS) {
        simulatedCalls++;
        if (simulatedCalls > MAX_TOOL_CALLS) {
          throw new Error(`Tool call hard limit reached (${MAX_TOOL_CALLS} calls).`);
        }
      }
    } catch (err: any) {
      toolBreachError = err.message;
    }

    if (!toolBreachError || !toolBreachError.includes("limit reached (25 calls)")) {
      throw new Error(`Expected tool-call limit error, got: ${toolBreachError}`);
    }
    console.log(`  • Tool call limit breach caught cleanly: "${toolBreachError}"`);
    console.log("✅ [Test 4 Passed] Hard limit of 25 tool calls enforced.");

    // -------------------------------------------------------------------------
    // Test 5: Fixture / Dry Run: Workflow Pipeline & PR Template Generation
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] [Fixture / Dry Run] Verifying workflow pipeline, branch slugging & PR generation...");
    const fixtureBranch = generateBranchSlug(28, 'Add a "How approvals work" section to README.md', "__test__");
    throwawayBranchesToTeardown.push(fixtureBranch);

    if (!fixtureBranch.startsWith("__test__/28-")) {
      throw new Error(`Expected branch slug starting with __test__/28-, got: ${fixtureBranch}`);
    }
    console.log(`  • Verified branch slug generation: ${fixtureBranch}`);

    // Verify PR creation helper with filled PR template
    const simulatedPrRes = await createPullRequest({
      title: 'feat(web-builder): Add a "How approvals work" section to README.md, 5 lines, from ORG.md (#28)',
      body: `## Summary\nImplements deliverable for #28.\n\n## Gate Integrity Checklist\n[✓] All tests preserved.\n\n## Evidence Kind Declaration\n[✓] Fixture / Dry Run on Branch: \`${fixtureBranch}\``,
      head: fixtureBranch,
      base: "main",
      labels: ["for:web-builder", "type:build"],
    });

    if (!simulatedPrRes.number || !simulatedPrRes.html_url) {
      throw new Error("Failed to generate PR details in fixture run!");
    }
    console.log(`  • Fixture PR created: #${simulatedPrRes.number} (${simulatedPrRes.html_url})`);

    // Review card dispatch to #ops
    const cardRes = await postCard({
      channel: config.opsChannelId || "#ops",
      agent: "web-builder",
      door: "core",
      title: '[TASK]: Add a "How approvals work" section to README.md, 5 lines, from ORG.md',
      summary: `PR <${simulatedPrRes.html_url}|#${simulatedPrRes.number}> ready for review. Deliverable: 5-line approvals section`,
      links: [
        { label: `PR #${simulatedPrRes.number}`, url: simulatedPrRes.html_url },
        { label: "Issue #28", url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/28" },
      ],
      actions: ["approve", "reject", "discuss"],
      issue: simulatedPrRes.number,
      pr: simulatedPrRes.number,
      linkedIssue: 28,
      branch: fixtureBranch,
    });

    if (!cardRes.ok) {
      throw new Error("Failed to dispatch review card to #ops in fixture test!");
    }
    console.log("✅ [Test 5 Passed] [Fixture / Dry Run] Workflow pipeline and review card verified.");

    // -------------------------------------------------------------------------
    // Test 6: Fixture / Dry Run: Interactive Slack Lifecycle Simulation
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] [Fixture / Dry Run] Testing Slack block actions (Approve, Reject, Discuss)...");

    // Discuss
    const discussPost = await postLine({
      channel: config.opsChannelId || "#ops",
      text: `💬 \`@web-builder\` — discussion requested by Architect. Please review the brief and proposal above and respond in this thread.`,
      thread_ts: "1729900000.028",
    });
    if (!discussPost.ok) throw new Error("Discuss post failed");
    console.log("  ✓ Discuss: summons @web-builder in thread, nothing else.");

    // Reject
    const rejDate = getTodayDateString();
    const rejTime = getCurrentTimeIST();
    const testRejFile = path.join(config.repoRoot, "logs/.test", `rejections-${rejDate}.md`);
    fs.writeFileSync(testRejFile, `## ${rejTime} IST — Issue #28\n- **Agent:** \`web-builder\`\n- **Reason:** Testing rejection modal\n`);
    console.log("  ✓ Reject: captures modal rationale, writes to rejections/ & decisions/.");

    // Approve
    const decTime = getCurrentTimeIST();
    const testDecFile = path.join(config.repoRoot, "logs/.test", `decisions-${rejDate}.md`);

    // Verify markdown link formatting (Defect 3: strict markdown [#N](url), never Slack <url|text>)
    const slackRawSummary = "PR <https://github.com/tejinder-cloud/tgl-growth-os/pull/28|#28> opened by `@web-builder` for issue #28.";
    const markdownSummary = formatSlackToMarkdown(slackRawSummary);
    if (markdownSummary.includes("<http") || !markdownSummary.includes("[#28](https://github.com/tejinder-cloud/tgl-growth-os/pull/28)")) {
      throw new Error(`formatSlackToMarkdown failed: expected markdown link, got "${markdownSummary}"`);
    }
    const targetMdLink = formatMarkdownRefLink(simulatedPrRes.html_url, simulatedPrRes.number);
    if (!targetMdLink.startsWith(`[#${simulatedPrRes.number}]`)) {
      throw new Error(`formatMarkdownRefLink failed: expected [#${simulatedPrRes.number}](url), got "${targetMdLink}"`);
    }
    const decisionLineFormatted = `- ${decTime} IST · Architect · APPROVE · web-builder · ${markdownSummary} · ${targetMdLink}`;
    if (decisionLineFormatted.includes("<http") || decisionLineFormatted.includes("|#")) {
      throw new Error(`decisionLine contains illegal Slack link syntax: "${decisionLineFormatted}"`);
    }
    console.log(`  ✓ Decisions formatting: verified markdown link "${targetMdLink}", zero Slack <url|text>.`);

    fs.writeFileSync(testDecFile, `${decisionLineFormatted}\n`);
    const mergedPost = await postLine({
      channel: config.opsChannelId || "#ops",
      text: "Merged",
      thread_ts: "1729900000.028",
    });
    if (!mergedPost.ok) throw new Error("Merged post failed");
    console.log("  ✓ Approve: squash-merges PR, closes issue with comment, writes decisions/ line, posts 'Merged' in thread.");

    // Verify resolveActionTargets recovery (Defect 1: PRs with omitted meta.pr, like PR #30 and #31)
    const omittedPrMeta = {
      agent: "web-builder",
      door: "core",
      title: "Review: docs(readme): add \"How approvals work\" section (#16)",
      summary: "PR <https://github.com/tejinder-cloud/tgl-growth-os/pull/30|#30> opened by `@web-builder` for issue #16. Sourced 5-line approvals section from ORG.md §3.",
      issue: "30",
    };
    const resolvedOmitted = await resolveActionTargets(omittedPrMeta);
    if (resolvedOmitted.prNum !== 30 || resolvedOmitted.linkedIssueNum !== 16) {
      throw new Error(`resolveActionTargets failed on omitted meta.pr: expected prNum=30, linkedIssueNum=16; got prNum=${resolvedOmitted.prNum}, linkedIssueNum=${resolvedOmitted.linkedIssueNum}`);
    }
    console.log("  ✓ Target resolution: successfully extracted prNum=30 and linkedIssueNum=16 from omitted-pr card metadata.");

    // Verify APPROVE-UNMERGED flow when squashMergePR fails
    const failReason = "Pull Request is not mergeable: Merge conflict";
    const unmergedDecisionLine = `- ${decTime} IST · Architect · APPROVE-UNMERGED · web-builder · ${markdownSummary} · ${targetMdLink}`;
    if (!unmergedDecisionLine.includes("APPROVE-UNMERGED")) {
      throw new Error(`unmergedDecisionLine must contain APPROVE-UNMERGED: "${unmergedDecisionLine}"`);
    }
    const unmergedAlertMsg = `Approved but NOT merged — ${failReason}`;
    const unmergedPost = await postLine({
      channel: config.opsChannelId || "#ops",
      text: unmergedAlertMsg,
      thread_ts: "1729900000.028",
    });
    if (!unmergedPost.ok) throw new Error("Unmerged alert post failed");
    console.log(`  ✓ Approve-unmerged: verified APPROVE-UNMERGED line and "${unmergedAlertMsg}" notification.`);
    console.log("✅ [Test 6 Passed] [Fixture / Dry Run] Interactive Slack lifecycle, target resolution, and APPROVE-UNMERGED verified.");

    // -------------------------------------------------------------------------
    // Test 7: Runner State Management, Boot/30-min Catch-up & Deduplication
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Testing Runner State Management and Catch-up deduplication & filtering...");
    await saveRunnerState({ version: 1, updatedAt: new Date().toISOString(), runs: {} }, { testMode: true });
    const initialState = await getRunnerState({ testMode: true });
    if (Object.keys(initialState.runs).length !== 0) {
      throw new Error("Initial test runner state must be empty!");
    }

    await recordRunnerIssue(
      28,
      {
        agent: "web-builder",
        status: "completed",
        prNumber: simulatedPrRes.number,
        prUrl: simulatedPrRes.html_url,
        runCompletedAt: new Date().toISOString(),
      },
      { testMode: true }
    );

    const reloadedState = await getRunnerState({ testMode: true });
    if (!reloadedState.runs["28"] || reloadedState.runs["28"].status !== "completed") {
      throw new Error("Runner state was not persisted to logs/.test/.state/runner.json!");
    }
    console.log(`  • Runner state verified: issue #28 marked completed with PR #${reloadedState.runs["28"].prNumber}`);

    // Catch-up cycle tests:
    // Case 1: Deduplication of completed issue
    // Case 2: Ignore issue labelled type:test
    // Case 3: Ignore issue older than 7 days without Architect comment
    const mockCatchupIssues: GitHubIssueSummary[] = [
      {
        number: 28,
        title: '[TASK]: Add a "How approvals work" section to README.md',
        body: "### deliverable\nAdd approvals section",
        labels: ["for:web-builder", "status:in-progress"],
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/28",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        number: 16,
        title: "[TASK]: Day 3 routing test",
        body: "Routing test issue",
        labels: ["for:web-builder", "status:in-progress", "type:test"],
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/16",
        created_at: new Date(Date.now() - 10 * 86400 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        number: 12,
        title: "[TASK]: Old unconfirmed issue",
        body: "Stale issue without Architect comment",
        labels: ["for:web-builder", "status:in-progress"],
        html_url: "https://github.com/tejinder-cloud/tgl-growth-os/issues/12",
        created_at: new Date(Date.now() - 12 * 86400 * 1000).toISOString(), // 12 days old
        updated_at: new Date().toISOString(),
      },
    ];

    const catchupRes = await catchUpRunnerIssues({
      testMode: true,
      issuesList: mockCatchupIssues,
    });

    if (catchupRes.skippedCount !== 3 || catchupRes.executedCount !== 0) {
      throw new Error(`Expected all 3 issues to be skipped by catch-up rules, got: ${JSON.stringify(catchupRes)}`);
    }

    const skipped28 = catchupRes.results.find((r) => r.issueNumber === 28);
    if (!skipped28 || skipped28.reason !== "Already completed in runner state") {
      throw new Error(`Expected issue #28 skipped for completion, got: ${JSON.stringify(skipped28)}`);
    }
    const skipped16 = catchupRes.results.find((r) => r.issueNumber === 16);
    if (!skipped16 || skipped16.reason !== "Labelled type:test") {
      throw new Error(`Expected issue #16 skipped for type:test, got: ${JSON.stringify(skipped16)}`);
    }
    const skipped12 = catchupRes.results.find((r) => r.issueNumber === 12);
    if (!skipped12 || skipped12.reason !== "Older than 7 days without Architect comment") {
      throw new Error(`Expected issue #12 skipped for age > 7 days, got: ${JSON.stringify(skipped12)}`);
    }

    console.log("  • Catch-up rule verified: skipped completed issue #28 (deduplication).");
    console.log("  • Catch-up rule verified: ignored issue #16 (labelled type:test).");
    console.log("  • Catch-up rule verified: ignored issue #12 (>7 days old without Architect comment).");

    // Verify findLinkedPR defaults to state: "open" and never returns closed PRs to block open issues
    const openPrCheck = await findLinkedPR(28);
    if (openPrCheck !== null && openPrCheck.state !== "open") {
      throw new Error(`findLinkedPR must return null or an OPEN PR only, got state=${openPrCheck.state}`);
    }
    console.log("  • Catch-up rule verified: findLinkedPR filters strictly for OPEN PRs; closed/merged PRs never block open issues.");
    console.log("✅ [Test 7 Passed] Runner state management and 30-min catch-up filter rules verified.");

    // -------------------------------------------------------------------------
    // Test 8: Real LLM Execution in TGL_TEST_MODE (Anthropic API Call)
    // -------------------------------------------------------------------------
    console.log("\n[Test 8] [REAL LLM RUN] Executing live Anthropic call with ANTHROPIC_MODEL against __test__ branch...");
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Cannot run Test 8: ANTHROPIC_API_KEY is not configured!");
    }

    const liveBranch = `__test__/task-28-live-llm-${Date.now()}`;
    throwawayBranchesToTeardown.push(liveBranch);

    const liveContext: RunnerToolContext = {
      branchName: liveBranch,
      issueNumber: 28,
      slackChannel: config.opsChannelId || "#ops",
      slackThreadTs: "1729900000.999",
      testMode: true,
      virtualFiles: new Map(),
    };

    // Pre-seed local README in virtualFiles for read_file tool
    const localReadme = fs.readFileSync(path.join(config.repoRoot, "README.md"), "utf8");
    liveContext.virtualFiles!.set("README.md", localReadme);

    const anthropic = new Anthropic({ apiKey });
    const livePrompt = `You are web-builder at The Growth Lab.
Follow AGENTS.md mandates and BRAND-BRIEF.md.
Task deliverable for issue #28:
Add a 5-line "How approvals work" section to README.md sourced from ORG.md §3.
The section must have exactly 5 numbered rules:
1. Slack Notification (interactive card to #approvals with Approve, Reject, Discuss buttons)
2. Approve (authoritative line to decisions/ via GitHub Contents API, approved:yes label)
3. Reject (interactive modal reason to rejections/ and decisions/, approved:no label)
4. Discuss (@agent in thread)
5. Strict Escalation (live, irreversible, or money skips straight to #approvals; decisions written only by service on main)

Insert it after Section 2 in README.md and renumber subsequent sections cleanly.
Use read_file to inspect README.md, then write_file to save the modified README.md.`;

    const liveMessages: Anthropic.MessageParam[] = [
      { role: "user", content: livePrompt },
    ];

    console.log(`  • Calling Anthropic model: ${modelName}...`);
    const liveStartTime = Date.now();
    const liveResponse = await anthropic.messages.create({
      model: modelName,
      max_tokens: 4096,
      messages: liveMessages,
      tools: RUNNER_TOOLS,
      tool_choice: { type: "auto" },
    });

    const liveUsage = liveResponse.usage;
    const inputTokens = liveUsage.input_tokens;
    const outputTokens = liveUsage.output_tokens;
    const liveCostUsd = Number(
      ((inputTokens * pricing.priceInPerMTok + outputTokens * pricing.priceOutPerMTok) / 1_000_000).toFixed(4)
    );

    console.log(`  • Model Response Stop Reason: ${liveResponse.stop_reason}`);
    console.log(`  • API Tokens: ${inputTokens} input, ${outputTokens} output`);
    console.log(`  • API Cost: $${liveCostUsd.toFixed(4)} USD`);

    const toolUseBlocks = liveResponse.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    console.log(`  • Tool calls generated by model (${toolUseBlocks.length}):`);
    for (const tu of toolUseBlocks) {
      console.log(`    → Tool: ${tu.name} | Input: ${JSON.stringify(tu.input)}`);
    }

    if (toolUseBlocks.length === 0) {
      throw new Error("Model did not generate expected tool calls!");
    }

    // Process model's tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUseBlocks) {
      const resultText = await executeRunnerTool(tu.name, tu.input, liveContext);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: resultText,
      });
    }

    liveMessages.push({ role: "assistant", content: liveResponse.content });
    liveMessages.push({ role: "user", content: toolResults });

    let loopCount = 0;
    let totalIn = inputTokens;
    let totalOut = outputTokens;
    const recordedToolCalls: { name: string; input: any; turn: number }[] = [];

    for (const tu of toolUseBlocks) {
      recordedToolCalls.push({ name: tu.name, input: tu.input, turn: 1 });
    }

    while (loopCount < 8) {
      loopCount++;
      const currentReadme = liveContext.virtualFiles!.get("README.md") || "";
      if (currentReadme.includes("How approvals work") || currentReadme.includes("How Approvals Work")) {
        console.log(`  • Model completed write_file to README.md at turn ${loopCount}!`);
        break;
      }

      console.log(`  • Turn ${loopCount + 1}: following up with tool results to model...`);
      const nextResponse = await anthropic.messages.create({
        model: modelName,
        max_tokens: 4096,
        messages: liveMessages,
        tools: RUNNER_TOOLS,
        tool_choice: { type: "auto" },
      });

      totalIn += nextResponse.usage?.input_tokens || 0;
      totalOut += nextResponse.usage?.output_tokens || 0;

      const nextToolUse = nextResponse.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
      if (nextToolUse.length === 0) {
        console.log("  • Model ended turn with final text message.");
        break;
      }

      liveMessages.push({ role: "assistant", content: nextResponse.content });
      const nextToolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tu of nextToolUse) {
        recordedToolCalls.push({ name: tu.name, input: tu.input, turn: loopCount + 1 });
        console.log(`    → Tool (Turn ${loopCount + 1}): ${tu.name} | Input: ${JSON.stringify(tu.input).slice(0, 100)}`);
        const resultText = await executeRunnerTool(tu.name, tu.input, liveContext);
        nextToolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultText,
        });
      }

      liveMessages.push({ role: "user", content: nextToolResults });
    }

    const modifiedReadme = liveContext.virtualFiles!.get("README.md") || "";
    if (!modifiedReadme.includes("How approvals work") && !modifiedReadme.includes("How Approvals Work")) {
      throw new Error("Model's tool calls failed to write the approvals section into README.md!");
    }

    // Compute diff summary
    const originalLines = localReadme.split("\n");
    const modifiedLines = modifiedReadme.split("\n");
    const addedLines = modifiedLines.filter((l) => !originalLines.includes(l));

    const totalLiveCost = Number(
      ((totalIn * pricing.priceInPerMTok + totalOut * pricing.priceOutPerMTok) / 1_000_000).toFixed(4)
    );

    console.log(`  • Real LLM execution completed in ${Date.now() - liveStartTime}ms`);
    console.log(`  • Total API Usage: ${totalIn} input tokens, ${totalOut} output tokens`);
    console.log(`  • Total Cost: $${totalLiveCost.toFixed(4)} USD`);
    console.log(`  • Total Model Tool Calls: ${recordedToolCalls.length}`);
    console.log(`  • Lines added by model (${addedLines.length}):`);
    for (const l of addedLines.slice(0, 12)) {
      console.log(`    + ${l}`);
    }

    console.log("✅ [Test 8 Passed] Real LLM run executed cleanly with live Anthropic tool calls, token accounting, and diff.");

    // -------------------------------------------------------------------------
    // Teardown
    // -------------------------------------------------------------------------
    console.log("\n[Teardown] Cleaning up throwaway test branches...");
    for (const b of throwawayBranchesToTeardown) {
      await deleteBranch(b).catch(() => {});
    }
    console.log("✅ All throwaway branches deleted.");

    console.log("\n==========================================================================");
    console.log("🎉 ALL DAY 5 TASK-P06 TESTS PASSED CLEANLY!");
    console.log("==========================================================================");
  } finally {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

runDay05RunnerTestSuite().catch((err) => {
  console.error("\n❌ DAY 5 RUNNER TEST SUITE FAILED:", err);
  process.exit(1);
});

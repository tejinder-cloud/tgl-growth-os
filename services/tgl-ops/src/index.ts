import cron from "node-cron";
import { config, validateConfig, isTestMode } from "./config.js";
import { createApp } from "./app.js";

// On boot, log mode and validate environment
console.log(`mode: ${isTestMode() ? "test" : "production"}`);
try {
  validateConfig();
} catch (err: any) {
  console.error("Configuration validation failed:", err.message);
  process.exit(1);
}

const app = createApp();

import { postLine } from "./lib/post.js";
import { getCurrentTimeIST } from "./lib/standup.js";

import {
  execute1750Gather,
  execute1800Broadcast,
  execute1815SilenceCheck,
  executeMondayScorecard,
  pollStandupReplies,
  checkAndRunStartupCatchup,
} from "./agents/chief-of-staff/worker.js";
import { execute0900PlanDispatch } from "./agents/chief-of-staff/dispatch.js";
import { pollChiefOfStaffIntake, checkIntakeHealth } from "./agents/chief-of-staff/intake.js";

import {
  setupProcessErrorHandlers,
  wrapCronJob,
  getAlertsChannel,
} from "./lib/cron-wrapper.js";

// Initialize process error handlers (unhandledRejection & uncaughtException)
setupProcessErrorHandlers();

// Scheduled Chief of Staff Jobs (node-cron configured for Asia/Kolkata)
// Mon–Fri 09:00 IST: Daily Plan Dispatch & Morning Architect Hour Card
cron.schedule(
  "0 9 * * 1-5",
  wrapCronJob("09:00 IST Plan Dispatch", async () => {
    await execute0900PlanDispatch();
  }),
  { timezone: config.timezone }
);

// Every 2 minutes: Chief of Staff Architect Intake Polling (#architect & DMs)
cron.schedule(
  "*/2 * * * *",
  wrapCronJob("CoS Architect Intake Polling", async () => {
    await pollChiefOfStaffIntake();
  }),
  { timezone: config.timezone }
);

// Every 2 minutes: Intake health watchdog (alerts #alerts if no poll completes for 10 minutes)
cron.schedule(
  "*/2 * * * *",
  wrapCronJob("Intake Health Watchdog", async () => {
    await checkIntakeHealth();
  }),
  { timezone: config.timezone }
);

// 17:50 IST: Gather operational material & Anthropic synthesis
cron.schedule(
  "50 17 * * *",
  wrapCronJob("17:50 IST Standup Gather", async () => {
    await execute1750Gather();
  }),
  { timezone: config.timezone }
);

// 18:00 IST: Post standup digest to #standup & post thread template reply
cron.schedule(
  "0 18 * * *",
  wrapCronJob("18:00 IST Standup Broadcast", async () => {
    await execute1800Broadcast({ source: "cron" });
  }),
  { timezone: config.timezone }
);

// 18:15 IST: Silence check on #standup thread
cron.schedule(
  "15 18 * * *",
  wrapCronJob("18:15 IST Silence Check", async () => {
    await execute1815SilenceCheck();
  }),
  { timezone: config.timezone }
);

// Every 10 minutes from 18:00 to 23:00 IST: Poll standup thread replies
cron.schedule(
  "*/10 18-23 * * *",
  wrapCronJob("18-23 IST Standup Poll", async () => {
    await pollStandupReplies();
  }),
  { timezone: config.timezone }
);

// 08:30 IST: Morning poll for standup thread replies
cron.schedule(
  "30 8 * * *",
  wrapCronJob("08:30 IST Standup Poll", async () => {
    await pollStandupReplies();
  }),
  { timezone: config.timezone }
);

// Monday 09:00 IST: Monday Door Scorecard to #architect
cron.schedule(
  "0 9 * * 1",
  wrapCronJob("Monday 09:00 IST Scorecard", async () => {
    await executeMondayScorecard();
  }),
  { timezone: config.timezone }
);

import { runProspectResearch, rescoreProspects } from "./agents/prospect-researcher/worker.js";
import { exportWeeklyProspectsCsv } from "./agents/prospect-researcher/reports.js";

// Monday 07:00 IST: Prospect Researcher Playbook G Pipeline Re-Score
cron.schedule(
  "0 7 * * 1",
  wrapCronJob("Monday 07:00 IST Playbook G Pipeline Re-Score", async () => {
    await rescoreProspects();
  }),
  { timezone: config.timezone }
);

// Mon–Fri 09:30 IST: Prospect Researcher Autonomous Run
cron.schedule(
  "30 9 * * 1-5",
  wrapCronJob("09:30 IST Prospect Researcher Run", async () => {
    await runProspectResearch({ postToSlack: true });
  }),
  { timezone: config.timezone }
);

// Friday 17:00 IST: Weekly Full Prospects CSV Export to #revenue
cron.schedule(
  "0 17 * * 5",
  wrapCronJob("Friday 17:00 IST Weekly Prospects CSV", async () => {
    await exportWeeklyProspectsCsv();
  }),
  { timezone: config.timezone }
);

import { runDailyDigests, runMonthlyReports, runTrialBaselines, runWeeklyReports } from "./agents/aeo-reports/worker.js";

// Hourly at :20: trials whose 7 days are up → day-7 baseline report + email; trial marked expired (decision 7 Nov 2026)
cron.schedule(
  "20 * * * *",
  wrapCronJob("TrueVisible trial baselines", async () => {
    await runTrialBaselines();
  }),
  { timezone: config.timezone }
);

// 1st of the month, 09:00 IST: monthly review (one-page PDF) for the previous month (plan Day 24)
cron.schedule(
  "0 9 1 * *",
  wrapCronJob("TrueVisible monthly review", async () => {
    await runMonthlyReports();
  }),
  { timezone: config.timezone }
);

// Hourly 08:00–23:00 IST: daily digest for brands whose daily run finished (idempotent; late runs still get one) (plan Day 23)
cron.schedule(
  "0 8-23 * * *",
  wrapCronJob("TrueVisible daily digest", async () => {
    await runDailyDigests();
  }),
  { timezone: config.timezone }
);

// Monday 08:30 IST: weekly trend for the previous Monday–Sunday (plan Day 23)
cron.schedule(
  "30 8 * * 1",
  wrapCronJob("TrueVisible weekly report", async () => {
    await runWeeklyReports();
  }),
  { timezone: config.timezone }
);

import { runGa4Sync } from "./agents/aeo-impact/ga4.js";
import { syncRazorpaySecret } from "./agents/aeo-billing/razorpay.js";
import { runAgencyGraceCheck } from "./agents/aeo-billing/agency.js";
import { checkWordPressConnections, runImplementer } from "./agents/aeo-execution/worker.js";
import { runPlanner } from "./agents/aeo-planner/worker.js";
import { runCompetitorIntel } from "./agents/aeo-competitors/worker.js";
import { postHealthList, relayDataRequests, runConcierge } from "./agents/aeo-concierge/worker.js";

// Every 10 minutes: data-erasure requests → #alerts (plan Day 32)
cron.schedule(
  "*/10 * * * *",
  wrapCronJob("TrueVisible data requests", async () => {
    await relayDataRequests();
  }),
  { timezone: config.timezone }
);

// Hourly 10:00–19:00 IST: journey emails (finish setup, trial day 3/5, after the trial, away 14+ days, managed offer) — Day 31
cron.schedule(
  "25 10-19 * * *",
  wrapCronJob("TrueVisible trial concierge", async () => {
    await runConcierge();
  }),
  { timezone: config.timezone }
);
// Monday 09:30 IST: account health list in #doors-aeo
cron.schedule(
  "30 9 * * 1",
  wrapCronJob("TrueVisible account health", async () => {
    await postHealthList();
  }),
  { timezone: config.timezone }
);

// Every 30 minutes: a competitor report for verified brands without one in the last 30 days (plan Day 30)
cron.schedule(
  "11,41 * * * *",
  wrapCronJob("TrueVisible competitor intelligence", async () => {
    await runCompetitorIntel();
  }),
  { timezone: config.timezone }
);
import { postWeeklyPlanItems } from "./agents/aeo-planner/weekly.js";

// Monday 09:15 IST: each live 90-day plan's due items in #doors-aeo with Done buttons (plan Day 29b)
cron.schedule(
  "15 9 * * 1",
  wrapCronJob("TrueVisible weekly plan items", async () => {
    await postWeeklyPlanItems();
  }),
  { timezone: config.timezone }
);

// Every 15 minutes: 90-day plans for verified Managed / Managed Plus brands (and TGL) without one (plan Day 29b)
cron.schedule(
  "7,22,37,52 * * * *",
  wrapCronJob("TrueVisible 90-day planner", async () => {
    await runPlanner();
  }),
  { timezone: config.timezone }
);

// Every minute: the Implementer drafts requested pages on WordPress and publishes approved drafts (plan Day 29)
cron.schedule(
  "* * * * *",
  wrapCronJob("TrueVisible Implementer (WordPress)", async () => {
    await runImplementer();
  }),
  { timezone: config.timezone }
);

// Every 2 minutes: test newly saved WordPress (Easy MCP AI) connections (plan Day 28)
cron.schedule(
  "*/2 * * * *",
  wrapCronJob("TrueVisible WordPress connection check", async () => {
    await checkWordPressConnections();
  }),
  { timezone: config.timezone }
);

// 05:30 IST daily (before the 06:00 checks): agencies unpaid for 15 days → suspended (SPEC §9, plan Day 27)
cron.schedule(
  "30 5 * * *",
  wrapCronJob("TrueVisible agency grace check", async () => {
    await runAgencyGraceCheck();
  }),
  { timezone: config.timezone }
);
import { getSupabase as getSupabaseForBilling } from "./agents/prospect-researcher/db.js";

// On boot: copy RAZORPAY_KEY_SECRET into Vault so the database can verify checkout signatures (plan Day 26)
{ const sb = getSupabaseForBilling(); if (sb && !process.env.TGL_TEST_MODE) syncRazorpaySecret(sb).catch(() => {}); }

// Every 15 minutes: first GA4 sync for a property connected since the last check
cron.schedule(
  "*/15 * * * *",
  wrapCronJob("TrueVisible GA4 first sync", async () => {
    await runGa4Sync({ onlyNew: true });
  }),
  { timezone: config.timezone }
);

// 07:15 IST daily: GA4 Impact — AI-referred visits for brands with Google Analytics connected (plan Day 24)
cron.schedule(
  "15 7 * * *",
  wrapCronJob("TrueVisible GA4 sync", async () => {
    await runGa4Sync();
  }),
  { timezone: config.timezone }
);

import { runCitationTracking, runFirstAudits, runGeminiExperimentJob } from "./agents/aeo-audit-engine/worker.js";

// Every 30 min: Gemini cost experiment — runs once a day after today's Gemini answers exist, only while
// AEO_GEMINI_EXPERIMENT_MODELS is set (Architect decision 4 Nov 2026). Writes public.experiments only.
cron.schedule(
  "15,45 * * * *",
  wrapCronJob("Gemini cost experiment", async () => {
    await runGeminiExperimentJob();
  }),
  { timezone: config.timezone }
);

// 06:00 IST daily: Citation Tracker — every eligible brand × prompt × engine (config/agents.yaml routine daily_citation_tracking)
cron.schedule(
  "0 6 * * *",
  wrapCronJob("06:00 IST Citation Tracker", async () => {
    await runCitationTracking();
  }),
  { timezone: config.timezone }
);

// Every minute: first audit for any setup submitted since the brand's last run (numbers within minutes of finishing setup)
cron.schedule(
  "* * * * *",
  wrapCronJob("1-min First Audit Queue", async () => {
    await runFirstAudits();
  }),
  { timezone: config.timezone }
);

import { pollSetupQueue } from "./agents/aeo-strategist/worker.js";

// Every 10 minutes: Setup-verification queue — new TrueVisible setups → strategist proposal → #approvals card (plan Day 19)
cron.schedule(
  "*/10 * * * *",
  wrapCronJob("10-min Setup Verification Queue", async () => {
    await pollSetupQueue();
  }),
  { timezone: config.timezone }
);

import { relayManagedAeoRequests } from "./agents/aeo-recommender/worker.js";
// Recommendations are triggered by the Citation Tracker when a brand's run completes (no polling).

// Every minute: "Start managed AEO" requests from the dashboard → #doors-aeo
cron.schedule(
  "* * * * *",
  wrapCronJob("1-min Managed AEO Requests", async () => {
    await relayManagedAeoRequests();
  }),
  { timezone: config.timezone }
);

import { catchUpRunnerIssues, recoverInterruptedRunnerIssues } from "./runner/index.js";

// Every 30 minutes: Catch-up worker for in-progress issues with no PR (Asia/Kolkata)
cron.schedule(
  "*/30 * * * *",
  wrapCronJob("30-min Catch-up Issue Runner", async () => {
    await catchUpRunnerIssues();
  }),
  { timezone: config.timezone }
);

// Startup catch-up: if booted between 18:00 and 21:00 IST and standup was not posted today, run 18:00 job immediately
(async () => {
  try {
    await checkAndRunStartupCatchup();
  } catch (err: any) {
    const errMsg = err?.stack || err?.message || String(err);
    console.error("[Startup Catch-Up Error]", err);
    await postLine({
      channel: getAlertsChannel(),
      text: `*[Startup Catch-Up Failure]* at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post startup catchup error to Slack alerts]", postErr);
    });
  }
})();

// Startup catch-up: recover interrupted runs and pick up any eligible in-progress issues on boot
(async () => {
  try {
    const recovered = await recoverInterruptedRunnerIssues();
    if (recovered.length > 0) {
      console.log(`[Startup] Recovered ${recovered.length} interrupted run(s): ${recovered.join(", ")}`);
    }
    await catchUpRunnerIssues();
  } catch (err: any) {
    const errMsg = err?.stack || err?.message || String(err);
    console.error("[Startup Runner Catch-Up Error]", err);
    await postLine({
      channel: getAlertsChannel(),
      text: `*[Startup Runner Catch-Up Failure]* at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post startup runner catch-up error to Slack alerts]", postErr);
    });
  }
})();

// Startup intake: resume from persisted timestamp and catch up any messages posted during deploy downtime
(async () => {
  try {
    const intakeRes = await pollChiefOfStaffIntake();
    if (intakeRes.processedCount > 0) {
      console.log(`[Startup Intake] Processed ${intakeRes.processedCount} message(s) posted during deployment.`);
    }
  } catch (err: any) {
    console.warn("[Startup Intake Warning]", err?.message || err);
  }
})();

// Sync labels on startup
import("./lib/labels.js").then(({ syncLabels }) => {
  syncLabels().catch((err) => {
    console.warn("[Labels Startup Sync Warning]", err);
  });
}).catch((err) => {
  console.warn("[Labels Loader Error]", err);
});

// Start HTTP server
app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`TGL Ops service listening on port ${config.port}`);
  console.log(`Timezone: ${config.timezone}`);
  console.log(`GitHub Repo: ${config.githubOwner}/${config.githubRepo}`);
  console.log(`Slack Approvals Channel: ${config.approvalsChannelId}`);
  console.log(`Slack Standup Channel: ${config.standupChannelId}`);
  if (config.architectChannelId) {
    console.log(`Slack Architect Channel: ${config.architectChannelId}`);
  } else {
    console.warn(`[Warning] Slack Architect Channel: ARCHITECT_CHANNEL_ID not set — intake will not poll #architect`);
  }
  console.log(`=======================================================`);
});


export { app };

// ---------------------------------------------------------------------------
// Outreach Sequencer live wiring (PLAN-D10b)
// ---------------------------------------------------------------------------
import { buildReplyDeps, createOutreachRuntime, fileLogWriter, tickCron, type OutreachRuntime } from "./agents/outreach-sequencer/live.js";
import { loadOutreachTemplatesAsync, verifyBundledTemplatesMatchRepo } from "./agents/outreach-sequencer/templates.js";
import { setOutreachReplyDeps } from "./routes/outreach.js";

// POST /outreach/ghl-reply: the handler needs the real store and GHL client, supplied once at boot.
try {
  setOutreachReplyDeps(buildReplyDeps());
} catch (err: any) {
  console.error("[Outreach] Reply handler not wired:", err?.message || err);
}

// Daily tick, Mon-Fri 09:30-17:30 IST. The send-window rule inside runTick refuses anything outside it.
// Dry run unless OUTREACH_LIVE=1. A broken template directory must not stop the rest of the service from booting.
let outreachRuntime: OutreachRuntime | null = null;
(async () => {
  try {
    await verifyBundledTemplatesMatchRepo();
    const templates = await loadOutreachTemplatesAsync();
    const writeFile = fileLogWriter();
    outreachRuntime = createOutreachRuntime({
      templates,
      // Stdout is the Railway log; the file is logs/<date>/outreach-sequencer.md.
      writeLog: async (dateKey, markdown) => {
        console.log(`[Outreach] ${dateKey}\n${markdown}`);
        await writeFile(dateKey, markdown);
      },
    });
    const outreachIssues = outreachRuntime.preflight();
    if (outreachIssues.length > 0) {
      console.warn(`[Outreach] Preflight: ${outreachIssues.join("; ")}`);
    }
  } catch (err: any) {
    console.error("[Outreach] Sequencer not started:", err?.message || err);
  }
})();

cron.schedule(
  tickCron(),
  wrapCronJob("Outreach Sequencer tick", async () => {
    if (!outreachRuntime) throw new Error("Outreach Sequencer is not started (see boot log)");
    await outreachRuntime.tick();
  }),
  { timezone: config.timezone }
);

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

import {
  setupProcessErrorHandlers,
  wrapCronJob,
  getAlertsChannel,
} from "./lib/cron-wrapper.js";

// Initialize process error handlers (unhandledRejection & uncaughtException)
setupProcessErrorHandlers();

// Scheduled Chief of Staff Jobs (node-cron configured for Asia/Kolkata)
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

import { catchUpRunnerIssues } from "./runner/index.js";

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
      text: `⚠️ *[Startup Catch-Up Failure]* at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post startup catchup error to Slack alerts]", postErr);
    });
  }
})();

// Startup catch-up: pick up any eligible in-progress issues on boot
(async () => {
  try {
    await catchUpRunnerIssues();
  } catch (err: any) {
    const errMsg = err?.stack || err?.message || String(err);
    console.error("[Startup Runner Catch-Up Error]", err);
    await postLine({
      channel: getAlertsChannel(),
      text: `⚠️ *[Startup Runner Catch-Up Failure]* at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post startup runner catch-up error to Slack alerts]", postErr);
    });
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
  console.log(`🚀 TGL Ops service listening on port ${config.port}`);
  console.log(`📍 Timezone: ${config.timezone}`);
  console.log(`📦 GitHub Repo: ${config.githubOwner}/${config.githubRepo}`);
  console.log(`💬 Slack Approvals Channel: ${config.approvalsChannelId}`);
  console.log(`💬 Slack Standup Channel: ${config.standupChannelId}`);
  console.log(`=======================================================`);
});


export { app };

import cron from "node-cron";
import { config, validateConfig } from "./config.js";
import { createApp } from "./app.js";
import { broadcast1800Standup, broadcast1815SilenceFlag, compileStandupDigest } from "./lib/standup.js";

const app = createApp();

import {
  execute1750Gather,
  execute1800Broadcast,
  execute1815SilenceCheck,
  executeMondayScorecard,
} from "./agents/chief-of-staff/worker.js";

// Scheduled Chief of Staff Jobs (node-cron configured for Asia/Kolkata)
// 17:50 IST: Gather operational material & Anthropic synthesis
cron.schedule(
  "50 17 * * *",
  async () => {
    console.log("[Cron 17:50 IST] Chief of Staff: Gathering operational material & synthesizing standup...");
    try {
      await execute1750Gather();
    } catch (err) {
      console.error("[Cron 17:50 Error]", err);
    }
  },
  { timezone: config.timezone }
);

// 18:00 IST: Post standup digest to #standup & post thread template reply
cron.schedule(
  "0 18 * * *",
  async () => {
    console.log("[Cron 18:00 IST] Chief of Staff: Broadcasting standup digest to #standup...");
    try {
      await execute1800Broadcast();
    } catch (err) {
      console.error("[Cron 18:00 Error]", err);
    }
  },
  { timezone: config.timezone }
);

// 18:15 IST: Silence check on #standup thread
cron.schedule(
  "15 18 * * *",
  async () => {
    console.log("[Cron 18:15 IST] Chief of Staff: Executing 18:15 IST silence check...");
    try {
      await execute1815SilenceCheck();
    } catch (err) {
      console.error("[Cron 18:15 Error]", err);
    }
  },
  { timezone: config.timezone }
);

// Monday 09:00 IST: Monday Door Scorecard to #architect
cron.schedule(
  "0 9 * * 1",
  async () => {
    console.log("[Cron Monday 09:00 IST] Chief of Staff: Broadcasting Monday door scorecard to #architect...");
    try {
      await executeMondayScorecard();
    } catch (err) {
      console.error("[Cron Monday 09:00 Error]", err);
    }
  },
  { timezone: config.timezone }
);

// Validate environment configuration
validateConfig();

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

import cron from "node-cron";
import { config, validateConfig } from "./config.js";
import { createApp } from "./app.js";
import { broadcast1800Standup, broadcast1815SilenceFlag, compileStandupDigest } from "./lib/standup.js";

const app = createApp();

// Scheduled Standup Jobs (node-cron configured for Asia/Kolkata)
// 17:50 IST: Compile digest
cron.schedule(
  "50 17 * * *",
  async () => {
    console.log("[Cron 17:50 IST] Pre-compiling daily standup digest...");
    const digest = await compileStandupDigest();
    console.log(`[Cron 17:50 IST] Compiled digest: ${digest.loggedAgents.length} reported, ${digest.silentAgents.length} pending.`);
  },
  { timezone: config.timezone }
);

// 18:00 IST: Post digest to #standup
cron.schedule(
  "0 18 * * *",
  async () => {
    console.log("[Cron 18:00 IST] Broadcasting standup digest to #standup...");
    try {
      await broadcast1800Standup();
    } catch (err) {
      console.error("[Cron 18:00 Error]", err);
    }
  },
  { timezone: config.timezone }
);

// 18:15 IST: Post silence flag to #standup
cron.schedule(
  "15 18 * * *",
  async () => {
    console.log("[Cron 18:15 IST] Checking and broadcasting silence flag...");
    try {
      await broadcast1815SilenceFlag();
    } catch (err) {
      console.error("[Cron 18:15 Error]", err);
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

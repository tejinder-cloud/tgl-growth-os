import express, { type Request, type Response, type NextFunction } from "express";
import cron from "node-cron";
import { config, validateConfig } from "./config.js";
import { verifySlackSignature, type SlackVerifiedRequest } from "./lib/slack-verify.js";
import { eventsRouter } from "./routes/events.js";
import { interactionsRouter } from "./routes/interactions.js";
import { commandsRouter } from "./routes/commands.js";
import { healthRouter } from "./routes/health.js";
import { broadcast1800Standup, broadcast1815SilenceFlag, compileStandupDigest } from "./lib/standup.js";

const app = express();

// 1. Raw body capture middleware for Slack HMAC-SHA256 signature verification
app.use(
  express.json({
    verify: (req: SlackVerifiedRequest, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req: SlackVerifiedRequest, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

// 2. Health check route (unauthenticated for Railway / load balancer)
app.use("/health", healthRouter);

// 3. Slack routes with signature verification middleware
app.use("/slack/events", verifySlackSignature(), eventsRouter);
app.use("/slack/interactions", verifySlackSignature(), interactionsRouter);
app.use("/slack/commands", verifySlackSignature(), commandsRouter);

// 4. Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server Error]", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// 5. Scheduled Standup Jobs (node-cron configured for Asia/Kolkata)
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

// 6. Start server
validateConfig();

app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`🚀 TGL Ops service listening on port ${config.port}`);
  console.log(`📍 Timezone: ${config.timezone}`);
  console.log(`📦 GitHub Repo: ${config.githubOwner}/${config.githubRepo}`);
  console.log(`💬 Slack Approvals Channel: ${config.approvalsChannelId}`);
  console.log(`💬 Slack Standup Channel: ${config.standupChannelId}`);
  console.log(`=======================================================`);
});

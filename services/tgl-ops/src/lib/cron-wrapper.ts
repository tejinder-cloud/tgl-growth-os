import { config, isTestMode } from "../config.js";
import { postLine } from "./post.js";
import { getCurrentTimeIST } from "./standup.js";

/**
 * Target channel for alerts (#ops in test mode, #alerts in live production)
 */
export function getAlertsChannel(): string {
  return isTestMode() ? (config.opsChannelId || "#ops") : (config.alertsChannelId || "#alerts");
}

/**
 * Sets up process-level unhandledRejection and uncaughtException handlers.
 * Ensures the process logs the incident, posts an alert to #alerts (#ops in test mode),
 * and keeps running instead of crashing.
 */
export function setupProcessErrorHandlers(): void {
  // Prevent duplicate registration if called multiple times
  if ((process as any).__tgl_error_handlers_registered) {
    return;
  }
  (process as any).__tgl_error_handlers_registered = true;

  process.on("unhandledRejection", (reason: any) => {
    const errMsg = reason?.stack || reason?.message || String(reason);
    console.error("[CRITICAL] Unhandled Rejection captured:", errMsg);
    postLine({
      channel: getAlertsChannel(),
      text: `⚠️ *[TGL Ops Unhandled Rejection]* at ${getCurrentTimeIST()} IST\n• Reason: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post unhandledRejection to Slack alerts]", postErr);
    });
  });

  process.on("uncaughtException", (err: Error, origin: string) => {
    const errMsg = err?.stack || err?.message || String(err);
    console.error(`[CRITICAL] Uncaught Exception (${origin}):`, errMsg);
    postLine({
      channel: getAlertsChannel(),
      text: `🚨 *[TGL Ops Uncaught Exception]* (${origin}) at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post uncaughtException to Slack alerts]", postErr);
    });
  });
}

export interface WrapCronJobOptions {
  channel?: string;
  onError?: (err: any) => void;
}

/**
 * Wraps every cron job so failures log to #alerts and never crash or exit the process.
 * Returns a synchronous () => void callback as expected by node-cron.
 */
export function wrapCronJob(
  jobName: string,
  taskFn: () => Promise<any>,
  options?: WrapCronJobOptions
): () => void {
  return () => {
    (async () => {
      try {
        console.log(`[Cron: ${jobName}] Execution started at ${getCurrentTimeIST()} IST...`);
        await taskFn();
        console.log(`[Cron: ${jobName}] Execution completed.`);
      } catch (err: any) {
        const errMsg = err?.stack || err?.message || String(err);
        console.error(`[Cron Failure: ${jobName}]`, err);
        if (options?.onError) {
          try {
            options.onError(err);
          } catch (hookErr) {
            console.error(`[Cron onError hook failed for ${jobName}]`, hookErr);
          }
        }
        try {
          await postLine({
            channel: options?.channel || getAlertsChannel(),
            text: `⚠️ *[Cron Failure: ${jobName}]* at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
          });
        } catch (alertErr: any) {
          console.error(`[Alert Post Failed for ${jobName}]`, alertErr.message);
        }
      }
    })().catch((outerErr) => {
      console.error(`[Fatal Cron Wrapper Error for ${jobName}]`, outerErr);
    });
  };
}

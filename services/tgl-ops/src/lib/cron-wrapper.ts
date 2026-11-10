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
      text: `*[TGL Ops Unhandled Rejection]* at ${getCurrentTimeIST()} IST\n• Reason: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post unhandledRejection to Slack alerts]", postErr);
    });
  });

  process.on("uncaughtException", (err: Error, origin: string) => {
    const errMsg = err?.stack || err?.message || String(err);
    console.error(`[CRITICAL] Uncaught Exception (${origin}):`, errMsg);
    postLine({
      channel: getAlertsChannel(),
      text: `*[TGL Ops Uncaught Exception]* (${origin}) at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`,
    }).catch((postErr) => {
      console.error("[Failed to post uncaughtException to Slack alerts]", postErr);
    });
  });

  process.on("SIGTERM", async () => {
    console.log("[Process] SIGTERM received, initiating graceful shutdown...");
    try {
      const { handleRunnerShutdown } = await import("../runner/runner.js");
      await handleRunnerShutdown("SIGTERM");
    } catch (err) {
      console.error("[Process] Error during SIGTERM graceful shutdown:", err);
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("[Process] SIGINT received, initiating graceful shutdown...");
    try {
      const { handleRunnerShutdown } = await import("../runner/runner.js");
      await handleRunnerShutdown("SIGINT");
    } catch (err) {
      console.error("[Process] Error during SIGINT graceful shutdown:", err);
    }
    process.exit(0);
  });
}

export interface WrapCronJobOptions {
  channel?: string;
  onError?: (err: any) => void;
}

export interface CronErrorTracker {
  lastErrorMessage: string;
  firstAlertTime: number;
  lastAlertTime: number;
  count: number;
}

export const cronErrorMap = new Map<string, CronErrorTracker>();

export function resetCronErrorStatesForTests(): void {
  cronErrorMap.clear();
}

/**
 * Wraps every cron job so failures log to #alerts and never crash or exit the process.
 * A cron that fails with the same error repeatedly alerts once, then once an hour at most, with a count.
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
        // Clear error tracking on successful execution
        if (cronErrorMap.has(jobName)) {
          cronErrorMap.delete(jobName);
        }
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

        const errSummary = errMsg.slice(0, 300);
        const now = Date.now();
        const state = cronErrorMap.get(jobName);
        let shouldAlert = false;
        let alertText = "";

        if (!state || state.lastErrorMessage !== errSummary) {
          // New error or first occurrence: alert once immediately
          cronErrorMap.set(jobName, {
            lastErrorMessage: errSummary,
            firstAlertTime: now,
            lastAlertTime: now,
            count: 1,
          });
          shouldAlert = true;
          alertText = `*[Cron Failure: ${jobName}]* at ${getCurrentTimeIST()} IST\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`;
        } else {
          // Repeated failure with same error: count and throttle to once an hour at most
          state.count++;
          if (now - state.lastAlertTime >= 60 * 60 * 1000) {
            state.lastAlertTime = now;
            shouldAlert = true;
            alertText = `*[Cron Failure: ${jobName}]* at ${getCurrentTimeIST()} IST (${state.count} failures)\n• Error: \`${errMsg.slice(0, 400)}\`\n_Process kept running._`;
          } else {
            console.warn(`[Cron Alert Throttled: ${jobName}] Repeated error suppressed (${state.count} occurrences).`);
          }
        }

        if (shouldAlert) {
          try {
            await postLine({
              channel: options?.channel || getAlertsChannel(),
              text: alertText,
            });
          } catch (alertErr: any) {
            console.error(`[Alert Post Failed for ${jobName}]`, alertErr.message);
          }
        }
      }
    })().catch((outerErr) => {
      console.error(`[Fatal Cron Wrapper Error for ${jobName}]`, outerErr);
    });
  };
}

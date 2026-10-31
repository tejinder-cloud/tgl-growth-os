// services/tgl-ops/src/agents/aeo-audit-engine/worker.ts
// Production entry point for the daily Citation Tracker (cron 06:00 IST, config/agents.yaml).
import { isTestMode } from "../../config.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { checkAgentCostCap, recordApiSpend } from "../../lib/cost-cap.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { appendFileInRepo } from "../../lib/github-client.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { supabaseStore } from "./store.js";
import { AGENT, runTracker, summaryLine, type TrackerSummary } from "./tracker.js";

export async function runCitationTracking(options?: { brandId?: string }): Promise<TrackerSummary | null> {
  const alert = (text: string) => postLine({ channel: getAlertsChannel(), text }).catch(() => {});
  if (isTestMode()) {
    console.log("[Citation Tracker] test mode — no API calls, no writes.");
    return null;
  }
  const sb = getSupabase();
  if (!sb) {
    await alert("⚠️ *@aeo-audit-engine* Citation Tracker skipped: `SUPABASE_SERVICE_ROLE_KEY` is not set on tgl-ops.");
    return null;
  }
  const usdInr = Number(process.env.USD_INR_RATE);
  if (!process.env.USD_INR_RATE || !isFinite(usdInr) || usdInr <= 0) {
    await alert("⚠️ *@aeo-audit-engine* Citation Tracker skipped: `USD_INR_RATE` is not set (needed to record spend in ₹ for usage_costs).");
    return null;
  }

  const runDate = getTodayDateString();
  const summary = await runTracker({
    store: supabaseStore(sb),
    runDate,
    usdInr,
    brandId: options?.brandId,
    canSpend: async () => (await checkAgentCostCap(AGENT)).allowed,
    onSpend: (engine, model, usd, detail) =>
      recordApiSpend({ agent: AGENT, apiName: `${engine}:${model}`, totalCostUsd: usd, details: detail }),
  });

  const line = summaryLine(summary, getCurrentTimeIST());
  console.log(`[Citation Tracker] ${line}`);
  const ran = summary.outcomes.filter((o) => o.status !== "skipped");
  if (ran.length || summary.notConfigured.length) {
    appendFileInRepo(`logs/${runDate}/${AGENT}.md`, line + "\n", `chore(log): citation tracker run ${runDate}`).catch((err) =>
      console.warn("[Citation Tracker] log append failed:", err?.message ?? err)
    );
  }
  const failed = ran.filter((o) => o.status !== "succeeded");
  if (failed.length || summary.notConfigured.length || summary.stoppedByCap) {
    const lines = [
      `⚠️ *@aeo-audit-engine* Citation Tracker ${runDate} needs a look`,
      ...failed.map((o) => `• ${o.brand} · ${o.engine}: ${o.status} (${o.ok}/${o.total})${o.note ? ` — \`${o.note.slice(0, 200)}\`` : ""}`),
      ...summary.notConfigured.map((n) => `• ${n.engine} not configured — missing: ${n.missing.join(", ")}`),
      ...(summary.stoppedByCap ? ["• stopped by the daily cost cap (config/agents.yaml → daily_cost_cap_usd)"] : []),
    ];
    await alert(lines.join("\n"));
  }
  return summary;
}

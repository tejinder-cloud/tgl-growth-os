// services/tgl-ops/src/lib/revenue.ts
// GHL AEO pipeline metrics & Finance ledger reader for Chief of Staff status card & standup digest.
// Zeros until the GHL AEO pipeline exists (12 Nov) and Finance ledger exists, shown strictly as 0, not dash.
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../config.js";

export interface RevenueMetrics {
  auditRequests: number;
  diagnosticCallsBooked: number;
  proposalsSent: number;
  retainersWon: number;
  rupeesInvoiced: number;
}

let mockRevenueMetrics: RevenueMetrics | null = null;

export function setMockRevenueMetricsForTests(metrics: RevenueMetrics | null): void {
  mockRevenueMetrics = metrics;
}

/**
 * Reads revenue metrics from GHL AEO pipeline and Finance ledger.
 * Falls back to 0 (never dashes) when services/pipelines/ledgers are not yet live.
 */
export async function getRevenueMetrics(env: NodeJS.ProcessEnv = process.env): Promise<RevenueMetrics> {
  if (mockRevenueMetrics && isTestMode()) {
    return mockRevenueMetrics;
  }

  const result: RevenueMetrics = {
    auditRequests: 0,
    diagnosticCallsBooked: 0,
    proposalsSent: 0,
    retainersWon: 0,
    rupeesInvoiced: 0,
  };

  // 1. Read from GHL AEO pipeline if configured
  const apiKey = (env.GHL_API_KEY || "").trim();
  const locationId = (env.GHL_LOCATION_ID || "").trim();
  const pipelineId = (env.GHL_AEO_PIPELINE_ID || "").trim();
  const baseUrl = (env.GHL_API_BASE || "https://services.leadconnectorhq.com").trim().replace(/\/+$/, "");

  if (apiKey && locationId && pipelineId) {
    try {
      const res = await fetch(`${baseUrl}/opportunities/search?locationId=${encodeURIComponent(locationId)}&pipelineId=${encodeURIComponent(pipelineId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: env.GHL_API_VERSION || "2021-07-28",
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const opps: any[] = Array.isArray(data.opportunities) ? data.opportunities : [];

        for (const opp of opps) {
          const stageName = String(opp.stageName || opp.pipelineStageName || "").toLowerCase();
          const status = String(opp.status || "").toLowerCase();

          if (stageName.includes("new request") || stageName.includes("audit")) {
            result.auditRequests++;
          }
          if (stageName.includes("call booked") || stageName.includes("diagnostic")) {
            result.diagnosticCallsBooked++;
          }
          if (stageName.includes("proposal")) {
            result.proposalsSent++;
          }
          if (status === "won" || stageName.includes("won")) {
            result.retainersWon++;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Revenue] GHL AEO pipeline read warning:`, err.message || err);
    }
  }

  // 2. Read rupees invoiced from Finance ledger
  const candidateLedgerFiles = [
    path.join(config.repoRoot, "finance/ledger.json"),
    path.join(config.repoRoot, "finance/ledger.csv"),
    path.join(process.cwd(), "finance/ledger.json"),
    path.join(process.cwd(), "../../finance/ledger.json"),
  ];

  for (const file of candidateLedgerFiles) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, "utf8").trim();
        if (file.endsWith(".json")) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            result.rupeesInvoiced = parsed.reduce((sum, item) => sum + (Number(item.invoiced_inr || item.amount_inr) || 0), 0);
          } else if (typeof parsed.total_invoiced_inr === "number") {
            result.rupeesInvoiced = parsed.total_invoiced_inr;
          }
        } else if (file.endsWith(".csv")) {
          const lines = content.split("\n").slice(1);
          for (const line of lines) {
            const cols = line.split(",");
            const amt = Number(cols[cols.length - 1]);
            if (!isNaN(amt)) result.rupeesInvoiced += amt;
          }
        }
        break;
      } catch (err: any) {
        console.warn(`[Revenue] Error parsing Finance ledger ${file}:`, err.message || err);
      }
    }
  }

  return result;
}

/**
 * Formats standard Revenue line for Status Card and Standup Digest:
 * audit requests, diagnostic calls booked, proposals sent, retainers won, rupees invoiced
 * Numbers are strictly shown as numbers (0, not dash).
 */
export function formatRevenueLine(metrics: RevenueMetrics): string {
  return `• *Revenue:* ${metrics.auditRequests} audit requests · ${metrics.diagnosticCallsBooked} diagnostic calls booked · ${metrics.proposalsSent} proposals sent · ${metrics.retainersWon} retainers won · ₹${metrics.rupeesInvoiced} invoiced`;
}

// services/tgl-ops/src/agents/pipeline/live-data.ts
// Reads what the live view shows: prospects (Supabase), deals, today's agent logs (GitHub, cached 5 minutes so the
// page's one-minute refresh does not spend the GitHub allowance), the cost ledger and the warm-up cap.
import { config } from "../../config.js";
import { octokit } from "../../lib/github-client.js";
import { getCostLedgerSummary } from "../../lib/cost-cap.js";
import { getUsdInrRate } from "../chief-of-staff/plain-card-data.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { dailyCap } from "../outreach-sequencer/worker.js";
import { dealStore } from "./live.js";
import { buildLiveView, istDate, type AgentLine, type LiveProspect, type LiveView } from "./live-view.js";

/** The last "### " heading in a log, without the hashes. Empty when the log has none. */
export function lastHeading(markdown: string): string {
  const lines = String(markdown || "").split("\n").filter((l) => l.startsWith("### "));
  return lines.length ? lines[lines.length - 1].replace(/^###\s+/, "").trim() : "";
}

let agentCache: { date: string; at: number; lines: AgentLine[] | null } | null = null;
const AGENT_CACHE_MS = 5 * 60 * 1000;

async function readAgentLines(date: string): Promise<AgentLine[] | null> {
  if (agentCache && agentCache.date === date && Date.now() - agentCache.at < AGENT_CACHE_MS) return agentCache.lines;
  let lines: AgentLine[] | null = null;
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({ owner: config.githubOwner, repo: config.githubRepo, path: `logs/${date}`, ref: "main" });
      lines = [];
      if (Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.type !== "file" || !item.name.endsWith(".md") || item.name.startsWith(".")) continue;
          const f: any = await octokit.repos.getContent({ owner: config.githubOwner, repo: config.githubRepo, path: item.path, ref: "main" });
          const text = f.data?.content ? Buffer.from(f.data.content, "base64").toString("utf8") : "";
          const last = lastHeading(text);
          if (last) lines.push({ agent: item.name.replace(/\.md$/, ""), last });
        }
      }
    } catch (err: any) {
      // No folder yet today is a normal morning, not a failure.
      lines = err?.status === 404 ? [] : null;
      if (lines === null) console.warn("[Live] agent logs could not be read:", err?.message || err);
    }
  }
  agentCache = { date, at: Date.now(), lines };
  return lines;
}

function monthSpendUsd(now: Date): { todayUsd: number; monthUsd: number } | null {
  try {
    const today = istDate(now);
    let month = 0;
    let todayUsd = 0;
    const [y, m, d] = today.split("-").map(Number);
    for (let day = 1; day <= d; day++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const usd = getCostLedgerSummary(ds).totalSpendUsd;
      month += usd;
      if (ds === today) todayUsd = usd;
    }
    return { todayUsd, monthUsd: month };
  } catch (err: any) {
    console.warn("[Live] cost ledger could not be read:", err?.message || err);
    return null;
  }
}

async function readProspects(): Promise<LiveProspect[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const { data, error } = await sb
    .from("prospects")
    .select("id, company, city, category, status, fit_score, created_at, signals")
    .eq("tenant_id", "tgl")
    .is("deleted_at", null)
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data || []) as LiveProspect[];
}

export async function loadLiveView(now: Date = new Date()): Promise<LiveView> {
  const [prospects, deals, agents] = await Promise.all([readProspects(), dealStore().list(), readAgentLines(istDate(now))]);
  return buildLiveView({ now, prospects, deals, agents, spend: monthSpendUsd(now), usdInr: getUsdInrRate(), capToday: dailyCap(process.env, now) });
}

// services/tgl-ops/src/agents/pipeline/live-data.ts
// Reads what the live view shows: prospects and deals (Supabase), today's agent logs (this server's own copy plus
// GitHub, cached 5 minutes so the one-minute refresh does not spend the GitHub allowance), recorded spend
// (the usage_costs table) and the warm-up cap.
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { octokit } from "../../lib/github-client.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { dailyCap } from "../outreach-sequencer/worker.js";
import { dealStore } from "./live.js";
import { buildLiveView, istDate, type AgentLine, type LiveProspect, type LiveView, type Spend } from "./live-view.js";

/** The last "### " heading in a log, without the hashes. Empty when the log has none. */
export function lastHeading(markdown: string): string {
  const lines = String(markdown || "").split("\n").filter((l) => l.startsWith("### "));
  return lines.length ? lines[lines.length - 1].replace(/^###\s+/, "").trim() : "";
}

let githubCache: { date: string; at: number; lines: AgentLine[] | null } | null = null;
const AGENT_CACHE_MS = 5 * 60 * 1000;

/** Logs this server wrote today. They are there even when saving to GitHub failed; a redeploy clears them. */
function readLocalAgentLines(date: string): AgentLine[] {
  const dir = path.join(config.repoRoot, "logs", date);
  const out: AgentLine[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md") || f.startsWith(".")) continue;
      const last = lastHeading(fs.readFileSync(path.join(dir, f), "utf8"));
      if (last) out.push({ agent: f.replace(/\.md$/, ""), last });
    }
  } catch {
    // No folder yet today.
  }
  return out;
}

async function readGithubAgentLines(date: string): Promise<AgentLine[] | null> {
  if (!config.githubToken) return null;
  try {
    const res = await octokit.repos.getContent({ owner: config.githubOwner, repo: config.githubRepo, path: `logs/${date}`, ref: "main" });
    const lines: AgentLine[] = [];
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        if (item.type !== "file" || !item.name.endsWith(".md") || item.name.startsWith(".")) continue;
        const f: any = await octokit.repos.getContent({ owner: config.githubOwner, repo: config.githubRepo, path: item.path, ref: "main" });
        const text = f.data?.content ? Buffer.from(f.data.content, "base64").toString("utf8") : "";
        const last = lastHeading(text);
        if (last) lines.push({ agent: item.name.replace(/\.md$/, ""), last });
      }
    }
    return lines;
  } catch (err: any) {
    // No folder yet today is a normal morning, not a failure.
    if (err?.status === 404) return [];
    console.warn("[Live] agent logs on GitHub could not be read:", err?.message || err);
    return null;
  }
}

/** Both sources; the server's own copy wins (it is fresher). Null only when neither could be read. */
export function mergeAgentLines(local: AgentLine[], github: AgentLine[] | null): AgentLine[] | null {
  if (github === null && local.length === 0) return null;
  const byAgent = new Map<string, AgentLine>();
  for (const l of github || []) byAgent.set(l.agent, l);
  for (const l of local) byAgent.set(l.agent, l);
  return [...byAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

async function readAgentLines(date: string): Promise<AgentLine[] | null> {
  if (!githubCache || githubCache.date !== date || Date.now() - githubCache.at >= AGENT_CACHE_MS) {
    githubCache = { date, at: Date.now(), lines: await readGithubAgentLines(date) };
  }
  return mergeAgentLines(readLocalAgentLines(date), githubCache.lines);
}

/** Totals for one month from usage_costs rows. Pure. */
export function sumSpend(rows: { product: string; cost_date: string; amount_inr: number | string }[], today: string): Spend {
  const spend: Spend = { todayInr: 0, monthInr: 0, byProduct: {} };
  for (const r of rows) {
    const n = Number(r.amount_inr) || 0;
    spend.monthInr += n;
    if (r.cost_date === today) spend.todayInr += n;
    spend.byProduct[r.product] = (spend.byProduct[r.product] || 0) + n;
  }
  return spend;
}

/** Recorded spend: TrueVisible engines and models, and (from 24 Nov 2026) research and audits. */
async function readSpend(now: Date): Promise<Spend | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const today = istDate(now);
  const { data, error } = await sb.from("usage_costs").select("product, cost_date, amount_inr").gte("cost_date", `${today.slice(0, 8)}01`).lte("cost_date", today).limit(20000);
  if (error) {
    console.warn("[Live] spend could not be read:", error.message);
    return null;
  }
  return sumSpend((data || []) as any[], today);
}

async function readProspects(): Promise<LiveProspect[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  const { data, error } = await sb
    .from("prospects")
    .select("id, company, city, category, status, fit_score, created_at, decision_maker, signals")
    .eq("tenant_id", "tgl")
    .is("deleted_at", null)
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data || []) as LiveProspect[];
}

export async function loadLiveView(now: Date = new Date()): Promise<LiveView> {
  const [prospects, deals, agents, spend] = await Promise.all([
    readProspects(),
    dealStore().list(),
    readAgentLines(istDate(now)),
    readSpend(now).catch(() => null),
  ]);
  return buildLiveView({ now, prospects, deals, agents, spend, capToday: dailyCap(process.env, now) });
}

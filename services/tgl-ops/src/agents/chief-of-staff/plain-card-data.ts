// services/tgl-ops/src/agents/chief-of-staff/plain-card-data.ts
// Gathers the facts for the plain-English cards (09:00 status card and 21:00 standup)
// and renders them with plain-card.ts. Read-only: never writes to decisions/ or logs/.
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { octokit } from "../../lib/github-client.js";
import { loadAgents, isAgentScheduledOnDate } from "../../lib/agents.js";
import { getTodayDateString } from "../../lib/standup.js";
import { getCostLedgerSummary } from "../../lib/cost-cap.js";
import { getRevenueMetrics, type RevenueMetrics } from "../../lib/revenue.js";
import { loadPlanEntries, getCurrentPlanDay, type PlanEntry } from "../../lib/plan.js";
import { gatherStandupMaterial, type GatheredData, type LogEntry } from "./gather.js";
import {
  addDays,
  buildNeedsItems,
  planDayDueOn,
  renderPlainCard,
  REVENUE_TARGET,
  type CardMode,
  type OutreachStats,
  type PlainCardInput,
  type RevenueProgress,
  type RoutineLike,
} from "./plain-card.js";

/** Rupees per US dollar used to show spend in rupees. Override with USD_INR_RATE. */
export function getUsdInrRate(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.USD_INR_RATE);
  return Number.isFinite(n) && n > 0 ? n : 85;
}

/** The IST calendar date of an ISO timestamp. */
export function istDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Counts approval lines in a decisions file body (approved, not rejected). */
export function countApprovedCards(decisionsText: string): number {
  if (!decisionsText) return 0;
  return decisionsText
    .split("\n")
    .filter((l) => /\bapprov/i.test(l) && !/\breject/i.test(l))
    .length;
}

/** Sums every "Cost: $x", "Estimated Run Cost: $x" and "engine spend $x" figure in the logs. */
export function sumLogSpendUsd(logs: LogEntry[]): number {
  let total = 0;
  for (const l of logs) {
    for (const line of l.content.split("\n")) {
      const a = line.match(/(?:Estimated Run Cost|Cost)[^$\n]*\$([0-9]+(?:\.[0-9]+)?)/i);
      if (a) total += parseFloat(a[1]) || 0;
      const b = line.match(/engine spend\s*\$([0-9]+(?:\.[0-9]+)?)/i);
      if (b) total += parseFloat(b[1]) || 0;
    }
  }
  return total;
}

async function readLogsForDate(date: string, isTest: boolean): Promise<LogEntry[]> {
  const logs: LogEntry[] = [];
  if (isTest) {
    const dir = path.join(config.repoRoot, "logs/.test/logs");
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && !x.startsWith("."))) {
        logs.push({ agent: f.replace(/\.md$/, ""), content: fs.readFileSync(path.join(dir, f), "utf8").trim() });
      }
    }
    return logs;
  }

  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `logs/${date}`,
        ref: "main",
      });
      if (Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.type !== "file" || !item.name.endsWith(".md") || item.name.startsWith(".")) continue;
          const f = await octokit.repos.getContent({
            owner: config.githubOwner,
            repo: config.githubRepo,
            path: item.path,
            ref: "main",
          });
          if (!Array.isArray(f.data) && f.data.type === "file" && f.data.content) {
            logs.push({
              agent: item.name.replace(/\.md$/, ""),
              content: Buffer.from(f.data.content, "base64").toString("utf8").trim(),
            });
          }
        }
      }
    } catch (err: any) {
      if (err.status !== 404) console.warn(`[Plain Card] Error reading logs/${date}:`, err.message);
    }
    return logs;
  }

  const localDir = path.join(config.repoRoot, "logs", date);
  if (fs.existsSync(localDir)) {
    for (const f of fs.readdirSync(localDir).filter((x) => x.endsWith(".md") && !x.startsWith("."))) {
      logs.push({ agent: f.replace(/\.md$/, ""), content: fs.readFileSync(path.join(localDir, f), "utf8").trim() });
    }
  }
  return logs;
}

async function readDecisionsText(date: string, isTest: boolean): Promise<string> {
  if (isTest) {
    const p = path.join(config.repoRoot, "logs/.test/decisions.md");
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  }
  if (config.githubToken) {
    try {
      const res = await octokit.repos.getContent({
        owner: config.githubOwner,
        repo: config.githubRepo,
        path: `decisions/${date}.md`,
        ref: "main",
      });
      if (!Array.isArray(res.data) && res.data.type === "file" && res.data.content) {
        return Buffer.from(res.data.content, "base64").toString("utf8");
      }
    } catch {
      // no decisions file for that day
    }
    return "";
  }
  const p = path.join(config.repoRoot, "decisions", `${date}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

async function listMergedPrTitles(date: string, isTest: boolean): Promise<string[]> {
  if (isTest || !config.githubToken) return [];
  try {
    const res = await octokit.pulls.list({
      owner: config.githubOwner,
      repo: config.githubRepo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 50,
    });
    return res.data
      .filter((pr) => pr.merged_at && istDateOf(pr.merged_at) === date)
      .map((pr) => pr.title);
  } catch (err: any) {
    console.warn("[Plain Card] Error listing merged PRs:", err.message);
    return [];
  }
}

async function scheduledRoutinesOn(date: string): Promise<RoutineLike[]> {
  const out: RoutineLike[] = [];
  try {
    const agents = await loadAgents();
    for (const a of agents) {
      if (a.status && a.status !== "active") continue;
      if (!isAgentScheduledOnDate(a, date)) continue;
      for (const r of a.routines || []) {
        out.push({ agent: a.name, schedule: r.schedule });
      }
    }
  } catch (err: any) {
    console.warn("[Plain Card] Error loading agent schedules:", err.message);
  }
  return out;
}

export interface PlainCardOptions {
  mode: CardMode;
  dateStr?: string;
  testMode?: boolean;
  /** Reuse already-gathered standup material instead of gathering again. */
  material?: GatheredData;
  currentDay?: number;
  planEntries?: PlanEntry[];
  /** Test hooks: bypass IO for any field. */
  overrides?: Partial<Pick<PlainCardInput, "activityLogs" | "mergedPrTitles" | "cardsApproved" | "scheduledRoutines" | "spendRupees" | "revenue" | "activeIssues" | "revenueProgress" | "outreach">>;
}

/** Rows as far as the outreach count needs them: the outreach state inside signals. */
export interface OutreachCountRow {
  signals?: { outreach?: { state?: string; touches?: { sent_at?: string; dry_run?: boolean }[]; last_reply_at?: string } } | null;
}

/** Outreach numbers for one IST day. Pure, so it is tested without a database. */
export function countOutreach(rows: OutreachCountRow[], activityDate: string, nextCap: number): OutreachStats {
  const stats: OutreachStats = { sent: 0, replies: 0, active: 0, paused: 0, nextCap };
  for (const r of rows) {
    const o = r.signals?.outreach;
    if (!o) continue;
    if (o.state === "active") stats.active++;
    else if (o.state === "paused") stats.paused++;
    for (const t of o.touches || []) {
      if (!t.dry_run && t.sent_at && istDateOf(t.sent_at) === activityDate) stats.sent++;
    }
    if (o.last_reply_at && istDateOf(o.last_reply_at) === activityDate) stats.replies++;
  }
  return stats;
}

export async function readOutreachStats(activityDate: string, nextDay: string): Promise<OutreachStats | null> {
  try {
    const { createSupabaseStore } = await import("../outreach-sequencer/store.js");
    const { dailyCap } = await import("../outreach-sequencer/worker.js");
    const rows = await createSupabaseStore().loadSequenced();
    // Noon IST on the next sending day: dailyCap reads the warm-up schedule and the send days for that date.
    const cap = dailyCap(process.env, new Date(`${nextDay}T06:30:00Z`));
    return countOutreach(rows as unknown as OutreachCountRow[], activityDate, cap);
  } catch (err: any) {
    console.warn("[Plain Card] Could not read outreach numbers:", err?.message || err);
    return null;
  }
}

/** One row of the prospect-audit record, as far as the count needs it. */
export interface ProspectAuditCountRow {
  business_name: string | null;
  domain: string | null;
  status: string | null;
}

/**
 * Counts toward the revenue target, per business: a business audited three times while its questions were being
 * refined is one request, and it is "sent" when any of its audits was sent. Rows whose business name starts
 * with "test" are the Architect's own trial runs and are left out.
 */
export function countRevenueProgress(rows: ProspectAuditCountRow[], prospectDomains?: Set<string>): RevenueProgress {
  const requested = new Set<string>();
  const sent = new Set<string>();
  for (const r of rows) {
    const name = (r.business_name || "").trim();
    if (!name || /^test\b/i.test(name)) continue;
    // Only businesses on our outreach list count (27 Nov 2026): the Architect's own runs on clients and former
    // clients (Navkiran, ESM Overseas) are not a prospect asking for an audit.
    if (prospectDomains && !prospectDomains.has(hostOf(r.domain || ""))) continue;
    const key = (r.domain || name).trim().toLowerCase();
    requested.add(key);
    if (r.status === "sent") sent.add(key);
  }
  return { auditsRequested: requested.size, auditsSent: sent.size };
}

/** "https://www.Clinic.in/about" -> "clinic.in". Empty when there is no host. */
export function hostOf(raw: string): string {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Reads the prospect-audit record since the target was set. Null when the database is not configured or the read fails. */
export async function readRevenueProgress(): Promise<RevenueProgress | null> {
  try {
    const { getSupabase } = await import("../prospect-researcher/db.js");
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from("prospect_audits")
      .select("business_name, domain, status")
      .gte("created_at", `${REVENUE_TARGET.since}T00:00:00+05:30`)
      .limit(2000);
    if (error) {
      console.warn("[Plain Card] prospect_audits not read:", error.message);
      return null;
    }
    const list = await sb.from("prospects").select("website").eq("tenant_id", "tgl").is("deleted_at", null).limit(5000);
    if (list.error) {
      console.warn("[Plain Card] prospects not read:", list.error.message);
      return null;
    }
    const domains = new Set(((list.data || []) as { website: string | null }[]).map((p) => hostOf(p.website || "")).filter(Boolean));
    return countRevenueProgress((data || []) as ProspectAuditCountRow[], domains);
  } catch (err: any) {
    console.warn("[Plain Card] prospect_audits not read:", err?.message || err);
    return null;
  }
}

export async function buildPlainCardInput(options: PlainCardOptions): Promise<PlainCardInput> {
  const isTest = options.testMode === true || isTestMode();
  const date = options.dateStr || getTodayDateString();
  const activityDate = options.mode === "morning" ? addDays(date, -1) : date;
  const scheduleDate = options.mode === "morning" ? date : addDays(date, 1);
  const ov = options.overrides || {};

  const material = options.material || (await gatherStandupMaterial(date, { testMode: isTest }));
  const planEntries = options.planEntries || (await loadPlanEntries({ testMode: isTest }));
  const currentDay = options.currentDay ?? (await getCurrentPlanDay({ testMode: isTest }));

  const activityLogs: LogEntry[] =
    ov.activityLogs || (options.mode === "evening" ? material.logs : await readLogsForDate(activityDate, isTest));

  const mergedPrTitles = ov.mergedPrTitles || (await listMergedPrTitles(activityDate, isTest));
  const cardsApproved =
    ov.cardsApproved !== undefined ? ov.cardsApproved : countApprovedCards(await readDecisionsText(activityDate, isTest));

  const revenue: RevenueMetrics =
    ov.revenue || material.revenueMetrics || (await getRevenueMetrics());

  let spendRupees = ov.spendRupees;
  if (spendRupees === undefined) {
    let ledgerUsd = 0;
    try {
      ledgerUsd = getCostLedgerSummary(activityDate, { testMode: isTest }).totalSpendUsd;
    } catch (err: any) {
      console.warn("[Plain Card] Error reading usage_costs ledger:", err.message);
    }
    const usd = Math.max(ledgerUsd, sumLogSpendUsd(activityLogs));
    spendRupees = usd * getUsdInrRate();
  }

  // Never read from a test process: tests pass the counts they want to see.
  const revenueProgress: RevenueProgress | null =
    ov.revenueProgress !== undefined ? ov.revenueProgress : isTest ? null : await readRevenueProgress();

  const outreach: OutreachStats | null =
    ov.outreach !== undefined ? ov.outreach : isTest ? null : await readOutreachStats(activityDate, scheduleDate);

  const scheduledRoutines = ov.scheduledRoutines || (await scheduledRoutinesOn(scheduleDate));
  const activeIssues =
    ov.activeIssues || (material.inProgressIssues || []).map((i) => ({ number: i.number, title: i.title }));

  const needs = buildNeedsItems({
    openApprovals: material.openApprovals || [],
    blockedIssues: material.blockedIssues || [],
    openProposals: (material.openProposals || []).map((p: any) => ({ number: p.number, title: p.title, agent: p.agent, url: p.url })),
    agentCostStatuses: material.agentCostStatuses || [],
    carriedForwardPlanEntries: material.carriedForwardPlanEntries || [],
    olderReviewCards: (material.olderReviewCards || []).map((r: any) => ({ title: r.title, agent: r.agent, ageHours: r.ageHours, permalink: r.permalink })),
    planEntries,
    currentDay,
    dueDay: planDayDueOn(date),
  });

  return {
    mode: options.mode,
    dateStr: date,
    currentDay,
    planEntries,
    activityLogs,
    mergedPrTitles,
    cardsApproved,
    scheduledRoutines,
    activeIssues,
    revenue,
    spendRupees,
    needs,
    revenueProgress,
    outreach,
  };
}

/** Gathers and renders the plain-English card as text. */
export async function buildPlainCardText(options: PlainCardOptions): Promise<string> {
  return renderPlainCard(await buildPlainCardInput(options));
}

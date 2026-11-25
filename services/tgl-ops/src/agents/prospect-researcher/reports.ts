// services/tgl-ops/src/agents/prospect-researcher/reports.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { postCard, postFile, postLine } from "../../lib/post.js";
import type { ProspectRecord } from "./types.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";
import { FIT_QUALIFIED_THRESHOLD } from "./threshold.js";
import { parseDim4Probe, summariseDim4Probe } from "./dim4.js";
import { categoryLabel } from "../outreach-sequencer/sequence.js";
import { cleanBusinessName } from "../outreach-sequencer/names.js";
import { recordEvent } from "../../lib/events.js";

/**
 * Builds CSV string formatted for revenue exports and GHL bulk ingestion.
 */
export function buildProspectsCsv(prospects: ProspectRecord[]): string {
  const headers = [
    "Company",
    "City",
    "Category",
    "Fit Score",
    "Primary Reason",
    "DM Name",
    "DM Role",
    "DM Email",
    "DM Phone",
    "Website",
    "Meta Ad Library",
    "Status",
    "Created At",
  ];

  const escapeCsv = (str: string | number | undefined) => {
    const val = String(str ?? "").replace(/"/g, '""');
    return `"${val}"`;
  };

  const rows = prospects.map((p) => [
    escapeCsv(p.company),
    escapeCsv(p.city),
    escapeCsv(p.category),
    escapeCsv(p.fit_score),
    escapeCsv(p.fit_reasons[0] || "Qualified"),
    escapeCsv(p.decision_maker.name),
    escapeCsv(p.decision_maker.role),
    escapeCsv(p.decision_maker.email),
    escapeCsv(p.decision_maker.phone || ""),
    escapeCsv(p.website),
    escapeCsv(p.signals.ad_library_url || ""),
    escapeCsv(p.status),
    escapeCsv(p.created_at),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

/**
 * Saves CSV to disk and returns the absolute path.
 */
export function saveProspectsCsv(
  prospects: ProspectRecord[],
  label: string,
  options?: { testMode?: boolean }
): string {
  if (prospects.length === 0) {
    return "";
  }
  const isTest = options?.testMode === true || isTestMode();
  const dateStr = getTodayDateString();
  const dir = path.join(config.repoRoot, isTest ? "logs/.test/reports" : `logs/${dateStr}`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const cleanLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fileName = `prospects-${cleanLabel}-${dateStr}.csv`;
  const fullPath = path.join(dir, fileName);

  const csvContent = buildProspectsCsv(prospects);
  fs.writeFileSync(fullPath, csvContent, "utf8");
  return fullPath;
}

/**
 * Dispatches the "Top 25 this run" interactive card to #revenue with CSV attached.
 */
export async function postTop25ReviewCard(params: {
  city: string;
  category: string;
  prospects: ProspectRecord[];
  csvPath: string;
  savedCount?: number;
  rejectionProposal?: string;
  options?: { testMode?: boolean };
}): Promise<{ cardTs?: string; channel?: string }> {
  const { city, category, prospects, csvPath, savedCount, rejectionProposal, options } = params;
  const isTest = options?.testMode === true || isTestMode();
  const targetChannel = isTest ? (config.opsChannelId || "#ops") : "#revenue";
  const dateStr = getTodayDateString();

  const top25 = [...prospects].sort((a, b) => b.fit_score - a.fit_score).slice(0, 25);

  const lines = top25.map((p, idx) => {
    const phoneTag = p.decision_maker.phone ? " · [phone]" : "";
    const probe = parseDim4Probe(p.fit_reasons);
    const probeLine = probe ? `\n   ↳ _AI visibility: ${summariseDim4Probe(probe)}_` : "";
    return `*${idx + 1}. <${p.website}|${p.company}>* (Score: *${p.fit_score}*) · ${p.city}\n   ↳ *${p.decision_maker.name}* (${p.decision_maker.role}) · ${p.decision_maker.email ? `\`${p.decision_maker.email}\`` : "no email"}${phoneTag}\n   ↳ _${p.fit_reasons[0] || "Qualified"}_${probeLine}`;
  });

  const writtenToSupabase =
    typeof savedCount === "number" && savedCount > 0
      ? `*Written to Supabase:* ${savedCount}`
      : "*Written to Supabase:* 0 saved";

  const summary =
    prospects.length > 0
      ? `*Top 25 Prospects — ${city} (${category})*\n*Total Qualified Batch:* ${prospects.length} accounts (Fit score ≥ ${FIT_QUALIFIED_THRESHOLD})\n${writtenToSupabase}\n\n${lines.slice(0, 8).join("\n\n")}\n\n_(+${Math.max(0, top25.length - 8)} more in attached CSV below)_`
      : `*Prospect Researcher Batch — ${city} (${category})*\n*Total Qualified Batch:* 0 accounts (Fit score ≥ ${FIT_QUALIFIED_THRESHOLD})\n${writtenToSupabase}\n\n*Shortfall:* Sourced accounts did not meet the fit score ≥ ${FIT_QUALIFIED_THRESHOLD} qualification threshold or lacked verified corporate contact.`;

  const runLogUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/logs/${dateStr}/prospect-researcher.md`;

  const cardPayload = {
    channel: targetChannel,
    agent: "prospect-researcher",
    door: "aeo",
    title: `Top 25 Prospects — ${city} (${category})`,
    summary,
    links: [
      { label: "Run Log", url: runLogUrl },
      { label: "SKILL.md", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/agents/prospect-researcher/SKILL.md` },
      { label: "Door AEO", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/doors/aeo.yaml` },
    ],
    actions: (prospects.length > 0
      ? ["approve", "reject", "discuss"]
      : ["discuss"]) as ("approve" | "reject" | "discuss")[],
    extraMeta: {
      city,
      category,
    },
  };

  let cardResult: { ok: boolean; ts?: string; channel?: string; dryRun?: boolean } = { ok: false };
  try {
    cardResult = await postCard(cardPayload);
  } catch (err: any) {
    console.warn(`[Prospect Card Post Notice] ${err.message || err}`);
    cardResult = { ok: false, channel: targetChannel, dryRun: true };
    // Say so where the Architect reads, instead of leaving the run looking complete.
    await postLine({
      channel: targetChannel,
      text: `*Prospect review card could not be posted* for ${city} (${category}): ${String(err?.message || err).slice(0, 200)}. ${prospects.length} qualified prospect(s) are saved; the run log lists them.`,
    }).catch(() => {});
  }

  // Attach CSV to thread ONLY if real message ts was returned from Slack API and CSV exists
  if (cardResult.ok && cardResult.ts && !cardResult.dryRun && csvPath && fs.existsSync(csvPath)) {
    try {
      await postFile({
        channel: cardResult.channel || targetChannel,
        filePath: csvPath,
        filename: path.basename(csvPath),
        title: `Full ${prospects.length}-Prospect Batch (${city} · ${category})`,
        thread_ts: cardResult.ts,
      });

      if (rejectionProposal) {
        await postLine({
          channel: cardResult.channel || targetChannel,
          text: rejectionProposal,
          thread_ts: cardResult.ts,
        });
      }
    } catch (fileErr: any) {
      console.warn(`[Prospect CSV Attachment Notice] ${fileErr.message || fileErr}`);
    }
  }

  return {
    cardTs: cardResult.ok && cardResult.ts && !cardResult.dryRun ? cardResult.ts : undefined,
    channel: cardResult.channel || targetChannel,
  };
}

/**
 * Exports full weekly prospects CSV and posts it to #revenue.
 * Benched rows (status bench or nurture) are never exported: a benched candidate is never notified.
 */
export async function exportWeeklyProspectsCsv(options?: { testMode?: boolean }): Promise<string> {
  const { loadAllProspects } = await import("./db.js");
  const isTest = options?.testMode === true || isTestMode();
  const targetChannel = isTest ? (config.opsChannelId || "#ops") : "#revenue";
  const dateStr = getTodayDateString();

  const allProspects = (await loadAllProspects(options)).filter((p) => p.status !== "bench" && p.status !== "nurture");
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weeklyProspects = allProspects.filter((p) => p.created_at >= sevenDaysAgo || p.status === "new" || p.status === "reviewed");

  const listToExport = weeklyProspects.length > 0 ? weeklyProspects : allProspects;
  const filePath = saveProspectsCsv(listToExport, `weekly-full-${dateStr}`, options);

  if (config.slackBotToken) {
    await postFile({
      channel: targetChannel,
      filePath,
      filename: path.basename(filePath),
      title: `Weekly Prospects Full Export — Week of ${dateStr} (${listToExport.length} accounts)`,
    });
  }

  return filePath;
}

export interface DailyRun {
  city: string;
  category: string;
  rows: ProspectRecord[];
  rejectionProposal?: string;
}

function hasEmailRow(p: ProspectRecord): boolean {
  return /\S+@\S+\.\S+/.test(p.decision_maker?.email || "");
}

/**
 * The text of the one daily approval card (24 Nov 2026): what the morning's searches found, per search, then the
 * best businesses across all of them. Pure, so it is tested without Slack.
 */
export function buildDailyReviewSummary(runs: DailyRun[], dateLabel: string): { title: string; summary: string; total: number } {
  const all = runs.flatMap((r) => r.rows);
  const total = all.length;
  const withEmail = all.filter(hasEmailRow).length;
  const title = `New businesses to approve, ${dateLabel}`;
  if (total === 0) {
    const tried = runs.map((r) => `${r.city} (${categoryLabel(r.category)})`).join(", ");
    return { title, total, summary: `*${title}*\nNo new businesses met the bar today${tried ? ` in ${tried}` : ""}. Nothing to approve.` };
  }
  const perRun = runs
    .map((r) => {
      const e = r.rows.filter(hasEmailRow).length;
      return `- ${r.city}, ${categoryLabel(r.category)}: *${r.rows.length}*${r.rows.length ? ` (${e} with an email, ${r.rows.length - e} phone only)` : ""}`;
    })
    .join("\n");
  const top = [...all].sort((a, b) => b.fit_score - a.fit_score).slice(0, 10);
  const lines = top
    .map((p, i) => `${i + 1}. *<${p.website}|${cleanBusinessName(p.company)}>*, ${p.city}. Fit ${p.fit_score}. ${hasEmailRow(p) ? "Has an email" : p.decision_maker?.phone ? "Phone only" : "No contact"}`)
    .join("\n");
  const summary = `*${title}*
*${total}* new ${total === 1 ? "business" : "businesses"} from ${runs.length} ${runs.length === 1 ? "search" : "searches"} this morning. *${withEmail}* can be emailed; the other ${total - withEmail} wait for WhatsApp.
${perRun}

*Highest fit*
${lines}${total > top.length ? `\n_(${total - top.length} more in the attached list)_` : ""}

Approve sends every business on this card into outreach. Reject removes them all. To drop one business, reply in the thread with its name.`;
  return { title, total, summary };
}

/** Posts the one daily approval card for all of the morning's runs, with one combined list attached. */
export async function postDailyReviewCard(runs: DailyRun[], options?: { testMode?: boolean }): Promise<{ cardTs?: string; channel?: string; total: number }> {
  const isTest = options?.testMode === true || isTestMode();
  const targetChannel = isTest ? (config.opsChannelId || "#ops") : "#revenue";
  const dateStr = getTodayDateString();
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(new Date()).replace(",", "");
  const { title, summary, total } = buildDailyReviewSummary(runs, label);
  const all = runs.flatMap((r) => r.rows);
  const csvPath = all.length ? saveProspectsCsv(all, `daily`, options) : "";
  const runLogUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/logs/${dateStr}/prospect-researcher.md`;

  let res: { ok: boolean; ts?: string; channel?: string; dryRun?: boolean } = { ok: false };
  try {
    res = await postCard({
      channel: targetChannel,
      agent: "prospect-researcher",
      door: "aeo",
      title,
      summary,
      links: [{ label: "Run log", url: runLogUrl }],
      actions: (total > 0 ? ["approve", "reject", "discuss"] : ["discuss"]) as ("approve" | "reject" | "discuss")[],
      // Approve and Reject act on every search on this card (interactions.ts reads pairs).
      extraMeta: { pairs: runs.filter((r) => r.rows.length).map((r) => ({ city: r.city, category: r.category })) },
    });
  } catch (err: any) {
    console.warn(`[Daily Card Post Notice] ${err.message || err}`);
    await postLine({ channel: targetChannel, text: `*The daily approval card could not be posted*: ${String(err?.message || err).slice(0, 200)}. ${total} new businesses are saved; the run log lists them.` }).catch(() => {});
  }
  if (res.ok && res.ts && !res.dryRun) {
    await recordEvent({ agent: "prospect-researcher", kind: "card", summary: total ? `Daily approval card posted in #revenue: ${total} new ${total === 1 ? "business" : "businesses"}.` : "Daily card posted: no new businesses today." });
    try {
      if (csvPath && fs.existsSync(csvPath)) {
        await postFile({ channel: res.channel || targetChannel, filePath: csvPath, filename: path.basename(csvPath), title: `All ${total} new businesses`, thread_ts: res.ts });
      }
      for (const r of runs) {
        if (r.rejectionProposal) await postLine({ channel: res.channel || targetChannel, text: `${r.city}, ${categoryLabel(r.category)}: ${r.rejectionProposal}`, thread_ts: res.ts });
      }
    } catch (fileErr: any) {
      console.warn(`[Daily Card Attachment Notice] ${fileErr.message || fileErr}`);
    }
  }
  return { cardTs: res.ok && res.ts && !res.dryRun ? res.ts : undefined, channel: res.channel || targetChannel, total };
}

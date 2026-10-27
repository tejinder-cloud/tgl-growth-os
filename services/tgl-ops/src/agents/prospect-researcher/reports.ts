// services/tgl-ops/src/agents/prospect-researcher/reports.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import { postCard, postFile, postLine } from "../../lib/post.js";
import type { ProspectRecord } from "./types.js";
import { getTodayDateString, getCurrentTimeIST } from "../../lib/standup.js";

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
  rejectionProposal?: string;
  options?: { testMode?: boolean };
}): Promise<{ cardTs?: string; channel?: string }> {
  const { city, category, prospects, csvPath, rejectionProposal, options } = params;
  const isTest = options?.testMode === true || isTestMode();
  const targetChannel = isTest ? (config.opsChannelId || "#ops") : "#revenue";

  const top25 = [...prospects].sort((a, b) => b.fit_score - a.fit_score).slice(0, 25);

  const lines = top25.map((p, idx) => {
    const phoneTag = p.decision_maker.phone ? " · 📱" : "";
    return `*${idx + 1}. <${p.website}|${p.company}>* (Score: *${p.fit_score}*) · ${p.city}\n   ↳ *${p.decision_maker.name}* (${p.decision_maker.role}) · \`${p.decision_maker.email}\`${phoneTag}\n   ↳ _${p.fit_reasons[0] || "Qualified"}_`;
  });

  const summary = `*Top 25 Prospects — ${city} (${category})*\n*Total Qualified Batch:* ${prospects.length} accounts (Fit score ≥ 70)\n\n${lines.slice(0, 8).join("\n\n")}\n\n_(+${Math.max(0, top25.length - 8)} more in attached CSV below)_`;

  const cardPayload = {
    channel: targetChannel,
    agent: "prospect-researcher",
    door: "aeo",
    title: `Top 25 Prospects — ${city} (${category})`,
    summary,
    links: [
      { label: "SKILL.md", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/agents/prospect-researcher/SKILL.md` },
      { label: "Door AEO", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/doors/aeo.yaml` },
    ],
    actions: ["approve", "reject", "discuss"] as ("approve" | "reject" | "discuss")[],
    issue: `prospects-${city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
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
  }

  // Attach CSV to thread ONLY if real message ts was returned from Slack API
  if (cardResult.ok && cardResult.ts && !cardResult.dryRun) {
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
 */
export async function exportWeeklyProspectsCsv(options?: { testMode?: boolean }): Promise<string> {
  const { loadAllProspects } = await import("./db.js");
  const isTest = options?.testMode === true || isTestMode();
  const targetChannel = isTest ? (config.opsChannelId || "#ops") : "#revenue";
  const dateStr = getTodayDateString();

  const allProspects = await loadAllProspects(options);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weeklyProspects = allProspects.filter((p) => p.created_at >= sevenDaysAgo || p.status === "new" || p.status === "reviewed");

  const listToExport = weeklyProspects.length > 0 ? weeklyProspects : allProspects;
  const filePath = saveProspectsCsv(listToExport, `weekly-full-${dateStr}`, options);

  if (config.slackBotToken) {
    await postFile({
      channel: targetChannel,
      filePath,
      filename: path.basename(filePath),
      title: `📊 Weekly Prospects Full Export — Week of ${dateStr} (${listToExport.length} accounts)`,
    });
  }

  return filePath;
}

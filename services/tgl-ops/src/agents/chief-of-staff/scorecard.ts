import { config } from "../../config.js";
import { loadDoorConfig } from "../../lib/agents.js";
import { postLine } from "../../lib/post.js";
import { getCurrentTimeIST, getTodayDateString } from "../../lib/standup.js";

export interface DoorScorecardEntry {
  door: string;
  name: string;
  lines: string[];
}

/**
 * Compiles the Monday 09:00 IST Scorecard from config/doors/*.yaml scorecard_lines[].
 * Blanks are strictly represented as "—" (dash). Never invented numbers.
 */
export async function compileMondayScorecard(): Promise<string> {
  const doorsToTrack = ["aeo", "ai", "truelead"];
  const doorEntries: DoorScorecardEntry[] = [];

  for (const doorKey of doorsToTrack) {
    try {
      const data = await loadDoorConfig(doorKey);
      if (data) {
        doorEntries.push({
          door: doorKey,
          name: data.name || doorKey.toUpperCase(),
          lines: data.scorecard_lines || [],
        });
      }
    } catch (err) {
      console.warn(`[Scorecard] Could not load door ${doorKey}:`, err);
    }
  }

  const dateStr = getTodayDateString();
  const timeStr = getCurrentTimeIST();

  const parts: string[] = [];
  parts.push(`*📈 The Growth Lab — Monday Door Scorecard | ${dateStr} ${timeStr} IST*`);
  parts.push("──────────────────────────────────────────");

  if (doorEntries.length === 0) {
    parts.push("• _No door configurations found in config/doors/*.yaml._");
  } else {
    for (const d of doorEntries) {
      parts.push(`\n*🚪 Door: ${d.name} (\`${d.door}\`)*`);
      if (d.lines.length === 0) {
        parts.push("  • Trials: —  |  Audits: —  |  Pipeline: —  |  Cash: —");
      } else {
        for (const line of d.lines) {
          // Format line, ensuring any unspecified value defaults strictly to "—"
          parts.push(`  • ${line}: —`);
        }
      }
    }
  }

  parts.push("\n──────────────────────────────────────────");
  parts.push("_Factual standard: Unpopulated metrics are rendered strictly as `—` (dash). Zero estimations._");

  return parts.join("\n");
}

/**
 * Posts the Monday Scorecard to #architect (or targetChannel).
 */
export async function broadcastMondayScorecard(targetChannel?: string): Promise<void> {
  const channel = targetChannel || config.architectChannelId;
  const message = await compileMondayScorecard();

  console.log(`[Scorecard Broadcast] Posting Monday scorecard to ${channel}...`);
  await postLine({
    channel,
    text: message,
  });
}

import { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { getArchitectConfig } from "./org.js";

export const slackClient = new WebClient(config.slackBotToken || "xoxb-mock-token");

export async function openModal(triggerId: string, view: any): Promise<void> {
  if (!config.slackBotToken) {
    console.warn("[Slack] SLACK_BOT_TOKEN not set; simulating modal open");
    return;
  }
  await slackClient.views.open({
    trigger_id: triggerId,
    view,
  });
}

const userDisplayNameCache = new Map<string, string>();

/**
 * Resolves a Slack user or user ID to their display name.
 * Uses architect display name from config/org.yaml for the Architect,
 * and resolves other team members dynamically via users.info.
 */
export async function getActorDisplayName(user: any): Promise<string> {
  const userId = typeof user === "string" ? user : user?.id;

  if (userId && userDisplayNameCache.has(userId)) {
    return userDisplayNameCache.get(userId)!;
  }

  const architect = await getArchitectConfig();
  const rawName = typeof user === "object" ? user?.name || user?.username : (typeof user === "string" ? user : undefined);

  // Match Architect either by user ID or handle
  if (
    (userId && architect.slack_user_id && userId === architect.slack_user_id) ||
    rawName === "falkanmedia" ||
    (userId && userId === "falkanmedia")
  ) {
    if (userId) {
      userDisplayNameCache.set(userId, architect.display_name);
    }
    return architect.display_name;
  }

  let resolvedName: string | undefined;

  // Resolve team members via users.info
  if (userId && config.slackBotToken && !userId.startsWith("mock") && !userId.startsWith("U_TEST")) {
    try {
      const res = await slackClient.users.info({ user: userId });
      if (res.ok && res.user) {
        const profile = res.user.profile;
        const displayName =
          profile?.display_name || profile?.real_name || res.user.real_name || res.user.name;
        if (displayName && displayName.trim()) {
          resolvedName = displayName.trim();
        }
      }
    } catch (err) {
      console.warn(`[getActorDisplayName] Could not fetch profile for ${userId}:`, err);
    }
  }

  const finalName: string =
    resolvedName ||
    (rawName && typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : architect.display_name);

  if (userId) {
    userDisplayNameCache.set(userId, finalName);
  }

  return finalName;
}



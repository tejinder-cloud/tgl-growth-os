import { WebClient } from "@slack/web-api";
import { config } from "../config.js";

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
 * Resolves a Slack user or user ID to their display name (e.g. "Tejinder Singh").
 * Falls back to profile.real_name, user.real_name, user.name, or "Tejinder Singh".
 */
export async function getActorDisplayName(user: any): Promise<string> {
  const userId = typeof user === "string" ? user : user?.id;

  if (userId && userDisplayNameCache.has(userId)) {
    return userDisplayNameCache.get(userId)!;
  }

  let resolvedName: string | undefined;

  if (userId && config.slackBotToken && !userId.startsWith("mock")) {
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

  let finalName = resolvedName;
  if (!finalName) {
    const rawName = typeof user === "object" ? user?.name || user?.username : undefined;
    if (rawName === "falkanmedia") {
      finalName = "Tejinder Singh";
    } else if (rawName && typeof rawName === "string" && rawName.trim().length > 0) {
      finalName = rawName.trim();
    } else {
      finalName = "Tejinder Singh";
    }
  }

  if (userId) {
    userDisplayNameCache.set(userId, finalName);
  }

  return finalName;
}


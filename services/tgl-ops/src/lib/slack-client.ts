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

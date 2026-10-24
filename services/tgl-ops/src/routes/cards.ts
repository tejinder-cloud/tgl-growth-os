import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { postCard, type ActionType } from "../lib/post.js";

export const cardsRouter = Router();

// POST /cards - post a standardized Block Kit card to Slack
cardsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const {
    title = "Gate 0 test",
    agent = "web-builder",
    door = "core",
    summary = "Gate 0 operational verification card for Slack events, interaction webhooks, and decision logging.",
    links = [
      { label: "ORG.md §3–4", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/ORG.md` },
      { label: "Agents Config", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/agents.yaml` },
    ],
    actions = ["approve", "reject", "discuss"],
    issue,
    channel = config.approvalsChannelId,
  } = req.body || {};

  try {
    const result = await postCard({
      channel,
      agent,
      door,
      title,
      summary,
      links,
      actions: actions as ActionType[],
      issue,
    });

    if (result.ok) {
      console.log(`[Card Dispatched] Title: "${title}" | Channel: ${result.channel || channel} | ts: ${result.ts}`);
      res.status(200).json({ ok: true, channel: result.channel || channel, ts: result.ts });
    } else {
      res.status(500).json({ ok: false, error: "Failed to dispatch card to Slack (check SLACK_BOT_TOKEN)" });
    }
  } catch (err: any) {
    console.error("[Cards Route Error]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Helper for Gate 0 test card
const handleGate0 = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await postCard({
      channel: config.approvalsChannelId,
      agent: "web-builder",
      door: "core",
      title: "Gate 0 test",
      summary: "Gate 0 operational verification card for Slack events, interaction webhooks, and GitHub Contents API decision logging.",
      links: [
        { label: "ORG.md §3–4", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/ORG.md` },
        { label: "Agents Config", url: `https://github.com/${config.githubOwner}/${config.githubRepo}/blob/main/config/agents.yaml` },
      ],
      actions: ["approve", "reject", "discuss"],
      issue: 1,
    });

    if (result.ok) {
      console.log(`[Gate 0 Card Dispatched] Channel: ${result.channel || config.approvalsChannelId} | ts: ${result.ts}`);
      res.status(200).json({ ok: true, channel: result.channel || config.approvalsChannelId, ts: result.ts });
    } else {
      res.status(500).json({ ok: false, error: "Failed to dispatch Gate 0 card to Slack" });
    }
  } catch (err: any) {
    console.error("[Gate 0 Error]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

cardsRouter.post("/gate0", handleGate0);
cardsRouter.get("/gate0", handleGate0);

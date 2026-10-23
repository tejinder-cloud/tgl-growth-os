import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { loadAgents } from "../lib/agents.js";
import { compileStandupDigest, formatStandupMessage, getTodayDateString } from "../lib/standup.js";
import { createIssue } from "../lib/github-client.js";
import { openModal } from "../lib/slack-client.js";

export const commandsRouter = Router();

commandsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const { command, text, user_name, channel_id, trigger_id } = req.body;

  console.log(`[Slash Command] Command: ${command} | User: ${user_name} | Text: "${text}"`);

  // 1. /standup Command
  if (command === "/standup") {
    // If a specific date is passed (YYYY-MM-DD), compile for that date; otherwise today
    const dateArg = text?.trim();
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : getTodayDateString();

    const digest = compileStandupDigest(targetDate);
    const message = formatStandupMessage(digest);

    res.json({
      response_type: "in_channel",
      text: message,
    });
    return;
  }

  // 2. /task Command
  if (command === "/task") {
    const trimmedText = text?.trim() || "";

    // If user provided text: "/task @web-builder Fix footer copyright line"
    if (trimmedText.length > 0) {
      const agentMatch = trimmedText.match(/@([a-zA-Z0-9_-]+)/);
      const agentName = agentMatch ? agentMatch[1].toLowerCase() : "web-builder";
      const taskTitle = trimmedText.replace(/@([a-zA-Z0-9_-]+)/, "").trim() || "Operational Task";

      const registered = loadAgents();
      const matched = registered.find((a) => a.name.toLowerCase() === agentName);

      const issue = await createIssue({
        title: `[TASK]: ${taskTitle}`,
        body: `### for-agent\n${matched?.name || agentName}\n\n### door\ncore\n\n### context\nCreated via /task slash command by @${user_name}:\n> "${trimmedText}"\n\n### deliverable\nPer agent mandate.\n\n### reviewer\n${matched?.reviewer || "Chief of Staff"}\n\n### due\nToday\n`,
        labels: [`for:${matched?.name || agentName}`, "type:build"],
      });

      res.json({
        response_type: "in_channel",
        text: `⚡ Task created by @${user_name} for \`@${matched?.name || agentName}\`:\n• *Issue:* <${issue.html_url}|#${issue.number} ${taskTitle}>\n• *Reviewer:* ${matched?.reviewer || "Chief of Staff"}`,
      });
      return;
    }

    // If no text provided, open the interactive modal
    if (trigger_id) {
      res.status(200).send(""); // acknowledge immediately
      await openTaskModal(trigger_id, user_name);
      return;
    }

    res.json({
      response_type: "ephemeral",
      text: "Usage: `/task @<agent> <task description>`",
    });
    return;
  }

  res.json({
    response_type: "ephemeral",
    text: `Unknown command: ${command}`,
  });
});

async function openTaskModal(triggerId: string, userName: string): Promise<void> {
  const agents = loadAgents();
  const agentOptions = agents.map((a) => ({
    text: { type: "plain_text", text: `${a.name} (${a.department})` },
    value: a.name,
  }));

  const modalView = {
    type: "modal",
    callback_id: "modal_task_create",
    title: { type: "plain_text", text: "Create TGL Task" },
    submit: { type: "plain_text", text: "Create Task" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "agent_block",
        label: { type: "plain_text", text: "Assign to Agent" },
        element: {
          type: "static_select",
          action_id: "agent_select",
          placeholder: { type: "plain_text", text: "Select an agent" },
          options: agentOptions.length > 0 ? agentOptions : [
            { text: { type: "plain_text", text: "web-builder" }, value: "web-builder" },
          ],
        },
      },
      {
        type: "input",
        block_id: "title_block",
        label: { type: "plain_text", text: "Task Title" },
        element: {
          type: "plain_text_input",
          action_id: "title_input",
          placeholder: { type: "plain_text", text: "e.g. Implement AEO short-form report template" },
        },
      },
      {
        type: "input",
        block_id: "door_block",
        label: { type: "plain_text", text: "Product Door" },
        element: {
          type: "static_select",
          action_id: "door_select",
          placeholder: { type: "plain_text", text: "Select door" },
          options: [
            { text: { type: "plain_text", text: "TGL AEO" }, value: "aeo" },
            { text: { type: "plain_text", text: "TGL AI" }, value: "ai" },
            { text: { type: "plain_text", text: "TrueLead" }, value: "truelead" },
            { text: { type: "plain_text", text: "Core / Infrastructure" }, value: "core" },
          ],
        },
      },
      {
        type: "input",
        block_id: "context_block",
        label: { type: "plain_text", text: "Context & Requirements" },
        element: {
          type: "plain_text_input",
          action_id: "context_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Context, specifications, and links..." },
        },
      },
    ],
  };

  await openModal(triggerId, modalView);
}

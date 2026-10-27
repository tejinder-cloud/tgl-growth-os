import { Router, type Request, type Response } from "express";
import { config, isTestMode } from "../config.js";
import { loadAgents } from "../lib/agents.js";
import { getTodayDateString } from "../lib/standup.js";
import { createIssue } from "../lib/github-client.js";
import { slackClient, openModal } from "../lib/slack-client.js";
import { recordIssueMapping } from "../lib/issues-index.js";
import { execute1800Broadcast } from "../agents/chief-of-staff/worker.js";

export const commandsRouter = Router();

commandsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const { command, text, user_name, channel_id, trigger_id } = req.body;

  console.log(`[Slash Command] Command: ${command} | User: ${user_name} | Text: "${text}"`);

  // 1. /standup Command: Calls Chief of Staff run (gather from GitHub, Anthropic call, cost line)
  if (command === "/standup") {
    const responseUrl = req.body.response_url;
    // Acknowledge immediately within 3 seconds
    res.status(200).json({
      response_type: "ephemeral",
      text: "⏳ Chief of Staff: Gathering operational material & synthesizing standup…",
    });

    (async () => {
      try {
        const isTest = isTestMode();
        const dateArg = text?.trim();
        const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : getTodayDateString();

        // In test mode, target #ops; in live use, target channel_id where the command was typed (e.g. #standup), fallback to config
        const targetChannel = isTest
          ? (config.opsChannelId || "#ops")
          : (channel_id || config.standupChannelId);

        console.log(`[Slash Command /standup] Invoking Chief of Staff standup run for ${targetDate} to ${targetChannel}...`);

        const broadcastRes = await execute1800Broadcast({
          targetChannel,
          dateStr: targetDate,
          forceCompile: true,
          source: "standup_command",
          testMode: isTest,
        });

        if (!broadcastRes.standupTs) {
          throw new Error("Standup broadcast completed without a message timestamp from Slack.");
        }

        const costLineText = broadcastRes.costLine ? `\n• *Cost:* ${broadcastRes.costLine}` : "";
        const replyText = `✅ Chief of Staff standup broadcast complete to <#${broadcastRes.channel}> (ts: ${broadcastRes.standupTs})${costLineText}`;

        if (responseUrl) {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "ephemeral",
              text: replyText,
            }),
          });
        }
      } catch (err) {
        console.error("[Standup Command Error]", err);
        if (responseUrl) {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "ephemeral",
              text: `❌ Error running Chief of Staff standup: ${(err as Error).message}`,
            }),
          });
        }
      }
    })();
    return;
  }

  // 2. /task Command: /task @agent | door | what
  if (command === "/task") {
    const trimmedText = text?.trim() || "";
    const registeredAgents = await loadAgents();
    const validDoors = ["aeo", "ai", "truelead", "core"];
    const validAgentsList = registeredAgents.map((a) => a.name).join(", ");
    const validDoorsList = validDoors.join(", ");

    if (!trimmedText) {
      if (trigger_id) {
        res.status(200).send("");
        await openTaskModal(trigger_id, user_name);
        return;
      }
      res.json({
        response_type: "ephemeral",
        text: `Usage: \`/task @<agent> | <door> | <what>\`\n\n• *Valid Agents:* ${validAgentsList}\n• *Valid Doors:* ${validDoorsList}`,
      });
      return;
    }

    // Direct /task @prospect-researcher invocation without pipes
    if (
      trimmedText.toLowerCase() === "@prospect-researcher" ||
      trimmedText.toLowerCase().startsWith("@prospect-researcher run") ||
      (trimmedText.toLowerCase().startsWith("@prospect-researcher") && !trimmedText.includes("|"))
    ) {
      const responseUrl = req.body.response_url;
      res.status(200).json({
        response_type: "ephemeral",
        text: "⏳ Prospect Researcher: Starting autonomous research run for next metro in rotation…",
      });

      (async () => {
        try {
          const { runProspectResearch } = await import("../agents/prospect-researcher/worker.js");
          const result = await runProspectResearch({ postToSlack: true });
          const replyText = `✅ Prospect Researcher run complete for *${result.city}* (${result.category}): *${result.qualifiedCount}* qualified prospects sourced. Review card posted to #revenue.`;

          if (responseUrl) {
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                response_type: "ephemeral",
                text: replyText,
              }),
            });
          }
        } catch (err: any) {
          console.error("[Task @prospect-researcher Error]", err);
          if (responseUrl) {
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                response_type: "ephemeral",
                text: `❌ Error running @prospect-researcher: ${err.message}`,
              }),
            });
          }
        }
      })();
      return;
    }

    const parts = trimmedText.split("|").map((p: string) => p.trim());
    if (parts.length < 3) {
      res.json({
        response_type: "ephemeral",
        text: `❌ Invalid format. Please use: \`/task @<agent> | <door> | <what>\`\n\n• *Valid Agents:* ${validAgentsList}\n• *Valid Doors:* ${validDoorsList}\n\n*Example:* \`/task @web-builder | core | Fix footer CTA spacing on mobile\``,
      });
      return;
    }

    const agentRaw = parts[0].replace(/^@/, "").trim().toLowerCase();
    const doorRaw = parts[1].toLowerCase().trim();
    const what = parts.slice(2).join(" | ").trim();

    const matchedAgent = registeredAgents.find(
      (a) =>
        a.name.toLowerCase() === agentRaw ||
        a.name.toLowerCase().replace(/-/g, "") === agentRaw.replace(/-/g, "")
    );
    const matchedDoor = validDoors.includes(doorRaw) ? doorRaw : undefined;

    if (!matchedAgent || !matchedDoor) {
      const errReason = !matchedAgent
        ? `Unknown agent "${parts[0]}"`
        : `Unknown door "${parts[1]}"`;
      res.json({
        response_type: "ephemeral",
        text: `❌ ${errReason}.\n\n• *Valid Agents:* ${validAgentsList}\n• *Valid Doors:* ${validDoorsList}\n\nUsage: \`/task @<agent> | <door> | <what>\``,
      });
      return;
    }

    const responseUrl = req.body.response_url;

    // Acknowledge immediately within 3 seconds
    res.status(200).json({
      response_type: "ephemeral",
      text: "⏳ Creating task…",
    });

    // Perform GitHub issue creation, Slack card dispatch, and mapping recording asynchronously
    (async () => {
      try {
        const permalink = `https://itsthegrowthlab.slack.com/archives/${channel_id}`;
        const contextText = `Slack message by @${user_name} in <#${channel_id}>:\n> "${trimmedText}"\n\n*Slack Permalink:* ${permalink}`;

        const issueBody = `### for-agent
${matchedAgent.name}

### door
${matchedDoor}

### context
${contextText}

### deliverable
${what}

### reviewer
${matchedAgent.reviewer}

### due
`;

        const titleSnippet = what.split("\n")[0].slice(0, 80);
        const issue = await createIssue({
          title: `[TASK]: ${titleSnippet}`,
          body: issueBody,
          labels: [`for:${matchedAgent.name}`, `door:${matchedDoor}`, "type:build"],
        });

        const targetChannel = matchedAgent.channel;
        const cardMetadata = JSON.stringify({
          agent: matchedAgent.name,
          door: matchedDoor,
          issue: issue.number,
          issueUrl: issue.html_url,
          title: titleSnippet,
          channel: targetChannel,
        });

        const cardBlocks = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `⚡ Task Assigned: ${matchedAgent.name}`,
              emoji: true,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `*Agent:* \`${matchedAgent.name}\`  |  *Door:* \`${matchedDoor}\`  |  *Reviewer:* \`${matchedAgent.reviewer}\``,
              },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Deliverable:*\n${what}\n\n*Issue Link:* <${issue.html_url}|#${issue.number} ${titleSnippet}>`,
            },
          },
          {
            type: "actions",
            block_id: "task_actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Picked up",
                  emoji: true,
                },
                style: "primary",
                action_id: "action_picked_up",
                value: cardMetadata,
              },
            ],
          },
        ];

        let cardTs: string | undefined;
        if (config.slackBotToken) {
          try {
            const postRes = await slackClient.chat.postMessage({
              channel: targetChannel,
              text: `⚡ Task for @${matchedAgent.name}: <${issue.html_url}|#${issue.number} ${titleSnippet}>`,
              blocks: cardBlocks,
            });
            if (!postRes.ok || !postRes.ts) {
              throw new Error(`Slack card post failed: ${postRes.error || "no ts returned"}`);
            }
            cardTs = postRes.ts;
          } catch (err: any) {
            if (!isTestMode()) {
              throw new Error(`Failed to post task card to ${targetChannel}: ${err.message}`);
            }
          }
        } else if (isTestMode()) {
          cardTs = `${(Date.now() / 1000).toFixed(6)}`;
        } else {
          throw new Error("SLACK_BOT_TOKEN is not configured; cannot post task card in production.");
        }

        if (!cardTs) {
          throw new Error(`Failed to post task card to ${targetChannel}: no message timestamp returned from Slack.`);
        }

        await recordIssueMapping(issue.number, {
          channel: targetChannel,
          ts: cardTs,
          agent: matchedAgent.name,
          door: matchedDoor,
          title: titleSnippet,
        });

        // Trigger autonomous issue runner if agent has autorun: true
        if (matchedAgent.autorun === true) {
          if (matchedAgent.name === "prospect-researcher") {
            const { runProspectResearch } = await import("../agents/prospect-researcher/worker.js");
            runProspectResearch({ postToSlack: true }).catch((err) => {
              console.error("[Prospect Researcher Trigger Error]:", err);
            });
          } else {
            const { addLabelsToIssue } = await import("../lib/github-client.js");
            await addLabelsToIssue(issue.number, ["status:in-progress"]);

            const { runIssueTask } = await import("../runner/index.js");
            runIssueTask({
              number: issue.number,
              title: `[TASK]: ${titleSnippet}`,
              body: issueBody,
              labels: [`for:${matchedAgent.name}`, `door:${matchedDoor}`, "type:build", "status:in-progress"],
              html_url: issue.html_url,
              agentName: matchedAgent.name,
              door: matchedDoor,
              slackChannel: targetChannel,
              slackThreadTs: cardTs,
            }).catch((err) => {
              console.error(`[Runner Trigger Error on Task #${issue.number}]:`, err);
            });
          }
        }

        const confirmationText = `✅ Task created: <${issue.html_url}|#${issue.number} ${titleSnippet}>\nPosted to ${targetChannel} for @${matchedAgent.name}.${matchedAgent.autorun ? "\n_Autonomous runner triggered._" : ""}`;

        if (responseUrl) {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "ephemeral",
              replace_original: true,
              text: confirmationText,
            }),
          });
        }
      } catch (err) {
        console.error("[Task Creation Error]", err);
        if (responseUrl) {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "ephemeral",
              replace_original: true,
              text: `❌ Failed to create task: ${(err as Error).message}`,
            }),
          });
        }
      }
    })();
    return;
  }

  res.json({
    response_type: "ephemeral",
    text: `Unknown command: ${command}`,
  });
});

async function openTaskModal(triggerId: string, userName: string): Promise<void> {
  const agents = await loadAgents();
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

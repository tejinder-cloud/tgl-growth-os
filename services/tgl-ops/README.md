# TGL Ops — Slack Service & Approval Webhook

Production Slack orchestration service for **The Growth Lab** agent nervous system ([ORG.md §3–4](file:///Users/tejindersingh/Documents/TGL%20Website/ORG.md#L76-L93)).

---

## 1. System Overview

`tgl-ops` bridges human leadership (Architect Tejinder Singh) and our multi-agent workforce across Slack and GitHub:

1. **Task Dispatch (`POST /slack/events`):**
   - Parses `@TGL Ops @<agent> <instruction>` in any pod channel.
   - Creates a GitHub issue in `tgl-growth-os` labelled `for:<agent>` and `type:build`.
   - Links the originating Slack thread directly in the issue body.
   - Replies in-thread with the created GitHub issue link.
   - Monitors thread replies from humans in `#approvals`, logging them as discussion comments directly into `decisions/YYYY-MM-DD.md`.

2. **Interactive Decision Engine (`POST /slack/interactions`):**
   - **Approve:** Writes an authoritative line to `decisions/YYYY-MM-DD.md` via GitHub Contents API, applies the label `approved:yes` to the linked issue/PR, updates the Slack card with an approved banner (`✅ Approved by @<actor> at HH:MM IST`), and confirms in-thread.
   - **Reject:** Opens an interactive Slack modal enforcing a required rejection reason. Upon submission, writes the reason to `rejections/YYYY-MM-DD.md` (so agents learn negative constraints), updates the card, marks the issue `approved:no`, and records the rejection in `decisions/YYYY-MM-DD.md`.
   - **Discuss:** Immediately notifies the responsible agent in-thread (`@<agent>`).

3. **Slash Commands (`POST /slack/commands`):**
   - `/standup [YYYY-MM-DD]` — Compiles today's standup digest from `logs/<date>/*.md`, parsing `Did`, `Blocked`, `Need`, and `Tomorrow` across agents, highlighting blockers and pending approvals.
   - `/task @<agent> <description>` — Quickly scaffolds and creates a GitHub task issue directly from Slack.

4. **18:00 Standup Automation (Cron in `Asia/Kolkata`):**
   - **17:50 IST:** Pre-compiles daily standup digest.
   - **18:00 IST:** Broadcasts company digest to `#standup`.
   - **18:15 IST:** Chief of Staff automatically posts a "Silence Flag" identifying any registered agent with zero logged progress today.

5. **Universal Agent Library (`src/lib/post.ts`):**
   - Standardised `postCard()`, `postLine()`, and `postFile()` helpers used across all agent workers.

---

## 2. Slack App Manifest

To configure the Slack App in 60 seconds:
1. Navigate to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
2. Select your workspace (**The Growth Lab**).
3. Paste the following YAML manifest (replace `<YOUR_RAILWAY_URL>` with your assigned Railway domain, e.g., `https://tgl-ops-production.up.railway.app`):

```yaml
display_information:
  name: TGL Ops
  description: The Growth Lab Agent Nervous System & Approval Webhook
  background_color: "#1F2421"
features:
  bot_user:
    display_name: TGL Ops
    always_online: true
  slash_commands:
    - command: /standup
      url: https://<YOUR_RAILWAY_URL>/slack/commands
      description: Compile and view today's TGL standup digest
      usage_hint: "[YYYY-MM-DD]"
      should_escape: false
    - command: /task
      url: https://<YOUR_RAILWAY_URL>/slack/commands
      description: Create and assign a task issue to an agent
      usage_hint: "@<agent> <description>"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - commands
      - files:write
      - groups:history
      - groups:read
      - im:history
      - im:write
      - mpim:history
      - mpim:write
settings:
  event_subscriptions:
    request_url: https://<YOUR_RAILWAY_URL>/slack/events
    bot_events:
      - app_mention
      - message.channels
      - message.groups
  interactivity:
    is_enabled: true
    request_url: https://<YOUR_RAILWAY_URL>/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

---

## 3. Railway Deployment Steps

1. **Log in to Railway:** Open project `tgl-growth-os` (as specified in `config/org.yaml`).
2. **New Service:** Click **+ New** → **GitHub Repo** → select `tejinder-cloud/tgl-growth-os`.
3. **Root Directory:** In Service Settings, set **Root Directory** to `services/tgl-ops`.
4. **Environment Variables:** Under **Variables**, add:
   ```env
   PORT=3000
   SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-...
   SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   GITHUB_OWNER=tejinder-cloud
   GITHUB_REPO_NAME=tgl-growth-os
   APPROVALS_CHANNEL_ID=<Channel ID for #approvals>
   STANDUP_CHANNEL_ID=<Channel ID for #standup>
   ALERTS_CHANNEL_ID=<Channel ID for #alerts>
   TIMEZONE=Asia/Kolkata
   ```
5. **Generate Domain:** In **Settings** → **Networking** → click **Generate Domain**.
6. **Health Check:** Railway uses `/health` (configured in `railway.json`). Check `https://<YOUR_RAILWAY_URL>/health` to verify `200 OK`.
7. **Verify URLs in Slack:** Paste the Railway URL into the Event Subscriptions and Interactivity settings in the Slack App dashboard.

---

## 4. Local Testing & Verification

Run the automated plumbing verification test:
```bash
npm run test:plumbing
```
This executes:
- Block Kit card rendering (`postCard`)
- Simulated Approve button interaction and GitHub Contents API decision write to `decisions/YYYY-MM-DD.md`
- Standup compilation and formatting (`compileStandupDigest`)

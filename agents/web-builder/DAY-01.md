# DAY 1 — Repo restructure, skill-file template, door configs

## Your hour (do these first, in order — the agent needs the IDs)
1. **Slack:** create workspace "The Growth Lab" (or use existing). Create channels: `#architect #standup #approvals #alerts #revenue #doors-aeo #doors-ai #doors-truelead #marketing #ops #people #finance #site-build #site-cro #video`. Note the workspace URL.
2. **GitHub:** create org (or use `tejinder-cloud`), repo `tgl-growth-os`, private. Push the current "TGL Website" folder contents (everything from the zips: AGENTS.md, ORG.md, TEAM-v3.md, PROJECT-PLAN.md, agents/, design-system/, site/, products/, tgl-theme/). Default branch `main`, branch protection: PRs required.
3. **Railway:** create project `tgl-growth-os`. Note the project name.
4. **Supabase:** create project `truevisible` (region: Mumbai/ap-south-1). Note project URL and anon/service keys — keep them in your password manager, not in chat.
5. Paste the Slack URL, GitHub repo URL, Railway project name and Supabase project URL into `config/org.yaml` (the agent creates the file; you fill four lines).

## Paste into the Web Builder session (it is the plumbing builder until the workers exist)

```
DAY 1 — TASK-P01: Repo restructure and foundations. Read AGENTS.md, ORG.md, PROJECT-PLAN.md and products/truevisible/SPEC.md first. Brief review (numbered concerns + proposals) before you build.

Build:
1. Restructure the repo to the ORG.md layout without losing anything:
   agents/<name>/SKILL.md (migrate ROLE.md files to the new 10-section standard for web-builder and creative-director; keep the old ROLE.md content inside the new sections)
   config/org.yaml (slack_url, github_repo, railway_project, supabase_url — leave values blank for the Architect)
   config/doors/aeo.yaml, ai.yaml, truelead.yaml — each with: name, icp, audit_spec, sla_hours, ghl_pipeline (blank), content_pillar, scorecard_lines[]
   logs/.keep, decisions/.keep, rejections/.keep, memory/.keep, products/truevisible/ (SPEC.md already there), plans/.keep, finance/.keep
2. Write agents/_TEMPLATE/SKILL.md implementing the ten-section standard in ORG.md §5, with one worked example line per section so a new agent can be scaffolded from it in minutes.
3. Write scripts/new-agent.sh <name> <department> that scaffolds agents/<name>/ from the template, creates memory/<name>.md, and adds the agent to config/agents.yaml (name, department, channel, trigger, reviewer).
4. Add .github/ISSUE_TEMPLATE/task.md with fields: for-agent, door, context, deliverable, reviewer, due. Add labels list to .github/labels.yml (for:<each agent>, door:aeo/ai/truelead, type:change-request/content/build/review).
5. Move decisions/2026-10-17.md and any rejections into the new folders; create decisions/2026-10-23.md summarising today's product decisions from SPEC.md §2, §6, §7, §9 (one line each).
6. README.md at root: what this repo is, how work flows (ORG.md §3), how to run scripts/new-agent.sh, where the standup lives.

Verify: tree output in the report; scripts/new-agent.sh test-agent revenue runs and produces a valid folder (then delete it); no file lost (list anything you moved).
Report in ROLE/SKILL format. Stop after the report.
```

## End of Day 1
You have: a repo that looks like the company, a template every agent is born from, door configs the audit engine will read tomorrow, and four IDs in `config/org.yaml`. Day 2 is the Slack bot and the approval webhook.

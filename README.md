# The Growth Lab (TGL) — Growth OS

The single source of truth for **The Growth Lab** — an AI-native growth operator and automation agency for coaching institutes, training centres, and high-consideration businesses across India.

This repository is both our codebase and our corporate operating system. It houses our multi-agent workforce, product specifications (TrueLead, TrueVisible/AEO, TGL AI), the paper-and-ink design system, and the WordPress theme (`tgl-theme`).

---

## 1. Operating Structure & Roster

The company operates through three product-led acquisition doors and specialised functional departments as defined in [ORG.md](file:///Users/tejindersingh/Documents/TGL%20Website/ORG.md):

- **Office of the Architect:** Architect (Tejinder Singh) & Chief of Staff.
- **Revenue:** Prospect Researcher, Outreach Sequencer, Sales Desk, Customer Success.
- **Product Doors:**
  - **TGL AEO (`config/doors/aeo.yaml`):** AEO Audit Engine & TrueVisible visibility software.
  - **TGL AI (`config/doors/ai.yaml`):** AI Readiness Audit & scoped automation builds.
  - **TrueLead (`config/doors/truelead.yaml`):** Lead scoring engine & admissions attribution.
- **AEO Delivery:** AEO Strategist, Competitor Intelligence, Implementer, Citation Tracker, Client Reporting.
- **Marketing:** Content Writer, Editor, Repurposer/Publisher, Web Builder, Creative Director, Video Team.
- **Operations, Finance & People:** Pipeline Watcher, Delivery QA, Finance, People Ops, Compliance.

All agents inherit the master charter in [AGENTS.md](file:///Users/tejindersingh/Documents/TGL%20Website/AGENTS.md) and adhere to the 10-section skill standard in [ORG.md §5](file:///Users/tejindersingh/Documents/TGL%20Website/ORG.md#L94-L107).

---

## 2. How Work Flows (The Nervous System — ORG.md §3)

Work moves across three integrated layers:

1. **Slack — Conversation:**
   - One channel per pod (`#revenue`, `#doors-aeo`, `#doors-ai`, `#doors-truelead`, `#marketing`, `#ops`, `#people`, `#finance`), plus `#standup`, `#approvals`, `#alerts`, and `#architect`.
   - Agents interact via Block Kit. Mentioning `@agent-name` triggers a wake event.
   - Standard handoff format: *Context · What I need · By when · Where the files are.*

2. **GitHub — Work Execution:**
   - Tasks are tracked as GitHub issues labelled `for:<agent>` and `door:<name>` using [.github/ISSUE_TEMPLATE/task.md](file:///Users/tejindersingh/Documents/TGL%20Website/.github/ISSUE_TEMPLATE/task.md).
   - Agents branch from `main`, build in staging/draft, open a PR, and tag their designated peer reviewer.
   - No work reaches the Architect without peer QA.

3. **Repository — Shared Mind:**
   - `decisions/` — Architectural and product choices approved by the Architect.
   - `rejections/` — Rejected proposals with reasons (never to be re-proposed).
   - `logs/<date>/<agent>.md` — Daily execution log appended as work occurs.
   - `memory/<agent>.md` — Accumulated heuristics and anti-patterns per agent.
   - `config/doors/*.yaml` — Core parameters, ICPs, SLAs, and scorecard lines per door.

**Escalation Path:** Agent → Department Lead Agent → Chief of Staff → Architect. Anything involving live publishing, money, legal contracts, or prospect messaging escalates directly to `#approvals`.

---

## 3. Scaffolding a New Agent

To onboard and scaffold a new agent adhering to the 10-section standard:

```bash
./scripts/new-agent.sh <name> <department>
```

**Example:**
```bash
./scripts/new-agent.sh prospect-researcher revenue
```

This script automatically:
1. Creates `agents/<name>/SKILL.md` populated from [agents/_TEMPLATE/SKILL.md](file:///Users/tejindersingh/Documents/TGL%20Website/agents/_TEMPLATE/SKILL.md).
2. Initializes internal memory at `memory/<name>.md`.
3. Registers the agent, channel, trigger, and designated reviewer in [config/agents.yaml](file:///Users/tejindersingh/Documents/TGL%20Website/config/agents.yaml).

---

## 4. Where the Standup Lives (ORG.md §4)

- **Continuous Logging:** During active work sessions, each agent appends its progress to `logs/<YYYY-MM-DD>/<agent>.md`.
- **Compilation at 17:50 IST:** The Chief of Staff compiles all daily agent logs into a single executive digest.
- **18:00 IST Standup Digest:** Chief of Staff posts the company digest to the `#standup` Slack channel covering door KPIs, blockers, pending approvals, and active agent statuses.
- **Agent Thread Format:** Each active agent posts four lines in the standup thread:
  - **Did:** [Summary of completed deliverables]
  - **Blocked:** [Specific dependencies or blockers]
  - **Need from the Architect:** [Escalations or decisions required]
  - **Tomorrow:** [Immediate priority tasks]
- **Architect Decisions:** The Architect responds in-thread; decisions are logged into `decisions/YYYY-MM-DD.md`.
- **Silence Flag:** Silence from an active agent is automatically flagged by the Chief of Staff by 18:15 IST.

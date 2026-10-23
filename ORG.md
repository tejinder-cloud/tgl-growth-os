# ORG.md — How The Growth Lab's agent company is organised
**22 October 2026 · Supersedes the roster sections of TEAM-v3.md. AGENTS.md remains the charter; BRAND-BRIEF.md remains the brand.**

---

## 1. The principle
Agents are staff, not scripts. Each has a department, a skill file, colleagues it talks to, a definition of done, a daily report, and a performance record. The company is organised like a small firm would be — because that is the shape that works — and capped like one: **no more than 12 active agents in the first 60 days.** Roles beyond that are on the bench until a door has paying customers.

## 2. Departments and roles

### Office of the Architect
| Role | Job |
|---|---|
| **Architect** (Tejinder) | Decides positioning, pricing, who we serve, anything live or irreversible, spend, hires. Reads one digest a day. |
| **Chief of Staff** | Runs the company's rhythm: 18:00 standup digest, Monday scorecard across doors, tracks pending approvals, chases blockers, keeps the 90-day door reviews. The Architect's only required daily read. |

### Revenue (built first — there is no list until this pod makes one)
| Role | Job |
|---|---|
| **Prospect Researcher** | Manufactures the list from zero: Google Maps categories where AI answers decide purchases (hospitals, dental and cosmetic chains, hotels, real-estate developers, coaching, law and CA firms, D2C brands), Justdial, Meta Ad Library (active advertisers = budget), LinkedIn Sales Navigator, Apollo. Scores fit per door. 100 qualified names a week, deduped against GHL. |
| **Outreach Sequencer** | Runs the 5-touch sequence through GrowthLab Engine and GHL. Pre-runs the short AEO audit on each prospect so the first message carries their own report. Logs every reply; routes intent to the Sales Desk. |
| **Sales Desk** | Prepares every call (prospect dossier, their audit, likely objections), books via GHL calendar, drafts the proposal within 4 hours of the call, follows up on the proposal cadence. Never sends to a prospect without approval. |
| **Customer Success** | From "won" onward: onboarding checklist, 7/30/60-day check-ins, usage and health signals per account, renewal and upsell timing, churn-risk flag 30 days early. |

### Doors (product-led acquisition)
| Role | Job |
|---|---|
| **AEO Door Lead** + **AEO Audit Engine** | Owns the AEO growth plan; the engine runs audits (full for inbound, short-form for outreach) and renders reports. |
| **AI Door Lead** + **AI Readiness Audit** | Owns the TGL AI growth plan; the audit scores automation opportunity and proposes three scoped builds. |
| **TrueLead Door Lead** + **Trial Concierge** + **Product QA** | Owns the TrueLead growth plan; concierge runs trial onboarding; QA runs the 5-step gate weekly. |

### AEO Delivery (the retainer — added 23 Oct; TGL's own site is client zero)
| Role | Job |
|---|---|
| **AEO Strategist** | Turns an audit into a 90-day plan per client: prompts to win, entities to establish, content to create, in priority order. Reviews monthly against the tracker. |
| **Competitor Intelligence** | Per target prompt: who is cited today, from which sources, why. Monthly refresh; gap list to the Strategist. |
| **Implementer** | Executes the plan: schema and entity pages, FAQ blocks, `llms.txt`, Google Business Profile, directory/citation submissions, Reddit/Quora presence, content briefs to Marketing. Client WordPress via Easy MCP AI; other platforms via API or a change list for the client's developer. |
| **Citation Tracker** | Weekly prompt runs per client across ChatGPT, Perplexity, Gemini, Copilot; every result written to Supabase (schema designed for the portal from day one); flags movement. |
| **Client Reporting** | Monthly report in the client's language: then vs now, what changed, what's next. Feeds the visibility portal. |

**AEO visibility portal:** v1 = Looker Studio on the Supabase tables (client-shareable, no code); v2 = custom portal with client login and internal all-accounts view, built on the TGL design system once five AEO clients are paying. GHL remains the CRM; we do not build another.

### Marketing
| Role | Job |
|---|---|
| **Content Writer → Editor → Repurposer → Publisher** | The engine: 4 posts a week (2 AEO), each cut into LinkedIn, carousel, X, Reddit, ad hooks; published to WordPress and scheduled to social. |
| **Community** | Monitors LinkedIn, Reddit, Quora; drafts replies; flags buying signals to Revenue. |
| **Ads Analyst + Creative Producer** | One campaign per door; cost per audit; creative bench from blog hooks. |
| **Web Builder + Creative Director** | As built. |
| **Video Team** | As built. |

### Operations
| Role | Job |
|---|---|
| **Pipeline Watcher** | Three GHL pipelines, SLAs, stuck deals, no-shows, daily digest. |
| **Delivery QA** | Every audit report checked before it leaves: facts, brand, no unverifiable claims, correct name. |

### People (HR)
| Role | Job |
|---|---|
| **People Ops** | For agents: owns the skill-file standard; onboards new agents (scaffold, tools, channel, first task); runs monthly performance reviews from the record (proposal acceptance rate, rejected re-proposals, SLA misses, errors caught by reviewers); retires or retrains underperformers; keeps `decisions/` and `rejections/` current so agents learn. For humans: job scorecards, candidate screening and interview kits for the Audit & Delivery Coordinator and later hires, onboarding plans, the founder-hours ledger (so the Architect's week is measured, not felt). |

### Finance
| Role | Job |
|---|---|
| **Finance** | Invoices (GST-compliant) from GHL/Razorpay/Zoho on win and on cycle; collections follow-up; per-door and per-client P&L monthly; **cost per audit including LLM/API spend**; agent run costs; cash-reserve tracker against the 4-month target; founder salary as a fixed line; monthly close pack to the Architect by the 3rd. Flags any client above 40% of revenue. |

### Legal & Compliance (part-time, triggered)
| Role | Job |
|---|---|
| **Compliance** | Contract templates per door; DPDP Act handling for lead data and audit data; WhatsApp Business and Meta platform policy checks on every template and campaign; TrueLead terms and privacy policy. Reviews, never signs. |

**Active in the first 60 days (12):** Chief of Staff · Prospect Researcher · Outreach Sequencer · Sales Desk · AEO Audit Engine · AEO Strategist + Implementer (one agent to start, on TGL's own site first) · Content Writer · Repurposer/Publisher (one agent to start) · Web Builder · Creative Director · Finance · People Ops. *(AEO Door Lead duties sit with the Strategist until the door has three clients.)*
**Bench until a door has revenue:** everything else.

## 3. How agents talk to each other (the nervous system)
Three layers, all of which exist today only on paper and are the first build:

1. **Slack — conversation.** One channel per department (`#revenue`, `#doors-aeo`, `#doors-ai`, `#doors-truelead`, `#marketing`, `#ops`, `#people`, `#finance`), plus `#standup`, `#approvals`, `#alerts`, `#architect`. Agents post with Block Kit; `@agent-name` in a message is a trigger — the mentioned agent reads the thread and acts. Handoffs use one template: *Context · What I need · By when · Where the files are.*
2. **GitHub — work.** Every task is an issue labelled `for:<agent>` and `door:<name>`. An agent picks up issues addressed to it, works on a branch, opens a PR, and @mentions its reviewer. The issue is the memory of the task; the PR is the deliverable.
3. **Repo — shared mind.** `decisions/` (what the Architect decided), `rejections/` (what not to re-propose), `logs/<date>/<agent>.md` (what each agent did today), `config/doors/*.yaml` (the facts about each door), `memory/<agent>.md` (what each agent has learned about its own job). Every agent reads the relevant files at the start of every run. This is how an agent remembers yesterday.

**Mechanically:** each agent is a Claude Agent SDK worker on Railway with its SKILL.md as system prompt, tools via MCP (GHL, WordPress, Slack, GitHub, the audit engines), triggered by Slack events, GitHub webhooks, or a schedule. The approval webhook writes button decisions to `decisions/` and fires the next agent. Build estimate: 3–4 days for the plumbing, then each agent is a day.

**Escalation:** agent → department lead agent → Chief of Staff → Architect. Anything irreversible, live, or involving money or a prospect skips straight to `#approvals`.

## 4. The 18:00 standup
- Through the day each agent appends to `logs/<date>/<agent>.md` as it works.
- At 17:50 IST the Chief of Staff compiles. At **18:00** it posts one digest to `#standup`: per-door headline numbers, blockers, approvals pending, and a line per agent.
- Each agent posts its own four lines in the thread: **Did · Blocked · Need from the Architect · Tomorrow.** Nothing else.
- The Architect replies in-thread; decisions are captured by the webhook into `decisions/`.
- Silence from an agent = a flag the Chief of Staff raises by 18:15.

## 5. The skill-file standard (every agent, no exceptions)
`agents/<name>/SKILL.md` — written as the brief a senior hire would be given on day one:
1. **Identity & seniority** — who you are, your years, what "excellent" looks like in your discipline
2. **Mandate** — the one outcome you own, and the metric on it
3. **Playbooks** — the ten-years-of-experience part: decision rules, heuristics, checklists, "when X, do Y", the mistakes juniors make in this role and how you avoid them
4. **Tools & access** — exactly what you can call, with examples
5. **Inputs / outputs / triggers** — what arrives, what leaves, what wakes you
6. **Colleagues** — who you talk to, about what, in which channel; who reviews your work; whose work you review
7. **Definition of done** — the test the Architect could run
8. **Never** — the hard lines
9. **Reporting** — your four standup lines, your weekly line for the scorecard
10. **Learning** — which `decisions/` and `rejections/` you read before each run; what you write to `memory/<name>.md`

People Ops owns the template and audits every skill file monthly.

## 6. Where "superior" comes from
Every agent runs on the same model; intelligence is not a dial. What makes one agent senior and another junior is identical to what does it for people: the depth of its brief (section 5.3), the data and tools it can reach, memory of what was decided, a second agent reviewing its work before the Architect sees it, and a standing mandate to challenge (AGENTS.md). Every agent therefore has a named reviewer. Every proposal is scored accepted/rejected, and People Ops reports the rate monthly. An agent whose proposals are never accepted is retrained or retired, like a hire would be.

## 7. Build order
1. Plumbing (Slack, bot, webhook, issue queue, logs, standup) — days 1–4
2. Revenue pod: Prospect Researcher → Outreach Sequencer → Sales Desk — days 3–8
3. AEO Audit Engine (short-form first, for outreach; full for inbound) + `/aeo` — days 4–10
4. Finance (invoicing must exist before the first customer) — day 8
5. Chief of Staff standup live — day 8
6. Content Writer + Repurposer/Publisher — days 10–14
7. People Ops; skill-file audit of everything built so far — day 14
8. AI door, Customer Success, Creative Producer, Ads — days 15–30, as doors earn them

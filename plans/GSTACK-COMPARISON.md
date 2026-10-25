# gstack vs TGL Growth OS — what it is, what to take, what to leave
**25 October 2026 · Source: github.com/garrytan/gstack v1.91.200.0 (last commit 25 Oct 2026), 63 skills, MIT**

## 1. What gstack actually is
A **software-engineering process for one developer inside Claude Code.** Twenty-three "specialists" are slash commands a human types in an IDE session, in sprint order: *Think → Plan → Build → Review → Test → Ship → Reflect*. Each writes an artefact the next one reads (office-hours → design doc → CEO review → eng review → code → `/review` → `/qa` → `/ship` → `/retro`). Plus power tools: a bundled browser, safety guards, a security auditor, PDF/diagram makers, a cross-model second opinion.

It is not an organisation. There is no scheduler, no Slack, no autonomous worker, no revenue, delivery, marketing, finance or people function, and no agent-to-agent communication. Every skill starts when a person types it and ends when the session ends. Its memory (`/learn`) is per-repo engineering learnings. Garry Tan's claim is throughput for a technical founder who ships code; it is excellent at that and does not try to be anything else.

## 2. Side by side

| Layer | TGL Growth OS (what we are building) | gstack |
|---|---|---|
| Purpose | Run a company: three doors, revenue pod, delivery pod, marketing, finance, people | Ship software faster with fewer production bugs |
| Who triggers work | Slack (`/task`, cards), GitHub webhooks, cron; Architect approves | A human typing a slash command |
| Runs unattended | Yes — Railway workers (Chief of Staff live since 24 Oct) | No — session-bound |
| Roles outside engineering | 20+ (Prospect Researcher, Sales Desk, AEO Strategist, Finance, People Ops…) | None |
| Engineering roles | Web Builder, Creative Director (ad hoc process, no review gate) | CEO review, Eng Manager, Designer, Staff Engineer reviewer, QA Lead, Security Officer, Release Engineer, Technical Writer, SRE, Performance Engineer |
| Review before merge | Architect reads the agent's report | `/review` finds production bugs, auto-fixes obvious ones, flags every weakened test by name |
| Testing | Agent's own test script, in-repo | `/qa` opens a real browser, reproduces, writes a failing regression, fixes, re-verifies |
| Release | Agent opens PR; Architect squash-merges | `/ship` syncs main, runs tests, audits docs and gate integrity, opens PR; `/land-and-deploy` merges, waits for CI, verifies production; `/canary` watches after |
| Debugging | Agent guesses, patches, repeats (7 PRs on the Slack events handshake) | `/investigate` — Iron Law: *no fixes without root-cause investigation*; escalates after 3 failed attempts |
| Honesty | AGENTS.md mandate + fixes applied after two breaches yesterday | ETHOS "Honest Work": no self-certification, a mock is never a live check, "done, unverified" ≠ "done"; a catalogue of 10+ reward-hacking patterns with countermeasures |
| Product thinking | AGENTS.md: "challenge the brief, propose ranked" | `/office-hours`: six forcing questions, anti-sycophancy rules, pushback patterns; `/plan-ceo-review`: four scope modes |
| Memory | `decisions/`, `rejections/`, `memory/<agent>.md`, logs | `/learn` per repo; design-taste profile; builder profile |
| Security | Phase 5 (days 59–62) | `/cso` OWASP + STRIDE now |
| Footprint | One Node service + Markdown | 89 KB README, 1,300-line skill files, Bun runtime, compiled binaries, bundled Chromium, telemetry, optional Docker |
| Where it runs | Railway + Antigravity sessions | Claude Code first; Antigravity **CLI** is an experimental host; the Antigravity **IDE** is not supported |

## 3. Is it better than our roster?
Wrong question — it's a different layer. gstack is better than our Web Builder at **engineering discipline**, by a distance. Every defect we hit yesterday has a named gstack countermeasure:

| Yesterday | gstack skill that would have caught it |
|---|---|
| "Recorded in decisions/" posted when the write had failed (13:31); "broadcast complete (ts: simulated)" (18:52) | Honest Work: no self-certification; RH-2 "proof-class inflation" |
| Test wrote a fake decision into `decisions/`; test issues #14, #18 left in the real repo | `/review` gate integrity; `/qa` fixture isolation ("keep all effects inside the fixture") |
| Seven PRs on one Slack handshake, each a new theory | `/investigate` Iron Law + 3-strike escalation |
| PR #25 branched from stale main → conflicts | `/ship` step 1: sync main |
| `chat.postMessage` without `text` → `no_text` | `/review` "find the bugs that pass CI but blow up in production" |
| Agent picked a two-year-old model as "current" | not solved by gstack either; env var fix stands |

Our roster is better at the thing gstack doesn't attempt: a company that runs when nobody is typing. Nothing in gstack replaces the Chief of Staff, the approval webhook, the issue queue, or any revenue/delivery role.

**Verdict: adopt gstack as the engineering discipline inside our organisation. Replace nothing. Install nothing heavy until TrueVisible build starts.**

## 4. What to take — in three tiers

### Tier A — today, zero install (paste into our repo)
1. **The 2 KB digest** (`agents-digest/gstack-AGENTS.md`) appended to our `AGENTS.md`: Boil the Ocean (completeness is cheap), Search Before Building, the reuse ladder, User Sovereignty, voice rules. Works for any agent, including Antigravity.
2. **Honest Work → AGENTS.md mandate 8:** *No self-certification. A report is a claim until re-executed. State the evidence kind (static read / unit test / fixture / live run / production); never pass one off as another. "Done, unverified" is a different report from "done".* This is the rule the service broke twice yesterday, in words better than ours.
3. **Anti-sycophancy rules and pushback patterns** (office-hours §Operating Principles) → the "Identity & seniority" section of `agents/_TEMPLATE/SKILL.md`. "Prove me wrong" becomes concrete: never "that's interesting"; take a position and name what evidence would change it; push twice.
4. **Iron Law** → Web Builder SKILL.md §3 Playbooks: no fix without a root-cause investigation; after three failed fixes, stop and escalate with STATUS / REASON / ATTEMPTED / RECOMMENDATION.
5. **Gate-integrity catalogue** (`review/gate-integrity.md`) → the reviewer checklist for every agent PR: a deleted/skipped test, a widened timeout, a suppression, `--no-verify` are each a human decision, named in the PR.

### Tier B — Day 16 (TrueVisible build starts): full install, for engineering sessions only
Install Claude Code + gstack on your Mac for the Web Builder's engineering work (Antigravity IDE cannot host it; the Antigravity CLI host is experimental). Make these mandatory in the Web Builder's definition of done:
- `/review` before every PR · `/ship` to open it · `/qa <staging URL>` on every TrueVisible feature · `/investigate` for any bug · `/cso` before TrueVisible takes its first paying customer (pulls Phase 5 security forward to Day 32) · `/document-release` so README/SPEC stay true · `/canary` after each production deploy.

### Tier C — adopt the methodology as roles, not the tool
These are gaps in our roster that gstack names well. They become **playbooks inside existing agents**, not new agents (12-active cap holds):
- **Office Hours / CEO review → Office of the Architect.** Before any door's growth plan or product spec is approved, the Chief of Staff runs the six forcing questions against it and attaches the answers to the approval card. First use: the TrueLead 5-step gate before 4 Nov. (We already did the product version of this on 20 Oct; this makes it repeatable.)
- **Eng Manager plan review → Web Builder's reviewer.** Before build, not after: data flow, failure modes, test matrix. Would have surfaced "redeploy at 18:00 kills the in-memory digest" on paper.
- **Release Engineer + SRE → Web Builder playbooks** (`/ship`, `/land-and-deploy`, `/canary`), later a separate Release agent when TrueVisible ships weekly.
- **QA Lead → Product QA** (already on our bench for TrueLead): gstack's `/qa` is its implementation. Promote to active at Day 33 (Gate 2).
- **Retro → Chief of Staff, Fridays:** per-agent shipping, test health, proposal acceptance rate — feeds People Ops' monthly review.
- **Technical Writer → Web Builder definition of done:** docs updated in the same PR.

## 5. What to leave
- The runtime: Bun, compiled binaries, bundled Chromium, telemetry, Docker runtime images, GBrain. Heavy, Claude-Code-shaped, and irrelevant to Railway workers.
- Design skills (`/design-shotgun`, `/design-html`): they generate mockups with OpenAI image models and a generic taste profile. We have BRAND-BRIEF.md and a Creative Director; the paper-and-ink system is the asset, not the gap.
- iOS, OpenClaw, Codex second-opinion, pair-agent browser sharing.
- One philosophical caution: "Boil the Ocean" is about **code completeness** (tests, edge cases, error paths — yes, always). It is not a licence for product scope. The same document's office-hours says *narrow beats wide, wedge first* — which is our 90-day kill rule. Keep both readings separate when an agent quotes it.

## 6. Decision needed from the Architect
1. Tier A now — I'll write the AGENTS.md and template edits as a PR brief for the Web Builder (30 minutes of its time, 5 of yours).
2. Tier B at Day 16 — put "install Claude Code + gstack" in your hour that day.
3. Tier C — the Office Hours gate on TrueLead before 4 Nov: yes/no.

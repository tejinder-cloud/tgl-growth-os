# PROJECT PLAN v2 — Building The Growth Lab's agent company
**23 October 2026 · 68 working days · Architect time: one hour per working day (TrueLead MVP sprint separate, ~2h/day, days 1–10)**

"Build" = agents. "Your hour" = the only thing you do. Phase gates are hard.

> Generated autonomously from `config/plan.yaml`. Do not edit directly; edit `config/plan.yaml` or update via approved proposals.

---

## Phase 0 — Foundations & plumbing (Days 1–5)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 1 | 2026-10-23 | `@web-builder` | Repo restructure to ORG.md layout; skill-file template; `config/doors/*.yaml`; `products/truevisible/` folder | Create Slack workspace + channels, GitHub org and push repo, Railway project, Supabase project. Paste IDs to `config/`. |
| 2 | 2026-10-24 | `@chief-of-staff` | TGL Ops Slack bot (Block Kit, approve/reject); approval webhook on Railway → `decisions/` → next agent | Create Slack app; scopes; paste bot token to Railway secrets; approve the test message. |
| 3 | 2026-10-25 | `@chief-of-staff` | GitHub issue queue (`for:`, `door:` labels); Actions for logs/standup; `@agent` mention listener | API keys: Anthropic, OpenAI, Google AI, Perplexity → secrets. |
| 4 | 2026-10-26 | `@chief-of-staff` | Chief of Staff (skill file + worker): 18:00 digest, thread template, silence flag | Review skill file (10 min); watch the first 18:00 standup. |
| 5 | 2026-10-27 | `@chief-of-staff` | End-to-end test: Slack → issue → agent → PR → approval → `decisions/` | **Gate 0:** approve one task from your phone without opening a file. |

## Phase 1 — Revenue pod + audit engine (Days 6–15)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 6 | 2026-10-28 | `@prospect-researcher` | Prospect Researcher SKILL.md | Approve; create Google Places key, Apollo, Hunter accounts. |
| 7 | 2026-10-29 | `@prospect-researcher` | Prospect Researcher worker → Supabase `prospects` → GHL; first 100 names | Review 25; reject 5 with reasons (it learns). |
| 8 | 2026-10-30 | `@aeo-audit-engine` | **AEO Audit Engine SKILL.md + short-form engine**: AEO Audit Engine SKILL.md + short-form engine (5 prompts × 3 engines, one-page PDF) — this is also TrueVisible's trial engine. | Approve prompt rules; review 3 one-pagers (yours + 2 prospects). |
| 9 | 2026-11-02 | `@aeo-audit-engine` | **Full engine: 10 prompts × 5 engines + 6-page PDF**: Full engine: 10 prompts × 5 engines (AI Overviews + Copilot via Playwright), sentiment, hallucination detection, competitor citations, 6-page PDF; Supabase runs/answers/citations. | Review TGL's full audit — our baseline, 0% expected. |
| 10 | 2026-11-03 | `@outreach-sequencer` | **Outreach Sequencer SKILL.md + 5-touch worker**: Outreach Sequencer SKILL.md + worker: 5-touch via GrowthLab Engine + GHL; one-pager attached to touch 2; replies → Sales Desk. | Edit the five templates; connect LinkedIn in GrowthLab Engine. |
| 11 | 2026-11-04 | `@web-builder` | **/aeo landing page + audit form + GHL pipeline**: /aeo page + audit form + GHL 'AEO' pipeline + WhatsApp alert templates. | Approve copy; submit templates. |
| 12 | 2026-11-05 | `@sales-desk` | **Sales Desk SKILL.md + worker + proposal template**: Sales Desk SKILL.md + worker: dossier, calendar, proposal in 4h, follow-up cadence; proposal template. | Approve proposal template (prices from SPEC §2). |
| 13 | 2026-11-06 | `@finance` | **Finance SKILL.md + v1: GST invoices & ledger**: Finance SKILL.md + v1: Razorpay/Zoho GST invoice on Won; collections cadence; finance/ledger; LUT task to Compliance. | Create Razorpay; set founder salary line and reserve account. |
| 14 | 2026-11-09 | `@outreach-sequencer` | **Outreach live: 25/day + Delivery QA**: Outreach live: 25/day; Delivery QA on every one-pager. | Watch the first 10 go out; reply to first replies (Sales Desk drafts). |
| 15 | 2026-11-10 | `@chief-of-staff` | **Gate 1 Review & Cross-Door Scorecard v1**: Review; scorecard v1. Gate 1 verification: 100 prospects, ≥50 touched, ≥5 audits delivered, 0 QA failures. | Gate 1: 100 prospects, ≥50 touched, ≥5 audits delivered, 0 QA failures. |

## Phase 2 — TrueVisible v1 + AEO delivery (Days 16–33)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 16 | 2026-11-11 | `@web-builder` | **Supabase schema per SPEC §11 with RLS & usage_costs**: Supabase schema per SPEC §11, RLS by tenant; usage_costs from day one. | Install Claude Code + gstack on the Mac for engineering sessions (git clone gstack → ./setup). Approve schema (5-line explainer). |
| 17 | 2026-11-12 | `@aeo-audit-engine` | **Citation Tracker: daily runs per brand**: Citation Tracker: daily runs per brand → runs/answers/citations; TGL = tenant zero; cost per brand logged. | Add TGL's 10 prompts (I draft). |
| 18 | 2026-11-13 | `@web-builder` | **Auth + onboarding wizard (3 steps) in paper-and-ink**: Auth + onboarding wizard (3 steps, platform question, language) in paper-and-ink. | Walk the wizard on your phone; list what confuses you. |
| 19 | 2026-11-16 | `@aeo-strategist` | **Setup-verification queue**: Setup-verification queue: agent proposes category/competitors/prompts → human confirm within 24h. | Verify the first 3 setups yourself. |
| 20 | 2026-11-17 | `@web-builder` | **TrueVisible Dashboard: Overview tab**: Dashboard: Overview (meter, over-time by engine, sentiment, SoV, citations, hallucinations panel). | Click through; five confusions. |
| 21 | 2026-11-18 | `@web-builder` | **TrueVisible Dashboard: Prompts, Citations & Settings tabs**: Dashboard: Prompts · Citations (+ gap list) · Settings. | Review Prompts and Citations tabs. |
| 22 | 2026-11-19 | `@web-builder` | **Recommendations with assets + Start managed AEO button**: Recommendations with assets; Start managed AEO button → contract + Razorpay + Delivery queue. | Approve the recommendation card and the managed-AEO flow copy. |
| 23 | 2026-11-20 | `@outreach-sequencer` | **Automated client reports (email + dashboard via Resend)**: Reports: daily digest + weekly trend (email + dashboard); Resend; Client Reporting agent narrative lines. | Read one weekly report as a client. |
| 24 | 2026-11-23 | `@web-builder` | **Monthly PDF generator via Playwright + GA4 Impact tab**: Monthly PDF (Playwright); Impact tab (GA4 referrers by engine). | Connect TGL's GA4. |
| 25 | 2026-11-24 | `@chief-of-staff` | **Alerts engine (hallucination & competitor overtake) + WhatsApp**: Alerts: thresholds, hallucination/competitor-overtake detection; WhatsApp via GHL; human-voice templates signed 'your TrueVisible team'. | Approve alert copy; set thresholds. |
| 26 | 2026-11-25 | `@finance` | **Billing engine: Razorpay subscriptions, trials, invoices**: Billing: Razorpay subscriptions (INR+GST / USD no GST), trial logic (14d, 10 prompts, no card), paywall, invoices. | Test a trial → paid conversion with a test card. |
| 27 | 2026-11-26 | `@web-builder` | **Agency multi-tenant data model**: Agency data model (agency_id, white_label, billing_owner, consolidated invoice logic) — no UI. | Approve agency data model architecture. |
| 28 | 2026-11-27 | `@web-builder` | **Execution paths: WordPress via MCP, Shopify/Webflow adapters**: Execution paths: platform detection; WordPress via MCP; Shopify/Webflow API adapters v1; change-pack generator + tracker. | Approve the change-pack format. |
| 29 | 2026-11-30 | `@aeo-strategist` | **AEO Strategist + Implementer: 90-day execution on TGL site**: AEO Strategist + Implementer (one agent): 90-day plan from audit; executes on TGL's site first. | Approve TGL's own 90-day plan; grant GBP access. |
| 30 | 2026-12-01 | `@aeo-strategist` | **Competitor Intelligence: citing sources & monthly refresh**: Competitor Intelligence: per-prompt citing sources, monthly refresh, gap list. | Review TGL's gap list. |
| 31 | 2026-12-02 | `@sales-desk` | **Customer Success v1 + Trial Concierge**: Customer Success v1: 7/30/60 check-ins, health score, churn flag; Trial Concierge for TrueVisible sign-ups. | Approve customer success copy and cadences. |
| 32 | 2026-12-03 | `@chief-of-staff` | **Compliance audit & legal contracts pack**: Compliance: TrueVisible terms + privacy, managed-AEO contract, DPDP note, LUT filing checklist, comparison-page review rules; /cso security audit of TrueVisible before first paying customer. | Read the contract and terms once. |
| 33 | 2026-12-04 | `@chief-of-staff` | **Gate 2 Load Test: TGL + 3 dummy tenants**: Load test: TGL + 3 dummy tenants through signup → trial → audit → dashboard → managed AEO → invoice. Gate 2. | Gate 2: a stranger signs up, gets the day-1 audit, sees the dashboard, and you can upsell them to managed AEO without touching anything. |

## Phase 3 — Marketing engine, umbrella site, Mission Control (Days 34–46)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 34 | 2026-12-07 | `@content-writer` | **Content Writer + Editor SKILL.md**: Content Writer + Editor SKILL.md (voice.md, pillars per door). | Approve; record 3 voice notes. |
| 35 | 2026-12-08 | `@content-writer` | **Writer + Editor workers & first 2 AEO posts**: Writer + Editor workers; first 2 AEO posts. | Edit post 1. |
| 36 | 2026-12-09 | `@repurposer-publisher` | **Repurposer/Publisher worker & social scheduling**: Repurposer/Publisher: WordPress REST + schema + featured image; Buffer scheduling. | Connect Buffer; approve post 1 + derivatives. |
| 37 | 2026-12-10 | `@web-builder` | **Homepage rebuilt as umbrella + /truevisible product page**: Homepage rebuilt as the umbrella; BRAND-BRIEF §1/§2/§7 rewritten; /truevisible product page with trial CTA; comparison page (dated, verified). | Approve homepage + comparison copy. |
| 38 | 2026-12-11 | `@web-builder` | **/ai draft + /coaching reorganization + /truelead waitlist**: /ai draft; /coaching moved under TrueLead; /truelead waitlist. | Approve /ai copy and page layouts. |
| 39 | 2026-12-14 | `@creative-director` | **Creative Director cold review & token audit**: Creative Director cold review of homepage, /truevisible, /aeo; fixes. | Decide what it escalates. |
| 40 | 2026-12-15 | `@sales-desk` | **Ads Analyst + Creative Producer: Meta campaign v1**: Ads Analyst + Creative Producer: Meta campaign → TrueVisible trial; ₹400/day. | Approve creatives; set budget. |
| 41 | 2026-12-16 | `@web-builder` | **Mission Control v1: Doors, pipelines & standup SLA**: Mission Control Part 1: doors, pipelines, standup/SLA per agent. | Use Mission Control morning screen; feedback. |
| 42 | 2026-12-17 | `@web-builder` | **Mission Control v2: Financials & run cost ledgers**: Mission Control Part 2: run costs + cost per brand, cash/invoices. | Review financial ledger widget. |
| 43 | 2026-12-18 | `@web-builder` | **Mission Control v3: Approvals queue & alert feed**: Mission Control Part 3: approvals, alert feed, integration. | Use it for three mornings; list what's missing. |
| 44 | 2026-12-21 | `@content-writer` | **Community monitoring agent: LinkedIn/Reddit/Quora**: Community agent: LinkedIn/Reddit/Quora monitoring, reply drafts. | Approve 5 replies. |
| 45 | 2026-12-22 | `@people-ops` | **People Ops: skill-file audit & performance records**: People Ops: skill-file audit; first performance record. | Read the audit summary. |
| 46 | 2026-12-23 | `@chief-of-staff` | **Gate 3 Review: Marketing engine & Mission Control**: Review. Gate 3 verification: 4 posts/week; homepage + product page live; first ad-sourced trial; Mission Control is morning screen. | Gate 3: 4 posts/week; homepage + product page live; first ad-sourced trial; Mission Control is your morning screen. |

## Phase 4 — TrueLead + TGL AI doors (Days 47–58)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 47 | 2026-12-24 | `@web-builder` | **Product QA runs TrueLead 5-step gate from fresh account**: Product QA runs the TrueLead 5-step gate from a fresh account. | Fix list → your sprint backlog. |
| 48 | 2026-12-25 | `@sales-desk` | **TrueLead Trial Concierge implementation**: TrueLead Trial Concierge; TrueLead door growth plan (Part 1). | Review TrueLead onboarding copy. |
| 49 | 2026-12-28 | `@sales-desk` | **TrueLead Door growth plan execution**: TrueLead Trial Concierge; TrueLead door growth plan (Part 2). | Approve TrueLead growth plan targets. |
| 50 | 2026-12-29 | `@sales-desk` | **TrueLead Door growth plan sign-off**: TrueLead door growth plan sign-off (Part 3). | Approve TrueLead door plan. |
| 51 | 2026-12-30 | `@chief-of-staff` | **Gate run #2: TrueLead waitlist becomes trial**: Gate run #2 → waitlist becomes trial if pass. | Decide on waitlist trial opening. |
| 52 | 2026-12-31 | `@web-builder` | **AI Readiness Audit engine development**: AI Readiness Audit engine + /ai live + TGL AI growth plan + demo flow (Part 1). | Review AI readiness audit questions. |
| 53 | 2027-01-01 | `@web-builder` | **/ai landing page deployment & demo flow**: AI Readiness Audit engine + /ai live + TGL AI growth plan + demo flow (Part 2). | Walk through /ai demo flow. |
| 54 | 2027-01-04 | `@sales-desk` | **TGL AI Growth Plan sign-off**: AI Readiness Audit engine + /ai live + TGL AI growth plan + demo flow (Part 3). | Approve plan and audit questions. |
| 55 | 2027-01-05 | `@sales-desk` | **Upsell Proposal Builder across doors**: Upsell Proposal Builder across doors. | Approve cross-door pricing matrix. |
| 56 | 2027-01-06 | `@video-team` | **Video Team final delivery & hero integration**: Video Team final → placed; stand-in retired. | Sign off on final explainer video. |
| 57 | 2027-01-07 | `@sales-desk` | **Second Meta Campaign launch for readier door**: Second Meta campaign (readier door). | Approve campaign targeting and budget. |
| 58 | 2027-01-08 | `@chief-of-staff` | **Gate 4 Review: Three doors live with pipelines**: Review. Gate 4 verification: three doors live, each with pipeline + scorecard line. | Gate 4: three doors live, each with pipeline + scorecard line. |

## Phase 5 — Hardening (Days 59–68)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 59 | 2027-01-11 | `@web-builder` | **Security Hardening: Secrets rotation & RLS audit**: Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 1). | Approve secrets rotation schedule. |
| 60 | 2027-01-12 | `@web-builder` | **Security Hardening: Token scopes & monitoring**: Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 2). | Review token permission scopes. |
| 61 | 2027-01-13 | `@web-builder` | **Security Hardening: Automated database backups**: Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 3). | Verify backup test output. |
| 62 | 2027-01-14 | `@chief-of-staff` | **Security & Infrastructure hardening sign-off**: Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 4). | Approve security audit sign-off. |
| 63 | 2027-01-15 | `@people-ops` | **People Ops Monthly Review: Performance records**: People Ops monthly review; bench/retire decisions (Part 1). | Review agent performance rankings. |
| 64 | 2027-01-18 | `@people-ops` | **People Ops Monthly Review: Bench/retire decisions**: People Ops monthly review; bench/retire decisions (Part 2). | One decision per flagged agent. |
| 65 | 2027-01-19 | `@people-ops` | **People Ops Monthly Review: Founder-hours ledger**: People Ops monthly review; founder-hours audit (Part 3). | Review founder-hours breakdown. |
| 66 | 2027-01-20 | `@finance` | **Finance Monthly Close: Cost per brand vs price**: Finance monthly close; cost per brand vs price; agency-plan go/no-go on the ₹600 number (Part 1). | Read finance close pack. |
| 67 | 2027-01-21 | `@finance` | **Finance Monthly Close: Agency plan go/no-go**: Finance monthly close; cost per brand vs price; agency-plan go/no-go on the ₹600 number (Part 2). | Set prices and sign off on agency plan. |
| 68 | 2027-01-22 | `@chief-of-staff` | **90-Day Door Reviews & Handover: Gate 5**: 90-day door reviews scheduled; handover doc. Gate 5: a week where your only input is the 18:00 thread. | Gate 5: a week where your only input is the 18:00 thread. |

---
Tools & APIs: unchanged from v1 of this plan, plus Razorpay subscriptions (INR/USD), Playwright for AI Overviews/Copilot, Resend, and Vercel for the TrueVisible app. Run-rate at full roster ₹50–90K/month; cost per brand per month is the number Finance guards.

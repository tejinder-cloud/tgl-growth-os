# PROJECT PLAN v2 — Building The Growth Lab's agent company
**23 October 2026 · 68 working days · Architect time: one hour per working day (TrueLead MVP sprint separate, ~2h/day, days 1–10)**

"Build" = agents. "Your hour" = the only thing you do. Phase gates are hard.

---

## Phase 0 — Foundations & plumbing (Days 1–5)
| Day | Build | Your hour |
|---|---|---|
| 1 | Repo restructure to ORG.md layout; skill-file template; `config/doors/*.yaml`; `products/truevisible/` folder | Create Slack workspace + channels, GitHub org and push repo, Railway project, Supabase project. Paste IDs to `config/`. |
| 2 | TGL Ops Slack bot (Block Kit, approve/reject); approval webhook on Railway → `decisions/` → next agent | Create Slack app; scopes; paste bot token to Railway secrets; approve the test message. |
| 3 | GitHub issue queue (`for:`, `door:` labels); Actions for logs/standup; `@agent` mention listener | API keys: Anthropic, OpenAI, Google AI, Perplexity → secrets. |
| 4 | Chief of Staff (skill file + worker): 18:00 digest, thread template, silence flag | Review skill file (10 min); watch the first 18:00 standup. |
| 5 | End-to-end test: Slack → issue → agent → PR → approval → `decisions/` | **Gate 0:** approve one task from your phone without opening a file. |

## Phase 1 — Revenue pod + audit engine (Days 6–15)
| Day | Build | Your hour |
|---|---|---|
| 6 | Prospect Researcher SKILL.md | Approve; create Google Places key, Apollo, Hunter accounts. |
| 7 | Prospect Researcher worker → Supabase `prospects` → GHL; first 100 names | Review 25; reject 5 with reasons (it learns). |
| 8 | AEO Audit Engine SKILL.md + short-form engine (5 prompts × 3 engines, one-page PDF) — this is also TrueVisible's trial engine | Approve prompt rules; review 3 one-pagers (yours + 2 prospects). |
| 9 | Full engine: 10 prompts × 5 engines (AI Overviews + Copilot via Playwright), sentiment, hallucination detection, competitor citations, 6-page PDF; Supabase `runs/answers/citations` | Review TGL's full audit — our baseline, 0% expected. |
| 10 | Outreach Sequencer SKILL.md + worker: 5-touch via GrowthLab Engine + GHL; one-pager attached to touch 2; replies → Sales Desk | Edit the five templates; connect LinkedIn in GrowthLab Engine. |
| 11 | `/aeo` page + audit form + GHL "AEO" pipeline + WhatsApp alert templates | Approve copy; submit templates. |
| 12 | Sales Desk SKILL.md + worker: dossier, calendar, proposal in 4h, follow-up cadence; proposal template | Approve proposal template (prices from SPEC §2). |
| 13 | Finance SKILL.md + v1: Razorpay/Zoho GST invoice on Won; collections cadence; `finance/ledger`; LUT task to Compliance | Create Razorpay; set founder salary line and reserve account. |
| 14 | Outreach live: 25/day; Delivery QA on every one-pager | Watch the first 10 go out; reply to first replies (Sales Desk drafts). |
| 15 | Review; scorecard v1 | **Gate 1:** 100 prospects, ≥50 touched, ≥5 audits delivered, 0 QA failures. |

## Phase 2 — TrueVisible v1 + AEO delivery (Days 16–33)
| Day | Build | Your hour |
|---|---|---|
| 16 | Supabase schema per SPEC §11, RLS by tenant; `usage_costs` from day one | Approve schema (5-line explainer). |
| 17 | Citation Tracker: daily runs per brand → runs/answers/citations; TGL = tenant zero; cost per brand logged | Add TGL's 10 prompts (I draft). |
| 18 | Auth + onboarding wizard (3 steps, platform question, language) in paper-and-ink | Walk the wizard on your phone; list what confuses you. |
| 19 | Setup-verification queue: agent proposes category/competitors/prompts → human confirm within 24h | Verify the first 3 setups yourself. |
| 20 | Dashboard: Overview (meter, over-time by engine, sentiment, SoV, citations, hallucinations panel) | Click through; five confusions. |
| 21 | Dashboard: Prompts · Citations (+ gap list) · Settings | — |
| 22 | Recommendations with assets; **Start managed AEO** button → contract + Razorpay + Delivery queue | Approve the recommendation card and the managed-AEO flow copy. |
| 23 | Reports: daily digest + weekly trend (email + dashboard); Resend; Client Reporting agent narrative lines | Read one weekly report as a client. |
| 24 | Monthly PDF (Playwright); Impact tab (GA4 referrers by engine) | Connect TGL's GA4. |
| 25 | Alerts: thresholds, hallucination/competitor-overtake detection; WhatsApp via GHL; **human-voice templates** signed "your TrueVisible team" | Approve alert copy; set thresholds. |
| 26 | Billing: Razorpay subscriptions (INR+GST / USD no GST), trial logic (14d, 10 prompts, no card), paywall, invoices | Test a trial → paid conversion with a test card. |
| 27 | Agency data model (`agency_id`, white_label, billing_owner, consolidated invoice logic) — no UI | Approve. |
| 28 | Execution paths: platform detection; WordPress via MCP; Shopify/Webflow API adapters v1; change-pack generator + tracker | Approve the change-pack format. |
| 29 | AEO Strategist + Implementer (one agent): 90-day plan from audit; executes on TGL's site first | Approve TGL's own 90-day plan; grant GBP access. |
| 30 | Competitor Intelligence: per-prompt citing sources, monthly refresh, gap list | Review TGL's gap list. |
| 31 | Customer Success v1: 7/30/60 check-ins, health score, churn flag; Trial Concierge for TrueVisible sign-ups | Approve copy. |
| 32 | Compliance: TrueVisible terms + privacy, managed-AEO contract, DPDP note, LUT filing checklist, comparison-page review rules | Read the contract and terms once. |
| 33 | Load test: TGL + 3 dummy tenants through signup → trial → audit → dashboard → managed AEO → invoice | **Gate 2:** a stranger signs up, gets the day-1 audit, sees the dashboard, and you can upsell them to managed AEO without touching anything. |

## Phase 3 — Marketing engine, umbrella site, Mission Control (Days 34–46)
| Day | Build | Your hour |
|---|---|---|
| 34 | Content Writer + Editor SKILL.md (voice.md, pillars per door) | Approve; record 3 voice notes. |
| 35 | Writer + Editor workers; first 2 AEO posts | Edit post 1. |
| 36 | Repurposer/Publisher: WordPress REST + schema + featured image; Buffer scheduling | Connect Buffer; approve post 1 + derivatives. |
| 37 | Homepage rebuilt as the umbrella; BRAND-BRIEF §1/§2/§7 rewritten; `/truevisible` product page with trial CTA; comparison page (dated, verified) | Approve homepage + comparison copy. |
| 38 | `/ai` draft; `/coaching` moved under TrueLead; `/truelead` waitlist | Approve. |
| 39 | Creative Director cold review of homepage, `/truevisible`, `/aeo`; fixes | Decide what it escalates. |
| 40 | Ads Analyst + Creative Producer: Meta campaign → TrueVisible trial; ₹400/day | Approve creatives; set budget. |
| 41–43 | **Mission Control**: doors, pipelines, standup/SLA per agent, run costs + cost per brand, cash/invoices, approvals, alert feed | Use it for three mornings; list what's missing. |
| 44 | Community agent: LinkedIn/Reddit/Quora monitoring, reply drafts | Approve 5 replies. |
| 45 | People Ops: skill-file audit; first performance record | Read the audit summary. |
| 46 | Review | **Gate 3:** 4 posts/week; homepage + product page live; first ad-sourced trial; Mission Control is your morning screen. |

## Phase 4 — TrueLead + TGL AI doors (Days 47–58)
| Day | Build | Your hour |
|---|---|---|
| 47 | Product QA runs the TrueLead 5-step gate from a fresh account | Fix list → your sprint backlog. |
| 48–50 | TrueLead Trial Concierge; TrueLead door growth plan | Approve. |
| 51 | Gate run #2 → waitlist becomes trial if pass | Decide. |
| 52–54 | AI Readiness Audit engine + `/ai` live + TGL AI growth plan + demo flow | Approve plan and audit questions. |
| 55 | Upsell Proposal Builder across doors | Approve. |
| 56 | Video Team final → placed; stand-in retired | Sign off. |
| 57 | Second Meta campaign (readier door) | Approve. |
| 58 | Review | **Gate 4:** three doors live, each with pipeline + scorecard line. |

## Phase 5 — Hardening (Days 59–68)
| Day | Build | Your hour |
|---|---|---|
| 59–62 | Security (secrets rotation, RLS audit, token scopes), monitoring, backups | Approve rotation. |
| 63–65 | People Ops monthly review; bench/retire decisions | One decision per flagged agent. |
| 66–67 | Finance monthly close; cost per brand vs price; agency-plan go/no-go on the ₹600 number | Read the pack; set prices. |
| 68 | 90-day door reviews scheduled; handover doc | **Gate 5:** a week where your only input is the 18:00 thread. |

---
Tools & APIs: unchanged from v1 of this plan, plus Razorpay subscriptions (INR/USD), Playwright for AI Overviews/Copilot, Resend, and Vercel for the TrueVisible app. Run-rate at full roster ₹50–90K/month; cost per brand per month is the number Finance guards.

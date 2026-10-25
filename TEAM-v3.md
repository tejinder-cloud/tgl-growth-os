# TGL Agent Team v3 — Three doors, one mechanism
**20 October 2026 · Supersedes the Phase 1 roster and the "TGL Visible" blueprint's team plan. AGENTS.md still governs every agent.**

## What changed in the company
The Growth Lab is now an umbrella with three product-led doors, each running the same motion — free audit → 24-hour report → upsell:
- **TGL AEO** — live first (AI-visibility audit → retainer)
- **TGL AI** — second (AI-readiness audit → scoped automation build), with its own growth plan
- **TrueLead** — when self-serve ships (lead-score trial → plan → done-for-you lead gen; agency lead-gen services exist only here, as the upsell)

Broad audience, narrow offer per door. One site, one design system, one charter.

## The TrueLead MVP gate (ship target: 4 November 2026)
"MVP" means a stranger can complete this without anyone at TGL touching it (per `products/truelead/SPEC-v0.md`):
1. **Agency connects Meta Lead Ads** (one authorisation) or uploads a CSV. Leads land in the TrueLead inbox under the client (brand). Historical CSV import → first Lead Accountability report within 15 minutes.
2. **Callers work inside TrueLead.** Mobile-first lead card: tap-to-call, outcome in two taps (unreachable · not interested · interested · follow-up · converted), optional remark, next follow-up date. New lead → WhatsApp ping to the assigned caller with the card link. Assignment: round-robin or manual.
3. **Outcomes → Meta daily** via CAPI quality events (Navkiran SOP), per brand's pixel/dataset. No GHL in the pipeline.
4. **Dashboard, two audiences, one data set.** Per lead: campaign, ad set, creative, cost (left) × time-to-first-call, attempts, outcome, remark (right). Views: Overview (funnel, time-to-call, outcome mix, by campaign/creative), Leads (the inbox), Callers (per-caller activity), Export (Sheet / CSV). Logins: agency owner, account manager, performance marketer; client owner, callers, sales head. Client sees only its brand.
5. **Monday email** to agency owner and client owner: the week's accountability numbers + link. **14-day trial → ₹2,999/month per brand** (+18% GST). Included in TGL retainers.

Gate metrics (Product QA runs these; the Architect does not decide by feel):
- **Adoption:** at the first real client, by end of week 2, ≥70% of leads have an outcome logged within 48h. Below → add sheet-import path and investigate before any other feature.
- **Time to first report:** < 15 min from CSV upload.
- **Time to first call** shown correctly for every lead (the number the owner will quote).
- **CAPI delivery:** ≥95% of outcomes acknowledged by Meta within 24h.
- **Trial → paid target:** 10% (agencies see their own data; higher than TrueVisible's 5–8%).

Until all five pass end-to-end from a fresh account, the TrueLead door on the site is a **waitlist**, not a trial. A QA agent runs the five steps weekly from a clean account and posts pass/fail to #truelead.

---

## The roster — what's new, what's changed, what's gone

### New agents (the audit engines are the product-led doors)
| Agent | Door | Job | Trigger |
|---|---|---|---|
| **AEO Audit Engine** | AEO | Takes business, site, competitors, 10 prompts → runs ChatGPT / Perplexity / Gemini / Copilot → scores presence, position, sentiment, cited sources → renders paper-and-ink PDF → GHL emails it | Form submit; SLA 24h, target 2h |
| **AI Readiness Audit** | AI | Intake questionnaire + site/stack scan → scores automation opportunity by function (enquiries, follow-up, reporting, fee collection, ops) → PDF with three scoped build candidates and ranges | Form submit; SLA 24h |
| **Trial Concierge** | TrueLead | Watches sign-ups; sends the onboarding WhatsApp/email sequence; flags stuck accounts (connected but no leads, scored but never opened); hands "ready to upsell" accounts to the Architect | Sign-up / inactivity events |
| **Product QA** | TrueLead | Runs the 5-step MVP gate weekly from a fresh account; files bugs as GitHub issues with repro | Weekly + on every deploy |
| **Chief of Staff** | All | Pulled forward from Phase 2 to now: one Monday scorecard across three doors (audits requested, delivered on time, calls, proposals, revenue, cost per audit), pending approvals, the 90-day kill/keep view | Monday 07:00 |
| **Door Lead × 3** (AEO, AI, TrueLead) | Each | Owns that door's growth plan, backlog and scorecard line; writes the weekly one-paragraph status; first reviewer of its content and pages | Continuous |

### Changed agents
| Agent | What changes |
|---|---|
| **Web Builder / Creative Director** | Unchanged in role. New pages: homepage as umbrella, `/aeo`, `/ai`, `/truelead` (waitlist → trial), audit forms, report templates. `/coaching` becomes a vertical page under TrueLead. |
| **Content Writer / Editor / Repurposer / Publisher** | Pillars become doors: AEO (2 posts/wk — the hot market), TGL AI (1/wk), TrueLead/lead quality (1/wk). Each post carries its door's audit CTA. |
| **Prospect Researcher / Outreach Sequencer** | Lists per door, not per vertical: AEO → any business with a brand people ask AI about (hospitality, healthcare, education, D2C, professional services); AI → SMEs with manual ops and 10–200 staff; TrueLead → anyone running Meta lead ads. |
| **Ads Analyst / Creative Producer** | One campaign per door, each driving its audit; cost per audit is the metric, not cost per lead. |
| **Pipeline Watcher** | Three GHL pipelines (one per door), three SLAs; the Roadmap pipeline becomes the TrueLead upsell pipeline. |
| **Roadmap Builder** | Becomes **Upsell Proposal Builder**: turns any audit report + call notes into the proposal for that door. |
| **SEO/AEO Monitor + GEO Citation Tracker** | Merge into the AEO Audit Engine — same code, pointed at TGL itself monthly. |
| **Lead Scoring Agent (client delivery)** | Absorbed into TrueLead the product. |
| **Video Team** | Script changes: the film is now "what happens to one lead" told door-agnostically, closing on the three doors; same objects, same system. |

### Deferred
Competitor Watch, Retention Sentinel, Client Reporting, Digital PR — valid, but not before each door has paying customers.

---

## Humans
- **Tejinder:** Architect across doors; *builder of TrueLead for 15 days* — which means the AEO and AI doors must be agent-built with Rahul executing, or they slip. Decision rights unchanged.
- **Rahul:** Meta ads per door + GHL pipelines/forms for all three + first-line on audit delivery QA. This is more than one person's week once two doors are live; the first human hire conversation moves from "Account Manager" to "**Audit & Delivery Coordinator**" — someone who owns report turnaround and client communication across doors.
- **Honest capacity note:** three doors, one founder building a product, one ops person. The sequence below exists so no two doors launch in the same week.

## Sequence (next 30 days)
| Days | AEO | AI | TrueLead |
|---|---|---|---|
| 1–7 | Audit engine built + tested on 5 real businesses · `/aeo` page · retainer tiers · GHL pipeline | — | MVP build (Tejinder) · waitlist page |
| 8–14 | Door live · first outreach list (100) · 2 posts | Readiness audit spec + intake · `/ai` page draft | MVP build · Product QA agent set up |
| 15–21 | First audits delivered · first calls | Door live · growth plan published | MVP gate run #1 |
| 22–30 | First retainer proposals | First readiness audits | Gate passes → waitlist becomes trial · Trial Concierge live |

## Repo changes
`config/doors/{aeo,ai,truelead}.yaml` (each: ICP, audit spec, SLA, pipeline id, pillar, scorecard lines) · `agents/aeo-audit-engine/`, `agents/ai-readiness-audit/`, `agents/trial-concierge/`, `agents/product-qa/`, `agents/chief-of-staff/` · `site/pages/{home,aeo,ai,truelead}.md` rewritten · `design-system/BRAND-BRIEF.md` §1, §2, §7 rewritten · `plans/tgl-ai-growth-plan.md`, `plans/aeo-growth-plan.md`, `plans/truelead-growth-plan.md`.

## The 90-day rule
Each door's scorecard line is reviewed on day 90 from its launch. No paying customer by then → the door pauses and its agents are reassigned. Written here so it's a rule, not a mood.

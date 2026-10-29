import fs from "node:fs";
import path from "node:path";
import { stringify } from "yaml";

export interface PlanEntry {
  day: number;
  date: string;
  agent: string;
  door: string;
  title: string;
  brief: string;
  definition_of_done: string[];
  depends_on: number[];
  architect_hour: string;
}

// Generate working days starting from 2026-10-30
function getWorkingDays(startDateStr: string, totalCount: number): string[] {
  const dates: string[] = [];
  const cur = new Date(startDateStr);
  while (dates.length < totalCount) {
    const dayOfWeek = cur.getDay(); // 0 is Sun, 6 is Sat
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(cur.toISOString().split("T")[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

const workingDates = getWorkingDays("2026-10-30", 61); // Days 8 through 68 = 61 working days
const getDate = (dayNum: number): string => workingDates[dayNum - 8];

export const PLAN_ENTRIES: PlanEntry[] = [
  // Phase 1 — Revenue pod + audit engine (Days 8–15)
  {
    day: 8,
    date: getDate(8),
    agent: "aeo-audit-engine",
    door: "aeo",
    title: "AEO Audit Engine SKILL.md + short-form engine",
    brief: "AEO Audit Engine SKILL.md + short-form engine (5 prompts × 3 engines, one-page PDF) — this is also TrueVisible's trial engine.",
    definition_of_done: [
      "agents/aeo-audit-engine/SKILL.md created following 11-section standard",
      "Short-form engine evaluates 5 prompts across Perplexity, Gemini, ChatGPT",
      "1-page paper-and-ink branded PDF generated with under 2MB size",
    ],
    depends_on: [],
    architect_hour: "Approve prompt rules; review 3 one-pagers (yours + 2 prospects).",
  },
  {
    day: 9,
    date: getDate(9),
    agent: "aeo-audit-engine",
    door: "aeo",
    title: "Full engine: 10 prompts × 5 engines + 6-page PDF",
    brief: "Full engine: 10 prompts × 5 engines (AI Overviews + Copilot via Playwright), sentiment, hallucination detection, competitor citations, 6-page PDF; Supabase runs/answers/citations.",
    definition_of_done: [
      "10 prompts × 5 engines (including Google AI Overviews & Copilot via Playwright)",
      "Sentiment and hallucination detection algorithms implemented",
      "Supabase schema stores runs, answers, citations",
      "6-page PDF generated with complete citation audit",
    ],
    depends_on: [8],
    architect_hour: "Review TGL's full audit — our baseline, 0% expected.",
  },
  {
    day: 10,
    date: getDate(10),
    agent: "outreach-sequencer",
    door: "aeo",
    title: "Outreach Sequencer SKILL.md + 5-touch worker",
    brief: "Outreach Sequencer SKILL.md + worker: 5-touch via GrowthLab Engine + GHL; one-pager attached to touch 2; replies → Sales Desk.",
    definition_of_done: [
      "agents/outreach-sequencer/SKILL.md created following standard",
      "5-touch sequence automated through GHL API",
      "One-pager audit dynamically attached to touch 2",
      "Prospect reply webhook routes intent to Sales Desk",
    ],
    depends_on: [8],
    architect_hour: "Edit the five templates; connect LinkedIn in GrowthLab Engine.",
  },
  {
    day: 11,
    date: getDate(11),
    agent: "web-builder",
    door: "aeo",
    title: "/aeo landing page + audit form + GHL pipeline",
    brief: "/aeo page + audit form + GHL 'AEO' pipeline + WhatsApp alert templates.",
    definition_of_done: [
      "/aeo responsive page built with paper-and-ink visual system",
      "Interactive audit request form writes lead to GHL AEO pipeline",
      "WhatsApp alert templates submitted and tested",
    ],
    depends_on: [8],
    architect_hour: "Approve copy; submit templates.",
  },
  {
    day: 12,
    date: getDate(12),
    agent: "sales-desk",
    door: "aeo",
    title: "Sales Desk SKILL.md + worker + proposal template",
    brief: "Sales Desk SKILL.md + worker: dossier, calendar, proposal in 4h, follow-up cadence; proposal template.",
    definition_of_done: [
      "agents/sales-desk/SKILL.md created following standard",
      "Pre-call prospect dossier compiled automatically from Places + Meta Ads + Audit",
      "Automated proposal generator outputs custom proposal within 4 hours",
      "Follow-up cadence registered in GHL",
    ],
    depends_on: [10],
    architect_hour: "Approve proposal template (prices from SPEC §2).",
  },
  {
    day: 13,
    date: getDate(13),
    agent: "finance",
    door: "core",
    title: "Finance SKILL.md + v1: GST invoices & ledger",
    brief: "Finance SKILL.md + v1: Razorpay/Zoho GST invoice on Won; collections cadence; finance/ledger; LUT task to Compliance.",
    definition_of_done: [
      "agents/finance/SKILL.md created following standard",
      "Razorpay/Zoho GST-compliant invoice webhook automated upon deal Won",
      "finance/ledger tracks all income and per-audit API expenses",
      "LUT export compliance task checklist delivered",
    ],
    depends_on: [],
    architect_hour: "Create Razorpay; set founder salary line and reserve account.",
  },
  {
    day: 14,
    date: getDate(14),
    agent: "outreach-sequencer",
    door: "aeo",
    title: "Outreach live: 25/day + Delivery QA",
    brief: "Outreach live: 25/day; Delivery QA on every one-pager.",
    definition_of_done: [
      "25 outbound personalized touches sent per day",
      "Delivery QA checks every audit PDF before sending",
      "Zero ungrounded or unverifiable claims in dispatched emails",
    ],
    depends_on: [10, 11, 12, 13],
    architect_hour: "Watch the first 10 go out; reply to first replies (Sales Desk drafts).",
  },
  {
    day: 15,
    date: getDate(15),
    agent: "chief-of-staff",
    door: "core",
    title: "Gate 1 Review & Cross-Door Scorecard v1",
    brief: "Review; scorecard v1. Gate 1 verification: 100 prospects, ≥50 touched, ≥5 audits delivered, 0 QA failures.",
    definition_of_done: [
      "Cross-door scorecard compiled with live metrics",
      "Gate 1 verified: 100 prospects, >=50 touched, >=5 audits delivered, 0 QA failures",
      "Decision recorded and standup summary posted",
    ],
    depends_on: [14],
    architect_hour: "Gate 1: 100 prospects, ≥50 touched, ≥5 audits delivered, 0 QA failures.",
  },

  // Phase 2 — TrueVisible v1 + AEO delivery (Days 16–33)
  {
    day: 16,
    date: getDate(16),
    agent: "web-builder",
    door: "aeo",
    title: "Supabase schema per SPEC §11 with RLS & usage_costs",
    brief: "Supabase schema per SPEC §11, RLS by tenant; usage_costs from day one.",
    definition_of_done: [
      "Supabase migrations created for tenants, runs, answers, citations",
      "Row-level security (RLS) configured and verified per tenant",
      "usage_costs table created for token and API attribution",
    ],
    depends_on: [15],
    architect_hour: "Install Claude Code + gstack on the Mac for engineering sessions (git clone gstack → ./setup). Approve schema (5-line explainer).",
  },
  {
    day: 17,
    date: getDate(17),
    agent: "aeo-audit-engine",
    door: "aeo",
    title: "Citation Tracker: daily runs per brand",
    brief: "Citation Tracker: daily runs per brand → runs/answers/citations; TGL = tenant zero; cost per brand logged.",
    definition_of_done: [
      "Daily automated citation run scheduler deployed",
      "TGL configured as tenant zero with 10 seed prompts",
      "Cost per brand tracked and logged in Supabase usage_costs",
    ],
    depends_on: [16],
    architect_hour: "Add TGL's 10 prompts (I draft).",
  },
  {
    day: 18,
    date: getDate(18),
    agent: "web-builder",
    door: "aeo",
    title: "Auth + onboarding wizard (3 steps) in paper-and-ink",
    brief: "Auth + onboarding wizard (3 steps, platform question, language) in paper-and-ink.",
    definition_of_done: [
      "Supabase auth login/signup flow implemented",
      "3-step onboarding wizard styled with paper-and-ink visual system",
      "Platform and language preferences saved to tenant profile",
    ],
    depends_on: [16],
    architect_hour: "Walk the wizard on your phone; list what confuses you.",
  },
  {
    day: 19,
    date: getDate(19),
    agent: "aeo-strategist",
    door: "aeo",
    title: "Setup-verification queue",
    brief: "Setup-verification queue: agent proposes category/competitors/prompts → human confirm within 24h.",
    definition_of_done: [
      "Agent automated prompt/competitor recommendation pipeline",
      "Verification queue card posted to Slack #approvals for new tenants",
      "Tenant state advances upon human confirmation",
    ],
    depends_on: [18],
    architect_hour: "Verify the first 3 setups yourself.",
  },
  {
    day: 20,
    date: getDate(20),
    agent: "web-builder",
    door: "aeo",
    title: "TrueVisible Dashboard: Overview tab",
    brief: "Dashboard: Overview (meter, over-time by engine, sentiment, SoV, citations, hallucinations panel).",
    definition_of_done: [
      "Visibility score meter component rendered with brand tokens",
      "Engine breakdown chart over time (Perplexity, ChatGPT, Gemini, etc.)",
      "Share of Voice and hallucinations detection panel integrated",
    ],
    depends_on: [17, 18],
    architect_hour: "Click through; five confusions.",
  },
  {
    day: 21,
    date: getDate(21),
    agent: "web-builder",
    door: "aeo",
    title: "TrueVisible Dashboard: Prompts, Citations & Settings tabs",
    brief: "Dashboard: Prompts · Citations (+ gap list) · Settings.",
    definition_of_done: [
      "Prompts management table with win/loss indicators",
      "Citations list with competitor gap highlight view",
      "Settings tab for brand domain, webhook endpoints, and team invites",
    ],
    depends_on: [20],
    architect_hour: "Review Prompts and Citations tabs.",
  },
  {
    day: 22,
    date: getDate(22),
    agent: "web-builder",
    door: "aeo",
    title: "Recommendations with assets + Start managed AEO button",
    brief: "Recommendations with assets; Start managed AEO button → contract + Razorpay + Delivery queue.",
    definition_of_done: [
      "Actionable prompt recommendations displayed with downloadable assets",
      "'Start Managed AEO' CTA triggers contract generation and payment link",
      "Payment completion automatically routes to Delivery queue in GHL",
    ],
    depends_on: [21],
    architect_hour: "Approve the recommendation card and the managed-AEO flow copy.",
  },
  {
    day: 23,
    date: getDate(23),
    agent: "outreach-sequencer",
    door: "aeo",
    title: "Automated client reports (email + dashboard via Resend)",
    brief: "Reports: daily digest + weekly trend (email + dashboard); Resend; Client Reporting agent narrative lines.",
    definition_of_done: [
      "Daily email digest template built and connected to Resend",
      "Weekly trend analysis narrative generated from citation changes",
      "Client dashboard exports weekly report automatically",
    ],
    depends_on: [21],
    architect_hour: "Read one weekly report as a client.",
  },
  {
    day: 24,
    date: getDate(24),
    agent: "web-builder",
    door: "aeo",
    title: "Monthly PDF generator via Playwright + GA4 Impact tab",
    brief: "Monthly PDF (Playwright); Impact tab (GA4 referrers by engine).",
    definition_of_done: [
      "Playwright automated headless PDF report generator",
      "GA4 OAuth connection pulling AI referrers (perplexity.ai, chatgpt.com)",
      "Impact tab showing conversions attributed to AI search engines",
    ],
    depends_on: [23],
    architect_hour: "Connect TGL's GA4.",
  },
  {
    day: 25,
    date: getDate(25),
    agent: "chief-of-staff",
    door: "aeo",
    title: "Alerts engine (hallucination & competitor overtake) + WhatsApp",
    brief: "Alerts: thresholds, hallucination/competitor-overtake detection; WhatsApp via GHL; human-voice templates signed 'your TrueVisible team'.",
    definition_of_done: [
      "Hallucination detection alert triggers when false claims appear in answers",
      "Competitor overtake alert triggers on SoV rank shifts",
      "WhatsApp notification sent through GHL API using approved templates",
    ],
    depends_on: [17],
    architect_hour: "Approve alert copy; set thresholds.",
  },
  {
    day: 26,
    date: getDate(26),
    agent: "finance",
    door: "aeo",
    title: "Billing engine: Razorpay subscriptions, trials, invoices",
    brief: "Billing: Razorpay subscriptions (INR+GST / USD no GST), trial logic (14d, 10 prompts, no card), paywall, invoices.",
    definition_of_done: [
      "14-day free trial engine with 10 prompt cap enforced",
      "Razorpay recurring subscription webhook handler for INR and USD",
      "Automatic tax invoice PDF generated and emailed upon payment",
    ],
    depends_on: [13, 18],
    architect_hour: "Test a trial → paid conversion with a test card.",
  },
  {
    day: 27,
    date: getDate(27),
    agent: "web-builder",
    door: "aeo",
    title: "Agency multi-tenant data model",
    brief: "Agency data model (agency_id, white_label, billing_owner, consolidated invoice logic) — no UI.",
    definition_of_done: [
      "agency_id column and foreign keys across client records",
      "White label branding domain and logo mapping in Supabase",
      "Consolidated multi-account invoicing logic for agency partners",
    ],
    depends_on: [26],
    architect_hour: "Approve agency data model architecture.",
  },
  {
    day: 28,
    date: getDate(28),
    agent: "web-builder",
    door: "aeo",
    title: "Execution paths: WordPress via MCP, Shopify/Webflow adapters",
    brief: "Execution paths: platform detection; WordPress via MCP; Shopify/Webflow API adapters v1; change-pack generator + tracker.",
    definition_of_done: [
      "CMS platform auto-detection from domain headers/HTML",
      "WordPress Easy MCP AI adapter for publishing schema and FAQs",
      "Change-pack generator producing downloadable code diffs for developers",
    ],
    depends_on: [22],
    architect_hour: "Approve the change-pack format.",
  },
  {
    day: 29,
    date: getDate(29),
    agent: "aeo-strategist",
    door: "aeo",
    title: "AEO Strategist + Implementer: 90-day execution on TGL site",
    brief: "AEO Strategist + Implementer (one agent): 90-day plan from audit; executes on TGL's site first.",
    definition_of_done: [
      "90-day strategic AEO roadmap compiled for TGL client zero",
      "Schema markup and FAQ entities deployed to TGL website",
      "GBP optimization suggestions executed",
    ],
    depends_on: [9, 28],
    architect_hour: "Approve TGL's own 90-day plan; grant GBP access.",
  },
  {
    day: 30,
    date: getDate(30),
    agent: "aeo-strategist",
    door: "aeo",
    title: "Competitor Intelligence: citing sources & monthly refresh",
    brief: "Competitor Intelligence: per-prompt citing sources, monthly refresh, gap list.",
    definition_of_done: [
      "Competitor citing source extraction pipeline operational",
      "Monthly automated competitor refresh schedule registered",
      "Target gap list delivered to AEO Strategist",
    ],
    depends_on: [29],
    architect_hour: "Review TGL's gap list.",
  },
  {
    day: 31,
    date: getDate(31),
    agent: "sales-desk",
    door: "aeo",
    title: "Customer Success v1 + Trial Concierge",
    brief: "Customer Success v1: 7/30/60 check-ins, health score, churn flag; Trial Concierge for TrueVisible sign-ups.",
    definition_of_done: [
      "Automated 7/30/60 day check-in sequence configured in GHL",
      "Account health score calculated from dashboard logins and audit activity",
      "Trial Concierge welcoming bot responding to onboarding queries",
    ],
    depends_on: [26, 30],
    architect_hour: "Approve customer success copy and cadences.",
  },
  {
    day: 32,
    date: getDate(32),
    agent: "chief-of-staff",
    door: "core",
    title: "Compliance audit & legal contracts pack",
    brief: "Compliance: TrueVisible terms + privacy, managed-AEO contract, DPDP note, LUT filing checklist, comparison-page review rules; /cso security audit of TrueVisible before first paying customer.",
    definition_of_done: [
      "Terms of Service & Privacy Policy published on site",
      "Managed AEO client contract template finalized",
      "DPDP compliance documentation verified for audit data",
      "Security audit checklist passed with zero high-risk findings",
    ],
    depends_on: [26],
    architect_hour: "Read the contract and terms once.",
  },
  {
    day: 33,
    date: getDate(33),
    agent: "chief-of-staff",
    door: "core",
    title: "Gate 2 Load Test: TGL + 3 dummy tenants",
    brief: "Load test: TGL + 3 dummy tenants through signup → trial → audit → dashboard → managed AEO → invoice. Gate 2.",
    definition_of_done: [
      "End-to-end load test passes from signup to invoice generation",
      "Gate 2 verified: stranger signs up, gets day-1 audit, views dashboard, and upgrades",
      "Zero manual intervention required during test cycle",
    ],
    depends_on: [31, 32],
    architect_hour: "Gate 2: a stranger signs up, gets the day-1 audit, sees the dashboard, and you can upsell them to managed AEO without touching anything.",
  },

  // Phase 3 — Marketing engine, umbrella site, Mission Control (Days 34–46)
  {
    day: 34,
    date: getDate(34),
    agent: "content-writer",
    door: "core",
    title: "Content Writer + Editor SKILL.md",
    brief: "Content Writer + Editor SKILL.md (voice.md, pillars per door).",
    definition_of_done: [
      "agents/content-writer/SKILL.md created following 11-section standard",
      "voice.md guidelines synthesized from BRAND-BRIEF.md",
      "Editorial pillars defined for Door AEO, TrueLead, and TGL AI",
    ],
    depends_on: [33],
    architect_hour: "Approve; record 3 voice notes.",
  },
  {
    day: 35,
    date: getDate(35),
    agent: "content-writer",
    door: "aeo",
    title: "Writer + Editor workers & first 2 AEO posts",
    brief: "Writer + Editor workers; first 2 AEO posts.",
    definition_of_done: [
      "Content generation and peer editor review workers deployed",
      "First 2 long-form AEO case studies/posts drafted and approved",
      "Derivative social snippets (LinkedIn + X hooks) produced",
    ],
    depends_on: [34],
    architect_hour: "Edit post 1.",
  },
  {
    day: 36,
    date: getDate(36),
    agent: "repurposer-publisher",
    door: "marketing",
    title: "Repurposer/Publisher worker & social scheduling",
    brief: "Repurposer/Publisher: WordPress REST + schema + featured image; Buffer scheduling.",
    definition_of_done: [
      "WordPress REST API integration for automated draft publishing",
      "Article schema and featured image generator operational",
      "Buffer scheduling integration queueing social derivatives",
    ],
    depends_on: [35],
    architect_hour: "Connect Buffer; approve post 1 + derivatives.",
  },
  {
    day: 37,
    date: getDate(37),
    agent: "web-builder",
    door: "core",
    title: "Homepage rebuilt as umbrella + /truevisible product page",
    brief: "Homepage rebuilt as the umbrella; BRAND-BRIEF §1/§2/§7 rewritten; /truevisible product page with trial CTA; comparison page (dated, verified).",
    definition_of_done: [
      "Homepage updated with umbrella positioning and paper-and-ink visual system",
      "/truevisible product page live with interactive trial CTA",
      "Competitor comparison page published with dated, screenshot-verified claims",
    ],
    depends_on: [33],
    architect_hour: "Approve homepage + comparison copy.",
  },
  {
    day: 38,
    date: getDate(38),
    agent: "web-builder",
    door: "ai",
    title: "/ai draft + /coaching reorganization + /truelead waitlist",
    brief: "/ai draft; /coaching moved under TrueLead; /truelead waitlist.",
    definition_of_done: [
      "/ai solutions landing page drafted",
      "/coaching URL routing restructured under TrueLead domain hierarchy",
      "/truelead waitlist page deployed with lead capture",
    ],
    depends_on: [37],
    architect_hour: "Approve /ai copy and page layouts.",
  },
  {
    day: 39,
    date: getDate(39),
    agent: "creative-director",
    door: "core",
    title: "Creative Director cold review & token audit",
    brief: "Creative Director cold review of homepage, /truevisible, /aeo; fixes.",
    definition_of_done: [
      "Comprehensive design review across all live routes at 390px mobile view",
      "Token audit confirming Fraunces + DM Sans and print palette integrity",
      "PR opened with craft fixes and visual refinements",
    ],
    depends_on: [37, 38],
    architect_hour: "Decide what it escalates.",
  },
  {
    day: 40,
    date: getDate(40),
    agent: "sales-desk",
    door: "aeo",
    title: "Ads Analyst + Creative Producer: Meta campaign v1",
    brief: "Ads Analyst + Creative Producer: Meta campaign → TrueVisible trial; ₹400/day.",
    definition_of_done: [
      "Ad creative hooks and visual posters generated from paper-and-ink assets",
      "Meta campaign configured targeting coaching and surgical healthcare founders",
      "UTM tracking parameters mapped to GHL and GA4 conversions",
    ],
    depends_on: [37],
    architect_hour: "Approve creatives; set budget.",
  },
  {
    day: 41,
    date: getDate(41),
    agent: "web-builder",
    door: "core",
    title: "Mission Control v1: Doors, pipelines & standup SLA",
    brief: "Mission Control Part 1: doors, pipelines, standup/SLA per agent.",
    definition_of_done: [
      "Internal Mission Control dashboard scaffolding with role auth",
      "Active door cards showing pipeline counts and conversion metrics",
      "Standup compliance and agent SLA trackers live",
    ],
    depends_on: [33],
    architect_hour: "Use Mission Control morning screen; feedback.",
  },
  {
    day: 42,
    date: getDate(42),
    agent: "web-builder",
    door: "core",
    title: "Mission Control v2: Financials & run cost ledgers",
    brief: "Mission Control Part 2: run costs + cost per brand, cash/invoices.",
    definition_of_done: [
      "Real-time token cost and API expenditure ledger widget",
      "Cost per brand profitability breakdown",
      "Invoice status and cash collection dashboard",
    ],
    depends_on: [41],
    architect_hour: "Review financial ledger widget.",
  },
  {
    day: 43,
    date: getDate(43),
    agent: "web-builder",
    door: "core",
    title: "Mission Control v3: Approvals queue & alert feed",
    brief: "Mission Control Part 3: approvals, alert feed, integration.",
    definition_of_done: [
      "Interactive approvals queue mirroring Slack card actions",
      "System alerts feed with anomaly severity tagging",
      "Mobile-responsive dashboard view for tablet/phone",
    ],
    depends_on: [42],
    architect_hour: "Use it for three mornings; list what's missing.",
  },
  {
    day: 44,
    date: getDate(44),
    agent: "content-writer",
    door: "marketing",
    title: "Community monitoring agent: LinkedIn/Reddit/Quora",
    brief: "Community agent: LinkedIn/Reddit/Quora monitoring, reply drafts.",
    definition_of_done: [
      "Brand mention and keyword monitoring across Reddit and Quora",
      "Draft replies created with TGL authority voice and no promotional spam",
      "Buying signals alerted directly to Sales Desk channel",
    ],
    depends_on: [36],
    architect_hour: "Approve 5 replies.",
  },
  {
    day: 45,
    date: getDate(45),
    agent: "people-ops",
    door: "people",
    title: "People Ops: skill-file audit & performance records",
    brief: "People Ops: skill-file audit; first performance record.",
    definition_of_done: [
      "Audit of all agent SKILL.md files against 11-section standard",
      "First performance record calculating proposal acceptance rates",
      "Report delivered to Chief of Staff for standup",
    ],
    depends_on: [43],
    architect_hour: "Read the audit summary.",
  },
  {
    day: 46,
    date: getDate(46),
    agent: "chief-of-staff",
    door: "core",
    title: "Gate 3 Review: Marketing engine & Mission Control",
    brief: "Review. Gate 3 verification: 4 posts/week; homepage + product page live; first ad-sourced trial; Mission Control is morning screen.",
    definition_of_done: [
      "Gate 3 verified and approved by Architect",
      "Marketing publishing rhythm established at 4 posts/week",
      "Mission Control validated as operational morning command center",
    ],
    depends_on: [44, 45],
    architect_hour: "Gate 3: 4 posts/week; homepage + product page live; first ad-sourced trial; Mission Control is your morning screen.",
  },

  // Phase 4 — TrueLead + TGL AI doors (Days 47–58)
  {
    day: 47,
    date: getDate(47),
    agent: "web-builder",
    door: "truelead",
    title: "Product QA runs TrueLead 5-step gate from fresh account",
    brief: "Product QA runs the TrueLead 5-step gate from a fresh account.",
    definition_of_done: [
      "Automated test script executes 5-step TrueLead onboarding gate",
      "Lead scoring latency verified < 15 seconds",
      "Defect list categorized into sprint backlog",
    ],
    depends_on: [46],
    architect_hour: "Fix list → your sprint backlog.",
  },
  {
    day: 48,
    date: getDate(48),
    agent: "sales-desk",
    door: "truelead",
    title: "TrueLead Trial Concierge implementation",
    brief: "TrueLead Trial Concierge; TrueLead door growth plan (Part 1).",
    definition_of_done: [
      "Trial Concierge interactive onboarding logic deployed",
      "Automated qualification heuristics for coaching leads configured",
    ],
    depends_on: [47],
    architect_hour: "Review TrueLead onboarding copy.",
  },
  {
    day: 49,
    date: getDate(49),
    agent: "sales-desk",
    door: "truelead",
    title: "TrueLead Door growth plan execution",
    brief: "TrueLead Trial Concierge; TrueLead door growth plan (Part 2).",
    definition_of_done: [
      "Outbound prospect list targeted for coaching institutes",
      "Custom TrueLead demo flow initialized",
    ],
    depends_on: [48],
    architect_hour: "Approve TrueLead growth plan targets.",
  },
  {
    day: 50,
    date: getDate(50),
    agent: "sales-desk",
    door: "truelead",
    title: "TrueLead Door growth plan sign-off",
    brief: "TrueLead door growth plan sign-off (Part 3).",
    definition_of_done: [
      "TrueLead pricing and packaging validated with finance",
      "Sign-off recorded in decisions/",
    ],
    depends_on: [49],
    architect_hour: "Approve TrueLead door plan.",
  },
  {
    day: 51,
    date: getDate(51),
    agent: "chief-of-staff",
    door: "truelead",
    title: "Gate run #2: TrueLead waitlist becomes trial",
    brief: "Gate run #2 → waitlist becomes trial if pass.",
    definition_of_done: [
      "TrueLead 5-step gate passes with zero blockers",
      "Waitlist leads converted to active trial accounts",
      "Welcome sequences dispatched",
    ],
    depends_on: [50],
    architect_hour: "Decide on waitlist trial opening.",
  },
  {
    day: 52,
    date: getDate(52),
    agent: "web-builder",
    door: "ai",
    title: "AI Readiness Audit engine development",
    brief: "AI Readiness Audit engine + /ai live + TGL AI growth plan + demo flow (Part 1).",
    definition_of_done: [
      "Interactive AI readiness scoring assessment algorithm",
      "Three scoped automation build proposals generated dynamically",
    ],
    depends_on: [46],
    architect_hour: "Review AI readiness audit questions.",
  },
  {
    day: 53,
    date: getDate(53),
    agent: "web-builder",
    door: "ai",
    title: "/ai landing page deployment & demo flow",
    brief: "AI Readiness Audit engine + /ai live + TGL AI growth plan + demo flow (Part 2).",
    definition_of_done: [
      "/ai responsive landing page deployed with audit questionnaire",
      "Interactive demo flow showing automation architecture",
    ],
    depends_on: [52],
    architect_hour: "Walk through /ai demo flow.",
  },
  {
    day: 54,
    date: getDate(54),
    agent: "sales-desk",
    door: "ai",
    title: "TGL AI Growth Plan sign-off",
    brief: "AI Readiness Audit engine + /ai live + TGL AI growth plan + demo flow (Part 3).",
    definition_of_done: [
      "TGL AI sales pipeline and pricing packages configured in GHL",
      "Lead routing to Sales Desk finalized",
    ],
    depends_on: [53],
    architect_hour: "Approve plan and audit questions.",
  },
  {
    day: 55,
    date: getDate(55),
    agent: "sales-desk",
    door: "core",
    title: "Upsell Proposal Builder across doors",
    brief: "Upsell Proposal Builder across doors.",
    definition_of_done: [
      "Automated cross-door expansion recommendations engine",
      "Generates combined TrueVisible + TrueLead + AI retainer proposals",
    ],
    depends_on: [51, 54],
    architect_hour: "Approve cross-door pricing matrix.",
  },
  {
    day: 56,
    date: getDate(56),
    agent: "video-team",
    door: "marketing",
    title: "Video Team final delivery & hero integration",
    brief: "Video Team final → placed; stand-in retired.",
    definition_of_done: [
      "Explainer video finalized with approved voiceover",
      "Video placed in hero section with fast lazy-loading",
      "Animated mechanism stand-in gracefully retired",
    ],
    depends_on: [37],
    architect_hour: "Sign off on final explainer video.",
  },
  {
    day: 57,
    date: getDate(57),
    agent: "sales-desk",
    door: "marketing",
    title: "Second Meta Campaign launch for readier door",
    brief: "Second Meta campaign (readier door).",
    definition_of_done: [
      "Meta ad campaign deployed targeting TrueLead or AI door",
      "Daily spend and lead cost monitoring active",
    ],
    depends_on: [55],
    architect_hour: "Approve campaign targeting and budget.",
  },
  {
    day: 58,
    date: getDate(58),
    agent: "chief-of-staff",
    door: "core",
    title: "Gate 4 Review: Three doors live with pipelines",
    brief: "Review. Gate 4 verification: three doors live, each with pipeline + scorecard line.",
    definition_of_done: [
      "All three doors (AEO, TrueLead, TGL AI) verified live with active pipelines",
      "Gate 4 signed off in decisions/",
    ],
    depends_on: [56, 57],
    architect_hour: "Gate 4: three doors live, each with pipeline + scorecard line.",
  },

  // Phase 5 — Hardening (Days 59–68)
  {
    day: 59,
    date: getDate(59),
    agent: "web-builder",
    door: "core",
    title: "Security Hardening: Secrets rotation & RLS audit",
    brief: "Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 1).",
    definition_of_done: [
      "All API keys and secrets rotated with zero downtime",
      "PostgreSQL RLS audit completed with negative authorization tests",
    ],
    depends_on: [58],
    architect_hour: "Approve secrets rotation schedule.",
  },
  {
    day: 60,
    date: getDate(60),
    agent: "web-builder",
    door: "core",
    title: "Security Hardening: Token scopes & monitoring",
    brief: "Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 2).",
    definition_of_done: [
      "GitHub and Slack token scopes reduced to least privilege",
      "Monitoring dashboards and alert webhooks verified",
    ],
    depends_on: [59],
    architect_hour: "Review token permission scopes.",
  },
  {
    day: 61,
    date: getDate(61),
    agent: "web-builder",
    door: "core",
    title: "Security Hardening: Automated database backups",
    brief: "Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 3).",
    definition_of_done: [
      "Automated daily Supabase backup routine configured and tested",
      "Disaster recovery restore drill executed successfully",
    ],
    depends_on: [60],
    architect_hour: "Verify backup test output.",
  },
  {
    day: 62,
    date: getDate(62),
    agent: "chief-of-staff",
    door: "core",
    title: "Security & Infrastructure hardening sign-off",
    brief: "Security (secrets rotation, RLS audit, token scopes), monitoring, backups (Part 4).",
    definition_of_done: [
      "Final infrastructure security report signed off",
      "Zero open security vulnerabilities",
    ],
    depends_on: [61],
    architect_hour: "Approve security audit sign-off.",
  },
  {
    day: 63,
    date: getDate(63),
    agent: "people-ops",
    door: "people",
    title: "People Ops Monthly Review: Performance records",
    brief: "People Ops monthly review; bench/retire decisions (Part 1).",
    definition_of_done: [
      "Performance scorecards computed for all 12 active agents",
      "Proposal acceptance rates and error ratios analyzed",
    ],
    depends_on: [58],
    architect_hour: "Review agent performance rankings.",
  },
  {
    day: 64,
    date: getDate(64),
    agent: "people-ops",
    door: "people",
    title: "People Ops Monthly Review: Bench/retire decisions",
    brief: "People Ops monthly review; bench/retire decisions (Part 2).",
    definition_of_done: [
      "Recommendations for benching underperforming agents or upgrading skills",
      "Decisions card posted to Slack #approvals",
    ],
    depends_on: [63],
    architect_hour: "One decision per flagged agent.",
  },
  {
    day: 65,
    date: getDate(65),
    agent: "people-ops",
    door: "people",
    title: "People Ops Monthly Review: Founder-hours ledger",
    brief: "People Ops monthly review; founder-hours audit (Part 3).",
    definition_of_done: [
      "Founder-hours ledger audited against 1 hour/day target",
      "Operational friction points identified and automated",
    ],
    depends_on: [64],
    architect_hour: "Review founder-hours breakdown.",
  },
  {
    day: 66,
    date: getDate(66),
    agent: "finance",
    door: "finance",
    title: "Finance Monthly Close: Cost per brand vs price",
    brief: "Finance monthly close; cost per brand vs price; agency-plan go/no-go on the ₹600 number (Part 1).",
    definition_of_done: [
      "Unit economics calculated per client brand across LLM and proxy costs",
      "Cost per brand benchmarked against price points",
    ],
    depends_on: [58],
    architect_hour: "Read finance close pack.",
  },
  {
    day: 67,
    date: getDate(67),
    agent: "finance",
    door: "finance",
    title: "Finance Monthly Close: Agency plan go/no-go",
    brief: "Finance monthly close; cost per brand vs price; agency-plan go/no-go on the ₹600 number (Part 2).",
    definition_of_done: [
      "Financial go/no-go model finalized for agency white-label pricing",
      "Approval card posted to #approvals",
    ],
    depends_on: [66],
    architect_hour: "Set prices and sign off on agency plan.",
  },
  {
    day: 68,
    date: getDate(68),
    agent: "chief-of-staff",
    door: "core",
    title: "90-Day Door Reviews & Handover: Gate 5",
    brief: "90-day door reviews scheduled; handover doc. Gate 5: a week where your only input is the 18:00 thread.",
    definition_of_done: [
      "90-day door review schedules established across all active doors",
      "Comprehensive self-operating company handover documentation finalized",
      "Gate 5 verified: full operational autonomy achieved",
    ],
    depends_on: [62, 65, 67],
    architect_hour: "Gate 5: a week where your only input is the 18:00 thread.",
  },
];

/**
 * Renders PROJECT-PLAN.md from plan entries.
 */
export function renderProjectPlanMarkdown(entries: PlanEntry[]): string {
  const phase1 = entries.filter((e) => e.day >= 8 && e.day <= 15);
  const phase2 = entries.filter((e) => e.day >= 16 && e.day <= 33);
  const phase3 = entries.filter((e) => e.day >= 34 && e.day <= 46);
  const phase4 = entries.filter((e) => e.day >= 47 && e.day <= 58);
  const phase5 = entries.filter((e) => e.day >= 59 && e.day <= 68);

  const renderRows = (list: PlanEntry[]) =>
    list
      .map(
        (e) =>
          `| ${e.day} | ${e.date} | \`@${e.agent}\` | **${e.title}**: ${e.brief} | ${e.architect_hour} |`
      )
      .join("\n");

  return `# PROJECT PLAN v2 — Building The Growth Lab's agent company
**23 October 2026 · 68 working days · Architect time: one hour per working day (TrueLead MVP sprint separate, ~2h/day, days 1–10)**

"Build" = agents. "Your hour" = the only thing you do. Phase gates are hard.

> Generated autonomously from \`config/plan.yaml\`. Do not edit directly; edit \`config/plan.yaml\` or update via approved proposals.

---

## Phase 0 — Foundations & plumbing (Days 1–5)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 1 | 2026-10-23 | \`@web-builder\` | Repo restructure to ORG.md layout; skill-file template; \`config/doors/*.yaml\`; \`products/truevisible/\` folder | Create Slack workspace + channels, GitHub org and push repo, Railway project, Supabase project. Paste IDs to \`config/\`. |
| 2 | 2026-10-24 | \`@chief-of-staff\` | TGL Ops Slack bot (Block Kit, approve/reject); approval webhook on Railway → \`decisions/\` → next agent | Create Slack app; scopes; paste bot token to Railway secrets; approve the test message. |
| 3 | 2026-10-25 | \`@chief-of-staff\` | GitHub issue queue (\`for:\`, \`door:\` labels); Actions for logs/standup; \`@agent\` mention listener | API keys: Anthropic, OpenAI, Google AI, Perplexity → secrets. |
| 4 | 2026-10-26 | \`@chief-of-staff\` | Chief of Staff (skill file + worker): 18:00 digest, thread template, silence flag | Review skill file (10 min); watch the first 18:00 standup. |
| 5 | 2026-10-27 | \`@chief-of-staff\` | End-to-end test: Slack → issue → agent → PR → approval → \`decisions/\` | **Gate 0:** approve one task from your phone without opening a file. |

## Phase 1 — Revenue pod + audit engine (Days 6–15)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
| 6 | 2026-10-28 | \`@prospect-researcher\` | Prospect Researcher SKILL.md | Approve; create Google Places key, Apollo, Hunter accounts. |
| 7 | 2026-10-29 | \`@prospect-researcher\` | Prospect Researcher worker → Supabase \`prospects\` → GHL; first 100 names | Review 25; reject 5 with reasons (it learns). |
${renderRows(phase1)}

## Phase 2 — TrueVisible v1 + AEO delivery (Days 16–33)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
${renderRows(phase2)}

## Phase 3 — Marketing engine, umbrella site, Mission Control (Days 34–46)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
${renderRows(phase3)}

## Phase 4 — TrueLead + TGL AI doors (Days 47–58)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
${renderRows(phase4)}

## Phase 5 — Hardening (Days 59–68)
| Day | Date | Agent | Build | Your hour |
|---|---|---|---|---|
${renderRows(phase5)}

---
Tools & APIs: unchanged from v1 of this plan, plus Razorpay subscriptions (INR/USD), Playwright for AI Overviews/Copilot, Resend, and Vercel for the TrueVisible app. Run-rate at full roster ₹50–90K/month; cost per brand per month is the number Finance guards.
`;
}

export function executePlanGeneration(repoRoot: string): void {
  const planYamlPath = path.join(repoRoot, "config/plan.yaml");
  const projectPlanPath = path.join(repoRoot, "PROJECT-PLAN.md");

  const yamlContent = stringify({
    version: 1,
    generated_at: new Date().toISOString(),
    start_date: "2026-10-30",
    days_count: PLAN_ENTRIES.length,
    plan: PLAN_ENTRIES,
  });

  fs.writeFileSync(planYamlPath, yamlContent, "utf8");
  console.log(`[Plan Generator] Successfully wrote ${PLAN_ENTRIES.length} entries to ${planYamlPath}`);

  const markdownContent = renderProjectPlanMarkdown(PLAN_ENTRIES);
  fs.writeFileSync(projectPlanPath, markdownContent, "utf8");
  console.log(`[Plan Generator] Successfully updated ${projectPlanPath}`);
}

// Execute plan generation
const findRepoRoot = (): string => {
  let cur = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(cur, "config")) && fs.existsSync(path.join(cur, "PROJECT-PLAN.md"))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
};

const root = findRepoRoot();
executePlanGeneration(root);

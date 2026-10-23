# TrueVisible — Product Specification v1
**23 October 2026 · Owner: Architect · Builders: Web Builder (UI), AEO Audit Engine (data), Delivery pod (managed service) · Status: approved for build**

---

## 1. What it is
**TrueVisible** is AI-visibility software from The Growth Lab: it shows a business what ChatGPT, Gemini, Perplexity, Google AI Overviews and Copilot say about it, who gets cited instead, and what to do — and, on one button, has TGL do it.

- **Category line:** AI visibility for your brand — see what AI says about you, and fix it.
- **Family:** TrueLead (are my leads real?) · TrueVisible (does AI see me?). Both "by The Growth Lab".
- **Audience:** any business whose customers ask AI before buying, India first; and the marketing agencies that serve them.
- **The one-line difference from HubSpot AEO:** verified setup, more engines and languages, reports not just dashboards, and execution included — built for India, priced in rupees.

## 2. Plans and pricing (all prices exclusive of 18% GST in India; USD prices carry no GST — export of services under LUT, Compliance to file)

| Plan | Price | Includes |
|---|---|---|
| **Trial** | Free, 14 days, no card | 10 prompts, 3 engines (ChatGPT, Gemini, Perplexity), full audit report on day 1, dashboard, daily digest |
| **TrueVisible** | ₹3,999/mo · $49/mo | 50 prompts, 5 engines, daily runs, all reports, alerts, recommendations with assets, 1 brand |
| **Managed AEO** (upsell) | ₹9,999/mo (+ software) | TGL's Delivery pod plans and executes the whole programme monthly; 90-day plan; on-site + off-site; monthly review |
| **Agency** | ₹4,500/mo · 3 brand seats · ₹999 per extra seat | White-label dashboard and reports, agency's clients under agency's brand, Mission-Control-lite for the agency |
| **Agency's brands (wholesale)** | Seat included/₹999 · managed AEO ₹6,999 per brand (30% off list) | Billed to the agency only; agency resells at its own price |

Annual: 2 months free on software plans. Price shown everywhere with "+18% GST" for India.

## 3. Onboarding wizard (borrowed structure, our material)
Three steps, progress bar, "analysing…" states — rendered in paper-and-ink.
1. **Brand** — name + variations (auto-suggested), primary domain, extra domains, **site platform** (WordPress / Shopify / Webflow / Wix / Squarespace / custom / none) → decides the execution path.
2. **Competitors, products, ICP, location** — auto-suggested from the site, **then verified by the Setup agent within 24h** (human review in the first 90 days). The HubSpot failure mode (wrong category, wrong competitors) is explicitly the thing this step prevents. One product/ICP/location pair to start; add more after.
3. **Prompts** — generated per product × ICP × location × language; language selector: English, Hindi, Hinglish (v1); Punjabi, Tamil, Telugu, Marathi, Bengali (v2). City-level intent prompts included. Buyer-journey tag per prompt. 10 on trial, 50 on paid.
Then: first run (all prompts, all engines) → **Audit report emailed within 24h** → dashboard live.

## 4. Dashboard — information architecture
Tabs: **Overview · Prompts · Citations · Recommendations · Impact · Reports · Settings** (+ **Brands** on Agency).

**Overview:** visibility score (stamped meter), visibility over time per engine, sentiment, share of voice vs competitors, top citing domains/URLs with channel type, "what AI gets wrong about you" panel, open recommendations count, next report date.
**Prompts:** each prompt × engine: mentioned?, position, sentiment, competitors mentioned, answer text, history. Add/edit/retire prompts.
**Citations:** top domains, top URLs, content type, brand/competitor mentioned; **Citation gap list** — sources citing competitors but not you, each with an action.
**Recommendations:** prioritised (impact × ease), each with the asset attached (page draft, FAQ block, JSON-LD, `llms.txt`, GBP edits, directory list, Reddit/Quora thread list). Two actions per item: *Do it myself* (download the pack) · ***Start managed AEO*** (one button → retainer; no per-fix pricing).
**Impact:** GA4-linked AI-referred sessions and conversions by engine; retainer clients see actions → visibility movement.
**Reports:** daily digest, weekly trend, monthly PDF — all on dashboard and email. No WhatsApp for reports.
**Settings:** brand, competitors, prompts, languages, site platform, integrations (GA4, WordPress, GBP), billing, team, alerts.

## 5. Engines and cadence
v1: ChatGPT, Gemini, Perplexity, Google AI Overviews / AI Mode, Copilot (browser automation; flagged fragile). v2: Meta AI in WhatsApp (automation; validate before it appears in any comparison).
Daily runs of all prompts. Results, answer text and citations stored per run.

## 6. Alerts and communication voice
- **WhatsApp is for alerts only:** visibility drop beyond threshold, a hallucination detected, a competitor overtaking on a key prompt, a report ready (one line + link).
- **Voice:** every alert and every important message reads as one person writing to another — short, specific, the one thing to do next, no dashboard-speak. Signed *your TrueVisible team*. If asked whether it's a person: "an AI-assisted account team, with Tejinder's oversight." Never deceptive.
- Hallucination alert = the wrong claim, the correct fact, the page/schema to publish (attached), and whether managed AEO would do it this week.

## 7. Execution paths (set by site platform at onboarding)
- **Off-site (everyone, ~half of AEO):** Google Business Profile, directories and citations, Reddit/Quora presence, listicle outreach, press mentions — done by the Implementer regardless of platform.
- **WordPress:** direct implementation via the Easy MCP AI bridge (client installs the plugin; scoped token).
- **Shopify / Webflow / Wix / Squarespace:** via each platform's API where it permits pages, metadata and schema; remainder as a change pack.
- **Custom / none:** **change pack** — paste-ready JSON-LD, page copy, FAQ blocks, `llms.txt`, meta; a 30-minute developer handoff; tracked in the dashboard until the client marks it done.
Retainer price is identical across paths.

## 8. Managed AEO (the retainer)
On *Start managed AEO*: contract + first invoice (Razorpay, GST) → client enters the Delivery pod's queue → Strategist produces the 90-day plan within 48h → Implementer executes weekly → Citation Tracker measures → Client Reporting writes the monthly review. Same pod, same playbooks as client zero (thegrowthlab.co.in). Scope limits are written into the plan: prompts in scope, pages per month, outreach volume. Cancel any time after 90 days.

## 9. Agency plan (data model v1, UI v2) — wholesale, white-label only
- One agency account → many brands (seats). Agency branding on dashboard, reports, alerts and the monthly review (logo, colours, sender name). Brands see the agency, never TGL. The managed-AEO pod communicates *as the agency*.
- Agency-lite Mission Control: all brands' visibility, alerts, open recommendations, retainer status.
- **Billing (decided 23 Oct): the agency is TGL's customer; the brand is the agency's customer.** One consolidated monthly invoice to the agency: ₹4,500 (3 seats) + ₹999 per extra seat + ₹6,999 per brand on managed AEO, all + GST (agency claims ITC). The agency sets its own prices with its clients and keeps the margin. TGL never invoices or emails a white-label brand. No referral/direct-discount path in v1.
- Edge rules: brand leaves agency → may open a direct account, keeps agency pricing 90 days, then list. Agency stops paying → 15-day grace, then brands suspended and each offered a direct account. Brand data belongs to the brand; exportable on exit.
- Mechanics: Razorpay subscription per agency; seats prorated mid-month; managed-AEO brands as line items; invoice on the 1st; Finance reconciles agency revenue against cost per brand monthly (₹600 ceiling).
- Data model fields in v1: `agency_id` on brands, `white_label` settings (logo, colours, sender_name, reply_to), `billing_owner` on subscriptions (agency | brand). No agency UI until v2.

## 10. Mission Control (Architect's view, Phase 3)
Single internal screen: doors (trials, paid, retainers, MRR, churn), GHL pipelines, today's standup and SLA status per agent, agent run cost and **cost per brand per month**, cash and invoices due, open approvals, alert feed. Same stack as TrueVisible's admin view.

## 11. Data model (Supabase, RLS by `tenant_id`)
`tenants` (direct | agency | agency_client) · `brands` · `brand_variants` · `domains` · `competitors` · `products_icps` · `prompts` (language, journey_phase, status) · `runs` (date, engine) · `answers` (text, mentioned, position, sentiment) · `citations` (domain, url, channel_type, content_type, brand_mentioned, competitors_mentioned) · `hallucinations` · `recommendations` (priority, asset_refs, status) · `assets` · `actions` (implementer log) · `reports` (daily/weekly/monthly, url) · `alerts` · `integrations` · `subscriptions` (plan, price, currency, gst, referral_source) · `invoices` · `usage_costs` (per brand per day — the margin number).

## 12. Stack
Next.js on Vercel/Railway · Supabase (Auth, Postgres, RLS, Storage) · engine runners on Railway (OpenAI, Gemini, Perplexity APIs; Playwright for AI Overviews/Copilot) · Razorpay (INR + USD, GST invoices) · Resend (reports, digests) · WhatsApp via GHL (alerts) · Playwright (PDF) · Recharts in brand palette · Sentry, Better Stack.

## 13. v1 / v2 split
**v1 (launch):** trial, paid plan, 5 engines, EN/HI/Hinglish, daily runs, all reports, alerts, recommendations with assets, *Start managed AEO*, execution paths, GA4 impact, Razorpay billing with GST, agency data model.
**v2:** Agency UI + white-label, regional languages, Meta AI in WhatsApp, auto-implement for connected WordPress, automated listicle/directory outreach.

## 14. Metrics that decide if it's working
Trial → paid (target 5–8%) · paid → managed AEO (target 20% within 60 days) · cost per brand per month (must be < ₹600) · 30-day retention · time to first audit (< 24h, target 2h) · hallucinations fixed per client per month.

## 15. Plan delta
Phase 2 grows by 5 days (signup/billing/trial/change-pack path); Phase 3 by 3 (Mission Control). Revised plan: 68 working days. Client zero remains thegrowthlab.co.in — our own 0% → visible is the launch case study.

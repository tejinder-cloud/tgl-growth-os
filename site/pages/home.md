# Page spec - Home (/)
**Template:** page-landing with full header nav (Home · AEO · TrueVisible · AI Automation · About) and one header button · **Slug:** `/` (front page) · **Status on build:** draft (never published by the builder)
**Title tag:** AI visibility audits and AI agents for Indian businesses | The Growth Lab
**Meta:** Does ChatGPT recommend your business? The Growth Lab tracks what AI says about you, fixes it, and builds AI agents that follow up every lead. Free AI visibility audit.
**Primary CTA everywhere:** "Get your free AI visibility audit" -> `#audit` with `data-tgl-event="home_audit_cta_click"`
**Colour roles:** AEO content carries coral; AI Automation content carries teal; everything else ink on cream. Tokens from `design-system/tokens.json` only.
**Copy status:** FINAL once the Architect approves this file, except lines marked `[ARCHITECT TO CONFIRM]`, which render as "—" or are left out until filled.

## Rules for this page (from the sprint brief)
- No client names, logos, testimonials or prices anywhere on Home.
- Every number is live from the company service or the repo, or it renders "—". Nothing typed by hand.
- Every screenshot carries its capture date. Nothing in a screenshot shows a token, channel ID, email address or prospect name.
- One primary action per viewport at 390px.

## 1. home-hero - anchor `#audit`
- Eyebrow: DOES CHATGPT RECOMMEND YOUR BUSINESS?
- H1: We get businesses recommended by AI, and we run their busywork on AI agents — the same way we run our own company.
- Inline form (two fields, one button):
  - Field 1: Your website or business name
  - Field 2: WhatsApp number (10-digit Indian mobile, or +country code)
  - Button: See what AI says about you
  - Microline: Free. One-page audit, sent to your WhatsApp.
- Secondary text link under the form: See our agents at work -> `https://project.thegrowthlab.co.in` (`data-tgl-event="home_board_click"`)
- Form behaviour: posts to `POST /aeo/lead` with `source=home_hero`. Success state: "Received. We will message you on WhatsApp at this number." Never shows success unless the endpoint returns `ok: true`. Tracking `data-tgl-event="aeo_audit_submit"` on success only.
- **Builder check:** the /aeo spec requires name, institute, website, WhatsApp and email. The endpoint must accept this two-field version from `home_hero`; if it cannot, report it and stop rather than adding fields.
- Visual: none beyond type. The sentence is the hero.

## 2. home-shift - "The shift"
- Pill label: THE SHIFT
- H2: Your buyers used to Google you. Now they ask ChatGPT, and it answers with one name.
- Body: A patient looking for a clinic, a parent choosing an institute, a family booking a hotel — more of them now ask an AI assistant and take the answer it gives. If your business is not in that answer, you were never in the running.
- Visual: two panels side by side (stacked at 390px). Left: a search results page, ten links, ink outline. Right: one AI answer, a real one captured by TGL's Citation Tracker for one of TGL's own prompts, with every business name except TGL's greyed out. Capture date printed under it.
- Line under the visual: For hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands, across India.

## 3. home-client-zero - "We track ourselves first"
- Pill label: CLIENT ZERO
- H2: We track ourselves first.
- Body: Before we audit anyone, we run our own tracker on The Growth Lab every day. These are our real numbers, including the ones we are not proud of yet.
- Live tiles (coral), read from the company service:
  - Questions tracked: [live, currently 16]
  - AI engines checked: [live, currently 3]
  - Times AI named The Growth Lab, latest run: [live]
  - Where we started: [live, first run's figure] — labelled "Where we started, [first run date]"
  - Last run: [live date]
- If the service is unreachable at render, every tile shows "—". No cached or typed fallback.
- Link: How the audit works -> `/aeo`

## 4. home-doors - "Two ways we help"
- Pill label: WHAT WE DO
- H2: Get found. Then never lose the lead.
- Card 1 (coral) — eyebrow: AEO + TRUEVISIBLE
  - Title: ChatGPT recommends your competitor.
  - Body: We find out what ChatGPT, Gemini and Perplexity say about your business, fix what they get wrong, and track it every week on your own dashboard.
  - Link: See how AEO works -> `/aeo`
- Card 2 (teal) — eyebrow: AI AUTOMATION
  - Title: Leads come in. Nobody calls back in time.
  - Body: AI agents that reply to every enquiry within minutes, qualify it, follow up on WhatsApp and email, and hand your team the ones ready to buy. Plus the reports and back-office work nobody has time for.
  - Link: See what our agents do -> `/ai-automation`
- No prices on either card.

## 5. home-agents - "The team that runs The Growth Lab"
- Pill label: OUR AGENT TEAM
- H2: The Growth Lab runs on AI agents. Here is the team.
- Body: Every agent has a job title, a daily routine and a reviewer. They report in our company Slack at 6 PM. Agents do the work. Tejinder signs off.
- Visual (teal): an org chart grouped by department, built from `config/agents.yaml` at build time, never typed by hand:
  - Office of the Architect · Revenue · AEO delivery · Marketing · Finance and People
  - Each card: job title, one line from its first routine, and a status label:
    - `status: active` -> solid card, "On duty"
    - `status: planned` -> outline card, "Joining"
  - At 390px: one department per row, collapsed to title + count ("Revenue · 1 on duty · 2 joining"); tap to expand.
- **Builder check:** `config/agents.yaml` currently marks `aeo-audit-engine` and `outreach-sequencer` as planned while the brief says the Citation Tracker runs daily. Flag this to the Chief of Staff; the page shows whatever the config says, so the config must be correct before 14 Nov.
- Proof strip: one dated screenshot of the live board (project.thegrowthlab.co.in), and a link: Open the live board -> (`data-tgl-event="home_board_click"`)

## 6. home-how - "How it works"
- Pill label: HOW IT WORKS
- H2: Four steps, and you can stop after any of them.
1. **Free audit.** Tell us your business. We ask the AI assistants what your buyers would ask.
2. **Honest report.** A one-page report on WhatsApp: where you are named, where you are not, and what to fix first. It is yours either way.
3. **Fix or track.** Track it yourself on the TrueVisible dashboard, or let us do the fixes for you.
4. **Monthly report.** What we changed, and what the AI assistants say now.
- Visual: the real one-page audit PDF (TGL's own), dated, shown as an object on the desk.

## 7. home-founder
- Pill label: WHO IS BEHIND IT
- Photo: `tgl-theme/assets/img/tejinder-stage.png` (1086×1448; replaces the older `tejinder-founder.webp` on this page; convert to WebP + @2x as for the existing founder images, Tejinder speaking on stage, supplied by the Architect 9 Nov). Crop to head and chest, portrait; keep the microphone in frame (it says "speaks on this"). Ink-toned frame; no filters that change the face. Alt text: "Tejinder Singh, founder of The Growth Lab, speaking on stage." Export as WebP under 150 KB.
- Name: Tejinder Singh
- Role: Founder, The Growth Lab
- Credentials (four lines, nothing added):
  - 18 years in sales and marketing, the last 3 in artificial intelligence.
  - Visiting faculty in Digital Marketing and Artificial Intelligence at Lovely Professional University and Chitkara University.
  - Consultant on AI and automation to corporates.
  - IBM certificate: Generative AI — Introduction and Applications.
- Line: I built the agents that run this company before I offered to build yours.
- Link: LinkedIn -> `https://www.linkedin.com/in/stejindersingh/` · More about Tejinder -> `/about`

## 8. home-faq (FAQPage schema via the Details block)
- **What is AI visibility?** It is whether AI assistants like ChatGPT, Gemini and Perplexity name your business when someone asks them for a recommendation, and whether what they say about you is right.
- **Can you guarantee ChatGPT will recommend us?** No, and nobody honestly can. We find out what the assistants say today, fix what they read about you, and show you every week whether it is changing.
- **What does the free audit include?** A one-page report: the questions we asked, which assistants named you, who they named instead, and the first fixes. No payment and no card.
- **What do your AI agents actually do?** Reply to enquiries, qualify leads, follow up on WhatsApp and email, prepare reports and handle routine back-office tasks. A person reviews their work.
- **Where do you work?** With businesses anywhere in India. Everything we do runs online: the audit, the dashboard, the fixes and the monthly report.

## 9. cta-band
- H2: Find out what AI says about your business.
- Button: Get your free AI visibility audit -> `#audit`
- Secondary: Book a 20-minute call -> GHL calendar `[RAHUL TO SUPPLY LINK, from 12 Nov]` (`data-tgl-event="calendar_open"`). Hidden until the link exists.
- Contact line: sales@thegrowthlab.co.in (`mailto:`, `data-tgl-event="email_click"`) · WhatsApp +91 98720 09997 (`https://wa.me/919872009997`, `data-tgl-event="whatsapp_click"`). No city in the CTA band.

## Site-wide footer (applies to every page)
- Contact: sales@thegrowthlab.co.in · WhatsApp +91 98720 09997
- Address: registered office address in the footer, small type, last line only `[ARCHITECT TO SUPPLY: full address as it should appear]`. No city or region anywhere else on the site; the copy says "India" only.
- Social (ink icons drawn from the brand's own SVG set, no icon library; each opens in a new tab, `rel="noopener"`):
  - LinkedIn -> `https://www.linkedin.com/company/the-growthlab/`
  - X -> `https://x.com/GrowwthLab`
  - Instagram -> `https://www.instagram.com/the_growthlabofficial/`
  - Facebook -> `https://www.facebook.com/itsthegrowthlab`

## Not on this page, deliberately
Prices, client names, logos, testimonials, the blog, the TrueLead waitlist, any "results in N days" promise.

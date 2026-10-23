# Page spec — /coaching
**Template:** page-landing (no nav links, header shows logo + one CTA) · **Slug:** `coaching` · **Status on build:** draft
> Note for Creative Director & QA: The `page-landing` template deliberately has no navigation links in the header (header carries the TGL logo + primary CTA only; the footer carries the full site map). This is an approved intentional design decision to eliminate conversion leakage.
**Title tag:** Lead generation system for coaching institutes | The Growth Lab
**Meta:** For institutes with 2+ branches: AI-qualified enquiries, WhatsApp reply in under 60 seconds, and attribution from campaign to admission. Get a free 90-day Growth Roadmap.
**Primary CTA everywhere:** "Get your Growth Roadmap" → `/roadmap?src=coaching` with `data-tgl-event="roadmap_cta_click"`

---

## 1. hero-problem
- Eyebrow: THE AI GROWTH OPERATOR FOR COACHING INSTITUTES
- H1: Your counsellors are talking to the *wrong* students.
- Sub: We build the system that qualifies every enquiry before it's dialled, replies on WhatsApp in under 60 seconds, and tells you which campaign actually produced an admission.
- Buttons: [Get your Growth Roadmap] [See how it works → #system]
- Microline under buttons: 3 minutes. Eleven questions. You get a written 90-day plan.
- Hero-adjacent Stand-in: Paper-and-ink animated desk scene (enquiry slip from Meta ad → TrueLead stamp → sorting trays → 60s WhatsApp phone → counsellor handset → admissions register → loop arrow back to Meta).

## 2. whats-not-working — "What's not working in your funnel right now?" *(replaces problem-trio)*
Pill label: DIAGNOSTIC
H2: What's not working in your funnel right now?
Sub: Tap your biggest bottleneck. See the exact mechanism we build to fix it.
Chips (5 options + search input):
1. **Too many junk enquiries** (`junk-enquiries`)
   - Mechanism: TrueLead AI Intent Scoring
   - Visual: `enquiry-slip.svg` & `truelead-stamp.svg`
   - Copy: You don't have a lead volume problem; you have a filter problem. TrueLead evaluates qualification, course readiness, destination country, and timing before dialling. Your counsellors only dial the top 20% who can actually enrol, while cold leads receive automated nurture.
   - Button: Get your Growth Roadmap → `/roadmap?problem=junk-enquiries&src=coaching`
2. **Counsellors call too late** (`late-calls`)
   - Mechanism: Sub-60s Automated WhatsApp Outreach
   - Visual: `phone-whatsapp.svg`
   - Copy: When an enquiry lands at 9:30 PM, manual calling at 11:00 AM next morning means the student has already engaged two competitors. Our concierge replies in under 60 seconds, 24/7, answers core intake questions, and books a call directly onto your counsellor's calendar.
   - Button: Get your Growth Roadmap → `/roadmap?problem=late-calls&src=coaching`
3. **Can't tell which ads bring admissions** (`blind-spending`)
   - Mechanism: Closed-Loop Attribution & Feedback to Meta
   - Visual: `admissions-register.svg` & `loop-arrow.svg`
   - Copy: Meta optimises for clicks and form-fills, not classroom seats. We match admission receipts back to the exact campaign, ad set, and creative that originated them. The algorithm stops hunting for cheap leads and begins hunting for paying students.
   - Button: Get your Growth Roadmap → `/roadmap?problem=blind-spending&src=coaching`
4. **Leads go cold on WhatsApp** (`cold-whatsapp`)
   - Mechanism: Systematic Multi-Touch Follow-up Engine
   - Visual: `sorting-trays.svg`
   - Copy: Most enquiries drop off because follow-up is manual, irregular, and stops after two attempts. Our engine sequences course brochures, fee breakdowns, and counsellor reminders automatically until the student replies or explicitly opts out.
   - Button: Get your Growth Roadmap → `/roadmap?problem=cold-whatsapp&src=coaching`
5. **Next intake is in 60 days** (`intake-60-days`)
   - Mechanism: Rapid 10-Day Deployment & Live Funnel Audit
   - Visual: `ad-poster.svg` & `counsellor-handset.svg`
   - Copy: You don't have time for a three-month agency onboarding. We audit your existing ad accounts and landing funnels live on our diagnostic call, deploy the scoring and WhatsApp reply pipeline within 10 days, and fill seat quotas for the upcoming intake.
   - Button: Get your Growth Roadmap → `/roadmap?problem=intake-60-days&src=coaching`
6. Fallback Card (typed search with no match):
   - Headline: Tell us on the Roadmap call.
   - Copy: Every coaching institute has unique bottlenecks across branch routing, entrance exams, or counsellor turnover. Share your intake specifics on the diagnostic call and we'll map the fix into your 90-day plan.
   - Button: Get your Growth Roadmap → `/roadmap?problem=other&src=coaching`
- Tracking: `data-tgl-event="problem_pick"` with selected problem slug.

## 3. system-four — anchor `#system` — "What the system does"
Pill label: THE SYSTEM
Eyebrow: THE SYSTEM
- Scores every enquiry before a counsellor sees it — hot, warm, cold — using TrueLead, our own AI scoring engine.
- Replies on WhatsApp in under 60 seconds, 24/7, in Hindi or English, then follows up until the student answers or opts out.
- Pushes real admissions back to Meta, so the algorithm finds more students who enrol — not more who fill forms.
- Gives your team one dashboard they open every morning: enquiries → contacted → interested → enrolled, by campaign, by counsellor.

## 4. running-today — "What's running today"
Pill label: LIVE SYSTEM
Eyebrow: LIVE FOR A NURSING INSTITUTE IN PUNJAB
H2: What's running today
Subtitle: Running for NCLEX-RN today · built to configure for IELTS, NEET and study-abroad intakes.
Intro (one paragraph): This isn't a plan. It's running right now for a multi-course nursing coaching institute — every enquiry from Meta, Instagram DMs and the website flows through the same engine, and an eight-person counselling team works only from the scored list.
Visual Collage: Overlapping collage of 3 physical UI surfaces (TrueLead scored slip rotated -1.5°, WhatsApp concierge sub-60s thread, and Live attribution tracker row offset +1°) on a tinted panel.
Four points:
1. **Scored before it's dialled.** Each enquiry is read by TrueLead and tagged hot, warm or cold with the reason — course, destination country, city, qualification.
2. **Answered in under a minute.** WhatsApp reply fires automatically, day or night, in the student's language.
3. **Admissions fed back to Meta.** When a student enrols, Meta learns what an enrolling student looks like — so the next campaign finds more of them.
4. **One sheet, one truth.** Counsellors, owner and TGL look at the same live tracker: who called whom, when, and what happened.
Closing line: We publish results only after a full intake has been verified. Until then, you can watch it work — ask for the two-minute walkthrough on your Roadmap call.
Button (secondary): See the two-minute walkthrough → links to a Loom/video (ARCHITECT to record; until recorded, hide this button).

> No client name, no numbers, no quote on this page until the Architect approves a dated, screenshot-able figure.

### Founder Trust Block (inside running-today):
- Photo: Tejinder Singh (stage/speaking)
- Name: Tejinder Singh
- Role: Founder & Growth Architect, The Growth Lab
- Proof Line 1: `[ARCHITECT TO CONFIRM: Years in digital marketing]`
- Proof Line 2: `[ARCHITECT TO CONFIRM: Faculty roles at LPU & Chitkara]`
- Proof Line 3: `[ARCHITECT TO CONFIRM: Corporate training / empanelment]`
- Personal statement: `"[ARCHITECT TO CONFIRM: Founder statement on why TGL exists]"`
- Links: LinkedIn & X profiles with 20px paper-and-ink icons.

## 5. roadmap-steps — "How the Growth Roadmap works"
Pill label: 90-DAY ROADMAP
1. **Apply** — 2 minutes. Eleven honest questions, not a 47-field form.
2. **Diagnostic call** — 45 minutes. We audit your funnel live: your ads, your form, your response time (we'll submit a test enquiry during the call). Includes 3-node hairline audit diagram (Ad account → Live speed test → 90-day plan).
3. **Written 90-day plan** — within 48 hours. Where enquiries should come from, what's leaking, the exact system we'd build. If we're not the right fit, the plan is still yours.

## 6. fit-notfit
Pill label: QUALIFICATION
**Built for you if:** 2+ branches, or 150+ enquiries a month · spending ₹50,000+ a month on ads · a counselling team of three or more · intakes at least twice a year · you want admissions tracked, not leads counted.
**Probably not a fit if:** a single batch with no budget headroom · you need results in 30 days · you want "just leads" · you'd rather not know which campaigns don't work.

## 7. from-thinking — "Sharp thinking. No fluff."
Pill label: EDITORIAL
Eyebrow: FROM THINKING
H2: Sharp thinking. No fluff.
Layout: 6-post grid (3×2 desktop, 2×3 tablet, single horizontal snap-scroll row on mobile at 80vw width).
Each card features:
- 16:9 brand illustration featured image (generated via `site/build-featured-image.js`)
- Pillar tag
- Date
- Title
- One-line excerpt
- Clear placeholder status indicator: "Placeholder — publishes with first post"
- Footer link: "All posts →" linking to `/thinking`
*Note: Post 6 title updated to: "The Multi-Branch Playbook: Scaling From 2 to 5 Campuses Across India"*

## 8. faq (Details blocks → FAQPage schema)
- **What does it cost?** Founding-client structure: ₹50,000/month plus a one-time installation fee, 90-day minimum, step-up from month 7. Stated upfront because it filters — we'd rather you know now.
- **How fast will I see results?** First qualified enquiries within 10 days of launch. First attribution report — which campaign produced which admissions — within 30 days.
- **What do you need from us?** Ad account access, one person who owns follow-up, and your last three months of enquiry and admission counts.
- **Do you run the ads or do we?** We run them. You see every rupee and every lead in a dashboard you can open any morning.
- **Will this work for IELTS / NEET / CA / nursing?** The system is the same; the creative, the scoring rules and the WhatsApp follow-ups are built per course. It's live for nursing today; the roadmap call is where we check fit for yours.
- **What is TrueLead?** Our own AI engine that reads every enquiry and scores it before anyone calls. We built it because off-the-shelf tools count leads; we needed something that judges them.
- **What if it doesn't work?** 15 days to decide — if it doesn't feel right we refund 50% of the advance. No lock-in after the first 90 days. Your data is your data.

## 9. cta-band
H2: See the plan before you *pay* for it.
Sub: No payment. No commitment. Just eleven answers and a plan built for your institute.
Button: Get your Growth Roadmap

---

## 10. sticky-mobile-cta
- Appears on viewports < 768px after 1,200px scroll.
- Fixed bottom-center terracotta pill: "Get your Growth Roadmap"
- Tracking: `data-tgl-event="roadmap_cta_click" data-tgl-position="sticky"`
- Hides via IntersectionObserver when `cta-band` or `footer` is in view.

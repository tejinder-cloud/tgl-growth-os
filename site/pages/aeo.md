# Page spec - /aeo
**Template:** page-landing (logo + one CTA in the header, full site map in the footer; same intentional no-nav decision as /coaching) · **Slug:** `aeo` · **Status on build:** draft (never published by the builder)
**Title tag:** Does ChatGPT recommend your institute? AI search audit | The Growth Lab
**Meta:** When a parent or student asks ChatGPT, Gemini or Perplexity for a coaching institute, is yours named? Request a written AI search audit for your institute.
**Primary CTA everywhere:** "Request your AI search audit" -> `#audit` with `data-tgl-event="aeo_cta_click"`
**Traffic source:** Meta campaign (Rahul), see `products/aeo/meta-campaign-brief.md`. The page must work on a phone first.

## Brief review (for the Architect, also in the PR)
Open questions. Until answered the page avoids each of these rather than guessing:
1. Is the audit free? The page states no price. If it is free, one line "No payment" can go under the form button.
2. Turnaround time for the written report. The page and the WhatsApp templates promise none. Give the number and it goes in the form microline.
3. Does the AEO audit sit inside the same fit criteria as the Roadmap (2+ branches, Rs 50,000+ ad spend)? The form collects no spend or branch data, so every lead lands in the pipeline and is qualified by a person afterwards. The fit and not-fit criteria are not changed here.
4. Founder proof lines are still `[ARCHITECT TO CONFIRM]` in the brand brief, so this page has no founder block.
5. No numbers, no client name, no screenshot of results appear on this page. The audit engine's output is not yet approved as a public figure.

## 1. aeo-hero
- Eyebrow: AI SEARCH AUDIT FOR COACHING INSTITUTES
- H1: Your next student is asking ChatGPT. Does it say your *name*?
- Sub: More parents and students now ask an AI assistant which institute to join. We check what ChatGPT, Gemini and Perplexity say about yours, and send you a written audit.
- Buttons: [Request your AI search audit -> #audit] [What we check -> #checks]
- Microline: One short form. The report comes to your WhatsApp.
- Visual: paper-and-ink desk scene - a phone showing a question bubble, three enquiry slips (one stamped, two blank), ledger. Uses existing objects from `design-system/objects/`. Terracotta + teal layers only.

## 2. aeo-checks - anchor `#checks` - "What the audit looks at"
Pill label: THE AUDIT
Four plain statements, no numbers:
1. **Are you named?** We ask the AI assistants the questions a parent or student would ask for your city and courses, and record whether your institute appears.
2. **What do they say?** If you are named, we record what is said, and whether the fees, courses, locations and results quoted are right.
3. **Who is named instead?** We list the institutes the assistants recommend in your place.
4. **What can you fix?** We check the pages and listings the assistants read from - your website, your Google profile, directories - and list what is missing or wrong, in order of effort.

## 3. aeo-how - "How it works"
Pill label: HOW IT WORKS
1. **Request** - one short form: your institute, your website, your WhatsApp number.
2. **We run the audit** - the same questions across the assistants, recorded.
3. **You get a written report** - on WhatsApp, with the fixes in order. If we are not the right people to fix it, the report is still yours.

## 4. aeo-audit-form - anchor `#audit`
Pill label: REQUEST THE AUDIT
H2: Tell us which institute to look at.
Fields (all required unless stated):
- Your name
- Institute name
- Website (accepts "example.com" or a full URL)
- WhatsApp number (10-digit Indian mobile, or +country code)
- Email
- A question you would want us to ask the AI about your institute (optional, 300 characters)
- Consent checkbox: "You may message me on WhatsApp and email about this audit."
- Hidden: honeypot `hp`, UTM parameters read from the URL (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `src`)
Button: Request your AI search audit
Tracking: `data-tgl-event="aeo_audit_submit"` on success only.
Success state (replaces the form, no confetti, no motion): "Received. We will message you on WhatsApp at the number you gave. If you want to add a question, reply to that message."
Failure states: field errors inline under each field; 429 and 502/503 show "We could not save your request. Please try again in a few minutes." The form never shows success unless the endpoint returned `ok: true`.
Writes to: GHL pipeline `AEO`, stage `New request` via `POST /aeo/lead` (see `products/aeo/ghl-aeo-pipeline.md`).

## 5. aeo-faq (FAQPage schema)
- **What is an AI search audit?** We ask ChatGPT, Gemini and Perplexity the questions a student or parent would ask when choosing an institute, and write down what they answer about you and about the institutes they name instead.
- **What do I get?** A written report: where you are named, where you are not, what is wrong in what they say, and what to fix first.
- **Do you need access to my accounts?** No. The audit uses only what is public.
- **Will you message me after?** On WhatsApp, about this audit. Reply STOP and we stop.
- **Is this the same as SEO?** Related, not the same. SEO decides where you rank on a results page. This is about whether an AI assistant names you at all, and what it says.
- **Do you guarantee that an AI will recommend me?** No. Nobody controls those answers. The report lists what you can change; it does not promise an outcome.

## 6. cta-band
H2: Find out what the assistants say about you.
Sub: One form. A written report.
Button: Request your AI search audit

## 7. sticky-mobile-cta
Same behaviour as /coaching: < 768px after 1,200px scroll, terracotta pill "Request your AI search audit", `data-tgl-event="aeo_cta_click" data-tgl-position="sticky"`, hides when the form or footer is in view.

## Build map
- `tgl-theme/patterns/aeo-hero.php`, `aeo-checks.php`, `aeo-how.php`, `aeo-audit-form.php`, `aeo-faq.php`
- Endpoint: `TGL_AEO_ENDPOINT` constant in wp-config.php (see products/aeo/ghl-aeo-pipeline.md section 4)
- No plugin, no external script. The form script is first-party and inline.

# Page spec - /aeo
**Template:** page-landing (logo + one CTA in the header, full site map and the site-wide footer from `home.md`) · **Slug:** `aeo` · **Status on build:** draft (never published by the builder)
**Replaces:** the coaching-only version of this spec (rewritten 9 Nov for the website sprint). The `aeo-*` patterns from PR #113 are kept as structure; all their copy is replaced by this file.
**Title tag:** Does ChatGPT recommend your business? Free AI visibility audit | The Growth Lab
**Meta:** When your customers ask ChatGPT, Gemini or Perplexity for a recommendation, is your business named? Get a free one-page AI visibility audit within 24 hours.
**Primary CTA everywhere:** "Get your free AI visibility audit" -> `#audit` with `data-tgl-event="aeo_cta_click"`
**Colour role:** coral throughout (AEO door). Tokens from `design-system/tokens.json` only.
**Copy status:** FINAL once the Architect approves this file, except lines marked `[ARCHITECT TO CONFIRM]`.

## Rules for this page
- No client names, logos, testimonials, "results in N days" or guarantees of AI placement.
- Every number is live from the company service or renders "—". Every screenshot or report image carries its date.
- The one action is the audit. The pricing strip (section 7) links out; it never has its own button competing with the audit.

## 1. aeo-hero
- Eyebrow: FREE AI VISIBILITY AUDIT
- H1 (one for everyone): Your next customer is asking ChatGPT. Does it say your *name*?
- Industry chips (one row, scrolls sideways at 390px): Hospital or clinic · Coaching institute · Hotel · Real-estate developer · D2C brand
- Sub (changes with the selected chip; default when none is selected):
  - Default: More people now ask an AI assistant who to buy from, and take the answer it gives. We check what ChatGPT, Gemini and Perplexity say about your business, and send you a one-page report.
  - Example question line under the sub, in a chat-bubble style, changes with the chip:
    - none: "Who is the best [your service] near me?"
    - clinic (word: patient): "Which clinic should I go to for a root canal near me?"
    - coaching (word: parent): "Which is the best NEET coaching institute in my city?"
    - hotel (word: guest): "Which hotel near the airport is good for a family stay?"
    - real-estate (word: buyer): "Which builder has a good track record for 3BHK projects?"
    - d2c (word: shopper): "Which brand makes the best natural skincare for oily skin?"
  - With a chip selected, the sub's first sentence swaps "people" for the chip's word: "More patients now ask an AI assistant…"
- Chip behaviour: first-party inline script only. `?for=clinic|coaching|hotel|realestate|d2c` preselects a chip on load. Selecting a chip also sets the Industry field in the form (section 6). No chip selected by default. Each chip tap fires `data-tgl-event="aeo_chip_select"` with `data-tgl-value`. Without JavaScript, the default text shows and the page still works.
- Button: Get your free AI visibility audit -> `#audit`
- Microline: Free. One-page report by email within 24 hours.
- Visual: none beyond type and the chat bubble.

## 2. aeo-shift - "The shift"
Same section, copy and visual as `home.md` section 2 (one pattern, used on both pages).

## 3. aeo-checks - anchor `#checks` - "How we check"
- Pill label: OUR METHOD
- H2: Ask. Record. Compare. Fix.
1. **Ask.** We put the questions your buyers ask to ChatGPT, Gemini and Perplexity, for your industry and your city.
2. **Record.** We save every answer word for word: whether you are named, and what is said about you.
3. **Compare.** We list the businesses the assistants name instead of you, and the sources they quote.
4. **Fix.** We check what the assistants read about you — your website, your Google profile, directories — and list what is missing or wrong, easiest fix first.
- Visual: four ink steps in a row (stacked at 390px), each with one real line from TGL's own tracker run as its example, dated.

## 4. aeo-sample - "What you get"
- Pill label: WHAT YOU GET
- H2: One page. Every answer we found. The first fixes.
- Body: This is the report we ran on ourselves. Yours looks the same, with your business in it.
- Visual: TGL's own one-page audit PDF, rendered as an image, with its run date printed beneath. Tap to open the full PDF.
- Five lines beside it: the questions we asked · which assistants named you · what they said · who they named instead · the first three fixes.
- Line: The report is yours whether or not you continue with us.

## 5. aeo-client-zero
Same live tiles as `home.md` section 3 (one pattern, used on both pages), H2 "We track ourselves first."

## 6. aeo-audit-form - anchor `#audit`
- Pill label: GET THE AUDIT
- H2: Tell us which business to check.
- Fields, in this order:
  1. Business name (required)
  2. Website (required; accepts "example.com" or a full URL). Helper text: "The audit runs on your website. If you only have a Google profile, paste its link."
  3. Industry (required; select: Hospital or clinic · Coaching institute · Hotel · Real-estate developer · D2C brand · Other). Prefilled from the chip or `?for=`.
  4. City (required)
  5. Your name (required)
  6. Email (required). Helper text: "Your report is sent here."
  7. WhatsApp number (optional; 10-digit Indian mobile, or +country code). Helper text: "Optional, for a copy on WhatsApp later."
  - Consent checkbox (required): "You may email me about this audit, and message me on WhatsApp if I gave a number."
  - Hidden: honeypot `hp`, `source` (`aeo_page` or the value passed in), UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `src`), `for`.
  - Prefill: if the URL carries `?site=`, the Website field is filled with it (used by the Home hero).
- Button: Get my free audit
- Microline under the button: Free. No card. Report by email within 24 hours.
- Success state (replaces the form, no confetti, no motion): "Received. Your report will reach [the email given] within 24 hours."
- Failure states: field errors inline under each field; 429 and 502/503 show "We could not save your request. Please try again in a few minutes." Never show success unless the endpoint returned `ok: true`.
- Tracking: `data-tgl-event="aeo_audit_submit"` on success only.
- Writes to: `POST /aeo/lead` → GHL pipeline `AEO`, stage `New request` (see `products/aeo/ghl-aeo-pipeline.md`). **Builder check:** the endpoint must accept `industry`, `city`, and an empty WhatsApp field; if it rejects any of them, report and stop.

## 7. aeo-plans-strip - "After the audit"
- Pill label: AFTER THE AUDIT
- H2: If you want to go further, there are three ways.
- Three compact rows (not cards, no buttons), prices ex-GST:
  - **Track** — ₹3,999/month. The dashboard: 600 AI answers read about your business every month, and what to fix.
  - **Managed** — ₹13,999/month. Everything in Track, and we do the fixes. One report a month of what changed.
  - **Managed Plus** — ₹24,999/month. For hospital groups, developers and chains with more than one location.
- Line: Prices exclude 18% GST. Annual plans: two months free.
- Link: Compare the plans -> `/truevisible#pricing`
- Line: Start with the free audit. The report is yours either way.

## 8. aeo-faq (FAQPage schema via the Details block)
- **What is an AI visibility audit?** We ask ChatGPT, Gemini and Perplexity the questions your customers ask when choosing a business like yours, and write down what they say about you and who they name instead.
- **How long does it take?** The report reaches your email within 24 hours.
- **Is it really free?** Yes. No payment and no card. The report is yours even if you never speak to us again.
- **Do you need access to my accounts?** No. The audit uses only what is public.
- **Is this the same as SEO?** Related, not the same. SEO decides where you rank on a page of results. This is about whether an AI assistant names you at all, and what it says.
- **Can you guarantee an AI will recommend us?** No. Nobody controls those answers. The report shows what you can change; it does not promise an outcome.

## 9. cta-band
- H2: Find out what AI says about your business.
- Button: Get your free AI visibility audit -> `#audit`
- Contact line: sales@thegrowthlab.co.in · WhatsApp +91 98720 09997 (as in `home.md`)

## 10. sticky-mobile-cta
Unchanged behaviour: < 768px after 1,200px scroll, terracotta pill "Get your free AI visibility audit", `data-tgl-event="aeo_cta_click" data-tgl-position="sticky"`, hides when the form or footer is in view.

## Build map
- Patterns: rewrite the copy in `aeo-hero.php`, `aeo-checks.php`, `aeo-how.php` (becomes `aeo-sample`), `aeo-audit-form.php`, `aeo-faq.php`, `aeo-sticky-cta.php`; add `aeo-plans-strip.php`; reuse the shift and client-zero patterns built for Home.
- Endpoint: `TGL_AEO_ENDPOINT` constant in wp-config.php.
- No plugin, no external script. Chip and form scripts are first-party and inline.

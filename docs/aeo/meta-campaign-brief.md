# Meta campaign brief: /aeo audit (owner: Rahul, budget Rs 500/day)

Status: brief only. The builder does not launch or edit ad accounts. Rahul launches after the checklist below is green.

## Objective and budget
- Objective: Leads (optimise for the Lead event fired on a confirmed form submit).
- Budget: Rs 500 per day, campaign level, no daily-budget increase without the Architect's say.
- Destination: `https://thegrowthlab.co.in/aeo?utm_source=meta&utm_medium=paid&utm_campaign=aeo-audit&utm_content={{ad.name}}&utm_term={{adset.name}}`
- The form captures every one of those parameters and writes them to the GHL note and opportunity source.

## Audience
Institute owners and directors in India, 30 to 60, interests and job titles around coaching and training institutes. Start broad on geography (all India), exclude existing clients and the retargeting list once it exists. The audience is a starting guess, not a finding. Review after the first 3 days of data.

## Creative (three ads, test one variable)
Same angle, three openings. No statistics, no client names, no screenshots of results.
1. "A parent in your city asked ChatGPT for the best coaching institute. Was it you?"
2. "Do you know what ChatGPT says about your institute? Most owners have never checked."
3. "Your competitor may already be the answer an AI gives. Request a written audit."
Primary text, 2 to 3 short lines. Headline: "AI search audit for your institute". CTA button: Learn more. Visuals: paper-and-ink phone and slips illustration from `design-system/objects/`. No stock photography, no people.

## Pre-launch checklist
- [ ] `/aeo` page published by the Architect (the builder leaves it as draft).
- [ ] `TGL_AEO_ENDPOINT` set in wp-config.php and `GHL_*` variables set on tgl-ops (docs/aeo/ghl-aeo-pipeline.md).
- [ ] `app.use("/aeo", aeoRouter)` merged and deployed.
- [ ] Test submission from a phone: lead appears in GHL pipeline AEO, stage New request, with UTMs in the note, and a Slack alert posted.
- [ ] Meta pixel already on the site fires `Lead` on the success state (verified in Meta Events Manager test events).
- [ ] WhatsApp templates approved and the `New request` workflow tested (docs/aeo/whatsapp-templates.md).
- [ ] Ad copy checked against the brand voice: no exclamation marks, no invented numbers.

## Reading the first week
- Rs 500 x 7 = Rs 3,500 total spend. That is too little to judge cost per lead with confidence. Read it for obvious breakage (clicks with no form submits, submits that do not reach GHL), not for winners.
- Compare: link clicks (Meta) vs landing page views (site analytics) vs submits (GHL). A big gap between the first two means a slow page or a bad click source.
- The measure that matters is leads who the team judges to be a fit, not leads counted.

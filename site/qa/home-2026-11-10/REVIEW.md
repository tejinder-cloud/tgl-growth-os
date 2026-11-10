# Home page (#147) — Creative Director review, 10 Nov 2026

Reviewer: Strategist (Claude), standing in for the Creative Director agent, which is not yet running a browser.
Evidence kind for every line below: **live render in headless Chromium** of the branch `task/147-build-the-new-home-page-from-s` at commit noted in the PR, unless marked otherwise. Nothing here is a static read.

## How the page was rendered
The theme is a WordPress block theme; there is no WordPress here. The five home patterns were executed with PHP 8.3 with the WordPress helpers stubbed (`get_theme_file_uri`, `esc_*`, `apply_filters`), wrapped in the theme's `header-landing` and `footer` parts, with `assets/css/tgl.css`, `assets/js/tgl.js` and the `theme.json` font presets (DM Sans body, Fraunces headings). Served from a local static server. Differences from the real site: no WordPress block CSS, no plugins, no caching layer, no favicon (the one console 404 in Lighthouse is `/favicon.ico`).

The Client Zero tiles were fed from a fixture endpoint returning today's real figures from the tracker tables (16 / 3 / 6 / 6 on 4 Nov 2026 / 10 Nov 2026), because the service's Supabase key is not available here. The service route that will feed them live is `GET /home/stats` (this PR), verified by fixture tests, not yet by a production call.

## Lighthouse, mobile (Moto G Power emulation, slow 4G)
`lighthouse-mobile.html` in this folder is the full report.

| Category | Score |
|---|---|
| Performance | 98 |
| Accessibility | 98 |
| Best practices | 96 |
| SEO | 100 |

FCP 2.0 s, LCP 2.0 s, CLS 0, TBT 10 ms. The craft standard is mobile >= 90: met, with the caveat that the production host adds WordPress and plugin weight this render does not have. Re-run on staging before Deploy.

Remaining audit notes:
- Heading order: the footer part uses `h4` after the page's `h2`s. Footer is shared theme code, not this PR. Leave for the theme sprint.
- Contrast: the AEO door card's eyebrow and link used coral `#C8553D` on white at 4.35:1. Fixed in this PR with a text-only shade `#B94B35` (5.1:1); coral stays for tiles, borders and the panel. Accessibility went 94 -> 98.

## Screenshots (390 px, device scale 2)
- `mobile-390-hero.webp` — first viewport.
- `mobile-390-client-zero.webp` — the tiles with live-shaped figures.
- `mobile-390-full.webp` — the whole page.
- `desktop-1280-full.webp` — desktop, for layout only.

No horizontal scroll at 390 px (checked in the DOM: `scrollWidth <= clientWidth`). Founder photo loads lazily; it is present and correctly cropped (checked after scroll).

## Fixes made during review (inside approved scope, recorded per mandate 5)
1. Tile dates rendered as `2026-11-10` and wrapped; now formatted client-side as `10 Nov 2026`. Pure presentation.
2. Coral text on white below 4.5:1 — see above.
3. Hero microline and the how-it-works step promised the report on WhatsApp; home.md says email. Corrected (earlier commit today).

## Proposals for the Architect (not done; each needs a decision)
1. **Header CTA conflicts with the hero.** `header-landing` still shows "Get your Growth Roadmap" linking to `/roadmap?src=coaching` (coaching-era). The hero's one action is the audit. Two actions in the first viewport breaks the conversion standard, and `/roadmap` is not in the two-service plan. Recommend: header CTA becomes "Free AI visibility audit" -> `/aeo#audit`, or no header CTA on the home template. Theme part, not this PR.
2. **"Times AI named The Growth Lab: 6" has no denominator.** 6 of 48 answers is the honest shape. Recommend the route also returns `answers_latest` and the tile reads "6 of 48". Small change to the route and the tile; can go in the next pass.
3. **Three captures: two of three exist.** AI answer (Perplexity, 10 Nov, names greyed, TGL not named) and the live board are in `tgl-theme/assets/img/home/` and listed in `home-captures.json`. The audit-PDF capture is not: no raw audit JSON is committed and the PDF renderer needs the stored answers. Fastest honest route: the Architect attaches the 4 Nov PDF from `#doors-aeo`, page 1 is captured with its date, and the PDF card renders. Until then that panel stays hidden by design (the pattern renders it only when a dated capture exists).

## Verdict
Approve as a **draft page** once the Architect decides on proposal 1 (it is visible in the first viewport). Items 2 and 3 can follow without blocking the 16 Nov deadline.

# Home page prototypes, 10 Nov 2026

Two single-file HTML prototypes built by the Strategist after the Architect rejected the first Home build (PR #148) as "plain text and boxes". Same approved copy (`site/pages/home.md`), same real figures from the tracker on 10 Nov 2026 (16 questions, 3 engines, 6 of 48 named; first run 4 Nov), same real captures (`tgl-theme/assets/img/home/`). Images are inlined as data URIs so each file opens on a phone by itself.

- `home-a-paper-and-ink.html` — **chosen by the Architect, 10 Nov 19:15.** Executes `design-system/BRAND-BRIEF.md` section 4 as written: cut-paper sheets with offset print shadows, tinted panels, rubber stamps, the 48-square proof sheet with "6 of 48" at poster size.
- `home-b-dark-instrument.html` — not chosen. Dark room, the 48-answer monitor as hero. Kept for reference; its monitor may be borrowed as a hero element.

Decision 10 Nov 19:18: keep Paper & Ink; rebuild the component layer to shadcn/ui conventions (semantic tokens, radius and spacing scale, Button / Input / Badge / Card / Accordion / Tabs / Dialog / Table / Toast with full hover, focus, disabled and error states) in plain CSS and minimal JS for the WordPress block theme. No React, no Next.js for the marketing site before 16 Nov. Documented in `design-system/components.md` (to be written) so every page and the Web Builder share the parts.

Not in these files: the TrueVisible dashboard screenshot (Architect to supply), the live `/home/stats` fetch (figures are baked in; production reads the route).

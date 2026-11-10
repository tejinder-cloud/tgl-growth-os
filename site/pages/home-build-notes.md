# Home (/) build notes - Task 147 (draft, not published)

Evidence kind: file writes and static read. No command was run in this session, so no test, Lighthouse run, screenshot or live submission exists. Nothing here claims otherwise.

## Architect instruction of 15:10, item by item

1. Hero rebuilt. `tgl-theme/patterns/home-hero.php` is now one website field in a plain GET form: action `/aeo#audit`, field `site`, hidden `source=home_hero`, so submitting opens `/aeo?site=...&source=home_hero#audit`. No script, no endpoint, no lead submitted from Home. Button keeps `data-tgl-event="home_audit_cta_click"`; `aeo_audit_submit` is not fired on Home because nothing is submitted there.
   - Discrepancy to resolve: the copy of `site/pages/home.md` on this branch still describes the older two-field form posting to `/aeo/lead`. It does not contain the update the Architect describes. I followed the 15:10 instruction and did not edit the spec. Please confirm the updated spec is on main.
   - Open dependency: the `/aeo` page must read `?site=` into its website field and `source=home_hero` into its source. I could not read `tgl-theme/patterns/aeo-audit-form.php` within the research budget, so that prefill is unverified. If it is absent, the visitor lands on `/aeo` with an empty form. That is a separate small change on the /aeo page.
2. Reverted. `services/tgl-ops/src/lib/aeo-lead.ts` and `services/tgl-ops/src/routes/aeo.ts` no longer contain any `home_hero` handling: `HOME_HERO_SOURCE`, the lighter validator, hero note, alert and GHL branches are gone. The endpoint requires name, institute, website, WhatsApp, email and consent. I rebuilt both from the file contents as read, with no git revert available, so please diff them against the last commit before the hero work.
3. `config/agents.yaml`: not touched. `aeo-audit-engine` is `active`; no other status changed.
4. Founder photo: `home-founder-faq-cta.php` now uses `tejinder-stage.webp` with `srcset` 1x and `tejinder-stage@2x.webp` 2x and no PNG reference. BLOCKER: the two WebP files do not exist in `tgl-theme/assets/img` and this runner can only write text, so I could not create them or delete the PNG. Until they are added the founder image is broken. Needed from a person with an image tool: export both WebP files from `tejinder-stage.png` (under 150 KB for the 1x), commit them, and delete `tgl-theme/assets/img/tejinder-stage.png` and the stray copy `site/pages/tejinder-stage.png`.
5. Still open items:
   - Read-only stats route: built, `GET /home/stats` in `services/tgl-ops/src/routes/home-stats.ts`, mounted in `app.ts` at `/home`. It returns only `questions_tracked`, `engines_checked`, `times_named_latest`, `first_run_figure`, `first_run_date`, `last_run_date`, with `Cache-Control: no-store`, and fails closed with 503 and no figures. It is NOT yet backed by data: I did not read the Citation Tracker store within the research budget and will not guess table names. Someone must call `setHomeStatsProvider(...)` from the composition root with a function that reads TGL's own first and latest run. Until then every tile shows a dash. The theme reads the URL from `TGL_HOME_STATS_ENDPOINT` (set it to `https://<service>/home/stats`).
   - Three dated captures (AI answer, live board, audit PDF): not made. Needs `site/capture-screens.js` run by someone able to execute it, with the date printed under each and a check for tokens, channel IDs, emails and prospect names.
   - Creative Director review with mobile screenshots at 390px: not done, nothing to screenshot yet.
   - Lighthouse mobile score: not run.
   - Therefore no approval card should be raised yet.

## Tests
`services/tgl-ops/src/test-task147-home-hero.ts` was rewritten for the new behaviour (written, not run): two-field payload still 422, full /aeo payload accepted, stats route 503 without provider / filtered keys / 503 on bad data and on error / no POST, hero is a one-field GET form with no script or endpoint, founder uses WebP srcset, agents.yaml statuses valid and `aeo-audit-engine` active. Run it like the other `test-*.ts` files in `services/tgl-ops`. If `test-task107-aeo-mount.ts` contains `home_hero` cases from the earlier attempt, they will fail and should be removed; I did not read that file.

## Brief review
- The new hero asks for a website only and hands off to /aeo, which is safer for lead quality and keeps one lead path. The cost is a second step before any lead exists; watch drop-off between `home_audit_cta_click` and the /aeo submit.
- Label says "Your website" while the spec's older text said "website or business name". A visitor without a website has no way in from the hero; the /aeo form is the place to handle that.
- The microline "sent to your WhatsApp" is now a promise made one step before the WhatsApp number is asked for. Copy is the Architect's; flagging only.
- 390px: hero button and any sticky CTA must not both show; check on staging.
- Footer address last line stays `[ARCHITECT TO SUPPLY]`; calendar link stays hidden until supplied.
- Not published. Order stays: Creative Director review, then Chief of Staff approval card to the Architect.

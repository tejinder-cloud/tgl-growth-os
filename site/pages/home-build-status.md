# Home build status - task 147 (draft, not published)

Evidence kinds: "static read" = file read on the branch; "file write" = file changed on the branch. Nothing here was run in a browser, so no screenshot, no Lighthouse score and no live end-to-end submit exists yet.

## Architect instruction, five points

1. Hero rebuilt from site/pages/home.md. DONE (static read). tgl-theme/patterns/home-hero.php is a plain GET form: one website field, hidden source=home_hero, action /aeo#audit, button "See what AI says about you", microline and board link as spec. No script, no endpoint, no lead submitted from Home. tgl-theme/patterns/aeo-audit-form.php pre-fills the Website field from ?site= on arrival and keeps source=home_hero as attribution.
2. services/tgl-ops aeo-lead.ts and routes/aeo.ts reverted. DONE on this branch (static read of routes/aeo.ts): the route validates with validateLead and returns 422 on a payload without the full field set. No file in services/tgl-ops/src/lib/aeo-lead.ts or routes/aeo.ts was touched in this session. src/test-task147-home-hero.ts asserts that a two-field home_hero payload is rejected with 422 and writes nothing to GHL. I could not re-read lib/aeo-lead.ts this session (research budget spent), so a reviewer should diff it against the commit before the Home work began.
3. config/agents.yaml. DONE (static read). aeo-audit-engine is status: active; every other status is unchanged. No edit made.
4. Founder image. DONE (file write + static read). home-founder-faq-cta.php uses tejinder-stage.webp and tejinder-stage@2x.webp from tgl-theme/assets/img with srcset; no PNG reference. The PNG is not in tgl-theme/assets/img. Not checked: the 150 KB WebP size limit (file sizes are not visible to me).
5. Still open, not done in this session:
   - Read-only stats route for the Client-zero tiles: the route exists (services/tgl-ops/src/routes/home-stats.ts, GET /home/stats, mounted in app.ts, fails closed with 503). What is NOT confirmed is a data provider wired to the real Citation Tracker store, so in production the route answers 503 and every tile shows a dash. I could not read src/index.ts or agents/aeo-audit-engine/store.js to wire it. Someone must call setHomeStatsProvider(...) with TGL's own first and latest run figures, and set TGL_HOME_STATS_ENDPOINT.
   - Three dated captures (AI answer from the Citation Tracker, live board, audit PDF): NOT made. A capture needs a browser or the tracker output; none is available to the builder, and an invented or undated capture is not allowed. The pattern renders the AI-answer panel only when tgl-theme/assets/data/home-captures.json lists a file with a capture date. Each capture must show no token, channel ID, email address or prospect name.
   - Creative Director review with mobile (390px) screenshots: NOT done.
   - Lighthouse mobile score: NOT run.
   - No approval card should be raised until the three open bullets above are complete.

## Spec fidelity fix made this session

- FAQ "What does the free audit include?" now reads "A one-page report, by email within 24 hours: ..." as in the spec (the earlier pattern had dropped "by email within 24 hours").

## Points for the Creative Director

- The FAQ section carries an H2 "Questions, answered." that is not in the spec. Keep for heading structure or remove.
- The search-results panel has a caption "Search: ten links." that is not in the spec.
- The calendar secondary link is hidden until TGL_HOME_CALENDAR_URL is defined (Rahul to supply the link).
- The footer address last line is still [ARCHITECT TO SUPPLY] and renders nothing until supplied.

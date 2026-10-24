# Memory — web-builder
**Department:** marketing
**Created:** 2026-10-23

## Accumulated Heuristics & Rules
- Service Configuration Pattern: Railway root-directory builds get an isolated context; never copy shared config into a service — fetch it. Services reading shared repository configuration (e.g. `config/agents.yaml`, `config/doors/*.yaml`) must fetch from the repository's `main` branch via the GitHub Contents API using `GITHUB_TOKEN`, cached in-memory (5 minutes), with a local-file fallback for local development only.
- Proposal execution protocol: A proposal is not executed until the Architect answers. Where a change is judged to be a craft decision within discipline under AGENTS.md mandate 6, state so explicitly ("craft decision — executed and recorded") instead of "Decision: Executed Option A". Where a proposal expands scope, mark it "awaiting approval" and build the rest within approved scope. Never self-approve.
- Desktop header is sticky (`position: sticky; top: 16px`); on mobile (<768px), header uncouples to `position: relative; top: auto;` to preserve viewport space for the bottom sticky pill.
- Sticky mobile CTA pill (`.tgl-sticky-pill`) appears at scroll > 1200px and hides via IntersectionObserver when `cta-band` or `footer` is in view.
- Never edit `tgl-theme/theme.json` manually; edit `design-system/tokens.json` and run `site/build-theme-json.js`.
- Always set `font-display: optional` on Fraunces to eliminate webfont swap delay and layout recalculation.
- Never preload body font (DM Sans); preload only display hero faces (`fraunces-latin-normal.woff2` and italic) with `fetchpriority="high"`.

## Pitfalls & Anti-Patterns Avoided
- Never duplicate repository-level `config/` into subservices; having two copies of configuration breaks the single-source rule in `ORG.md §3`.
- Never self-approve proposals or execute unapproved scope expansions before Architect review.
- Never add inline script or style tags; tracking events must use `data-tgl-event` attributes.
- Avoid low-contrast text on Thinking cards (body metadata must maintain WCAG AA ≥ 4.5:1).
- Never use generic `<div>` with `aria-label`; place ARIA directly on interactive elements or SVGs with `role="img"`.
- Railway default domains (`*.up.railway.app`) lack IPv6 `AAAA` DNS records. Services receiving webhooks from platforms with IPv6-preferring egress (e.g. Slack Event Subscriptions) can fail or time out during DNS/egress resolution if relying solely on the default Railway subdomain; attach a custom domain with Cloudflare or dual-stack proxying if IPv6 egress delivery fails.


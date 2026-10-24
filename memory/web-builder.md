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
- Test hygiene standing rule: any issue, PR, card or log line created by a test is labelled `type:test`, posts only to `#ops`, and is closed by the test itself. Never post test executions to real channels (`#standup`, `#marketing`, `#site-build`, `#approvals`, `#architect`) or leave unclosed test artifacts.

## Pitfalls & Anti-Patterns Avoided
- Never duplicate repository-level `config/` into subservices; having two copies of configuration breaks the single-source rule in `ORG.md §3`.
- Never self-approve proposals or execute unapproved scope expansions before Architect review.
- Never add inline script or style tags; tracking events must use `data-tgl-event` attributes.
- Slack Event Subscriptions verification observation & mounting diff:
  - Both `/slack/commands` and `/slack/events` share identical `express.raw({ type: "*/*", limit: "5mb" })` capture.
  - Middleware order: Synchronous `url_verification` sits as the first middleware on `/slack/events`, returning `200 { challenge }` in <1ms without awaits or external dependencies. Content-type parsing follows, followed by `/slack` entry logging and HMAC verification.
  - Redirects & status: Neither endpoint issues redirects (no 301/302/307) or 404 on POST; both return HTTP 200 on synthetic IPv4 POSTs.
  - Network & routing: `tgl-growth-os-production.up.railway.app` publishes no `AAAA` DNS record (IPv4 `A` at `69.46.46.67`). The endpoint is responsive over IPv4 (~0.5s). Slack's verification request was captured at `webhook.site` (with valid headers and matching signature) but was not observed arriving at the Railway application when targeting the Railway domain; cause: unknown — under investigation.
  - Operational rule: Zero application-level differences exist in code; `/task` is the operational trigger until Slack events verify.

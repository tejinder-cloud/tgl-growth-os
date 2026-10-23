# TGL Theme — Architecture & Build Spec
### A custom WordPress block theme, no page builders, agent-editable

**Decision:** build `tgl-theme`, a custom block theme (Full Site Editing) generated from `design-system/tokens.json`. Remove Elementor, ElementsKit, Hello and the Fonts Plugin once the new theme is live. Interactive tools (Roadmap questionnaire, Calculator) live in a separate plugin `tgl-tools`, not in the theme.

---

## 1. Why a theme, and why this split

**Theme = presentation. Plugin = behaviour.** WordPress convention, and for an agent team it's the only sane structure:

- The **Web Builder** edits the theme (templates, patterns, `theme.json`, CSS). A theme change can never break the Roadmap or Calculator logic.
- The **Site Analyst** proposes CRO changes that are almost always theme changes (layout, copy position, CTA placement) — safe to automate.
- The **tools plugin** changes rarely, has its own tests, and only the Architect approves changes to it.
- Switching themes later (or giving a client a skinned copy) doesn't touch the tools.

**Why a block theme rather than classic PHP templates:** everything is files (`theme.json`, HTML templates, block patterns) that agents can read and write without running PHP; the Site Editor gives you a visual fallback; Gutenberg output is lightweight (Lighthouse 95+ is normal); and page content stays as portable block markup that Easy MCP AI can read and edit over MCP.

**Why not Elementor/Bricks/Divi:** JSON blobs in post meta that agents edit badly, 300–600 KB of extra CSS/JS per page, and lock-in. You've already said no; I'm agreeing on the record.

---

## 2. Theme structure

```
wp-content/themes/tgl-theme/
├── style.css                 # header only (name, version, text-domain)
├── theme.json                # GENERATED from design-system/tokens.json — palette, typography, spacing, layout widths, block styles
├── functions.php             # enqueue fonts + tgl.css, register pattern categories, disable core bloat (emoji, global-styles inline SVGs), add data-tgl-event support
├── assets/
│   ├── css/tgl.css           # the few things theme.json can't express (hairline rules, rainbow divider, italic accent word, stat tiles)
│   ├── fonts/                # self-hosted woff2 (display serif + body sans) — no Fonts Plugin, no Google Fonts call
│   └── js/tgl.js             # 2 KB: FAQ details toggles, sticky CTA on mobile, data-tgl-event → dataLayer push
├── templates/
│   ├── index.html            # blog index (/thinking)
│   ├── single.html           # blog post — author box, TOC, related, Roadmap CTA band
│   ├── page.html             # default page
│   ├── page-landing.html     # no header nav, single CTA — used by /coaching and ad landing pages
│   ├── page-pitch.html       # long-form editorial template — used by /pitch
│   ├── archive.html, search.html, 404.html
├── parts/
│   ├── header.html           # logo, 5 links, one primary CTA
│   ├── footer.html
│   ├── cta-band.html         # reusable "Get your Growth Roadmap" band
│   └── rainbow-rule.html     # the small striped divider motif
└── patterns/                 # one file per section type — THIS is what agents compose pages from
    ├── hero-problem.php      # eyebrow + H1 (italic accent word) + sub + 2 buttons
    ├── hero-statement.php    # pitch-style centred statement
    ├── problem-trio.php      # three owner problems
    ├── system-four.php       # four outcome lines
    ├── stat-band.php         # 4 big stats on ink background
    ├── proof-case.php        # client case: intro, before/after table, quote
    ├── compare-table.php     # before / 90 days in
    ├── timeline-90.php       # days 1–14, weeks 3–6, etc.
    ├── commitments.php       # numbered commitments
    ├── fit-notfit.php        # built for / not a fit
    ├── roadmap-steps.php     # 3-step how it works
    ├── faq.php               # Details blocks → FAQPage schema via Rank Math
    └── tool-embed.php        # wrapper for a tgl-tools shortcode/block
```

`theme.json` is **generated**, not hand-written: a 40-line Node script (`site/build-theme-json.js`) reads `tokens.json` and emits `theme.json`. Change a token → regenerate → the whole site updates. That's the "design for scale" move: a client skin is a different `tokens.json`.

---

## 3. Site map and which template/patterns each page uses

| Page | Slug | Template | Patterns (in order) | Form / tool |
|---|---|---|---|---|
| Home | `/` | page | hero-problem · problem-trio · system-four · proof-case (Navkiran) · stat-band · fit-notfit · roadmap-steps · cta-band | Roadmap CTA → /roadmap |
| Coaching institutes | `/coaching` | page-landing | hero-problem · problem-trio · system-four · proof-case · roadmap-steps · fit-notfit · faq · cta-band | GHL form embed |
| Pitch | `/pitch` | page-pitch | hero-statement · (two traps) · stat-band ("Volume") · segment-list (institutes first) · timeline-90 · compare-table · proof-case (Navkiran only) · commitments (5) · roadmap-steps · cta-band | Roadmap CTA |
| Growth Roadmap | `/roadmap` | page-landing | hero-statement · roadmap-steps · **tool-embed [tgl_roadmap]** · faq | tgl-tools questionnaire → GHL → email report |
| Growth Calculator | `/growth-calculator` | page-landing | hero-statement · **tool-embed [tgl_calculator]** · cta-band | tgl-tools calculator → GHL → email report |
| Proof | `/proof` | page | proof-case × N · cta-band | — |
| Thinking | `/thinking` | index | post grid, pillar filters | — |
| Post | `/thinking/<slug>` | single | content · author box · faq (if any) · cta-band | — |
| About / Services | keep minimal; services collapse into Home + Coaching | | | |

Nav: Coaching · Thinking · Pitch · About · **Get your Growth Roadmap** (button). Drop "Services" and "Tools" menus — the tools are reached from CTAs, not navigation.

---

## 4. The tools plugin — `tgl-tools`

Your questionnaires are the engagement engine; they should be first-class, not form-plugin hacks.

```
wp-content/plugins/tgl-tools/
├── tgl-tools.php            # registers two blocks/shortcodes, REST routes, settings page (GHL webhook URL, Make URL)
├── blocks/roadmap/          # multi-step questionnaire (4 things + qualifiers), React or vanilla; saves progress in localStorage
├── blocks/calculator/       # inputs → live result on screen → "email me the full report" gate
├── includes/
│   ├── class-submit.php     # POST /wp-json/tgl/v1/submit → validates → forwards to GHL inbound webhook (+ UTM, fbclid, page) → returns thank-you payload
│   ├── class-score.php      # the lead-score rules from the acquisition plan, server-side, returned to GHL as a field
│   └── class-report.php     # builds the report payload; the email itself is sent by GHL (branded template) or by Make.com after Claude writes the narrative
└── assets/
```

**Flow:** visitor answers → `tgl-tools` scores and posts to GHL inbound webhook → GHL creates/updates contact with answers + score + UTMs → GHL workflow sends the branded report email (Calculator: instant, templated numbers; Roadmap: a "we're building it" message, then the 4-page Roadmap from the Roadmap Builder agent within 48h) → WhatsApp follows per Workflow 1 → you get the Slack alert. On-screen, the Calculator shows the headline number immediately and gates the full report behind the email — that's the engagement mechanic working as intended.

Keep what you already built: if your existing questionnaire logic is sound, we port the questions and scoring into this plugin rather than rebuilding them.

---

## 5. Build sequence (Web Builder, on staging, in this order)

1. **Scaffold** `tgl-theme` with `create-block-theme` or by hand; run `build-theme-json.js`; self-host fonts. Activate on staging only.
2. **Parts + rainbow rule + cta-band** → visual parity check against the live site screenshots.
3. **Patterns**, one at a time, each verified at 390px and 1280px.
4. **Templates** (page, page-landing, page-pitch, index, single).
5. **Pages** from `site/pages/*.md` specs — Coaching first (it's the ad destination), then Home, Pitch, Proof, Thinking.
6. **`tgl-tools` plugin** — port the Roadmap and Calculator questionnaires; wire to GHL webhook; test leads named `TEST-TOOLS`.
7. **Tracking** via `tgl-core` (GTM/GA4/Clarity/Pixel/Insight Tag) — SOP-001 run on staging.
8. **Content migration**: existing posts and media stay (they're in the database, not the theme).
9. **Launch**: Softaculous push to live → deactivate Elementor/ElementsKit/Hello/Fonts Plugin → re-run SOP-001 on live → delete the old plugins a week later.

Expected: 8–12 working days for theme + pages, 3–4 for the tools plugin, with you approving at steps 2, 5, 6 and 9.

---

## 6. Risks and how we hold them
- **Visual parity drift** — the agent builds "close enough" and it reads as a different brand. Hold: step 2 is a hard gate; screenshots side by side; you approve before patterns begin.
- **Fonts** — the display serif on the live site must be identified and licensed for self-hosting (Fraunces is free and close if the current one isn't).
- **Tools plugin complexity** — React blocks are the right end state but slower to build. Hold: v1 can be a vanilla-JS multi-step form; same REST route; upgrade later.
- **Elementor content loss** — pages built in Elementor don't convert automatically. Hold: every page is rebuilt from the markdown spec, which is the source of truth anyway.

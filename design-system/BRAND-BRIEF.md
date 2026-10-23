# The Growth Lab — Brand Brief
**Version 1.0 · 18 October 2026 · Owner: Architect · Every agent reads this before touching anything public.**

This is the document the agents were missing. It answers the questions a senior designer or writer asks a client on day one. Where the Architect has not yet supplied a fact, it is marked `[ARCHITECT TO CONFIRM]` — agents treat those as blanks, never as licence to invent.

---

## 1. Who we are, in one breath
The Growth Lab is an AI-native growth operator for coaching and training institutes across India. We install the system that qualifies every enquiry before it's dialled, replies on WhatsApp in under a minute, and connects ad spend to actual admissions — powered by TrueLead, our own scoring engine. Founded and run by Tejinder Singh, who teaches digital marketing and generative AI at two universities and has spent over a decade in the work.

**Master line:** We don't generate leads. We generate clients.
**Category line:** The AI growth operator for coaching institutes.
**Geography:** Pan-India. Based in Chandigarh Tricity. The site never says "North India" as a limit; it may say "from Chandigarh" as an origin.

## 2. Who we're talking to
The owner or director of a coaching institute with 2+ branches or 150+ enquiries a month, spending ₹50,000+ a month on ads, with a counselling team of three or more. 35–55. Reads on a phone, often at night. Has been burned by at least one agency. Doesn't want to learn marketing; wants to stop losing students he already paid to find. Respects people who show their work and speak plainly. Distrusts anything that looks like a template.

**They should feel, in order:** *recognised* (this is my problem, exactly) → *shown* (here's the mechanism, not a promise) → *safe* (these people are serious, they'll tell me if I'm not a fit).
**They must never feel:** *sold to.*

## 3. The reference, and what we take from it
One reference only: **clay.com.** What makes it work is not its colours; it's that every abstract concept is turned into a physical object rendered in one consistent material, and the page breathes through soft coloured panels rather than lines and boxes. Product UI appears as a confident collage, not a screenshot. The rest of the page — type, layout — stays quiet so the objects carry the personality.

**We take the principle. We do not take the look.** Clay's material is matte 3D clay. Ours is already in our logo.

## 4. Our material: print
The TGL wordmark is a stacked, chunky, 1970s screen-print: cream paper, ink letters, an offset rainbow shadow where the colour layers didn't quite register. That is the whole visual language, and the site should look like it came from the same press.

**The TGL illustration system — "paper & ink":**
- **Flat cut-paper shapes**, not 3D, not gradients. Think risograph / screen-print: solid colour layers, slight misregistration (a 2–3px offset between an object and its coloured shadow — the logo's own trick), fine grain on large fills.
- **Palette:** cream paper, ink, then the five accents (terracotta, coral, sage, mustard, teal) used as *print layers*, two or three per illustration, never all five.
- **The objects** — our equivalents of Clay's funnel and magnifying glass. Each is a thing an institute owner recognises:
  - the **enquiry card** (a paper slip with a student's details and a stamp: HOT / WARM / COLD)
  - the **phone** with a WhatsApp bubble
  - the **counsellor's desk** and handset
  - the **admissions register** (a ledger book — the thing that tells the truth)
  - the **ad poster** (what Meta shows the student)
  - the **loop arrow** (admission → back to Meta)
  - the **stamp** (TrueLead's verdict), the **rubber band**, the **paper clip**, the **sorting tray**
- **One scene per section**, built from these objects, illustrating that section's claim. The hero scene is the whole mechanism as a desk: enquiry slips arriving, being stamped, sorted into trays, the phone lighting up, the register being filled, the loop arrow going back out.
- **Built as SVG** by the Web Builder from a shared object library (`design-system/objects/*.svg`), so every illustration is sharp, under 30KB, and can be animated.

**Motion rule (revised):** motion that *explains* is allowed and encouraged — a slip moving from tray to tray, a stamp coming down, the loop arrow drawing itself — triggered once on scroll-into-view, 600–900ms, with `prefers-reduced-motion` respected. Motion that *imitates live software* (typing indicators, fake timestamps ticking) is still forbidden. Decorative motion (parallax, floating blobs) is forbidden.

**Layout rule:** sections sit on soft tinted panels (cream-deep, a pale sage, a pale mustard, a pale teal — each at ~12% tint on cream), with a small pill label top-left like Clay's DATA / AGENTS. Rounded 24px corners. The hairline dividers go; the panels do the separating.

**Mockups** stay — but as collage: two or three UI surfaces overlapping on a tinted panel, slightly offset, one of them rotated 1–2°. Confidence, not a screenshot.

**What stays forbidden:** stock photography; AI-generated scenes of people; 3D renders; gradients as decoration; more than one typeface pair; any visual that illustrates nothing.

## 5. Voice
Direct, plain, specific, a little dry. Short sentences. Hindi/Punjabi phrases are welcome where an owner would actually say them. Numbers only when screenshot-able. We say what we won't do as readily as what we will. No exclamation marks. No "unlock", "leverage", "supercharge", "game-changing". We write like someone who has done this and is slightly impatient with people who haven't.

## 6. The founder, on the site
Tejinder is the trust layer, and a one-liner undersells him. The founder block carries:
- Photo (stage, speaking — the one we have)
- Name and role
- **Three proof lines** `[ARCHITECT TO CONFIRM each]`: years in digital marketing · faculty roles (LPU, Chitkara — since when) · corporate training / empanelment (names if permitted) · a line on audience or talks if true
- One sentence in his voice about why TGL exists
- Links: LinkedIn (personal) and any other profile the Architect lists `[ARCHITECT TO CONFIRM URLs]`

Social icons: footer and founder block. Icons drawn in the paper-and-ink style, ink only, 20px.

## 7. The interactive moment — "What's not working?"
Our version of Clay's "What do you want to build?". Sits directly after the hero on the homepage and /coaching. A prompt box with five chips:
- Too many junk enquiries
- Counsellors call too late
- Can't tell which ads bring admissions
- Leads go cold on WhatsApp
- Next intake is in 60 days
Tap a chip (or type) → an answer card unfolds beneath: the one mechanism that fixes it, its illustration, one plain paragraph, and a Roadmap button that passes `?problem=<slug>` so the questionnaire opens with that answer pre-selected. Five hand-written cards, no AI generation at runtime. Typed text matches to the nearest chip by keyword; no match → a sixth card: "Tell us on the Roadmap call." Every chip tap fires `data-tgl-event="problem_pick"` with the slug. This section replaces problem-trio.

## 8. Explainer video
Animated, with voiceover. Produced by a separate Video team (see `agents/video-team/`). Until delivered, the hero-adjacent slot shows the **animated mechanism illustration** (section 4 motion rule) as the stand-in. The Web Builder and Creative Director do not wait on the video; they design for the stand-in and the slot.

## 9. The discovery rule (added to AGENTS.md)
Before building or reviewing anything public, every agent reads this brief. If a fact it needs is missing or marked `[ARCHITECT TO CONFIRM]`, the agent asks the Architect in its Brief review — a numbered list of questions — and does not guess. A senior practitioner's first instinct on a new client is to ask; ours is now written down.

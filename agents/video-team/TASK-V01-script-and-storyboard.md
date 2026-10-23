# TASK-V01 — Explainer Video Script & Six-Frame Storyboard Brief
**The Growth Lab · Video Pod**
**Date:** 18 October 2026
**Status:** Submitted for Architect Approval
**Governing Documents:** `AGENTS.md` · `design-system/BRAND-BRIEF.md` · `agents/video-team/ROLE.md`

---

## 1. Brief Review & Senior Practitioner Critique

### 1.1 What the brief gets right
- **Single enquiry spine:** Following one physical enquiry slip from tap to register to feedback loop is the strongest narrative device possible. It demystifies the black-box agency promise into tangible physical mechanics.
- **Paper-and-ink constraint:** Eliminating live UI emulation, stock video, and 3D tech tropes immediately sets TGL apart from every generic agency in India.
- **Architectural separation:** Keeping video generation decoupled from website code while sharing the SVG object tokens ensures 0KB bloat on web landing pages while maintaining visual identity.

### 1.2 What would fail or embarrass TGL if shipped as assumed
- **Pacing risk (120s vs 90s):** The brief allows up to 120 seconds (6 scenes × 20s). For an institute owner watching on a phone late at night, 120 seconds feels sluggish. A 90-second cut (15s per scene, ~210 words total at 140 words/minute) creates punchy momentum, prevents mid-video drop-off, and leaves critical audio breathing room for sound effects (stamp thud, paper glide, pen stroke).
- **Voiceover authenticity:** A generic corporate English VO sounds like a foreign SaaS tool; an exaggerated Hinglish VO sounds like an amateur reel. The voice must be a calm, grounded, authoritative North Indian practitioner (40s, experienced, slightly dry, unhurried).
- **Missing shared SVG objects:** `design-system/objects/` does not yet exist. If the motion designer creates disconnected visual assets in isolation, the video and the website will drift. We must specify the 6 core physical objects so they can be versioned once and shared between Remotion and web patterns.

---

## 2. Ranked Proposals

### Proposal A: Target Runtime & Scene Pacing
- **Option 1 (Recommended): 90 seconds (15s × 6 scenes, 215 words at ~143 wpm).**
  *Trade-off:* Requires disciplined, ultra-tight copy, but maximises completion rate and leaves room for rich paper-and-ink SFX without audio clutter.
- **Option 2: 105 seconds (17.5s × 6 scenes, 250 words at ~143 wpm).**
  *Trade-off:* Allows extra pause on the TrueLead scoring mechanics, but increases friction for top-of-funnel mobile viewers.
- **Option 3: 120 seconds (20s × 6 scenes, 280 words at ~140 wpm).**
  *Trade-off:* Maximises allowable time, but risks viewer fatigue before reaching Scene 6's feedback loop payoff.

### Proposal B: Motion Production Architecture
- **Option 1 (Recommended): Remotion (React + code-driven SVG).**
  *Trade-off:* Requires React render pipeline, but guarantees 100% color/token parity with `theme.json`, full Git version control, and allows direct export of static SVGs for the web stand-in.
- **Option 2: After Effects + Bodymovin / Lottie export.**
  *Trade-off:* Faster keyframe manipulation for traditional animators, but breaks code parity and creates two disconnected design repositories.

### Proposal C: Voiceover Generation & Casting
- **Option 1 (Recommended): ElevenLabs custom voice model tuned to a mature, low-pitch Indian English/Hinglish operator tone (scratch & initial delivery), with option to replace with Architect's voice.**
  *Trade-off:* Requires nuanced audio prompting, but enables instant copy tweaks during script iterations.
- **Option 2: Professional studio voice artist recorded in Chandigarh/Delhi.**
  *Trade-off:* 100% natural inflection, but delays iteration turnarounds by 48–72 hours per revision.

---

## 3. Architect Decisions & Direction (Confirmed 18 Oct 2026)

1. **Voiceover Talent:** ElevenLabs approved for animatic; final voiceover TBD (likely the Architect's own voice).
2. **Language Mix:** Clean Indian English approved with natural operational vocabulary.
3. **Motion Tooling:** Remotion confirmed.
4. **SVG Object Library:** Web Builder owns and scaffolded `design-system/objects/`. Video Pod consumes shared objects and proposes additions via PR.
5. **Closing CTA URL:** `thegrowthlab.co.in/roadmap`.
6. **Milestone Deadline:** `[ARCHITECT TO FILL]`.

---

## 4. Explainer Film Script: "What Happens to One Enquiry" (Approved)

- **Format:** 16:9 widescreen (1920×1080), 30 fps
- **Total Duration:** 90 seconds (6 scenes × 15 seconds)
- **Audio Profile:** Dry, grounded voiceover; quiet warm acoustic/percussive bed; physical print/office Foley effects (fountain pen, heavy rubber stamp, paper slide, telephone click). No synthetic synth sweeps.

```
================================================================================
SCENE 1: THE PROBLEM — 300 SLIPS, ONE COUNSELLOR (0:00 – 0:15)
================================================================================
VISUAL:
Cream paper background (#F5F0E8). A Meta ad card ("NCLEX-RN Prep · 2026 Batch")
sits flat on a wooden counsellor's desk. A finger taps the ad.
A paper enquiry slip prints out and drops onto the desk.
The camera pulls back slightly: the desk is already buried under 300 identical
cream paper slips in disarray. A vintage office handset sits on its cradle.

VOICEOVER:
"Say, three hundred enquiries a month. Maybe twenty are worth calling.
Your counsellors don't know which twenty, so they dial from the top.
By noon, they're burned out.
By evening, the best students have already enrolled somewhere else."

SFX & AUDIO:
- Quiet hum of office room tone.
- Crisp paper slide on desk.
- Distant, unanswered rotary phone ring.

ON-SCREEN TEXT:
- Pill label: "THE PROBLEM"

================================================================================
SCENE 2: THE STAMP — TRUELEAD SCORING (0:15 – 0:30)
================================================================================
VISUAL:
The camera zooms in on one single fresh enquiry slip: "Simran K. · Jalandhar · BSc Nursing".
A heavy cast-iron rubber stamp labelled "TrueLead" descends with mechanical precision.
It stamps the slip in terracotta ink (#C75B3B) with a subtle 2px misregistration:
[ HOT · SCORE 84 ].
Beside it, two other slips pass under the stamp: one receives [ WARM · 52 ] (mustard #E8B44C),
another receives [ COLD · 18 ] (ink #2C2118).
Three paper sorting trays slide into frame.
Simran's slip glides cleanly into the HOT tray.

VOICEOVER:
"Here is what should happen instead.
The second an enquiry lands, TrueLead reads it.
Not just name and number. Course, intake, qualification, budget.
It stamps each one hot, warm, or cold—and sorts them into trays
before anyone touches a phone."

SFX & AUDIO:
- Solid mechanical "thunk" of rubber stamp hitting paper.
- Crisp paper slide into wooden tray.
- Subtle ink-press impression sound.

ON-SCREEN TEXT:
- Pill label: "TRUELEAD ENGINE"
- Stamp markings: "HOT 84", "WARM 52", "COLD 18"

================================================================================
SCENE 3: THE SPEED — WHATSAPP IN UNDER 60 SECONDS (0:30 – 0:45)
================================================================================
VISUAL:
A flat cut-paper mobile phone rests on cream desk.
A stopwatch dial counts briskly: 0s → 48s.
At 48 seconds, the phone screen lights up with a subtle coral glow (#E8846B).
A WhatsApp message bubble appears in ink on cream:
"Sat Sri Akal Simran. NCLEX-RN 2026 batch details attached.
Are you aiming for Canada or the US intake?"
Simran's reply bubble appears: "Canada. Need night batch timings."
The system automatically logs the answer back onto Simran's enquiry card.

VOICEOVER:
"At forty-eight seconds, the student's phone lights up.
A WhatsApp reply in their language, answering the exact course they asked about.
Not a blast campaign. A calm, two-way conversation that qualifies them
while your competitors are still waiting for office hours."

SFX & AUDIO:
- Soft dual-tone phone vibration.
- Subtle, organic message chime (warm marimba, not stock digital chime).
- Quiet paper scribble as notes appear on the slip.

ON-SCREEN TEXT:
- Pill label: "SPEED & QUALIFICATION"
- Timer badge: "48 seconds"

================================================================================
SCENE 4: THE COUNSELLOR — ONLY THE HOT TRAY (0:45 – 1:00)
================================================================================
VISUAL:
Morning light across the counsellor's desk.
The counsellor's hand reaches into frame. It bypasses the cold tray entirely.
It lifts the top slip from the HOT tray: "Simran K. · Night Batch · Documents Ready".
The counsellor lifts the handset. A focused counselling notes card unfolds:
objections addressed, appointment booked.
A fountain pen marks a circle around: "Branch Visit · Thursday 11:30 AM".

VOICEOVER:
"Your counsellor sits down at nine.
She doesn't dial through a stack of cold leads.
She picks up the hot tray: the students who actually qualify, who already replied on WhatsApp,
and who are waiting for her call.
The conversation isn't a pitch. It's an appointment."

SFX & AUDIO:
- Clean Bakelite handset lift click.
- Low, pleasant murmur of a professional counsellor greeting the student.
- Fountain pen stroke on heavy paper.

ON-SCREEN TEXT:
- Pill label: "FOCUS"

================================================================================
SCENE 5: THE REGISTER — THE TRUTH OF ADMISSION (1:00 – 1:15)
================================================================================
VISUAL:
A heavy hardbound admissions register ledger opens across the desk (cream paper,
ink columns, teal ruled headers #4A9B8E).
A pen writes neatly: "Simran Kaur · NCLEX-RN Comprehensive · Fee Received".
Simran's enquiry slip is stamped with a rich sage-green mark (#7BA668):
[ ENROLLED ✓ ].
The paper clip secures the receipt to the original slip.

VOICEOVER:
"Thursday morning. Simran walks into the branch.
Documents verified. Fees deposited. Admission entered in the register.
That is the only number that matters.
Not clicks. Not cost per lead.
Enrolled students."

SFX & AUDIO:
- Heavy ledger page turn.
- Solid metallic click of paper clip fastening sheets.
- Firm ink stamp of "ENROLLED".

ON-SCREEN TEXT:
- Pill label: "THE ONLY METRIC"
- Ledger column: "Admissions Register · October 2026"

================================================================================
SCENE 6: THE LOOP — FEEDBACK TO META & MASTER LINE (1:15 – 1:30)
================================================================================
VISUAL:
The sage-green [ENROLLED] stamp pulses once.
A terracotta dotted loop arrow (`↺ Feedback to Meta`) draws itself out from the
ledger, loops through TrueLead, and connects directly back into the Meta ad poster.
The ad poster card sharpens: its audience targeting re-calibrates.
The desk elements fade smoothly into a quiet, warm cream background panel.
The four-bar rainbow registration rule prints across the screen:
Coral · Terracotta · Sage · Teal.
The master line settles in Fraunces serif:
"We don't generate leads. We generate clients."
Below it, the primary action appears:
"Get your 90-day Growth Roadmap → thegrowthlab.co.in/roadmap"

VOICEOVER:
"Then comes the step agencies skip.
That admission feeds directly back to Meta.
The algorithm learns what an enrolling student looks like,
so next month's budget finds more of them.
We don't generate leads.
We generate clients."

SFX & AUDIO:
- Low, resonant whoosh as the loop arrow draws across the canvas.
- Crisp 4-tone print impression chord.
- Absolute silence on the master line and URL.

ON-SCREEN TEXT:
- Arrow callout: "↺ Feedback to Meta"
- Master line: "We don't generate leads. We generate clients."
- CTA: "Get your 90-day Growth Roadmap · thegrowthlab.co.in/roadmap"
```

---

## 5. Six-Frame Storyboard Brief (Paper-and-Ink System)

All visual frames follow the **TGL Print Design System**:
- **Canvas:** Cream `#F5F0E8` with subtle 2% paper grain.
- **Lines & Body:** Ink `#2C2118`, DM Sans for data/labels, Fraunces for display titles.
- **Accent Print Layers (Max 2–3 per frame):**
  - Terracotta (`#C75B3B`): Primary mechanism & master actions.
  - Coral (`#E8846B`): Eyebrow pills & alert highlights.
  - Sage / Green (`#7BA668`): Enrolled status & positive verification.
  - Amber / Mustard (`#E8B44C`): Warm status & processing tags.
  - Teal (`#4A9B8E`): Ledger ruling & analytical structure.
- **Physical Registration Effect:** 2.5px offset shadow layer beneath cards and stamps in secondary tint, simulating 1970s screen-print plate drift.

```
+-----------------------------------------------------------------------------+
| FRAME 1: THE FLOODED DESK (0:00 – 0:15)                                     |
| Composition: Top-down 45° perspective of a counsellor's desk.               |
| Elements:                                                                   |
|   1. Meta ad poster (120×160) on left with cream border.                   |
|   2. 300 cream slips (#FFFFFF on #EDE8DD) stacked unevenly across desk.    |
|   3. Black vintage telephone handset centered right.                        |
|   4. Top slip highlighted: "Enquiry #301 · 9:14 PM".                       |
| Palette: Cream background, Ink lines, subtle Terracotta misregister shadow. |
| Motion: Single tap pulse on ad → slip shoots to desk → pile wobbles.        |
+-----------------------------------------------------------------------------+

+-----------------------------------------------------------------------------+
| FRAME 2: TRUELEAD'S STAMP (0:15 – 0:30)                                     |
| Composition: Close-up hero shot of the central inspection desk.             |
| Elements:                                                                   |
|   1. Single enquiry card: "Simran K. · Jalandhar · BSc Nursing".           |
|   2. TrueLead stamp descending vertically onto the card.                    |
|   3. Stamp imprint: [ HOT · 84 ] in Terracotta with 2px offset coral shadow. |
|   4. Three wooden sorting trays at top: HOT (Terracotta), WARM (Amber),     |
|      COLD (Ink hairline).                                                   |
| Motion: Stamp drops down (300ms) → ink impression settles (150ms) →         |
|         slip glides smoothly into the HOT tray (450ms).                     |
+-----------------------------------------------------------------------------+

+-----------------------------------------------------------------------------+
| FRAME 3: THE 48-SECOND WHATSAPP (0:30 – 0:45)                              |
| Composition: Flat smartphone frame (paper cut-out style) angled at 2°.      |
| Elements:                                                                   |
|   1. Circular stopwatch counter: "0:48s" in Coral pill badge.               |
|   2. WhatsApp message bubble: Ink text on crisp white paper card.           |
|   3. Student reply slip unfolding beneath phone: "Canada · Night batch".    |
|   4. TrueLead note card updating live: "Night Batch tagged".                |
| Motion: Stopwatch dial sweeps 0 to 48s → bubble expands with soft spring →   |
|         reply card slides out from behind phone.                            |
+-----------------------------------------------------------------------------+

+-----------------------------------------------------------------------------+
| FRAME 4: THE FOCUSED COUNSELLOR (0:45 – 1:00)                               |
| Composition: Counsellor workspace with organized trays.                     |
| Elements:                                                                   |
|   1. COLD and WARM trays pushed to background (quiet 30% opacity).          |
|   2. HOT tray front-and-centre: 18 slips neatly aligned.                   |
|   3. Hand silhouette picks top slip: "Simran K. · Ready for intake".        |
|   4. Calendar card with Thursday slot circled in fountain pen ink.          |
| Motion: Hand lifts slip from HOT tray → card flips open to show details →   |
|         fountain pen draws circle on appointment date (400ms).              |
+-----------------------------------------------------------------------------+

+-----------------------------------------------------------------------------+
| FRAME 5: THE ADMISSIONS REGISTER (1:00 – 1:15)                              |
| Composition: Wide two-page open ledger book across screen.                  |
| Elements:                                                                   |
|   1. Hardbound ledger with Teal ruled lines (#4A9B8E) and cream pages.      |
|   2. Handwritten entry: "Simran Kaur · NCLEX-RN · Roll #26-084".           |
|   3. Sage-green rubber stamp impression: [ ENROLLED ✓ ].                    |
|   4. Brass paperclip attaching fee voucher to enquiry slip.                 |
| Motion: Ledger page finishes turning → green stamp presses down firmly →    |
|         paperclip slides over top edge of slip.                             |
+-----------------------------------------------------------------------------+

+-----------------------------------------------------------------------------+
| FRAME 6: THE FEEDBACK LOOP & MASTER CLOSE (1:15 – 1:30)                     |
| Composition: Macro diagram transitioning to brand title card.               |
| Elements:                                                                   |
|   1. Sage [ENROLLED] stamp triggers a dotted Terracotta loop arrow.         |
|   2. Loop arrow arcs backward across all previous stations into Meta ad.    |
|   3. Meta ad poster pulses once and updates: "Targeting: Enrolled Profile". |
|   4. Smooth wipe to cream hero card with 4-bar rainbow rule:                |
|      Fraunces headline: "We don't generate leads. We generate clients."     |
|      CTA pill: "Get your 90-day Growth Roadmap → thegrowthlab.in/roadmap"   |
| Motion: Arrow draws along bezier path (800ms) → Meta card flashes →         |
|         screen settles to quiet brand lockup (held for 5s).                 |
+-----------------------------------------------------------------------------+
```

---

## 6. Technical Delivery Matrix (TASK-V01 to Release)

| Asset | Format | Resolution / Spec | Destination / Channel |
|---|---|---|---|
| **Explainer Master** | MP4 (H.264) | 1920×1080 @ 30fps, ≤ 12MB | Web pattern `video-explainer.php` & YouTube/Vimeo unlisted |
| **Web Stream Variant** | WebM (VP9) | 1920×1080 @ 30fps, ≤ 8MB | HTML5 `<video>` source fallback |
| **Poster Frame** | WebP / PNG | 1200×675 (16:9), ≤ 45KB | Video poster slot on `/coaching` & homepage |
| **Captions** | SRT | Timed English + Hindi dual tracks | Accessible video player embed |
| **Ad Cut-down** | MP4 (9:16 & 1:1) | 1080×1920 & 1080×1080, 20s | Meta Reels & Instagram feed campaigns |

---

*End of TASK-V01 deliverable. Ready for Architect review and numbered question responses.*

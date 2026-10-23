<?php
/**
 * Title: System Four
 * Slug: tgl-theme/system-four
 * Categories: tgl-sections
 * Description: Mechanism diagram (desktop horizontal / mobile vertical) + four outcome lines (anchor #system)
 */
?>
<!-- wp:group {"tagName":"section","className":"tgl-section tgl-section--system","layout":{"type":"constrained"}} -->
<section id="system" class="wp-block-group tgl-section tgl-section--system">
  <div class="tgl-container">
    <div class="tgl-panel tgl-panel--teal">
      <div class="tgl-panel-pill">THE SYSTEM</div>
      <div class="tgl-section-header tgl-section-header--panel">
        <span class="tgl-eyebrow">THE SYSTEM</span>
        <h2 class="tgl-section-title">What the system does</h2>
      </div>

    <!-- Mechanism Diagram (SVG horizontal on desktop / vertical on mobile) -->
    <div class="tgl-mechanism-wrap">
      <!-- Desktop SVG (Hidden on mobile < 768px) -->
      <svg class="tgl-mechanism-svg tgl-mechanism-desktop" viewBox="0 0 960 210" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Lead generation and attribution mechanism diagram">
        <defs>
          <marker id="arrow-hairline" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#DDD6CA"/>
          </marker>
          <marker id="arrow-terracotta" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#C75B3B"/>
          </marker>
          <filter id="card-shadow" x="-4" y="-2" width="160" height="85" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#2C2118" flood-opacity="0.04"/>
          </filter>
        </defs>

        <!-- Connectors between horizontal nodes -->
        <line x1="172" y1="58" x2="204" y2="58" stroke="#DDD6CA" stroke-width="2" marker-end="url(#arrow-hairline)"/>
        <line x1="362" y1="58" x2="394" y2="58" stroke="#DDD6CA" stroke-width="2" marker-end="url(#arrow-hairline)"/>
        <line x1="552" y1="58" x2="584" y2="58" stroke="#DDD6CA" stroke-width="2" marker-end="url(#arrow-hairline)"/>
        <line x1="742" y1="58" x2="774" y2="58" stroke="#DDD6CA" stroke-width="2" marker-end="url(#arrow-hairline)"/>

        <!-- Return Loop: Admission -> back to Meta (Terracotta Highlight) -->
        <path d="M 855 94 C 855 170, 95 170, 95 100" stroke="#C75B3B" stroke-width="2.2" stroke-dasharray="6 4" fill="none" marker-end="url(#arrow-terracotta)"/>
        
        <!-- Return Loop Label Pill -->
        <rect x="380" y="152" width="200" height="28" rx="14" fill="#F5F0E8" stroke="#C75B3B" stroke-width="1.2"/>
        <text x="480" y="170" fill="#C75B3B" font-family="'DM Sans', sans-serif" font-size="11.5" font-weight="700" text-anchor="middle" letter-spacing="0.02em">↺ back to Meta (Conversion API)</text>

        <!-- Node 1: Enquiry -->
        <g transform="translate(20, 24)">
          <rect width="152" height="68" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5" filter="url(#card-shadow)"/>
          <text x="76" y="32" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">Enquiry</text>
          <text x="76" y="50" fill="#6B625B" font-family="'DM Sans', sans-serif" font-size="11.5" text-anchor="middle">Meta / IG / Web</text>
        </g>

        <!-- Node 2: TrueLead Score -->
        <g transform="translate(210, 24)">
          <rect width="152" height="68" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5" filter="url(#card-shadow)"/>
          <text x="76" y="32" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">TrueLead score</text>
          <text x="76" y="50" fill="#7BA668" font-family="'DM Sans', sans-serif" font-size="11.5" font-weight="600" text-anchor="middle">AI hot / warm / cold</text>
        </g>

        <!-- Node 3: WhatsApp (60s) -->
        <g transform="translate(400, 24)">
          <rect width="152" height="68" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5" filter="url(#card-shadow)"/>
          <text x="76" y="32" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">WhatsApp (60s)</text>
          <text x="76" y="50" fill="#6B625B" font-family="'DM Sans', sans-serif" font-size="11.5" text-anchor="middle">24/7 instant reply</text>
        </g>

        <!-- Node 4: Counsellor -->
        <g transform="translate(590, 24)">
          <rect width="152" height="68" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5" filter="url(#card-shadow)"/>
          <text x="76" y="32" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">Counsellor</text>
          <text x="76" y="50" fill="#6B625B" font-family="'DM Sans', sans-serif" font-size="11.5" text-anchor="middle">Calls only scored list</text>
        </g>

        <!-- Node 5: Admission -->
        <g transform="translate(780, 24)">
          <rect width="152" height="68" rx="12" fill="#FFFFFF" stroke="#C75B3B" stroke-width="1.5" filter="url(#card-shadow)"/>
          <text x="76" y="32" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">Admission</text>
          <text x="76" y="50" fill="#C75B3B" font-family="'DM Sans', sans-serif" font-size="11.5" font-weight="700" text-anchor="middle">Student enrolled ✓</text>
        </g>
      </svg>

      <!-- Mobile SVG (Visible only on mobile < 768px, 340x510) -->
      <svg class="tgl-mechanism-svg tgl-mechanism-mobile" viewBox="0 0 340 500" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Lead generation and attribution mechanism diagram mobile">
        <defs>
          <marker id="m-arrow-hairline" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#DDD6CA"/>
          </marker>
          <marker id="m-arrow-terracotta" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#C75B3B"/>
          </marker>
        </defs>

        <!-- Vertical Connectors -->
        <line x1="140" y1="78" x2="140" y2="104" stroke="#DDD6CA" stroke-width="2" marker-end="url(#m-arrow-hairline)"/>
        <line x1="140" y1="168" x2="140" y2="194" stroke="#DDD6CA" stroke-width="2" marker-end="url(#m-arrow-hairline)"/>
        <line x1="140" y1="258" x2="140" y2="284" stroke="#DDD6CA" stroke-width="2" marker-end="url(#m-arrow-hairline)"/>
        <line x1="140" y1="348" x2="140" y2="374" stroke="#DDD6CA" stroke-width="2" marker-end="url(#m-arrow-hairline)"/>

        <!-- Return Loop: Admission -> back to Meta (curving right side) -->
        <path d="M 230 410 C 315 410, 315 48, 238 48" stroke="#C75B3B" stroke-width="2.2" stroke-dasharray="6 4" fill="none" marker-end="url(#m-arrow-terracotta)"/>
        <rect x="238" y="215" width="84" height="42" rx="8" fill="#F5F0E8" stroke="#C75B3B" stroke-width="1.2"/>
        <text x="280" y="233" fill="#C75B3B" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" text-anchor="middle">↺ back to</text>
        <text x="280" y="246" fill="#C75B3B" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" text-anchor="middle">Meta ads</text>

        <!-- Node 1: Enquiry -->
        <g transform="translate(30, 18)">
          <rect width="200" height="60" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="100" y="28" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">Enquiry</text>
          <text x="100" y="46" fill="#6B625B" font-family="'DM Sans', sans-serif" font-size="11.5" text-anchor="middle">Meta / IG / Website</text>
        </g>

        <!-- Node 2: TrueLead Score -->
        <g transform="translate(30, 108)">
          <rect width="200" height="60" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="100" y="28" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">TrueLead score</text>
          <text x="100" y="46" fill="#7BA668" font-family="'DM Sans', sans-serif" font-size="11.5" font-weight="600" text-anchor="middle">AI hot / warm / cold</text>
        </g>

        <!-- Node 3: WhatsApp (60s) -->
        <g transform="translate(30, 198)">
          <rect width="200" height="60" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="100" y="28" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">WhatsApp (60s)</text>
          <text x="100" y="46" fill="#6B625B" font-family="'DM Sans', sans-serif" font-size="11.5" text-anchor="middle">24/7 instant reply</text>
        </g>

        <!-- Node 4: Counsellor -->
        <g transform="translate(30, 288)">
          <rect width="200" height="60" rx="12" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="100" y="28" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">Counsellor</text>
          <text x="100" y="46" fill="#6B625B" font-family="'DM Sans', sans-serif" font-size="11.5" text-anchor="middle">Calls only scored list</text>
        </g>

        <!-- Node 5: Admission -->
        <g transform="translate(30, 378)">
          <rect width="200" height="60" rx="12" fill="#FFFFFF" stroke="#C75B3B" stroke-width="1.5"/>
          <text x="100" y="28" fill="#2C2118" font-family="'Fraunces', Georgia, serif" font-size="14.5" font-weight="700" text-anchor="middle">Admission</text>
          <text x="100" y="46" fill="#C75B3B" font-family="'DM Sans', sans-serif" font-size="11.5" font-weight="700" text-anchor="middle">Student enrolled ✓</text>
        </g>
      </svg>
    </div>

    <!-- The Four Outcome Lines -->
    <div class="tgl-system-lines">
      <div class="tgl-system-line-item">
        <span class="tgl-system-line-num">01</span>
        <p class="tgl-system-line-text">Scores every enquiry before a counsellor sees it — hot, warm, cold — using TrueLead, our own AI scoring engine.</p>
      </div>

      <div class="tgl-system-line-item">
        <span class="tgl-system-line-num">02</span>
        <p class="tgl-system-line-text">Replies on WhatsApp in under 60 seconds, 24/7, in Hindi or English, then follows up until the student answers or opts out.</p>
      </div>

      <div class="tgl-system-line-item">
        <span class="tgl-system-line-num">03</span>
        <p class="tgl-system-line-text">Pushes real admissions back to Meta, so the algorithm finds more students who enrol — not more who fill forms.</p>
      </div>

      <div class="tgl-system-line-item">
        <span class="tgl-system-line-num">04</span>
        <p class="tgl-system-line-text">Gives your team one dashboard they open every morning: enquiries → contacted → interested → enrolled, by campaign, by counsellor.</p>
      </div>
    </div>
    </div>
  </div>
</section>
<!-- /wp:group -->

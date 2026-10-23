<?php
/**
 * Title: Video Explainer Stand-in (Hero Desk Scene)
 * Slug: tgl-theme/video-explainer
 * Categories: tgl-sections
 * Description: Paper-and-ink animated desk scene stand-in with scroll-triggered explanatory motion
 */
?>
<!-- wp:group {"tagName":"section","className":"tgl-section tgl-section--desk","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-section tgl-section--desk" id="mechanism">
  <div class="tgl-container">
    <div class="tgl-panel tgl-panel--cream-deep">
      <div class="tgl-panel-pill">THE MECHANISM</div>
      
      <div class="tgl-section-header tgl-section-header--panel">
        <h2 class="tgl-section-title">The Desk: How an enquiry turns into an admission</h2>
        <p class="tgl-section-subhead">Watch the physical path every student follows through TrueLead, WhatsApp, and your counselling team.</p>
      </div>

      <!-- Desk Surface Scene -->
      <div class="tgl-desk-stage" id="tgl-hero-desk" aria-label="Interactive mechanism flow diagram">
        <div class="tgl-desk-track">
          <!-- Step 1: Enquiry Slip -->
          <div class="tgl-desk-node tgl-desk-node--slip" data-step="1">
            <div class="tgl-desk-obj-wrap">
              <img src="/wp-content/themes/tgl-theme/assets/img/objects/enquiry-slip.svg" alt="" width="88" height="88" class="tgl-desk-obj" loading="lazy" decoding="async">
            </div>
            <div class="tgl-desk-node-info">
              <span class="tgl-desk-node-step">01</span>
              <h3 class="tgl-desk-node-title">Enquiry</h3>
              <p class="tgl-desk-node-desc">Meta ad lead arrives</p>
            </div>
          </div>

          <!-- Connector 1 -->
          <div class="tgl-desk-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#C4B9AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>

          <!-- Step 2: TrueLead Stamp -->
          <div class="tgl-desk-node tgl-desk-node--stamp" data-step="2">
            <div class="tgl-desk-obj-wrap">
              <img src="/wp-content/themes/tgl-theme/assets/img/objects/truelead-stamp.svg" alt="" width="88" height="88" class="tgl-desk-obj" loading="lazy" decoding="async">
            </div>
            <div class="tgl-desk-node-info">
              <span class="tgl-desk-node-step">02</span>
              <h3 class="tgl-desk-node-title">TrueLead Stamp</h3>
              <p class="tgl-desk-node-desc">Hot / Warm / Cold scored</p>
            </div>
          </div>

          <!-- Connector 2 -->
          <div class="tgl-desk-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#C4B9AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>

          <!-- Step 3: Sorting Trays -->
          <div class="tgl-desk-node tgl-desk-node--tray" data-step="3">
            <div class="tgl-desk-obj-wrap">
              <img src="/wp-content/themes/tgl-theme/assets/img/objects/sorting-trays.svg" alt="" width="88" height="88" class="tgl-desk-obj" loading="lazy" decoding="async">
            </div>
            <div class="tgl-desk-node-info">
              <span class="tgl-desk-node-step">03</span>
              <h3 class="tgl-desk-node-title">Sorting Trays</h3>
              <p class="tgl-desk-node-desc">Top 20% routed to team</p>
            </div>
          </div>

          <!-- Connector 3 -->
          <div class="tgl-desk-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#C4B9AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>

          <!-- Step 4: Phone WhatsApp -->
          <div class="tgl-desk-node tgl-desk-node--phone" data-step="4">
            <div class="tgl-desk-obj-wrap">
              <img src="/wp-content/themes/tgl-theme/assets/img/objects/phone-whatsapp.svg" alt="" width="88" height="88" class="tgl-desk-obj" loading="lazy" decoding="async">
            </div>
            <div class="tgl-desk-node-info">
              <span class="tgl-desk-node-step">04</span>
              <h3 class="tgl-desk-node-title">WhatsApp &lt; 60s</h3>
              <p class="tgl-desk-node-desc">Concierge replies 24/7</p>
            </div>
          </div>

          <!-- Connector 4 -->
          <div class="tgl-desk-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#C4B9AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>

          <!-- Step 5: Admissions Register -->
          <div class="tgl-desk-node tgl-desk-node--register" data-step="5">
            <div class="tgl-desk-obj-wrap">
              <img src="/wp-content/themes/tgl-theme/assets/img/objects/admissions-register.svg" alt="" width="88" height="88" class="tgl-desk-obj" loading="lazy" decoding="async">
            </div>
            <div class="tgl-desk-node-info">
              <span class="tgl-desk-node-step">05</span>
              <h3 class="tgl-desk-node-title">Admissions</h3>
              <p class="tgl-desk-node-desc">Enrolment confirmed</p>
            </div>
          </div>

          <!-- Connector 5 -->
          <div class="tgl-desk-arrow" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#C4B9AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>

          <!-- Step 6: Loop Arrow Back to Meta -->
          <div class="tgl-desk-node tgl-desk-node--loop" data-step="6">
            <div class="tgl-desk-obj-wrap">
              <img src="/wp-content/themes/tgl-theme/assets/img/objects/loop-arrow.svg" alt="" width="88" height="88" class="tgl-desk-obj" loading="lazy" decoding="async">
            </div>
            <div class="tgl-desk-node-info">
              <span class="tgl-desk-node-step">06</span>
              <h3 class="tgl-desk-node-title">Loop to Meta</h3>
              <p class="tgl-desk-node-desc">Algorithm learns payers</p>
            </div>
          </div>
        </div>

        <!-- Desk Micro-Footnote -->
        <div class="tgl-desk-footnote">
          <span>Physical paper &amp; ink flow &#183; Animated sequentially on scroll</span>
        </div>
      </div>
    </div>
  </div>
</section>
<!-- /wp:group -->

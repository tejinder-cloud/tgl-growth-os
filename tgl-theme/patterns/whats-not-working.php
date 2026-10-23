<?php
/**
 * Title: What's Not Working
 * Slug: tgl-theme/whats-not-working
 * Categories: tgl-sections
 * Description: Interactive diagnostic widget with 5 chips, keyword search, and hand-written mechanism cards replacing problem-trio
 */
?>
<!-- wp:group {"tagName":"section","className":"tgl-section tgl-section--wnw","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-section tgl-section--wnw" id="diagnostic">
  <div class="tgl-container">
    <div class="tgl-panel tgl-panel--mustard">
      <div class="tgl-panel-pill">DIAGNOSTIC</div>
      
      <div class="tgl-section-header tgl-section-header--panel">
        <h2 class="tgl-section-title">What&#8217;s not working in your funnel right now?</h2>
        <p class="tgl-section-subhead">Tap your biggest bottleneck. See the exact mechanism we build to fix it.</p>
      </div>

      <!-- Problem Picker Widget -->
      <div class="tgl-wnw-widget" data-tgl-widget="problem-picker">
        <!-- Interactive Chips -->
        <div class="tgl-wnw-chips" role="tablist" aria-label="Funnel bottlenecks">
          <button type="button" class="tgl-wnw-chip is-active" role="tab" aria-selected="true" aria-controls="card-junk-enquiries" data-problem="junk-enquiries" data-keywords="junk quality volume irrelevant cold filter fake unqualified">
            Too many junk enquiries
          </button>
          <button type="button" class="tgl-wnw-chip" role="tab" aria-selected="false" aria-controls="card-late-calls" data-problem="late-calls" data-keywords="late call delay speed counsellor night slow morning response">
            Counsellors call too late
          </button>
          <button type="button" class="tgl-wnw-chip" role="tab" aria-selected="false" aria-controls="card-blind-spending" data-problem="blind-spending" data-keywords="blind spending ads meta attribution roi admissions cost wasted campaign">
            Can&#8217;t tell which ads bring admissions
          </button>
          <button type="button" class="tgl-wnw-chip" role="tab" aria-selected="false" aria-controls="card-cold-whatsapp" data-problem="cold-whatsapp" data-keywords="cold whatsapp ghost drop nurture sequence message unanswered">
            Leads go cold on WhatsApp
          </button>
          <button type="button" class="tgl-wnw-chip" role="tab" aria-selected="false" aria-controls="card-intake-60-days" data-problem="intake-60-days" data-keywords="intake 60 days urgent fast launch quick start deadline seats quota">
            Next intake is in 60 days
          </button>
        </div>

        <!-- Search Input Filter -->
        <div class="tgl-wnw-search-wrap">
          <svg class="tgl-wnw-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="tgl-wnw-search" placeholder="Or type your bottleneck (e.g. counsellor delay, junk leads)..." aria-label="Search funnel bottleneck">
        </div>

        <!-- Hand-Written Mechanism Cards -->
        <div class="tgl-wnw-cards">
          <!-- Card 1: junk-enquiries (Default Active) -->
          <div class="tgl-wnw-card is-active" id="card-junk-enquiries" role="tabpanel" data-card-slug="junk-enquiries">
            <div class="tgl-wnw-card-content">
              <span class="tgl-wnw-mechanism-pill">Mechanism 01</span>
              <h3 class="tgl-wnw-card-title">TrueLead AI Intent Scoring</h3>
              <p class="tgl-wnw-card-copy">You don&#8217;t have a lead volume problem; you have a filter problem. TrueLead evaluates qualification, course readiness, destination country, and timing before dialling. Your counsellors only dial the top 20% who can actually enrol, while cold leads receive automated nurture.</p>
              <a href="/roadmap?problem=junk-enquiries&src=coaching" class="tgl-btn-primary tgl-wnw-cta" data-tgl-event="roadmap_cta_click" data-tgl-problem="junk-enquiries">
                Get your Growth Roadmap
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
            <div class="tgl-wnw-card-visual" aria-hidden="true">
              <div class="tgl-wnw-visual-pair">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/enquiry-slip.svg" alt="" width="100" height="100" class="tgl-wnw-obj tgl-wnw-obj--slip" loading="lazy" decoding="async">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/truelead-stamp.svg" alt="" width="90" height="90" class="tgl-wnw-obj tgl-wnw-obj--stamp" loading="lazy" decoding="async">
              </div>
            </div>
          </div>

          <!-- Card 2: late-calls -->
          <div class="tgl-wnw-card" id="card-late-calls" role="tabpanel" data-card-slug="late-calls" hidden>
            <div class="tgl-wnw-card-content">
              <span class="tgl-wnw-mechanism-pill">Mechanism 02</span>
              <h3 class="tgl-wnw-card-title">Sub-60s Automated WhatsApp Outreach</h3>
              <p class="tgl-wnw-card-copy">When an enquiry lands at 9:30 PM, manual calling at 11:00 AM next morning means the student has already engaged two competitors. Our concierge replies in under 60 seconds, 24/7, answers core intake questions, and books a call directly onto your counsellor&#8217;s calendar.</p>
              <a href="/roadmap?problem=late-calls&src=coaching" class="tgl-btn-primary tgl-wnw-cta" data-tgl-event="roadmap_cta_click" data-tgl-problem="late-calls">
                Get your Growth Roadmap
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
            <div class="tgl-wnw-card-visual" aria-hidden="true">
              <div class="tgl-wnw-visual-single">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/phone-whatsapp.svg" alt="" width="110" height="110" class="tgl-wnw-obj" loading="lazy" decoding="async">
              </div>
            </div>
          </div>

          <!-- Card 3: blind-spending -->
          <div class="tgl-wnw-card" id="card-blind-spending" role="tabpanel" data-card-slug="blind-spending" hidden>
            <div class="tgl-wnw-card-content">
              <span class="tgl-wnw-mechanism-pill">Mechanism 03</span>
              <h3 class="tgl-wnw-card-title">Closed-Loop Attribution &amp; Feedback to Meta</h3>
              <p class="tgl-wnw-card-copy">Meta optimises for clicks and form-fills, not classroom seats. We match admission receipts back to the exact campaign, ad set, and creative that originated them. The algorithm stops hunting for cheap leads and begins hunting for paying students.</p>
              <a href="/roadmap?problem=blind-spending&src=coaching" class="tgl-btn-primary tgl-wnw-cta" data-tgl-event="roadmap_cta_click" data-tgl-problem="blind-spending">
                Get your Growth Roadmap
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
            <div class="tgl-wnw-card-visual" aria-hidden="true">
              <div class="tgl-wnw-visual-pair">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/admissions-register.svg" alt="" width="105" height="105" class="tgl-wnw-obj" loading="lazy" decoding="async">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/loop-arrow.svg" alt="" width="85" height="85" class="tgl-wnw-obj tgl-wnw-obj--loop" loading="lazy" decoding="async">
              </div>
            </div>
          </div>

          <!-- Card 4: cold-whatsapp -->
          <div class="tgl-wnw-card" id="card-cold-whatsapp" role="tabpanel" data-card-slug="cold-whatsapp" hidden>
            <div class="tgl-wnw-card-content">
              <span class="tgl-wnw-mechanism-pill">Mechanism 04</span>
              <h3 class="tgl-wnw-card-title">Systematic Multi-Touch Follow-up Engine</h3>
              <p class="tgl-wnw-card-copy">Most enquiries drop off because follow-up is manual, irregular, and stops after two attempts. Our engine sequences course brochures, fee breakdowns, and counsellor reminders automatically until the student replies or explicitly opts out.</p>
              <a href="/roadmap?problem=cold-whatsapp&src=coaching" class="tgl-btn-primary tgl-wnw-cta" data-tgl-event="roadmap_cta_click" data-tgl-problem="cold-whatsapp">
                Get your Growth Roadmap
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
            <div class="tgl-wnw-card-visual" aria-hidden="true">
              <div class="tgl-wnw-visual-single">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/sorting-trays.svg" alt="" width="110" height="110" class="tgl-wnw-obj" loading="lazy" decoding="async">
              </div>
            </div>
          </div>

          <!-- Card 5: intake-60-days -->
          <div class="tgl-wnw-card" id="card-intake-60-days" role="tabpanel" data-card-slug="intake-60-days" hidden>
            <div class="tgl-wnw-card-content">
              <span class="tgl-wnw-mechanism-pill">Mechanism 05</span>
              <h3 class="tgl-wnw-card-title">Rapid 10-Day Deployment &amp; Live Funnel Audit</h3>
              <p class="tgl-wnw-card-copy">You don&#8217;t have time for a three-month agency onboarding. We audit your existing ad accounts and landing funnels live on our diagnostic call, deploy the scoring and WhatsApp reply pipeline within 10 days, and fill seat quotas for the upcoming intake.</p>
              <a href="/roadmap?problem=intake-60-days&src=coaching" class="tgl-btn-primary tgl-wnw-cta" data-tgl-event="roadmap_cta_click" data-tgl-problem="intake-60-days">
                Get your Growth Roadmap
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
            <div class="tgl-wnw-card-visual" aria-hidden="true">
              <div class="tgl-wnw-visual-pair">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/ad-poster.svg" alt="" width="100" height="100" class="tgl-wnw-obj" loading="lazy" decoding="async">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/counsellor-handset.svg" alt="" width="95" height="95" class="tgl-wnw-obj" loading="lazy" decoding="async">
              </div>
            </div>
          </div>

          <!-- Card 6: Fallback (typed search with no match) -->
          <div class="tgl-wnw-card tgl-wnw-card--fallback" id="card-fallback" role="tabpanel" data-card-slug="other" hidden>
            <div class="tgl-wnw-card-content">
              <span class="tgl-wnw-mechanism-pill">Custom Diagnostic</span>
              <h3 class="tgl-wnw-card-title">Tell us on the Roadmap call.</h3>
              <p class="tgl-wnw-card-copy">Every coaching institute has unique bottlenecks across branch routing, entrance exams, or counsellor turnover. Share your intake specifics on the diagnostic call and we&#8217;ll map the fix into your 90-day plan.</p>
              <a href="/roadmap?problem=other&src=coaching" class="tgl-btn-primary tgl-wnw-cta" data-tgl-event="roadmap_cta_click" data-tgl-problem="other">
                Get your Growth Roadmap
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </a>
            </div>
            <div class="tgl-wnw-card-visual" aria-hidden="true">
              <div class="tgl-wnw-visual-single">
                <img src="/wp-content/themes/tgl-theme/assets/img/objects/admissions-register.svg" alt="" width="110" height="110" class="tgl-wnw-obj" loading="lazy" decoding="async">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
<!-- /wp:group -->

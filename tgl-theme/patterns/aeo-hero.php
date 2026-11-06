<?php
/**
 * Title: AEO Hero
 * Slug: tgl-theme/aeo-hero
 * Categories: tgl-hero, featured
 * Description: /aeo hero. Eyebrow + H1 with italic accent + subhead + two CTAs + microline.
 */
?>
<!-- wp:group {"tagName":"section","className":"tgl-hero tgl-aeo-hero","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-hero tgl-aeo-hero">
  <div class="tgl-container">
    <div class="tgl-hero-content">
      <span class="tgl-eyebrow">AI SEARCH AUDIT FOR COACHING INSTITUTES</span>

      <h1 class="tgl-hero-title">Your next student is asking ChatGPT. Does it say your <em>name</em>?</h1>

      <p class="tgl-hero-subhead">More parents and students now ask an AI assistant which institute to join. We check what ChatGPT, Gemini and Perplexity say about yours, and send you a written audit.</p>

      <div class="tgl-hero-actions">
        <a href="#audit" class="tgl-btn-primary" data-tgl-event="aeo_cta_click" data-tgl-position="hero">
          Request your AI search audit
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
        <a href="#checks" class="tgl-btn-secondary">What we check</a>
      </div>

      <div class="tgl-microline">One short form. The report comes to your WhatsApp.</div>
    </div>

    <!-- Paper-and-ink scene: a phone with a question bubble, three slips (one stamped), misregistered 3px layer offset. Flat shapes, two print layers (terracotta, teal). -->
    <figure class="tgl-aeo-scene" aria-hidden="true">
      <svg viewBox="0 0 480 300" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" role="presentation" focusable="false">
        <!-- misregistered shadow layer -->
        <g fill="#2F7F7A" opacity="0.9" transform="translate(3 3)">
          <rect x="40" y="40" width="130" height="220" rx="18"/>
          <rect x="230" y="60" width="200" height="56" rx="6"/>
          <rect x="230" y="130" width="200" height="56" rx="6"/>
          <rect x="230" y="200" width="200" height="56" rx="6"/>
        </g>
        <!-- ink / paper layer -->
        <g stroke="#1B1A17" stroke-width="2.5" stroke-linejoin="round">
          <rect x="40" y="40" width="130" height="220" rx="18" fill="#F6F0E1"/>
          <rect x="56" y="76" width="98" height="40" rx="12" fill="#C8553D"/>
          <path d="M70 116 l-8 12 l20 -12" fill="#C8553D"/>
          <rect x="56" y="136" width="70" height="22" rx="8" fill="#F6F0E1"/>
          <rect x="56" y="168" width="84" height="22" rx="8" fill="#F6F0E1"/>
          <rect x="230" y="60" width="200" height="56" rx="6" fill="#F6F0E1"/>
          <rect x="230" y="130" width="200" height="56" rx="6" fill="#F6F0E1"/>
          <rect x="230" y="200" width="200" height="56" rx="6" fill="#F6F0E1"/>
        </g>
        <!-- slip lines -->
        <g stroke="#1B1A17" stroke-width="2" stroke-linecap="round" opacity="0.55">
          <path d="M246 80h96M246 96h128"/>
          <path d="M246 150h110M246 166h80"/>
          <path d="M246 220h96M246 236h120"/>
        </g>
        <!-- stamp on the first slip only -->
        <g transform="rotate(-8 392 88)">
          <rect x="356" y="72" width="62" height="28" rx="4" fill="none" stroke="#C8553D" stroke-width="3"/>
          <path d="M366 86h42" stroke="#C8553D" stroke-width="3" stroke-linecap="round"/>
        </g>
      </svg>
    </figure>
  </div>
</section>
<!-- /wp:group -->

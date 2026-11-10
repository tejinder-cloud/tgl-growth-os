<?php
/**
 * Title: Home Hero
 * Slug: tgl-theme/home-hero
 * Categories: tgl-hero
 * Description: Home (/) hero, anchor #audit. One website field. Submitting opens /aeo?site=...&source=home_hero#audit. No lead is submitted from Home; the /aeo form collects the full field set.
 */
?>
<!-- wp:group {"tagName":"section","anchor":"audit","className":"tgl-home-hero","layout":{"type":"constrained"}} -->
<section id="audit" class="wp-block-group tgl-home-hero">
  <div class="h-wrap">
    <span class="h-eyebrow">DOES CHATGPT RECOMMEND YOUR BUSINESS?</span>
    <h1>We get businesses recommended by AI, and we run their busywork on AI agents &mdash; the same way we run our own company.</h1>

    <!-- wp:html -->
    <!-- Plain GET form, no script and no endpoint: the browser opens /aeo?site=<value>&source=home_hero#audit. -->
    <form class="h-hero-form" id="tgl-home-form" method="get" action="/aeo#audit" data-tgl-form="home-hero">
      <div class="h-field">
        <label for="home-site">Your website</label>
        <input type="text" id="home-site" name="site" inputmode="url" autocomplete="url" placeholder="yourbusiness.com" required maxlength="200">
      </div>
      <input type="hidden" name="source" value="home_hero">
      <button type="submit" class="h-btn" data-tgl-event="home_audit_cta_click">See what AI says about you</button>
      <p class="h-micro">Free. One-page audit, sent to your WhatsApp.</p>
    </form>

    <a class="h-hero-link" href="https://project.thegrowthlab.co.in" data-tgl-event="home_board_click">See our agents at work</a>
    <!-- /wp:html -->
  </div>
</section>
<!-- /wp:group -->

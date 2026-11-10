<?php
/**
 * Title: Home Founder, FAQ and CTA Band
 * Slug: tgl-theme/home-founder-faq-cta
 * Categories: tgl-sections
 * Description: Home sections 7, 8 and 9. FAQ uses core Details blocks for FAQPage schema. The calendar link renders only when TGL_HOME_CALENDAR_URL is defined. Founder photo is tejinder-stage.webp with an @2x srcset.
 */
$tgl_calendar = apply_filters(
    'tgl_home_calendar_url',
    defined( 'TGL_HOME_CALENDAR_URL' ) ? TGL_HOME_CALENDAR_URL : ''
);
?>
<!-- wp:group {"tagName":"section","className":"tgl-home-founder","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-founder">
  <div class="h-wrap">
    <span class="h-pill">WHO IS BEHIND IT</span>
    <!-- wp:html -->
    <div class="h-founder">
      <figure class="h-founder-photo">
        <img src="<?php echo esc_url( get_theme_file_uri( 'assets/img/tejinder-stage.webp' ) ); ?>" srcset="<?php echo esc_url( get_theme_file_uri( 'assets/img/tejinder-stage.webp' ) ); ?> 1x, <?php echo esc_url( get_theme_file_uri( 'assets/img/tejinder-stage@2x.webp' ) ); ?> 2x" width="400" height="500" alt="Tejinder Singh, founder of The Growth Lab, speaking on stage." loading="lazy">
      </figure>
      <div>
        <h2>Tejinder Singh</h2>
        <p><strong>Founder, The Growth Lab</strong></p>
        <ul>
          <li>18 years in sales and marketing, the last 3 in artificial intelligence.</li>
          <li>Visiting faculty in Digital Marketing and Artificial Intelligence at Lovely Professional University and Chitkara University.</li>
          <li>Consultant on AI and automation to corporates.</li>
          <li>IBM certificate: Generative AI &mdash; Introduction and Applications.</li>
        </ul>
        <p>I built the agents that run this company before I offered to build yours.</p>
        <p><a href="https://www.linkedin.com/in/stejindersingh/" target="_blank" rel="noopener">LinkedIn</a> &middot; <a href="/about">More about Tejinder</a></p>
      </div>
    </div>
    <!-- /wp:html -->
  </div>
</section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"tgl-home-faq","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-faq">
  <div class="h-wrap h-faq">
    <h2>Questions, answered.</h2>

    <!-- wp:details {"className":"tgl-faq-item"} -->
    <details class="wp-block-details tgl-faq-item"><summary>What is AI visibility?</summary>
      <!-- wp:paragraph --><p>It is whether AI assistants like ChatGPT, Gemini and Perplexity name your business when someone asks them for a recommendation, and whether what they say about you is right.</p><!-- /wp:paragraph -->
    </details>
    <!-- /wp:details -->

    <!-- wp:details {"className":"tgl-faq-item"} -->
    <details class="wp-block-details tgl-faq-item"><summary>Can you guarantee ChatGPT will recommend us?</summary>
      <!-- wp:paragraph --><p>No, and nobody honestly can. We find out what the assistants say today, fix what they read about you, and show you every week whether it is changing.</p><!-- /wp:paragraph -->
    </details>
    <!-- /wp:details -->

    <!-- wp:details {"className":"tgl-faq-item"} -->
    <details class="wp-block-details tgl-faq-item"><summary>What does the free audit include?</summary>
      <!-- wp:paragraph --><p>A one-page report, by email within 24 hours: the questions we asked, which assistants named you, who they named instead, and the first fixes. No payment and no card.</p><!-- /wp:paragraph -->
    </details>
    <!-- /wp:details -->

    <!-- wp:details {"className":"tgl-faq-item"} -->
    <details class="wp-block-details tgl-faq-item"><summary>What do your AI agents actually do?</summary>
      <!-- wp:paragraph --><p>Reply to enquiries, qualify leads, follow up on WhatsApp and email, prepare reports and handle routine back-office tasks. A person reviews their work.</p><!-- /wp:paragraph -->
    </details>
    <!-- /wp:details -->

    <!-- wp:details {"className":"tgl-faq-item"} -->
    <details class="wp-block-details tgl-faq-item"><summary>Where do you work?</summary>
      <!-- wp:paragraph --><p>With businesses anywhere in India. Everything we do runs online: the audit, the dashboard, the fixes and the monthly report.</p><!-- /wp:paragraph -->
    </details>
    <!-- /wp:details -->
  </div>
</section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"tgl-home-cta h-cta","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-cta h-cta">
  <div class="h-wrap">
    <h2>Find out what AI says about your business.</h2>
    <!-- wp:html -->
    <p><a class="h-btn" href="#audit" data-tgl-event="home_audit_cta_click">Get your free AI visibility audit</a></p>
    <?php if ( $tgl_calendar ) : ?>
    <p><a href="<?php echo esc_url( $tgl_calendar ); ?>" data-tgl-event="calendar_open">Book a 20-minute call</a></p>
    <?php endif; ?>
    <p><a href="mailto:sales@thegrowthlab.co.in" data-tgl-event="email_click">sales@thegrowthlab.co.in</a> &middot; WhatsApp <a href="https://wa.me/919872009997" data-tgl-event="whatsapp_click">+91 98720 09997</a></p>
    <!-- /wp:html -->
  </div>
</section>
<!-- /wp:group -->

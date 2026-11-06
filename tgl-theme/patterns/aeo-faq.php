<?php
/**
 * Title: AEO FAQ
 * Slug: tgl-theme/aeo-faq
 * Categories: tgl-content
 * Description: /aeo FAQ with details blocks and matching FAQPage JSON-LD, plus the closing CTA band.
 */
$tgl_aeo_faq = array(
    array( 'What is an AI search audit?', 'We ask ChatGPT, Gemini and Perplexity the questions a student or parent would ask when choosing an institute, and write down what they answer about you and about the institutes they name instead.' ),
    array( 'What do I get?', 'A written report: where you are named, where you are not, what is wrong in what they say, and what to fix first.' ),
    array( 'Do you need access to my accounts?', 'No. The audit uses only what is public.' ),
    array( 'Will you message me after?', 'On WhatsApp, about this audit. Reply STOP and we stop.' ),
    array( 'Is this the same as SEO?', 'Related, not the same. SEO decides where you rank on a results page. This is about whether an AI assistant names you at all, and what it says.' ),
    array( 'Do you guarantee that an AI will recommend me?', 'No. Nobody controls those answers. The report lists what you can change; it does not promise an outcome.' ),
);
$tgl_aeo_schema = array(
    '@context'   => 'https://schema.org',
    '@type'      => 'FAQPage',
    'mainEntity' => array_map(
        function ( $qa ) {
            return array(
                '@type'          => 'Question',
                'name'           => $qa[0],
                'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $qa[1] ),
            );
        },
        $tgl_aeo_faq
    ),
);
?>
<!-- wp:group {"tagName":"section","className":"tgl-aeo-panel tgl-aeo-panel--cream tgl-aeo-faq","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-aeo-panel tgl-aeo-panel--cream tgl-aeo-faq">
  <span class="tgl-aeo-pill">Questions</span>
  <h2>Before you request it</h2>
  <?php foreach ( $tgl_aeo_faq as $qa ) : ?>
  <details>
    <summary><?php echo esc_html( $qa[0] ); ?></summary>
    <p><?php echo esc_html( $qa[1] ); ?></p>
  </details>
  <?php endforeach; ?>
  <script type="application/ld+json"><?php echo wp_json_encode( $tgl_aeo_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); ?></script>
</section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"tgl-cta-band","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-cta-band" id="aeo-cta-band">
  <div class="tgl-container">
    <h2>Find out what the assistants say about <em>you</em>.</h2>
    <p>One form. A written report.</p>
    <a href="#audit" class="tgl-btn-primary" data-tgl-event="aeo_cta_click" data-tgl-position="cta-band">Request your AI search audit</a>
  </div>
</section>
<!-- /wp:group -->

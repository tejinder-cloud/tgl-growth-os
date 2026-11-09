<?php
/**
 * Title: Home Doors, Agents and How
 * Slug: tgl-theme/home-doors-agents-how
 * Categories: tgl-sections
 * Description: Home sections 4, 5 and 6. The org chart is read from assets/data/home-agents.json, which site/build-home-agents.js builds from config/agents.yaml.
 */
$tgl_agents_file = get_theme_file_path( 'assets/data/home-agents.json' );
$tgl_agents      = file_exists( $tgl_agents_file ) ? json_decode( (string) file_get_contents( $tgl_agents_file ), true ) : array();
$tgl_groups      = is_array( $tgl_agents ) && ! empty( $tgl_agents['groups'] ) ? $tgl_agents['groups'] : array();

$tgl_captures_file = get_theme_file_path( 'assets/data/home-captures.json' );
$tgl_captures      = file_exists( $tgl_captures_file ) ? json_decode( (string) file_get_contents( $tgl_captures_file ), true ) : array();
$tgl_board         = is_array( $tgl_captures ) && ! empty( $tgl_captures['board']['file'] ) && ! empty( $tgl_captures['board']['captured'] ) ? $tgl_captures['board'] : null;
$tgl_pdf           = is_array( $tgl_captures ) && ! empty( $tgl_captures['audit_pdf']['file'] ) && ! empty( $tgl_captures['audit_pdf']['captured'] ) ? $tgl_captures['audit_pdf'] : null;
?>
<!-- wp:group {"tagName":"section","className":"tgl-home-doors","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-doors">
  <div class="h-wrap">
    <span class="h-pill">WHAT WE DO</span>
    <h2>Get found. Then never lose the lead.</h2>
    <!-- wp:html -->
    <div class="h-doors">
      <article class="h-door h-door--aeo">
        <span class="h-eyebrow">AEO + TRUEVISIBLE</span>
        <h3>ChatGPT recommends your competitor.</h3>
        <p>We find out what ChatGPT, Gemini and Perplexity say about your business, fix what they get wrong, and track it every week on your own dashboard.</p>
        <a href="/aeo">See how AEO works</a>
      </article>
      <article class="h-door h-door--auto">
        <span class="h-eyebrow">AI AUTOMATION</span>
        <h3>Leads come in. Nobody calls back in time.</h3>
        <p>AI agents that reply to every enquiry within minutes, qualify it, follow up on WhatsApp and email, and hand your team the ones ready to buy. Plus the reports and back-office work nobody has time for.</p>
        <a href="/ai-automation">See what our agents do</a>
      </article>
    </div>
    <!-- /wp:html -->
  </div>
</section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"tgl-home-agents","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-agents">
  <div class="h-wrap">
    <div class="h-panel h-panel--teal">
      <span class="h-pill">OUR AGENT TEAM</span>
      <h2>The Growth Lab runs on AI agents. Here is the team.</h2>
      <p>Every agent has a job title, a daily routine and a reviewer. They report in our company Slack at 6 PM. Agents do the work. Tejinder signs off.</p>

      <!-- wp:html -->
      <?php foreach ( $tgl_groups as $tgl_g ) :
          $tgl_on   = 0;
          $tgl_join = 0;
          foreach ( $tgl_g['agents'] as $tgl_a ) {
              if ( 'active' === $tgl_a['status'] ) { $tgl_on++; } elseif ( 'planned' === $tgl_a['status'] ) { $tgl_join++; }
          }
          ?>
      <details class="h-dept" open>
        <summary><?php echo esc_html( $tgl_g['label'] ); ?> &middot; <?php echo (int) $tgl_on; ?> on duty &middot; <?php echo (int) $tgl_join; ?> joining</summary>
        <div class="h-agents">
          <?php foreach ( $tgl_g['agents'] as $tgl_a ) :
              $tgl_active = ( 'active' === $tgl_a['status'] );
              ?>
          <div class="h-agent <?php echo $tgl_active ? 'h-agent--active' : 'h-agent--planned'; ?>">
            <h3><?php echo esc_html( $tgl_a['title'] ); ?></h3>
            <p><?php echo esc_html( $tgl_a['line'] ); ?></p>
            <strong><?php echo $tgl_active ? 'On duty' : 'Joining'; ?></strong>
          </div>
          <?php endforeach; ?>
        </div>
      </details>
      <?php endforeach; ?>
      <script>
      // At 390px each department starts collapsed (title and count); on wider screens all are open.
      (function () {
        if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
          document.querySelectorAll('.tgl-home .h-dept').forEach(function (d) { d.removeAttribute('open'); });
        }
      })();
      </script>

      <?php if ( $tgl_board ) : ?>
      <figure class="h-capture">
        <img src="<?php echo esc_url( get_theme_file_uri( 'assets/img/home/' . basename( $tgl_board['file'] ) ) ); ?>" alt="The Growth Lab live agent board, captured <?php echo esc_attr( $tgl_board['captured'] ); ?>." loading="lazy">
        <figcaption>The live board, captured <?php echo esc_html( $tgl_board['captured'] ); ?>.</figcaption>
      </figure>
      <?php endif; ?>
      <p><a href="https://project.thegrowthlab.co.in" data-tgl-event="home_board_click">Open the live board</a></p>
      <!-- /wp:html -->
    </div>
  </div>
</section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"tgl-home-how","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-how">
  <div class="h-wrap">
    <span class="h-pill">HOW IT WORKS</span>
    <h2>Four steps, and you can stop after any of them.</h2>
    <!-- wp:html -->
    <ol class="h-steps">
      <li><strong>Free audit.</strong> Tell us your business. We ask the AI assistants what your buyers would ask.</li>
      <li><strong>Honest report.</strong> A one-page report on WhatsApp: where you are named, where you are not, and what to fix first. It is yours either way.</li>
      <li><strong>Fix or track.</strong> Track it yourself on the TrueVisible dashboard, or let us do the fixes for you.</li>
      <li><strong>Monthly report.</strong> What we changed, and what the AI assistants say now.</li>
    </ol>
    <?php if ( $tgl_pdf ) : ?>
    <figure class="h-capture">
      <img src="<?php echo esc_url( get_theme_file_uri( 'assets/img/home/' . basename( $tgl_pdf['file'] ) ) ); ?>" alt="The Growth Lab's own one-page AI visibility audit." loading="lazy">
      <figcaption>Our own audit, dated <?php echo esc_html( $tgl_pdf['captured'] ); ?>.</figcaption>
    </figure>
    <?php endif; ?>
    <!-- /wp:html -->
  </div>
</section>
<!-- /wp:group -->

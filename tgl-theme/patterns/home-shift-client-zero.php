<?php
/**
 * Title: Home Shift and Client Zero
 * Slug: tgl-theme/home-shift-client-zero
 * Categories: tgl-sections
 * Description: Home sections 2 and 3. The shift (captured AI answer, rendered only when a dated capture exists) and Client Zero live tiles (render a dash unless the company service answers).
 */
$tgl_captures_file = get_theme_file_path( 'assets/data/home-captures.json' );
$tgl_captures      = file_exists( $tgl_captures_file ) ? json_decode( (string) file_get_contents( $tgl_captures_file ), true ) : array();
$tgl_ai_answer     = is_array( $tgl_captures ) && ! empty( $tgl_captures['ai_answer']['file'] ) && ! empty( $tgl_captures['ai_answer']['captured'] ) ? $tgl_captures['ai_answer'] : null;
$tgl_stats_endpoint = apply_filters(
    'tgl_home_stats_endpoint',
    defined( 'TGL_HOME_STATS_ENDPOINT' ) ? TGL_HOME_STATS_ENDPOINT : ''
);
?>
<!-- wp:group {"tagName":"section","className":"tgl-home-shift","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-shift">
  <div class="h-wrap">
    <span class="h-pill">THE SHIFT</span>
    <h2>Your buyers used to Google you. Now they ask ChatGPT, and it answers with one name.</h2>
    <p>A patient looking for a clinic, a parent choosing an institute, a family booking a hotel &mdash; more of them now ask an AI assistant and take the answer it gives. If your business is not in that answer, you were never in the running.</p>

    <!-- wp:html -->
    <div class="h-two">
      <figure class="h-capture" aria-label="A search results page: ten links">
        <svg viewBox="0 0 320 240" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A search results page with ten links">
          <g fill="none" stroke="#1B1A17" stroke-width="2">
            <rect x="8" y="8" width="304" height="224" rx="8"/>
            <path d="M24 34h272" stroke-width="3"/>
          </g>
          <g stroke="#1B1A17" stroke-width="2" stroke-linecap="round" opacity=".6">
            <path d="M24 56h120M24 68h200M24 88h110M24 100h190M24 120h130M24 132h180M24 152h100M24 164h210M24 184h140M24 196h170"/>
          </g>
        </svg>
        <figcaption>Search: ten links.</figcaption>
      </figure>
      <?php if ( $tgl_ai_answer ) : ?>
      <figure class="h-capture">
        <img src="<?php echo esc_url( get_theme_file_uri( 'assets/img/home/' . basename( $tgl_ai_answer['file'] ) ) ); ?>" alt="An AI assistant answer captured by the TGL Citation Tracker, with every business name except The Growth Lab greyed out." loading="lazy">
        <figcaption>AI answer, captured <?php echo esc_html( $tgl_ai_answer['captured'] ); ?>.</figcaption>
      </figure>
      <?php endif; ?>
    </div>
    <!-- /wp:html -->

    <p>For hospitals and clinics, coaching institutes, hotels, real-estate developers and D2C brands, across India.</p>
  </div>
</section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"tgl-home-client-zero","layout":{"type":"constrained"}} -->
<section class="wp-block-group tgl-home-client-zero">
  <div class="h-wrap">
    <div class="h-panel h-panel--coral">
      <span class="h-pill">CLIENT ZERO</span>
      <h2>We track ourselves first.</h2>
      <p>Before we audit anyone, we run our own tracker on The Growth Lab every day. These are our real numbers, including the ones we are not proud of yet.</p>

      <!-- wp:html -->
      <ul class="h-tiles" id="tgl-home-tiles" data-endpoint="<?php echo esc_url( $tgl_stats_endpoint ); ?>">
        <li class="h-tile"><b data-stat="questions_tracked">&mdash;</b><span>Questions tracked</span></li>
        <li class="h-tile"><b data-stat="engines_checked">&mdash;</b><span>AI engines checked</span></li>
        <li class="h-tile"><b data-stat="times_named_latest">&mdash;</b><span>Times AI named The Growth Lab, latest run</span></li>
        <li class="h-tile"><b data-stat="first_run_figure">&mdash;</b><span id="tgl-home-start-label">Where we started</span></li>
        <li class="h-tile"><b data-stat="last_run_date">&mdash;</b><span>Last run</span></li>
      </ul>
      <script>
      (function () {
        var list = document.getElementById('tgl-home-tiles');
        if (!list) return;
        var endpoint = list.getAttribute('data-endpoint');
        var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        function fmt(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)); return m ? (parseInt(m[3], 10) + ' ' + M[parseInt(m[2], 10) - 1] + ' ' + m[1]) : String(v); }
        if (!endpoint) return; // no endpoint configured: every tile keeps its dash, no typed fallback
        fetch(endpoint, { headers: { Accept: 'application/json' } })
          .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
          .then(function (d) {
            list.querySelectorAll('[data-stat]').forEach(function (el) {
              var v = d && d[el.getAttribute('data-stat')];
              if (v !== undefined && v !== null && v !== '') el.textContent = fmt(v);
            });
            if (d && d.first_run_date) document.getElementById('tgl-home-start-label').textContent = 'Where we started, ' + fmt(d.first_run_date);
          })
          .catch(function () { /* unreachable service: all tiles stay as a dash */ });
      })();
      </script>
      <!-- /wp:html -->

      <p><a href="/aeo">How the audit works</a></p>
    </div>
  </div>
</section>
<!-- /wp:group -->

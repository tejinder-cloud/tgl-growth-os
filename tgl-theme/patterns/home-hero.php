<?php
/**
 * Title: Home Hero
 * Slug: tgl-theme/home-hero
 * Categories: tgl-hero
 * Description: Home (/) hero, anchor #audit. Two-field inline form posting to the tgl-ops /aeo/lead endpoint with source=home_hero.
 */
$tgl_aeo_endpoint = apply_filters(
    'tgl_aeo_endpoint',
    defined( 'TGL_AEO_ENDPOINT' ) ? TGL_AEO_ENDPOINT : ''
);
?>
<!-- wp:group {"tagName":"section","anchor":"audit","className":"tgl-home-hero","layout":{"type":"constrained"}} -->
<section id="audit" class="wp-block-group tgl-home-hero">
  <div class="h-wrap">
    <span class="h-eyebrow">DOES CHATGPT RECOMMEND YOUR BUSINESS?</span>
    <h1>We get businesses recommended by AI, and we run their busywork on AI agents &mdash; the same way we run our own company.</h1>

    <!-- wp:html -->
    <form class="h-hero-form" id="tgl-home-form" novalidate data-endpoint="<?php echo esc_url( $tgl_aeo_endpoint ); ?>" data-tgl-form="home-hero">
      <div class="h-field">
        <label for="home-business">Your website or business name</label>
        <input type="text" id="home-business" name="business" autocomplete="url" required maxlength="200" aria-describedby="home-business-err">
        <p class="h-err" id="home-business-err" role="alert"></p>
      </div>
      <div class="h-field">
        <label for="home-phone">WhatsApp number</label>
        <input type="tel" id="home-phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="98765 43210 or +country code" required maxlength="30" aria-describedby="home-phone-err">
        <p class="h-err" id="home-phone-err" role="alert"></p>
      </div>
      <div class="h-hp" aria-hidden="true">
        <label for="home-hp">Leave this field empty</label>
        <input type="text" id="home-hp" name="hp" tabindex="-1" autocomplete="off">
      </div>
      <button type="submit" class="h-btn" data-tgl-event="home_audit_cta_click">See what AI says about you</button>
      <p class="h-micro">Free. One-page audit, sent to your WhatsApp.</p>
      <p class="h-err" id="tgl-home-status" role="status" aria-live="polite"></p>
    </form>

    <div class="h-done" id="tgl-home-done" hidden tabindex="-1">
      <strong>Received.</strong> We will message you on WhatsApp at this number.
    </div>

    <a class="h-hero-link" href="https://project.thegrowthlab.co.in" data-tgl-event="home_board_click">See our agents at work</a>

    <script>
    (function () {
      var form = document.getElementById('tgl-home-form');
      if (!form) return;
      var statusEl = document.getElementById('tgl-home-status');
      var done = document.getElementById('tgl-home-done');
      var btn = form.querySelector('button[type="submit"]');
      var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'src'];
      function utm() {
        var out = {}, p = new URLSearchParams(window.location.search);
        UTM_KEYS.forEach(function (k) { var v = p.get(k); if (v) out[k] = v; });
        return out;
      }
      function err(id, msg) { var e = document.getElementById(id); if (e) e.textContent = msg || ''; }
      function status(msg) { statusEl.textContent = msg || ''; }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        err('home-business-err', ''); err('home-phone-err', ''); status('');
        var endpoint = form.getAttribute('data-endpoint');
        var business = form.elements.business.value.trim();
        var phone = form.elements.phone.value.trim();
        var bad = false;
        if (business.length < 2) { err('home-business-err', 'Tell us your website or business name.'); bad = true; }
        if (phone.replace(/\D/g, '').length < 10) { err('home-phone-err', 'Enter a WhatsApp number we can reach, 10 digits or +country code.'); bad = true; }
        if (bad) return;
        if (!endpoint) { status('Requests are temporarily unavailable. Please try again in a few minutes.'); return; }
        btn.disabled = true;
        status('Sending.');
        // Two fields only, as specified. The endpoint decides whether this is enough; success is shown only on ok:true.
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'home_hero',
            business: business,
            website: business,
            phone: phone,
            hp: form.elements.hp.value,
            utm: utm(),
            pagePath: window.location.pathname
          })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
        }).then(function (r) {
          if (r.status === 200 && r.data && r.data.ok === true) {
            form.hidden = true; done.hidden = false; done.focus(); status('');
            if (window.dataLayer && window.dataLayer.push) window.dataLayer.push({ event: 'aeo_audit_submit' });
            return;
          }
          status('We could not save your request. Please try again in a few minutes.');
          btn.disabled = false;
        }).catch(function () {
          status('We could not save your request. Please check your connection and try again.');
          btn.disabled = false;
        });
      });
    })();
    </script>
    <!-- /wp:html -->
  </div>
</section>
<!-- /wp:group -->

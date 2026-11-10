<?php
/**
 * Title: AEO Audit Form
 * Slug: tgl-theme/aeo-audit-form
 * Categories: tgl-form
 * Description: /aeo audit request form (anchor #audit). Posts JSON to the tgl-ops endpoint, which writes the lead to the GHL AEO pipeline.
 */
$tgl_aeo_endpoint = apply_filters(
    'tgl_aeo_endpoint',
    defined( 'TGL_AEO_ENDPOINT' ) ? TGL_AEO_ENDPOINT : ''
);
?>
<!-- wp:group {"tagName":"section","anchor":"audit","className":"tgl-aeo-panel tgl-aeo-panel--teal","layout":{"type":"constrained"}} -->
<section id="audit" class="wp-block-group tgl-aeo-panel tgl-aeo-panel--teal">
  <span class="tgl-aeo-pill">Request the audit</span>
  <h2>Tell us which institute to look at.</h2>

  <!-- wp:html -->
  <form class="tgl-aeo-form" id="tgl-aeo-form" novalidate data-endpoint="<?php echo esc_url( $tgl_aeo_endpoint ); ?>" data-tgl-form="aeo-audit">
    <div class="tgl-aeo-field">
      <label for="aeo-name">Your name</label>
      <input type="text" id="aeo-name" name="name" autocomplete="name" required maxlength="80" aria-describedby="aeo-name-err">
      <p class="tgl-aeo-err" id="aeo-name-err" role="alert"></p>
    </div>
    <div class="tgl-aeo-field">
      <label for="aeo-institute">Institute name</label>
      <input type="text" id="aeo-institute" name="institute" autocomplete="organization" required maxlength="120" aria-describedby="aeo-institute-err">
      <p class="tgl-aeo-err" id="aeo-institute-err" role="alert"></p>
    </div>
    <div class="tgl-aeo-field">
      <label for="aeo-website">Website</label>
      <input type="text" id="aeo-website" name="website" inputmode="url" autocomplete="url" placeholder="yourinstitute.com" required maxlength="200" aria-describedby="aeo-website-err">
      <p class="tgl-aeo-err" id="aeo-website-err" role="alert"></p>
    </div>
    <div class="tgl-aeo-field">
      <label for="aeo-phone">WhatsApp number</label>
      <input type="tel" id="aeo-phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="98765 43210" required maxlength="30" aria-describedby="aeo-phone-err">
      <p class="tgl-aeo-err" id="aeo-phone-err" role="alert"></p>
    </div>
    <div class="tgl-aeo-field">
      <label for="aeo-email">Email</label>
      <input type="email" id="aeo-email" name="email" autocomplete="email" required maxlength="120" aria-describedby="aeo-email-err">
      <p class="tgl-aeo-err" id="aeo-email-err" role="alert"></p>
    </div>
    <div class="tgl-aeo-field">
      <label for="aeo-question">A question you want us to ask the AI about your institute <span class="tgl-aeo-opt">(optional)</span></label>
      <textarea id="aeo-question" name="question" rows="3" maxlength="300" placeholder="Best NEET coaching in Ludhiana for droppers"></textarea>
    </div>
    <div class="tgl-aeo-field">
      <label class="tgl-aeo-consent" for="aeo-consent">
        <input type="checkbox" id="aeo-consent" name="consent" value="1" required aria-describedby="aeo-consent-err">
        <span>You may message me on WhatsApp and email about this audit.</span>
      </label>
      <p class="tgl-aeo-err" id="aeo-consent-err" role="alert"></p>
    </div>
    <div class="tgl-aeo-hp" aria-hidden="true">
      <label for="aeo-hp">Leave this field empty</label>
      <input type="text" id="aeo-hp" name="hp" tabindex="-1" autocomplete="off">
    </div>
    <button type="submit" class="tgl-aeo-submit" data-tgl-event="aeo_cta_click" data-tgl-position="form">Request your AI search audit</button>
    <p class="tgl-aeo-status" id="tgl-aeo-status" role="status" aria-live="polite"></p>
  </form>

  <div class="tgl-aeo-done" id="tgl-aeo-done" hidden tabindex="-1">
    <strong>Received.</strong>
    <p>We will message you on WhatsApp at the number you gave. If you want to add a question, reply to that message.</p>
  </div>

  <script>
  (function () {
    var form = document.getElementById('tgl-aeo-form');
    if (!form) return;
    var statusEl = document.getElementById('tgl-aeo-status');
    var done = document.getElementById('tgl-aeo-done');
    var btn = form.querySelector('button[type="submit"]');
    var FIELDS = ['name', 'institute', 'website', 'phone', 'email', 'consent'];
    var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'src'];

    function readUtm() {
      var out = {};
      var params = new URLSearchParams(window.location.search);
      UTM_KEYS.forEach(function (k) {
        var v = params.get(k);
        if (v) {
          out[k] = v;
          try { sessionStorage.setItem('tgl_' + k, v); } catch (e) {}
        } else {
          try { var s = sessionStorage.getItem('tgl_' + k); if (s) out[k] = s; } catch (e) {}
        }
      });
      return out;
    }

    function setError(field, msg) {
      var err = document.getElementById('aeo-' + field + '-err');
      var input = form.elements[field];
      if (err) err.textContent = msg || '';
      var wrap = input && input.closest ? input.closest('.tgl-aeo-field') : null;
      if (wrap) wrap.setAttribute('data-invalid', msg ? 'true' : 'false');
    }
    function clearErrors() { FIELDS.forEach(function (f) { setError(f, ''); }); }
    function setStatus(msg, state) { statusEl.textContent = msg || ''; statusEl.setAttribute('data-state', state || ''); }

    function clientCheck(v) {
      var errs = {};
      if (v.name.trim().length < 2) errs.name = 'Tell us your name.';
      if (v.institute.trim().length < 2) errs.institute = 'Tell us the institute name.';
      if (!/\.[a-z]{2,}/i.test(v.website.trim())) errs.website = 'Enter your website, for example yourinstitute.com.';
      if (v.phone.replace(/\D/g, '').length < 10) errs.phone = 'Enter a WhatsApp number we can reach, 10 digits.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) errs.email = 'Enter a valid email address.';
      if (!v.consent) errs.consent = 'We need your OK to message you on WhatsApp and email.';
      return errs;
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearErrors();
      setStatus('');

      var endpoint = form.getAttribute('data-endpoint');
      if (!endpoint) {
        setStatus('Requests are temporarily unavailable. Please try again in a few minutes.', 'error');
        return;
      }
      var values = {
        name: form.elements.name.value,
        institute: form.elements.institute.value,
        website: form.elements.website.value,
        phone: form.elements.phone.value,
        email: form.elements.email.value,
        question: form.elements.question.value,
        consent: form.elements.consent.checked,
        hp: form.elements.hp.value,
        utm: readUtm(),
        pagePath: window.location.pathname
      };
      var errs = clientCheck(values);
      var keys = Object.keys(errs);
      if (keys.length) {
        keys.forEach(function (k) { setError(k, errs[k]); });
        var first = form.elements[keys[0]];
        if (first && first.focus) first.focus();
        return;
      }

      btn.disabled = true;
      setStatus('Sending.', '');
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
      }).then(function (r) {
        if (r.status === 200 && r.data && r.data.ok === true) {
          form.hidden = true;
          done.hidden = false;
          done.focus();
          setStatus('');
          // Fire only on confirmed success. Uses analytics already on the site; adds nothing.
          if (window.dataLayer && window.dataLayer.push) window.dataLayer.push({ event: 'aeo_audit_submit' });
          if (typeof window.fbq === 'function') window.fbq('track', 'Lead');
          return;
        }
        if (r.status === 422 && r.data && r.data.errors) {
          Object.keys(r.data.errors).forEach(function (k) { setError(k, r.data.errors[k]); });
          setStatus('Please fix the fields marked above.', 'error');
        } else {
          setStatus('We could not save your request. Please try again in a few minutes.', 'error');
        }
        btn.disabled = false;
      }).catch(function () {
        setStatus('We could not save your request. Please check your connection and try again.', 'error');
        btn.disabled = false;
      });
    });
  })();
  </script>
  <!-- /wp:html -->
</section>
<!-- /wp:group -->

<!-- wp:html -->
<script>
// Arrival from the Home hero: /aeo?site=<website>&source=home_hero#audit.
// Pre-fills the Website field only. The visitor completes the rest of this form, so the endpoint still
// receives the full /aeo field set. source=home_hero is kept as the lead's "src" attribution, which the
// existing sourceLabel() already reads; no endpoint change.
(function () {
  var params = new URLSearchParams(window.location.search);
  var site = params.get('site');
  var website = document.getElementById('aeo-website');
  if (site && website && !website.value) website.value = site.slice(0, 200);
  if (params.get('source') === 'home_hero' && !params.get('src')) {
    try { sessionStorage.setItem('tgl_src', 'home_hero'); } catch (e) {}
  }
})();
</script>
<!-- /wp:html -->

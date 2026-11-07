<?php
/**
 * Title: AEO Sticky Mobile CTA
 * Slug: tgl-theme/aeo-sticky-cta
 * Categories: tgl-utility
 * Description: Mobile-only fixed CTA for /aeo. Shows after 1,200px of scroll on viewports under 768px, hides while the form or footer is in view.
 */
?>
<!-- wp:html -->
<style>
.tgl-aeo-sticky { display: none; position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 50; background: var(--tgl-terracotta, #C8553D); color: #fffdf7; border: 1.5px solid var(--tgl-ink, #1B1A17); border-radius: 999px; padding: 14px 24px; min-height: 48px; font-weight: 600; text-decoration: none; box-shadow: 3px 3px 0 var(--tgl-ink, #1B1A17); white-space: nowrap; }
.tgl-aeo-sticky[data-show="true"] { display: inline-flex; align-items: center; }
@media (min-width: 768px) { .tgl-aeo-sticky, .tgl-aeo-sticky[data-show="true"] { display: none; } }
</style>
<a href="#audit" class="tgl-aeo-sticky" id="tgl-aeo-sticky" data-tgl-event="aeo_cta_click" data-tgl-position="sticky">Request your AI search audit</a>
<script>
(function () {
  var el = document.getElementById('tgl-aeo-sticky');
  if (!el || !('IntersectionObserver' in window)) return;
  var scrolled = false, blocked = 0;
  function render() { el.setAttribute('data-show', scrolled && blocked === 0 ? 'true' : 'false'); }
  window.addEventListener('scroll', function () { var s = window.scrollY > 1200; if (s !== scrolled) { scrolled = s; render(); } }, { passive: true });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var was = e.target.__tglIn === true;
      if (e.isIntersecting && !was) blocked++;
      if (!e.isIntersecting && was) blocked--;
      e.target.__tglIn = e.isIntersecting;
    });
    render();
  });
  ['audit', 'aeo-cta-band'].forEach(function (id) { var n = document.getElementById(id); if (n) io.observe(n); });
  var f = document.querySelector('footer'); if (f) io.observe(f);
})();
</script>
<!-- /wp:html -->

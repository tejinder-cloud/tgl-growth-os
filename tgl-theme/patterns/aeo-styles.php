<?php
/**
 * Title: AEO Styles
 * Slug: tgl-theme/aeo-styles
 * Categories: tgl-utility
 * Inserter: false
 * Description: Scoped styles for the /aeo page. Insert once, first on the page. Uses theme tokens where they exist, with paper-and-ink fallbacks.
 */
?>
<!-- wp:html -->
<style>
.tgl-aeo-hero .tgl-container { display: grid; gap: 32px; align-items: center; }
.tgl-aeo-scene { margin: 0; max-width: 520px; }
.tgl-aeo-scene svg { display: block; width: 100%; height: auto; }
@media (min-width: 900px) {
  .tgl-aeo-hero .tgl-container { grid-template-columns: 1.1fr 0.9fr; gap: 56px; }
}

.tgl-aeo-panel { border-radius: 24px; padding: clamp(24px, 5vw, 56px); margin: 24px auto; max-width: 1120px; }
.tgl-aeo-panel--sage { background: var(--tgl-sage-tint, #E9EEE3); }
.tgl-aeo-panel--mustard { background: var(--tgl-mustard-tint, #F6EDD3); }
.tgl-aeo-panel--teal { background: var(--tgl-teal-tint, #E1EEEC); }
.tgl-aeo-panel--cream { background: var(--tgl-cream-deep, #EFE7D2); }
.tgl-aeo-pill { display: inline-block; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; padding: 4px 12px; border: 1.5px solid var(--tgl-ink, #1B1A17); border-radius: 999px; margin-bottom: 16px; }
.tgl-aeo-panel h2 { margin: 0 0 16px; }
.tgl-aeo-grid { display: grid; gap: 20px; grid-template-columns: 1fr; padding: 0; margin: 24px 0 0; list-style: none; }
@media (min-width: 720px) { .tgl-aeo-grid--2 { grid-template-columns: 1fr 1fr; } .tgl-aeo-grid--3 { grid-template-columns: repeat(3, 1fr); } }
.tgl-aeo-grid li { background: var(--tgl-cream, #F6F0E1); border: 1.5px solid var(--tgl-ink, #1B1A17); border-radius: 16px; padding: 20px; box-shadow: 3px 3px 0 var(--tgl-terracotta, #C8553D); }

.tgl-aeo-form { display: grid; gap: 16px; max-width: 640px; }
.tgl-aeo-field { display: grid; gap: 6px; }
.tgl-aeo-field label { font-weight: 600; }
.tgl-aeo-field .tgl-aeo-opt { font-weight: 400; opacity: 0.7; }
.tgl-aeo-field input[type="text"],
.tgl-aeo-field input[type="email"],
.tgl-aeo-field input[type="tel"],
.tgl-aeo-field input[type="url"],
.tgl-aeo-field textarea { font: inherit; font-size: 16px; padding: 12px 14px; border: 1.5px solid var(--tgl-ink, #1B1A17); border-radius: 12px; background: #fffdf7; color: var(--tgl-ink, #1B1A17); width: 100%; box-sizing: border-box; }
.tgl-aeo-field input:focus-visible,
.tgl-aeo-field textarea:focus-visible,
.tgl-aeo-submit:focus-visible { outline: 3px solid var(--tgl-teal, #2F7F7A); outline-offset: 2px; }
.tgl-aeo-field[data-invalid="true"] input,
.tgl-aeo-field[data-invalid="true"] textarea { border-color: var(--tgl-terracotta, #C8553D); border-width: 2.5px; }
.tgl-aeo-err { color: #9A3420; font-size: 14px; min-height: 0; margin: 0; }
.tgl-aeo-consent { display: flex; gap: 10px; align-items: flex-start; }
.tgl-aeo-consent input { margin-top: 4px; width: 20px; height: 20px; flex: none; }
.tgl-aeo-hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.tgl-aeo-submit { font: inherit; font-weight: 600; cursor: pointer; border: 1.5px solid var(--tgl-ink, #1B1A17); background: var(--tgl-terracotta, #C8553D); color: #fffdf7; border-radius: 999px; padding: 14px 28px; min-height: 48px; justify-self: start; }
.tgl-aeo-submit[disabled] { opacity: 0.6; cursor: progress; }
.tgl-aeo-status { margin: 0; }
.tgl-aeo-status[data-state="error"] { color: #9A3420; }
.tgl-aeo-done { border: 1.5px solid var(--tgl-ink, #1B1A17); border-radius: 16px; padding: 24px; background: var(--tgl-cream, #F6F0E1); box-shadow: 3px 3px 0 var(--tgl-teal, #2F7F7A); max-width: 640px; }

.tgl-aeo-faq details { border-top: 1.5px solid var(--tgl-ink, #1B1A17); padding: 16px 0; }
.tgl-aeo-faq summary { cursor: pointer; font-weight: 600; }
.tgl-aeo-faq details p { margin: 12px 0 0; }
</style>
<!-- /wp:html -->

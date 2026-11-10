<?php
/**
 * Title: Home Styles
 * Slug: tgl-theme/home-styles
 * Categories: tgl-sections
 * Description: Scoped styles for the Home page sections. Colour roles: coral for AEO, teal for AI Automation, ink on cream for everything else.
 */
?>
<!-- wp:html -->
<style>
.tgl-home{--h-ink:#1B1A17;--h-cream:#F6F0E1;--h-coral:#C8553D;--h-teal:#2F7F7A;color:var(--h-ink)}
.tgl-home section{padding:56px 20px}
.tgl-home .h-wrap{max-width:1080px;margin:0 auto}
.tgl-home .h-pill{display:inline-block;border:2px solid var(--h-ink);border-radius:999px;padding:4px 14px;font-size:.75rem;letter-spacing:.08em;font-weight:700;margin-bottom:16px}
.tgl-home .h-eyebrow{display:block;font-size:.8rem;letter-spacing:.1em;font-weight:700;margin-bottom:12px}
.tgl-home h1{font-size:clamp(1.9rem,5vw,3.2rem);line-height:1.12;margin:0 0 28px}
.tgl-home h2{font-size:clamp(1.5rem,3.6vw,2.2rem);line-height:1.2;margin:0 0 16px}
.tgl-home .h-btn{display:inline-block;background:var(--h-ink);color:var(--h-cream);border:2px solid var(--h-ink);border-radius:8px;padding:14px 22px;font-weight:700;text-decoration:none;cursor:pointer;font:inherit;font-weight:700}
.tgl-home .h-btn:focus-visible,.tgl-home a:focus-visible,.tgl-home input:focus-visible,.tgl-home summary:focus-visible{outline:3px solid var(--h-teal);outline-offset:2px}
.tgl-home .h-btn[disabled]{opacity:.6;cursor:not-allowed}
/* hero */
.tgl-home .h-hero-form{display:grid;gap:12px;max-width:560px}
.tgl-home .h-field label{display:block;font-weight:700;margin-bottom:4px}
.tgl-home .h-field input{width:100%;box-sizing:border-box;padding:12px;border:2px solid var(--h-ink);border-radius:8px;background:#fff;color:var(--h-ink);font:inherit}
.tgl-home .h-err{color:var(--h-coral);font-size:.875rem;min-height:1em;margin:4px 0 0}
.tgl-home .h-micro{font-size:.875rem;margin:0}
.tgl-home .h-hero-link{display:inline-block;margin-top:16px}
.tgl-home .h-hp{position:absolute;left:-9999px;height:0;overflow:hidden}
.tgl-home .h-done{border:2px solid var(--h-ink);border-radius:8px;padding:16px;max-width:560px}
/* shift */
.tgl-home .h-two{display:grid;gap:20px;grid-template-columns:1fr}
.tgl-home .h-capture{margin:0;border:2px solid var(--h-ink);border-radius:8px;padding:12px;background:#fff}
.tgl-home .h-capture img{max-width:100%;height:auto;display:block}
.tgl-home .h-capture figcaption{font-size:.8rem;margin-top:8px}
/* client zero (coral) */
.tgl-home .h-panel{border:2px solid var(--h-ink);border-radius:12px;padding:28px 20px;background:#fff}
.tgl-home .h-panel--coral{border-color:var(--h-coral)}
.tgl-home .h-panel--teal{border-color:var(--h-teal)}
.tgl-home .h-tiles{display:grid;gap:12px;grid-template-columns:1fr 1fr;margin:20px 0;padding:0;list-style:none}
.tgl-home .h-tile{border:2px solid var(--h-coral);border-radius:8px;padding:14px;background:var(--h-cream)}
.tgl-home .h-tile b{display:block;font-size:2rem;line-height:1;color:var(--h-coral)}
.tgl-home .h-tile span{font-size:.85rem}
/* doors */
.tgl-home .h-doors{display:grid;gap:20px;grid-template-columns:1fr}
.tgl-home .h-door{border:2px solid var(--h-ink);border-radius:12px;padding:24px 20px;background:#fff}
.tgl-home .h-door--aeo{border-color:var(--h-coral)}
.tgl-home .h-door--aeo .h-eyebrow,.tgl-home .h-door--aeo a{color:var(--h-coral)}
.tgl-home .h-door--auto{border-color:var(--h-teal)}
.tgl-home .h-door--auto .h-eyebrow,.tgl-home .h-door--auto a{color:var(--h-teal)}
/* agents (teal) */
.tgl-home .h-dept{border-top:2px solid var(--h-teal);padding:12px 0}
.tgl-home .h-dept summary{cursor:pointer;font-weight:700;padding:8px 0}
.tgl-home .h-agents{display:grid;gap:12px;grid-template-columns:1fr;padding:8px 0 0}
.tgl-home .h-agent{border:2px solid var(--h-teal);border-radius:8px;padding:12px}
.tgl-home .h-agent--active{background:var(--h-teal);color:var(--h-cream)}
.tgl-home .h-agent--planned{background:transparent;color:var(--h-ink)}
.tgl-home .h-agent h3{margin:0 0 4px;font-size:1rem}
.tgl-home .h-agent p{margin:0 0 8px;font-size:.85rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tgl-home .h-agent strong{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase}
/* how */
.tgl-home .h-steps{padding-left:20px}
.tgl-home .h-steps li{margin-bottom:12px}
/* founder */
.tgl-home .h-founder{display:grid;gap:24px;grid-template-columns:1fr;align-items:start}
.tgl-home .h-founder-photo{border:4px solid var(--h-ink);border-radius:8px;overflow:hidden;background:var(--h-ink);aspect-ratio:4/5;margin:0}
.tgl-home .h-founder-photo img{width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block}
/* faq + cta */
.tgl-home .h-faq details{border-top:2px solid var(--h-ink);padding:12px 0}
.tgl-home .h-faq summary{font-weight:700;cursor:pointer}
.tgl-home .h-cta{background:var(--h-ink);color:var(--h-cream);text-align:left}
.tgl-home .h-cta a:not(.h-btn){color:var(--h-cream)}
.tgl-home .h-cta .h-btn{background:var(--h-cream);color:var(--h-ink);border-color:var(--h-cream)}
@media (min-width:768px){
  .tgl-home section{padding:80px 32px}
  .tgl-home .h-two,.tgl-home .h-doors{grid-template-columns:1fr 1fr}
  .tgl-home .h-tiles{grid-template-columns:repeat(5,1fr)}
  .tgl-home .h-agents{grid-template-columns:repeat(3,1fr)}
  .tgl-home .h-founder{grid-template-columns:minmax(0,380px) 1fr}
}
</style>
<!-- /wp:html -->

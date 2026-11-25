// services/tgl-ops/src/agents/pipeline/shell.ts
// One frame for the private pages (25 Nov 2026): Overview, Outreach, Pipeline and Build share a centred column,
// a header aligned to it, the same tabs, and the same panel, table and pill styles. A page adds only its own CSS.

export type Tab = "overview" | "outreach" | "pipeline" | "build";

const TABS: { id: Tab; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/pipeline/live" },
  { id: "outreach", label: "Outreach", href: "/pipeline/outreach" },
  { id: "pipeline", label: "Pipeline", href: "/pipeline" },
  { id: "build", label: "Build", href: "/pipeline/build" },
];

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const BASE_CSS = `@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:400 700;font-display:swap;src:url(/book/assets/fraunces-latin-italic.woff2) format("woff2")}
:root{--paper:#F5F0E8;--paper-2:#EDE8DD;--white:#FFFDF9;--ink:#2C2118;--ink-2:#3A3028;--mute:#6B625B;--grey:#D9D1C5;--terra:#C75B3B;--terra-text:#B94B35;--coral:#E8846B;--sage:#7BA668;--sage-dk:#4F7A3E;--mustard:#E8B44C;--teal:#4A9B8E;--serif:"Fraunces",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif;--w:1200px;--gut:24px}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}p{margin:0}h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.02em}
.wrap{max-width:var(--w);margin:0 auto;padding:0 var(--gut)}
.hd{border-bottom:1px solid var(--paper-2);background:var(--paper)}
.hd .wrap{display:flex;align-items:center;gap:28px;min-height:60px}
.hd img{height:34px;display:block}
.tabs{display:flex;gap:4px;margin:0;padding:0;list-style:none;flex:1}
.tabs a{display:block;text-decoration:none;font-weight:600;font-size:.92rem;color:var(--ink-2);padding:18px 10px 16px;border-bottom:3px solid transparent}
.tabs a:hover{color:var(--ink)}.tabs a[aria-current]{color:var(--terra-text);border-bottom-color:var(--terra)}
.me{display:flex;gap:14px;align-items:center;font-size:.82rem;color:var(--mute);white-space:nowrap}.me a{font-weight:600;color:var(--ink-2);text-decoration:none}.me a:hover{text-decoration:underline}
.title{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:12px;padding-top:26px;padding-bottom:16px}
h1{font-size:clamp(1.7rem,3.6vw,2.4rem);letter-spacing:-.032em;line-height:1.1}.acc{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--terra-text)}
.sub1{color:var(--mute);font-size:.9rem;margin-top:6px}
.refresh{font:600 .85rem var(--sans);background:var(--white);color:var(--ink);border:2px solid var(--ink);border-radius:10px;padding:7px 14px;cursor:pointer;box-shadow:2px 2px 0 var(--grey)}
.refresh:active{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--grey)}
main.wrap{padding-bottom:48px}
.row{display:grid;gap:16px;margin-bottom:16px}.row.two{grid-template-columns:repeat(2,minmax(0,1fr))}.row.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.panel{background:var(--white);border:2px solid var(--ink);border-radius:14px;padding:18px 20px;min-width:0}
.panel h2{font-size:1.02rem;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.panel h2 .more{margin-left:auto;font-size:.82rem;font-weight:600;color:var(--terra-text)}
.count{font-size:.74rem;background:var(--ink);color:var(--paper);border-radius:999px;padding:1px 9px;font-weight:600}
.lead{color:var(--mute);font-size:.88rem;margin:-4px 0 10px}
.ok{color:var(--mute)}.sub{display:block;font-size:.82rem;color:var(--mute);margin-top:1px}
.list{list-style:none;margin:0;padding:0}.list>li{display:grid;grid-template-columns:1fr auto;gap:4px 14px;align-items:start;padding:9px 0;border-bottom:1px solid var(--paper-2)}.list>li:last-child{border-bottom:0}
.pill{font-size:.72rem;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap;border:1.5px solid var(--grey);color:var(--mute)}
.pill.good{background:#E3EEDC;border-color:#E3EEDC;color:var(--sage-dk)}.pill.bad{background:#F6DDD3;border-color:#F6DDD3;color:var(--terra-text)}.pill.warn{background:#F7EBCB;border-color:#F7EBCB;color:#7A5A12}
table{width:100%;border-collapse:collapse;font-size:.9rem}thead th{text-align:left;font-size:.75rem;color:var(--mute);font-weight:600;padding:4px 10px 6px 0;border-bottom:1.5px solid var(--grey)}
td{padding:8px 10px 8px 0;border-bottom:1px solid var(--paper-2);vertical-align:top}td b{font-weight:600}
.num{text-align:right;white-space:nowrap}
details>summary{cursor:pointer;color:var(--mute);font-weight:600;font-size:.88rem;margin-top:8px}
.foot{color:var(--mute);font-size:.8rem;margin-top:8px}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px}
@media (max-width:900px){.row.two,.row.three{grid-template-columns:1fr}.hd .wrap{flex-wrap:wrap;gap:0 20px;padding-top:8px}.tabs{order:3;flex-basis:100%;overflow-x:auto}.tabs a{padding:10px 10px 10px}}
@media (max-width:600px){:root{--gut:14px}table thead{display:none}table,tbody,tr,td{display:block}tr{padding:8px 0;border-bottom:1px solid var(--paper-2)}td{border:0;padding:2px 0}}`;

export interface ShellOptions {
  title: string;
  tab: Tab;
  email: string;
  /** Heading HTML (already escaped). */
  heading: string;
  /** One line under the heading, plain text. */
  subline?: string;
  main: string;
  css?: string;
  /** When set, the page refreshes its main part from this URL every minute and on the Refresh button. */
  partUrl?: string;
}

export function renderShell(o: ShellOptions): string {
  const tabs = TABS.map((t) => `<li><a href="${t.href}"${t.id === o.tab ? ' aria-current="page"' : ""}>${t.label}</a></li>`).join("");
  const refresh = o.partUrl
    ? `<script>
(function(){
  var busy=false,url=${JSON.stringify(o.partUrl)};
  function load(){
    if(busy)return;busy=true;
    var b=document.getElementById("refresh");b.textContent="Refreshing";
    var open=[].map.call(document.querySelectorAll("#main details[open]"),function(d){return d.id}).filter(Boolean);
    fetch(url,{credentials:"same-origin"}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h){document.getElementById("main").innerHTML=h;open.forEach(function(id){var d=document.getElementById(id);if(d)d.open=true})}}).catch(function(){}).then(function(){busy=false;b.textContent="Refresh"});
  }
  document.getElementById("refresh").addEventListener("click",load);
  setInterval(function(){if(!document.hidden)load()},60000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)load()});
})();
</script>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(o.title)} | The Growth Lab</title>
<style>
${BASE_CSS}
${o.css || ""}
</style></head><body>
<header class="hd"><div class="wrap"><a href="/pipeline/live"><img src="/book/assets/logo.png" alt="The Growth Lab" width="60" height="34"></a>
<nav aria-label="Pages" style="display:contents"><ul class="tabs">${tabs}</ul></nav>
<p class="me"><a href="/pipeline/whatsapp/console">WhatsApp console</a><span>${esc(o.email)}</span><a href="/pipeline/logout">Sign out</a></p></div></header>
<div class="wrap title"><div><h1>${o.heading}</h1>${o.subline ? `<p class="sub1">${esc(o.subline)}</p>` : ""}</div>${o.partUrl ? `<button class="refresh" type="button" id="refresh">Refresh</button>` : ""}</div>
<main class="wrap" id="main" aria-live="polite">${o.main}</main>
${refresh}
</body></html>`;
}

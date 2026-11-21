// services/tgl-ops/src/agents/booking/page.ts
// The /book page. Visual system copied from the website (tgl-theme/launch/assets/css/site.css and thank-you.css):
// paper and ink, DM Sans with the Fraunces italic accent, 2px ink borders, one-colour offset print shadows,
// the stamp and the receipt slip. Fonts, logo and photo are served from /book/assets so nothing loads from elsewhere.
import fs from "node:fs";
import path from "node:path";

export const BOOKING_ASSETS: Record<string, string> = {
  "dm-sans-latin.woff2": "font/woff2",
  "fraunces-latin-italic.woff2": "font/woff2",
  "logo.png": "image/png",
  "founder.webp": "image/webp",
};

export function bookingAssetPath(file: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(BOOKING_ASSETS, file)) return null;
  const candidates = [
    path.resolve(__dirname, "../../assets/booking", file),
    path.join(process.cwd(), "src/assets/booking", file),
    path.join(process.cwd(), "dist/assets/booking", file),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const SITE = "https://thegrowthlab.co.in";

const CSS = `
@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:400 700;font-display:swap;src:url(/book/assets/fraunces-latin-italic.woff2) format("woff2")}
:root{color-scheme:light;--paper:#F5F0E8;--paper-2:#EDE8DD;--white:#FFFDF9;--ink:#2C2118;--ink-2:#3A3028;--mute:#6B625B;--grey:#D9D1C5;
--terra:#C75B3B;--terra-text:#B94B35;--coral:#E8846B;--sage:#7BA668;--mustard:#E8B44C;--teal:#4A9B8E;--teal-text:#357A6F;--teal-t:#DCEBE8;--coral-t:#F8E2DA;
--serif:"Fraunces",Georgia,serif;--sans:"DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}p{margin:0}
h1,h2,h3{font-weight:600;letter-spacing:-.032em;margin:0;line-height:1.06;text-wrap:balance}
.acc{font-family:var(--serif);font-style:italic;font-weight:400;letter-spacing:-.015em;color:var(--terra-text)}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.hd{border-bottom:1px solid var(--paper-2)}
.hd .wrap{display:flex;align-items:center;justify-content:space-between;height:62px}
.hd img{height:36px;width:auto;display:block}
.hd .back{font-size:.95rem;font-weight:500;text-decoration:none}
.hd .back:hover{text-decoration:underline;text-decoration-color:var(--terra);text-underline-offset:4px}
.pill{display:inline-block;font-size:.76rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 11px;border:1.5px solid var(--ink);border-radius:999px;background:var(--paper);margin-bottom:16px}
main{padding:34px 0 64px}
.grid{display:grid;gap:36px;align-items:start}
.grid>*{min-width:0}
h1{font-size:clamp(2.3rem,8.6vw,3.9rem)}
.sub{font-size:1.12rem;color:var(--ink-2);margin-top:16px;max-width:27em}
.expect{list-style:none;padding:0;margin:0;display:grid;gap:10px;max-width:27em}
.expect li{display:flex;gap:12px;align-items:baseline;color:var(--ink-2)}
.expect li::before{content:"";flex:none;width:10px;height:10px;border-radius:3px;background:var(--mustard);border:1.5px solid var(--ink);transform:translateY(1px) rotate(-8deg)}
.expect li:nth-child(2)::before{background:var(--teal)}.expect li:nth-child(3)::before{background:var(--coral)}
.trust{display:flex;align-items:center;gap:16px;margin-top:28px;font-size:1rem;line-height:1.45;color:var(--ink-2);max-width:30em}
.trust img{width:72px;height:72px;border-radius:50%;object-fit:cover;object-position:50% 18%;border:2px solid var(--ink);box-shadow:4px 4px 0 var(--coral);flex:none}
.trust b{color:var(--ink)}
.sheet{background:var(--white);border:2px solid var(--ink);border-radius:18px;box-shadow:8px 8px 0 var(--teal);padding:22px 18px 24px;position:relative}
.step{display:flex;align-items:center;gap:10px;font-size:1.05rem;font-weight:600;letter-spacing:-.01em;margin:0 0 12px}
.step .k{width:26px;height:26px;border-radius:50%;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-size:.8rem;font-weight:700;flex:none}
.step small{margin-left:auto;font-weight:500;font-size:.85rem;color:var(--mute)}
.block+.block{margin-top:26px;padding-top:22px;border-top:1.5px dashed color-mix(in srgb,var(--ink) 25%,transparent)}
.days{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.day,.slot{font:inherit;color:var(--ink);background:var(--paper);border:2px solid var(--ink);border-radius:12px;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}
.day{padding:8px 4px 9px;text-align:center;line-height:1.15}
.day b{display:block;font-size:1.15rem;font-weight:600;letter-spacing:-.02em}
.day span{display:block;font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mute)}
.day:hover:not([disabled]),.slot:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink)}
.day[aria-pressed=true]{background:var(--ink);color:var(--paper);box-shadow:3px 3px 0 var(--coral)}
.day[aria-pressed=true] span{color:var(--paper)}
.day[disabled]{cursor:default;border-style:dashed;color:var(--mute);background:transparent}
.slots{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.slot{padding:12px 14px;text-align:left}
.slot b{display:block;font-size:1.08rem;font-weight:600}
.slot span{display:block;font-size:.82rem;color:var(--mute)}
.slot[aria-pressed=true]{background:var(--ink);color:var(--paper);box-shadow:4px 4px 0 var(--mustard)}
.slot[aria-pressed=true] span{color:var(--grey)}
.none{color:var(--mute);font-size:.95rem}
.form{display:grid;gap:12px}
.form .row{display:grid;gap:12px}
.form label{display:grid;gap:6px;font-weight:600;font-size:.92rem}
.form label i{font-style:normal;font-weight:500;color:var(--mute)}
.form input,.form textarea{font:inherit;font-size:1rem;padding:12px 14px;border:2px solid var(--ink);border-radius:14px;background:var(--white);color:var(--ink);width:100%;min-width:0}
.form textarea{min-height:76px;resize:vertical}
.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.btn{display:flex;align-items:center;justify-content:center;width:100%;margin-top:6px;font:inherit;font-weight:600;font-size:1.02rem;padding:15px 20px;border-radius:14px;border:2px solid var(--ink);background:var(--ink);color:var(--paper);cursor:pointer;box-shadow:4px 4px 0 var(--terra);transition:transform .12s ease,box-shadow .12s ease}
.btn:hover:not([disabled]){transform:translate(-1px,-1px);box-shadow:6px 6px 0 var(--terra)}
.btn:active:not([disabled]){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--terra)}
.btn[disabled]{cursor:default;background:var(--paper-2);color:var(--mute);border-color:var(--grey);box-shadow:none}
.fine{font-size:.85rem;color:var(--mute);text-align:center;margin-top:10px}
.err{margin-top:4px;border-left:3px solid var(--terra);background:var(--coral-t);padding:10px 12px;border-radius:0 10px 10px 0;font-size:.95rem}
.loading{color:var(--mute);padding:24px 0;text-align:center}
:focus-visible{outline:3px solid var(--teal);outline-offset:3px}
.slip{position:relative;background:var(--white);border:2px solid var(--ink);border-radius:14px 14px 0 0;box-shadow:8px 8px 0 var(--coral);padding:20px 20px 26px;transform:rotate(-1deg);margin:6px 8px 26px 0}
.slip::after{content:"";position:absolute;left:-2px;right:-2px;bottom:-12px;height:12px;background:linear-gradient(135deg,var(--white) 6px,transparent 0) 0 0/12px 12px repeat-x,linear-gradient(225deg,var(--white) 6px,transparent 0) 0 0/12px 12px repeat-x}
.slip .top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;border-bottom:2px solid var(--ink);padding-bottom:10px}
.slip .top b{font-weight:700;letter-spacing:-.02em;font-size:1.15rem}
.slip .top span{font-size:.72rem;color:var(--mute);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.slip dl{margin:12px 0 0}
.slip dl div{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1.5px dashed color-mix(in srgb,var(--ink) 30%,transparent)}
.slip dt{color:var(--mute);font-size:.9rem}
.slip dd{margin:0;font-weight:600;text-align:right;overflow-wrap:anywhere}
.slip .pad{height:70px}
.stamp{position:absolute;right:14px;bottom:20px;border:4px solid var(--terra);color:var(--terra-text);border-radius:10px;padding:2px 14px;font-weight:700;font-size:1.6rem;letter-spacing:.1em;transform:rotate(-12deg);background:color-mix(in srgb,var(--white) 82%,transparent);animation:stampIn .5s cubic-bezier(.2,.9,.3,1.2) .35s both}
@keyframes stampIn{from{opacity:0;transform:rotate(-12deg) scale(1.8)}to{opacity:1;transform:rotate(-12deg) scale(1)}}
.after{color:var(--ink-2);font-size:.98rem;margin-top:4px}
.ft{border-top:1px solid var(--paper-2);padding:22px 0 30px;font-size:.88rem;color:var(--mute)}
.ft .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 20px}
@media (min-width:860px){
  main{padding:64px 0 80px}
  .grid{grid-template-columns:1fr 1.05fr;grid-template-areas:"intro sheet" "more sheet";grid-template-rows:auto 1fr;column-gap:64px;row-gap:28px}
  .intro{grid-area:intro}.more{grid-area:more}.sheet{grid-area:sheet}
  .sheet{padding:28px 28px 30px}
  .form .row{grid-template-columns:1fr 1fr}
}
@media (max-width:380px){.days{grid-template-columns:repeat(4,1fr)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const SCRIPT = `
(function(){
  var app=document.getElementById('app');
  var IST='Asia/Kolkata';var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;var local=!!tz&&tz!==IST&&tz!=='Asia/Calcutta';
  var days=[],dayIdx=0,picked=null,draft={name:'',email:'',company:'',note:''};
  function el(t,a,c){var e=document.createElement(t);for(var k in a||{}){if(k==='text')e.textContent=a[k];else e.setAttribute(k,a[k]);}(c||[]).forEach(function(x){if(x)e.appendChild(x)});return e;}
  function f(iso,zone,o){return new Intl.DateTimeFormat('en-IN',Object.assign({timeZone:zone},o)).format(new Date(iso));}
  function tm(iso,zone){return f(iso,zone,{hour:'numeric',minute:'2-digit',hour12:true});}
  function noon(d){return d+'T06:30:00Z';}
  function step(n,label,note){return el('h2',{'class':'step'},[el('span',{'class':'k','aria-hidden':'true',text:String(n)}),el('span',{text:label}),note?el('small',{text:note}):null]);}
  function firstOpen(){var i=days.findIndex(function(d){return d.slots.length;});return i<0?0:i;}
  function render(message){
    app.innerHTML='';
    if(!days.some(function(d){return d.slots.length;})){app.appendChild(el('p',{'class':'none',text:'No times are open in the next two weeks. Write to sales@thegrowthlab.co.in and we will find one.'}));return;}
    var b1=el('div',{'class':'block'},[step(1,'Pick a day')]);
    var strip=el('div',{'class':'days',role:'group','aria-label':'Day'});
    days.forEach(function(d,i){
      var full=!d.slots.length;
      var btn=el('button',{type:'button','class':'day','aria-pressed':String(i===dayIdx),'aria-label':f(noon(d.date),IST,{weekday:'long',day:'numeric',month:'long'})+(full?', fully booked':'')},[el('span',{text:f(noon(d.date),IST,{weekday:'short'})}),el('b',{text:f(noon(d.date),IST,{day:'numeric'})}),el('span',{text:full?'Full':f(noon(d.date),IST,{month:'short'})})]);
      if(full)btn.disabled=true;
      btn.onclick=function(){dayIdx=i;picked=null;render();};
      strip.appendChild(btn);
    });
    b1.appendChild(strip);app.appendChild(b1);
    var d=days[dayIdx];
    var b2=el('div',{'class':'block'},[step(2,'Pick a time',local?'India time, yours below':'India time')]);
    var grid=el('div',{'class':'slots',role:'group','aria-label':'Time'});
    d.slots.forEach(function(s){
      var b=el('button',{type:'button','class':'slot','aria-pressed':String(s===picked)},[el('b',{text:tm(s,IST)}),el('span',{text:local?tm(s,tz)+' your time':'20 minutes'})]);
      b.onclick=function(){picked=s;render();var n=document.getElementById('n');if(n&&!n.value)n.focus({preventScroll:true});};
      grid.appendChild(b);
    });
    b2.appendChild(grid);app.appendChild(b2);
    var b3=el('div',{'class':'block'},[step(3,'Your details')]);
    var form=el('form',{'class':'form',novalidate:''});
    function field(id,label,attrs,opt){var a=Object.assign({id:id,name:id==='n'?'name':id==='e'?'email':id==='c'?'company':'note'},attrs);var input=el(id==='o'?'textarea':'input',a);var key=a.name;input.value=draft[key]||'';input.oninput=function(){draft[key]=input.value;};return el('label',{'for':id},[el('span',{text:label},[opt?el('i',{text:' (optional)'}):null]),input]);}
    form.appendChild(el('div',{'class':'row'},[field('n','Your name',{autocomplete:'name',required:''}),field('c','Business name',{autocomplete:'organization',required:''})]));
    form.appendChild(field('e','Work email',{type:'email',autocomplete:'email',required:'',inputmode:'email'}));
    form.appendChild(field('o','Anything we should know',{maxlength:'500',rows:'3'},true));
    form.appendChild(el('input',{'class':'hp',name:'website',tabindex:'-1',autocomplete:'off','aria-hidden':'true'}));
    if(message)form.appendChild(el('p',{'class':'err',role:'alert',text:message}));
    var go=el('button',{type:'submit','class':'btn',text:picked?'Confirm '+f(picked,IST,{weekday:'short',day:'numeric',month:'short'})+' at '+tm(picked,IST):'Pick a time to continue'});
    if(!picked)go.disabled=true;
    form.appendChild(go);
    form.appendChild(el('p',{'class':'fine',text:'Google Calendar sends the invite with the Meet link.'}));
    form.onsubmit=function(ev){ev.preventDefault();if(!picked)return;
      var body={start:picked,name:draft.name,email:draft.email,company:draft.company,note:draft.note,website:form.website.value};
      go.disabled=true;go.textContent='Booking…';
      fetch('/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(j){
        if(j.ok){done(j,body);return;}
        if(j.days){days=j.days;picked=null;dayIdx=firstOpen();}
        render(j.message||'That did not go through. Please try again.');
      }).catch(function(){render('That did not go through. Check your connection and try again.');});
    };
    b3.appendChild(form);app.appendChild(b3);
  }
  function done(j,body){
    app.innerHTML='';
    var rows=[['Date',f(j.start,IST,{weekday:'long',day:'numeric',month:'long'})],['Time',tm(j.start,IST)+' IST'+(local?' ('+tm(j.start,tz)+' your time)':'')],['Length','20 minutes'],['Where','Google Meet'],['Invite sent to',body.email]];
    var dl=el('dl');rows.forEach(function(r){dl.appendChild(el('div',{},[el('dt',{text:r[0]}),el('dd',{text:r[1]})]));});
    var slip=el('div',{'class':'slip',role:'status'},[el('div',{'class':'top'},[el('b',{text:'Call booked'}),el('span',{text:'The Growth Lab'})]),dl,el('div',{'class':'pad'}),el('span',{'class':'stamp','aria-hidden':'true',text:'BOOKED'})]);
    app.appendChild(slip);
    app.appendChild(el('p',{'class':'after',text:'The invite is from Google Calendar. To move or cancel the call, use the invite. If it has not arrived in a few minutes, check spam.'}));
    document.getElementById('title').focus();
  }
  fetch('/book/slots').then(function(r){return r.json();}).then(function(j){
    if(!j.open){app.innerHTML='';app.appendChild(el('p',{'class':'none',text:'Booking is not open right now. Write to sales@thegrowthlab.co.in and we will find a time.'}));return;}
    days=j.days;dayIdx=firstOpen();render();
  }).catch(function(){app.innerHTML='';app.appendChild(el('p',{'class':'none',text:'Free times could not be loaded. Refresh the page, or write to sales@thegrowthlab.co.in.'}));});
})();
`;

export const BOOKING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Book a call with Tejinder Singh | The Growth Lab</title>
<link rel="preload" href="/book/assets/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style></head><body>
<header class="hd"><div class="wrap">
  <a href="${SITE}/" aria-label="The Growth Lab, home"><img src="/book/assets/logo.png" alt="The Growth Lab" width="63" height="36"></a>
  <a class="back" href="${SITE}/">thegrowthlab.co.in</a>
</div></header>
<main><div class="wrap grid">
  <section class="intro" aria-labelledby="title">
    <span class="pill">20-minute call</span>
    <h1 id="title" tabindex="-1">Book a call with <span class="acc">Tejinder.</span></h1>
    <p class="sub">We go through what AI assistants say about your business today, who they name instead, and what would change it.</p>
  </section>
  <section class="sheet" aria-label="Choose a time">
    <div id="app"><p class="loading">Checking free times…</p></div>
  </section>
  <section class="more" aria-label="What to expect">
    <ul class="expect">
      <li>20 minutes on Google Meet, at a time you choose.</li>
      <li>Weekdays, 3 pm to 5 pm India time.</li>
      <li>If we are not a fit, we will say so on the call.</li>
    </ul>
    <p class="trust"><img src="/book/assets/founder.webp" alt="" width="72" height="72"><span>You speak with <b>Tejinder Singh</b>, AI Automation Expert, Consultant with Corporate for AI Integration, Visiting Faculty for teaching AI in Universities.</span></p>
  </section>
</div></main>
<footer class="ft"><div class="wrap"><span>&copy; 2026 The Growth Lab. Chandigarh, India.</span><span><a href="${SITE}/privacy-policy/">Privacy</a></span></div></footer>
<script>${SCRIPT}</script>
</body></html>`;

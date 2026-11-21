// services/tgl-ops/src/routes/book.ts
// GET  /book                 the booking page
// GET  /book/slots           free slots for the next 10 working days (JSON)
// POST /book                 books a slot; "ok": true only after Google Calendar confirmed the event
// GET  /book/connect         one-time Google sign-in for the bookings calendar (only BOOKING_CALENDAR_EMAIL is accepted)
// GET  /book/oauth/callback  Google's return from that sign-in
import { Router, type Request, type Response } from "express";
import { authUrl, configIssues, exchangeCode, loadGoogleBookingConfig, makeState, verifyState } from "../agents/booking/google.js";
import { bookingService, bookingStore } from "../agents/booking/live.js";

export const bookRouter = Router();

// --- per-IP rate limit (in memory; one Railway instance) ---
const hits = new Map<string, number[]>();
export function resetBookRateLimitForTests(): void {
  hits.clear();
}
function limited(req: Request, key: string, max: number, windowMs = 10 * 60 * 1000): boolean {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(k, list);
  return list.length > max;
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f1e7;color:#1c1a17;margin:0;padding:48px 20px}main{max-width:440px;margin:0 auto}h1{font-size:22px;margin:0 0 12px}p{font-size:16px;line-height:1.5;margin:0 0 20px}</style></head><body><main>${body}</main></body></html>`;
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Book a call with Tejinder Singh | The Growth Lab</title>
<style>
:root{--paper:#f6f1e7;--ink:#1c1a17;--muted:#5d564c;--line:#d8cfbf;--pick:#1c1a17}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:560px;margin:0 auto;padding:40px 20px 64px}
h1{font-size:26px;line-height:1.25;margin:0 0 8px}p{margin:0 0 16px;line-height:1.5}.muted{color:var(--muted)}
h2{font-size:16px;margin:28px 0 12px}
.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.day{flex:0 0 auto;min-width:72px;padding:10px 8px;border:1.5px solid var(--line);border-radius:8px;background:#fffdf8;text-align:center;cursor:pointer;font:inherit;color:inherit}
.day small{display:block;color:var(--muted);font-size:12px}.day[disabled]{opacity:.4;cursor:default}
.day[aria-pressed=true],.slot[aria-pressed=true]{background:var(--pick);color:var(--paper);border-color:var(--pick)}.day[aria-pressed=true] small{color:var(--paper)}
.slots{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.slot{padding:12px;border:1.5px solid var(--line);border-radius:8px;background:#fffdf8;font:inherit;color:inherit;cursor:pointer;text-align:left}
.slot small{display:block;color:var(--muted);font-size:12px}.slot[aria-pressed=true] small{color:var(--paper)}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}
input,textarea{width:100%;font:inherit;padding:10px 12px;border:1.5px solid var(--line);border-radius:8px;background:#fffdf8;color:inherit}
textarea{min-height:80px;resize:vertical}.hp{position:absolute;left:-9999px}
button.go{margin-top:20px;width:100%;font:inherit;font-weight:600;padding:14px;border:0;border-radius:8px;background:var(--ink);color:var(--paper);cursor:pointer}
button.go[disabled]{opacity:.5;cursor:default}
:focus-visible{outline:3px solid #8a6d3b;outline-offset:2px}
.msg{margin-top:16px;padding:12px;border-radius:8px;background:#fbe9e2}.done{background:#e6efe1;padding:20px;border-radius:8px}.done h2{margin-top:0}
</style></head><body><main>
<h1>Book a 20-minute call with Tejinder Singh</h1>
<p class="muted">The Growth Lab. We go through how AI assistants describe your business and what would change it. You get a Google Calendar invite with a Meet link.</p>
<div id="app"><p class="muted" id="loading">Loading free times…</p></div>
</main>
<script>
(function(){
  var app=document.getElementById('app');
  var tz=Intl.DateTimeFormat().resolvedOptions().timeZone; var ist='Asia/Kolkata'; var local=tz && tz!==ist && tz!=='Asia/Calcutta';
  var days=[],dayIdx=0,picked=null;
  function el(t,a,c){var e=document.createElement(t);for(var k in a||{}){if(k==='text')e.textContent=a[k];else e.setAttribute(k,a[k]);}(c||[]).forEach(function(x){e.appendChild(x)});return e;}
  function fmt(iso,zone,opts){return new Intl.DateTimeFormat('en-IN',Object.assign({timeZone:zone},opts)).format(new Date(iso));}
  function time(iso,zone){return fmt(iso,zone,{hour:'numeric',minute:'2-digit',hour12:true});}
  function render(message){
    app.innerHTML='';
    if(!days.length){app.appendChild(el('p',{text:'No times are open right now. Please reply to the email and we will find one.'}));return;}
    app.appendChild(el('h2',{text:'Pick a day'}));
    var strip=el('div',{'class':'days',role:'group','aria-label':'Day'});
    days.forEach(function(d,i){var b=el('button',{type:'button','class':'day','aria-pressed':String(i===dayIdx)},[el('span',{text:fmt(d.date+'T06:30:00Z',ist,{weekday:'short'})}),el('small',{text:fmt(d.date+'T06:30:00Z',ist,{day:'numeric',month:'short'})})]);if(!d.slots.length)b.disabled=true;b.onclick=function(){dayIdx=i;picked=null;render();};strip.appendChild(b);});
    app.appendChild(strip);
    var d=days[dayIdx];
    app.appendChild(el('h2',{text:'Pick a time (India time)'}));
    var grid=el('div',{'class':'slots',role:'group','aria-label':'Time'});
    d.slots.forEach(function(s){var kids=[el('span',{text:time(s,ist)})];if(local)kids.push(el('small',{text:time(s,tz)+' your time'}));var b=el('button',{type:'button','class':'slot','aria-pressed':String(s===picked)},kids);b.onclick=function(){picked=s;render();};grid.appendChild(b);});
    app.appendChild(grid);
    var f=el('form',{novalidate:''});
    f.appendChild(el('label',{'for':'n',text:'Your name'}));f.appendChild(el('input',{id:'n',name:'name',autocomplete:'name',required:''}));
    f.appendChild(el('label',{'for':'e',text:'Work email'}));f.appendChild(el('input',{id:'e',name:'email',type:'email',autocomplete:'email',required:''}));
    f.appendChild(el('label',{'for':'c',text:'Business name'}));f.appendChild(el('input',{id:'c',name:'company',autocomplete:'organization',required:''}));
    f.appendChild(el('label',{'for':'o',text:'Anything we should know (optional)'}));f.appendChild(el('textarea',{id:'o',name:'note',maxlength:'500'}));
    f.appendChild(el('input',{'class':'hp',name:'website',tabindex:'-1',autocomplete:'off','aria-hidden':'true'}));
    var go=el('button',{type:'submit','class':'go',text:picked?'Confirm booking: '+fmt(picked,ist,{weekday:'short',day:'numeric',month:'short'})+', '+time(picked,ist)+' IST':'Pick a time first'});
    if(!picked)go.disabled=true; f.appendChild(go);
    if(message)f.appendChild(el('p',{'class':'msg',role:'alert',text:message}));
    f.onsubmit=function(ev){ev.preventDefault();if(!picked)return;var fd=new FormData(f);var body={start:picked};fd.forEach(function(v,k){body[k]=v;});go.disabled=true;go.textContent='Booking…';
      fetch('/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return{r:r,j:j};});}).then(function(x){
        if(x.j.ok){app.innerHTML='';var box=el('div',{'class':'done',role:'status'},[el('h2',{text:'Booked'}),el('p',{text:fmt(x.j.start,ist,{weekday:'long',day:'numeric',month:'long'})+', '+time(x.j.start,ist)+' IST'+(local?' ('+time(x.j.start,tz)+' your time)':'')+'.'}),el('p',{text:'Google has sent the invite with the Meet link to '+body.email+'. To change or cancel, use the invite.'})]);app.appendChild(box);return;}
        if(x.j.days){days=x.j.days;picked=null;dayIdx=Math.max(0,days.findIndex(function(d){return d.slots.length;}));}
        render(x.j.message||'That did not go through. Please try again.');
      }).catch(function(){render('That did not go through. Please check your connection and try again.');});};
    app.appendChild(f);
  }
  fetch('/book/slots').then(function(r){return r.json();}).then(function(j){
    if(!j.open){app.innerHTML='';app.appendChild(el('p',{text:'Booking is not open yet. Please reply to the email and we will find a time.'}));return;}
    days=j.days;dayIdx=Math.max(0,days.findIndex(function(d){return d.slots.length;}));render();
  }).catch(function(){app.innerHTML='';app.appendChild(el('p',{text:'Free times could not be loaded. Please refresh, or reply to the email.'}));});
})();
</script></body></html>`;

bookRouter.get("/", (_req: Request, res: Response) => {
  res.status(200).type("html").set("Cache-Control", "no-store").send(PAGE);
});

bookRouter.get("/slots", async (req: Request, res: Response) => {
  if (limited(req, "slots", 120)) {
    res.status(429).json({ open: false, days: [], error: "too_many_requests" });
    return;
  }
  try {
    const out = await bookingService().slots();
    res.status(200).set("Cache-Control", "no-store").json(out);
  } catch (err) {
    console.error("[Book] slots failed:", (err as Error).message);
    res.status(503).json({ open: false, days: [], error: "calendar_unavailable" });
  }
});

bookRouter.post("/", async (req: Request, res: Response) => {
  if (limited(req, "book", 6)) {
    res.status(429).json({ ok: false, error: "too_many_requests", message: "Too many attempts. Please wait a few minutes." });
    return;
  }
  try {
    const out = await bookingService().book((req.body || {}) as any);
    if (out.ok) res.status(200).json(out);
    else res.status(out.status).json(out);
  } catch (err) {
    console.error("[Book] booking failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "calendar_failed", message: "We could not confirm that booking. Please try again, or reply to the email." });
  }
});

bookRouter.get("/connect", (_req: Request, res: Response) => {
  const cfg = loadGoogleBookingConfig();
  const issues = configIssues(cfg);
  if (issues.length > 0) {
    res.status(503).type("html").send(shell("Not ready", `<h1>Not ready to connect</h1><p>${issues.join(". ")}.</p>`));
    return;
  }
  res.redirect(302, authUrl(cfg, makeState(cfg.clientSecret)));
});

bookRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  const cfg = loadGoogleBookingConfig();
  const fail = (msg: string, code = 400) => res.status(code).type("html").send(shell("Not connected", `<h1>Not connected</h1><p>${msg}</p><p><a href="/book/connect">Try again</a></p>`));
  if (configIssues(cfg).length > 0) return void fail("The service is missing its Google settings.", 503);
  if (req.query.error) return void fail("Google sign-in was cancelled or refused.");
  if (!verifyState(String(req.query.state || ""), cfg.clientSecret)) return void fail("This sign-in link has expired. Start again.");
  try {
    const got = await exchangeCode(cfg, String(req.query.code || ""));
    if (got.email !== cfg.calendarEmail) return void fail(`Signed in as ${got.email || "an unknown account"}. Sign in with ${cfg.calendarEmail}.`, 403);
    if (!got.scopes.includes("https://www.googleapis.com/auth/calendar.events")) return void fail("Calendar access was not granted. Tick the calendar box on Google's screen.", 403);
    if (!got.refreshToken) return void fail("Google did not return a lasting sign-in. Remove The Growth Lab at myaccount.google.com/permissions and try again.", 502);
    await bookingStore().setRefreshToken(got.refreshToken);
    res.status(200).type("html").send(shell("Connected", `<h1>Connected</h1><p>Bookings will be created on ${cfg.calendarEmail}. You can close this page.</p><p><a href="/book">Open the booking page</a></p>`));
  } catch (err) {
    console.error("[Book] connect failed:", (err as Error).message);
    fail("Google sign-in could not be completed. Try again.", 502);
  }
});

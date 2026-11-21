// services/tgl-ops/src/agents/whatsapp/connect-page.ts
// The private "Connect WhatsApp" page. It loads Meta's JavaScript SDK (the only outside script, required by Meta
// for Embedded Signup) and opens the signup window with coexistence switched on.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function connectPage(opts: { appId: string; configId: string; graphVersion: string; email: string; issues: string[]; connected?: { display_number?: string | null; connected_at?: string } | null }): string {
  const ready = opts.issues.length === 0;
  const status = opts.connected
    ? `<p class="ok">Connected: ${esc(opts.connected.display_number || "number pending")}, ${esc(String(opts.connected.connected_at || "").slice(0, 10))}. Connecting again replaces it.</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Connect WhatsApp | The Growth Lab</title>
<style>@font-face{font-family:"DM Sans";font-weight:400 700;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
body{margin:0;background:#F5F0E8;color:#2C2118;font-family:"DM Sans",system-ui,sans-serif;line-height:1.5}
main{max-width:560px;margin:0 auto;padding:40px 20px}img{height:40px}h1{font-size:1.8rem;letter-spacing:-.03em;margin:20px 0 8px}
ol{padding-left:20px}li{margin:6px 0}.card{background:#FFFDF9;border:2px solid #2C2118;border-radius:16px;padding:20px;box-shadow:6px 6px 0 #4A9B8E;margin-top:20px}
button{font:inherit;font-weight:600;padding:14px 22px;border:2px solid #2C2118;border-radius:14px;background:#2C2118;color:#F5F0E8;cursor:pointer;box-shadow:4px 4px 0 #C75B3B}
button[disabled]{opacity:.5;cursor:default}.ok{background:#E4EBDD;border-left:3px solid #4C7A3B;padding:10px;border-radius:0 8px 8px 0}
.err{background:#F8E2DA;border-left:3px solid #C75B3B;padding:10px;border-radius:0 8px 8px 0}#log li.bad{color:#B94B35}#log li.good{color:#4C7A3B}small{color:#6B625B}</style></head>
<body><main><img src="/book/assets/logo.png" alt="The Growth Lab"><h1>Connect WhatsApp</h1>
<p>Connects The Growth Lab's WhatsApp Business app number to the service, so approved outreach messages can be sent from it. The app on your phone keeps working.</p>
${status}
<div class="card">
<ol><li>Keep your phone with the WhatsApp Business app at hand.</li><li>Press the button and sign in with Facebook.</li><li>Choose The Growth Lab and the existing number. When asked, copy the code shown in the WhatsApp Business app into Meta's window.</li></ol>
${ready ? `<button id="go" disabled>Connect WhatsApp</button><p><small id="hint">Loading Meta's sign-in…</small></p>` : `<p class="err">Not ready: ${esc(opts.issues.join("; "))}.</p>`}
<ul id="log"></ul></div>
<p><small>Signed in as ${esc(opts.email)}. <a href="/pipeline">Back to the pipeline</a> | <a href="/pipeline/whatsapp/console">WhatsApp templates and sending</a></small></p></main>
${ready ? `<script>
(function(){
  var go=document.getElementById('go'),hint=document.getElementById('hint'),log=document.getElementById('log');
  var code=null,waba=null,phone=null,sent=false;
  function say(t,cls){var li=document.createElement('li');li.textContent=t;if(cls)li.className=cls;log.appendChild(li);}
  function maybeFinish(){
    if(sent||!code||!waba)return; sent=true; say('Saving the connection…');
    fetch('/pipeline/whatsapp/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,waba_id:waba,phone_number_id:phone})})
      .then(function(r){return r.json();}).then(function(j){
        (j.steps||[]).forEach(function(s){say((s.ok?'Done: ':'Failed: ')+s.step+(s.detail?' ('+s.detail+')':''),s.ok?'good':'bad');});
        say(j.ok?'WhatsApp is connected.':(j.message||'Not fully connected. Send a screenshot of this page.'),j.ok?'good':'bad');
      }).catch(function(){say('The service did not answer. Send a screenshot of this page.','bad');});
  }
  window.addEventListener('message',function(e){
    if(!/(^|\\.)facebook\\.com$/.test(new URL(e.origin).hostname))return;
    var d;try{d=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch(_){return;}
    if(!d||d.type!=='WA_EMBEDDED_SIGNUP')return;
    if(d.event==='CANCEL'){say('Meta signup was closed'+(d.data&&d.data.current_step?' at '+d.data.current_step:'')+'. Nothing was changed.','bad');return;}
    if(d.event==='ERROR'){say('Meta reported: '+((d.data&&d.data.error_message)||'an error'),'bad');return;}
    if(d.data&&d.data.waba_id){waba=String(d.data.waba_id);phone=d.data.phone_number_id?String(d.data.phone_number_id):null;say('Meta finished signup ('+d.event+').','good');maybeFinish();}
  });
  window.fbAsyncInit=function(){
    FB.init({appId:${JSON.stringify(opts.appId)},autoLogAppEvents:true,xfbml:false,version:${JSON.stringify(opts.graphVersion)}});
    go.disabled=false;hint.textContent='Ready.';
  };
  go.onclick=function(){
    go.disabled=true;say('Opening Meta signup…');
    FB.login(function(r){
      if(r&&r.authResponse&&r.authResponse.code){code=r.authResponse.code;maybeFinish();}
      else{say('Meta sign-in did not complete. Nothing was changed.','bad');go.disabled=false;}
    },{config_id:${JSON.stringify(opts.configId)},response_type:'code',override_default_response_type:true,extras:{setup:{},featureType:'whatsapp_business_app_onboarding',sessionInfoVersion:'3'}});
  };
})();
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>` : ""}
</body></html>`;
}

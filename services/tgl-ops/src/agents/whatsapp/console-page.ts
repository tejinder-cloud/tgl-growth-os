// services/tgl-ops/src/agents/whatsapp/console-page.ts
// The private WhatsApp screen: message templates (list, create) and sending one template message.
// Used day to day and recorded for Meta's App Review. Plain HTML and one script; no outside resources.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function consolePage(email: string, tokenReady: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>WhatsApp | The Growth Lab</title>
<style>@font-face{font-family:"DM Sans";font-weight:400 700;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
:root{--paper:#F5F0E8;--white:#FFFDF9;--ink:#2C2118;--mute:#6B625B;--grey:#D9D1C5;--terra:#C75B3B;--teal:#4A9B8E;--sage:#4C7A3B}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"DM Sans",system-ui,sans-serif;line-height:1.45;font-size:15px}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid #EDE8DD}header img{height:34px}header a{color:inherit;margin-left:14px;font-size:.9rem}
main{max-width:1100px;margin:0 auto;padding:24px 20px 60px}h1{font-size:1.9rem;letter-spacing:-.03em;margin:0 0 6px}h2{font-size:1.15rem;margin:0 0 12px}
.grid{display:grid;gap:22px;margin-top:20px}@media(min-width:900px){.grid{grid-template-columns:1.2fr 1fr}}
.card{background:var(--white);border:2px solid var(--ink);border-radius:16px;padding:18px;box-shadow:5px 5px 0 var(--teal)}.card.send{box-shadow:5px 5px 0 var(--terra)}
label{display:grid;gap:5px;font-weight:600;font-size:.88rem;margin-top:10px}label i{font-weight:500;font-style:normal;color:var(--mute)}
input,select,textarea{font:inherit;padding:10px 12px;border:2px solid var(--ink);border-radius:12px;background:#fff;width:100%}textarea{min-height:90px}
button{font:inherit;font-weight:600;padding:11px 16px;border:2px solid var(--ink);border-radius:12px;background:var(--ink);color:var(--paper);cursor:pointer;margin-top:12px}button.light{background:var(--white);color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--grey);vertical-align:top}th{color:var(--mute);font-weight:600}
.st{font-weight:700;font-size:.75rem;padding:2px 8px;border-radius:999px;border:1.5px solid var(--grey)}.APPROVED{border-color:var(--sage);color:var(--sage)}.REJECTED{border-color:var(--terra);color:var(--terra)}
.msg{margin-top:12px;padding:10px;border-radius:0 8px 8px 0;font-size:.9rem}.ok{background:#E4EBDD;border-left:3px solid var(--sage)}.err{background:#F8E2DA;border-left:3px solid var(--terra)}
.row{display:grid;gap:10px;grid-template-columns:1fr 1fr}.muted{color:var(--mute);font-size:.85rem}</style></head>
<body><header><img src="/book/assets/logo.png" alt="The Growth Lab"><span class="muted">${esc(email)}<a href="/pipeline">Pipeline</a><a href="/pipeline/whatsapp">Connect</a></span></header>
<main><h1>WhatsApp</h1><p class="muted">Message templates and sending, through the WhatsApp Cloud API. Every result shown is Meta's own answer.</p>
${tokenReady ? "" : `<p class="msg err">No WhatsApp token yet. Add WHATSAPP_SYSTEM_TOKEN in Railway, or connect the number first.</p>`}
<label>Account and number<select id="acct"></select></label>
<details id="diag" style="margin-top:8px"><summary class="muted">What Meta answered</summary><ul id="diagList" class="muted"></ul></details>
<div class="grid">
<section class="card"><h2>Templates</h2><button class="light" id="reload">Refresh</button>
<table><thead><tr><th>Name</th><th>Status</th><th>Category</th><th>Text</th></tr></thead><tbody id="tpls"><tr><td colspan="4" class="muted">Pick an account</td></tr></tbody></table>
<h2 style="margin-top:22px">Create a template</h2>
<form id="create"><label>Name <i>(lowercase, underscores)</i><input name="name" required pattern="[a-z0-9_]+" placeholder="tgl_ai_visibility_first_touch"></label>
<div class="row"><label>Category<select name="category"><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option></select></label><label>Language<select name="language"><option value="en">English</option><option value="en_US">English (US)</option><option value="hi">Hindi</option></select></label></div>
<label>Body <i>use {{1}}, {{2}} for values</i><textarea name="body" required maxlength="1024"></textarea></label>
<label>Examples <i>one per line, for {{1}}, {{2}}…</i><textarea name="examples"></textarea></label>
<label>Footer <i>optional</i><input name="footer" maxlength="60"></label>
<label>Quick-reply buttons <i>optional, one per line</i><textarea name="buttons" placeholder="Yes, send it&#10;Not interested"></textarea></label>
<button type="submit">Submit to Meta for review</button><div id="createMsg"></div></form></section>
<section class="card send"><h2>Send a template message</h2>
<form id="send"><label>Template<select name="tpl" id="sendTpl"></select></label>
<label>To <i>WhatsApp number, e.g. 98720 09997 or +44…</i><input name="to" required></label>
<div id="vals"></div>
<button type="submit">Send</button><div id="sendMsg"></div></form>
<p class="muted">Only you can send from here. Approved templates only; Meta refuses anything else.</p></section>
</div></main>
<script>
(function(){
  var acct=document.getElementById('acct'),tpls=[],accounts=[];
  function api(p,o){return fetch('/pipeline/whatsapp/api/'+p,Object.assign({headers:{'Content-Type':'application/json'}},o||{})).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||('Error '+r.status));return j;});});}
  function show(id,ok,t){var d=document.getElementById(id);d.className='msg '+(ok?'ok':'err');d.textContent=t;}
  function cur(){var v=acct.value.split('|');return {waba:v[0],phone:v[1]};}
  function cell(t){var td=document.createElement('td');td.textContent=t;return td;}
  function loadTpls(){var c=cur();if(!c.waba)return;var tb=document.getElementById('tpls');tb.innerHTML='<tr><td colspan="4" class="muted">Loading…</td></tr>';
    api('templates?waba='+encodeURIComponent(c.waba)).then(function(j){tpls=j.templates||[];tb.innerHTML='';
      if(!tpls.length)tb.innerHTML='<tr><td colspan="4" class="muted">No templates on this account</td></tr>';
      tpls.forEach(function(t){var tr=document.createElement('tr');tr.appendChild(cell(t.name+' ('+t.language+')'));var s=document.createElement('td');var b=document.createElement('span');b.className='st '+t.status;b.textContent=t.status;s.appendChild(b);tr.appendChild(s);tr.appendChild(cell(t.category));tr.appendChild(cell(t.body));tb.appendChild(tr);});
      var sel=document.getElementById('sendTpl');sel.innerHTML='';tpls.filter(function(t){return t.status==='APPROVED';}).forEach(function(t,i){var o=document.createElement('option');o.value=i;o.dataset.idx=tpls.indexOf(t);o.textContent=t.name+' ('+t.language+')';sel.appendChild(o);});
      renderVals();
    }).catch(function(e){tb.innerHTML='';var tr=document.createElement('tr');var td=cell(e.message);td.colSpan=4;tr.appendChild(td);tb.appendChild(tr);});}
  function picked(){var sel=document.getElementById('sendTpl');var o=sel.options[sel.selectedIndex];return o?tpls[Number(o.dataset.idx)]:null;}
  function renderVals(){var t=picked(),box=document.getElementById('vals');box.innerHTML='';if(!t)return;for(var i=1;i<=t.placeholders;i++){var l=document.createElement('label');l.textContent='Value for {{'+i+'}}';var inp=document.createElement('input');inp.name='v'+i;inp.required=true;l.appendChild(inp);box.appendChild(l);}}
  document.getElementById('sendTpl').onchange=renderVals;
  document.getElementById('reload').onclick=loadTpls;acct.onchange=loadTpls;
  api('accounts').then(function(j){accounts=j.accounts||[];acct.innerHTML='';var dl=document.getElementById('diagList');dl.innerHTML='';(j.notes||[]).forEach(function(n){var li=document.createElement('li');li.textContent=(n.ok?'OK ':'Refused ')+n.call+': '+n.detail;dl.appendChild(li);});if(!accounts.length)document.getElementById('diag').open=true;if(!accounts.length){var none=document.createElement('option');none.textContent='Meta lists no WhatsApp account for this token. Assign one to the system user.';acct.appendChild(none);return;}accounts.forEach(function(a){(a.numbers.length?a.numbers:[{id:'',display:'no number'}]).forEach(function(n){var o=document.createElement('option');o.value=a.id+'|'+n.id;o.textContent=a.name+': '+n.display+(n.name?' ('+n.name+')':'');acct.appendChild(o);});});loadTpls();})
    .catch(function(e){var o=document.createElement('option');o.textContent=e.message;acct.appendChild(o);});
  document.getElementById('create').onsubmit=function(ev){ev.preventDefault();var f=ev.target;var lines=function(s){return s.split('\\n').map(function(x){return x.trim();}).filter(Boolean);};
    api('templates',{method:'POST',body:JSON.stringify({waba:cur().waba,name:f.name.value.trim(),category:f.category.value,language:f.language.value,body:f.body.value,examples:lines(f.examples.value),footer:f.footer.value.trim(),quickReplies:lines(f.buttons.value)})})
      .then(function(j){show('createMsg',true,'Submitted: '+j.template.id+', status '+j.template.status+', category '+j.template.category+'.');loadTpls();}).catch(function(e){show('createMsg',false,e.message);});};
  document.getElementById('send').onsubmit=function(ev){ev.preventDefault();var t=picked();if(!t)return show('sendMsg',false,'No approved template on this account.');var vals=[];for(var i=1;i<=t.placeholders;i++)vals.push(ev.target['v'+i].value);
    api('send',{method:'POST',body:JSON.stringify({phone_number_id:cur().phone,to:ev.target.to.value,name:t.name,language:t.language,values:vals})})
      .then(function(j){show('sendMsg',true,'Sent. Meta message id '+j.messageId+'.');}).catch(function(e){show('sendMsg',false,e.message);});};
})();
</script></body></html>`;
}

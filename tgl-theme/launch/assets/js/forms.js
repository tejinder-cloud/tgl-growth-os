/* Lead forms. Set window.TGL = {aeoEndpoint:'...', autoEndpoint:'...', thanksUrl:'/thank-you'} before this file.
   Success is shown only when the service answers ok:true. With no endpoint and TGL.preview true, the form confirms in place. */
window.tglSend=function(form,sec,email,kind){
  var T=window.TGL||{},url=kind==='aeo'?T.aeoEndpoint:T.autoEndpoint,btn=form.querySelector('button[type=submit]');
  var msg=form.querySelector('.err-save');
  if(!msg){msg=document.createElement('p');msg.className='err-save';msg.setAttribute('role','alert');msg.style.cssText='color:var(--terra-text);font-weight:600;font-size:.95rem';msg.hidden=true;btn.insertAdjacentElement('afterend',msg);}
  function fail(){btn.disabled=false;msg.textContent='We could not save your request. Please try again in a few minutes.';msg.hidden=false;}
  if(!url){if(T.preview){var t=document.getElementById('t-email');if(t)t.textContent=email;sec.classList.add('done');sec.scrollIntoView({behavior:'smooth',block:'start'});}else fail();return;}
  var data={};new FormData(form).forEach(function(v,k){data[k]=typeof v==='string'?v.trim():v;});data.consent=true;data.page=location.pathname;
  try{location.search.replace(/^\?/,'').split('&').forEach(function(p){var kv=p.split('='),k=decodeURIComponent(kv[0]||'');if(/^(utm_source|utm_medium|utm_campaign|utm_content|utm_term|fbclid|gclid|src)$/.test(k))data[k]=decodeURIComponent((kv[1]||'').replace(/\+/g,' '));});}catch(e){}
  btn.disabled=true;msg.hidden=true;
  fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {s:r.status,j:j};});})
    .then(function(o){if(o.s>=200&&o.s<300&&o.j&&o.j.ok===true){try{sessionStorage.setItem('tgl_lead_email',email);}catch(e){}
      location.href=(T.thanksUrl||'/thank-you')+'#'+(kind==='aeo'?'aeo':'automation');}else fail();})
    .catch(fail);
};

(function(){
  /* One page for every form. The form that sends the visitor here sets the service
     (aeo or automation). On the live site this page opens only after the company
     service has confirmed the lead is saved. The email is never put in the address. */
  var T={
    aeo:{},
    automation:{pill:'Enquiry received',h1:'We have your <span class="acc">enquiry</span>.',sub:'We will reply to <b class="em">your email</b> within one working day.',
      d1:'AI Automation enquiry',d2:'A reply from our team',d4:'Within one working day',d5:'No charge to talk',
      h2:'Three steps, and the next one is <span class="acc">ours</span>.',
      s1h:'Your enquiry is saved',s1p:'We have what you told us about your business and what you want automated.',
      s2w:'Within one working day',s2h:'We read it properly',s2p:'A person reads your enquiry and looks at your business before replying.',
      s3w:'Then',s3h:'A 20-minute call',s3p:'We reply with times for a short call to understand the work. No price until we know the scope.',
      q:'Thank you for writing in. We run our own company on AI agents, so we will tell you plainly what is worth automating and what is not.',
      l1b:'The live board',l1s:'Watch our agents work on our own company, today.',l2b:'Free AI visibility audit',l2s:'See what ChatGPT says about your business.',l1e:'Open it',l2e:'Get yours'}
  };
  var H={aeo:{l1:'/aeo#measure',l2:'/aeo#pricing'},automation:{l1:'https://project.thegrowthlab.co.in',l2:'/aeo#audit'}};
  var base={};document.querySelectorAll('[data-t]').forEach(function(el){base[el.getAttribute('data-t')]=el.innerHTML;});
  var email='';try{email=sessionStorage.getItem('tgl_lead_email')||'';}catch(e){}
  function show(v){if(!T[v])v='aeo';var t=T[v];
    document.querySelectorAll('[data-t]').forEach(function(el){var k=el.getAttribute('data-t');el.innerHTML=(k in t)?t[k]:base[k];});
    document.querySelectorAll('[data-t-href]').forEach(function(a){a.setAttribute('href',H[v][a.getAttribute('data-t-href')]);});
    if(email)document.querySelectorAll('.em').forEach(function(b){b.textContent=email;});
    document.querySelectorAll('.pv button').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-v')===v));});
    var r=document.querySelector('.rcv');r.style.animation='none';void r.offsetWidth;r.style.animation='';}
  document.querySelectorAll('.pv button').forEach(function(b){b.addEventListener('click',function(){var v=b.getAttribute('data-v');try{history.replaceState(null,'','#'+v);}catch(e){}show(v);});});
  window.addEventListener('hashchange',function(){show((location.hash||'').slice(1));});
  show((location.hash||'').slice(1)||'aeo');
})();

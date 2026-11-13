(function(){
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* example buyer questions by industry; {c} is the city or market typed by the visitor */
  var Q={
    healthcare:['patients','your city',['Best dental clinic in {c}','Which hospital in {c} is good for knee replacement?','Child specialist in {c} with good reviews','How much does a root canal cost in {c}?','{c} mein sabse accha skin doctor kaun hai?']],
    education:['students and parents','your city',['Best NEET coaching institute in {c}','Which IELTS institute in {c} has good results?','Online data analytics course with placement support','What are the fees for JEE coaching in {c}?','{c} mein CA ki best coaching kaun si hai?']],
    hospitality:['guests','your city',['Best family hotel in {c} near the airport','Which hotel in {c} is good for a wedding function?','Boutique stay in {c} with good reviews','Best restaurant in {c} for a business dinner','{c} mein accha budget hotel kaun sa hai?']],
    realestate:['buyers','your city',['Which builder in {c} has a good track record?','Best 3BHK projects in {c} that are ready to move','RERA approved projects in {c}','Is {c} a good place to invest in property?','{c} mein flat lena sahi rahega ya plot?']],
    ecommerce:['shoppers','India',['Best natural skincare brand in {c} for oily skin','Which brand makes good running shoes for beginners?','Best online store for ethnic wear in {c}','Which protein powder brand is trusted in {c}?','Sabse accha mattress brand kaun sa hai?']],
    other:['buyers','your city',['Who is the best in {c} for what I need?','Which company in {c} is trusted for this service?','What does this service usually cost in {c}?','Which option in {c} has good reviews?','{c} mein sabse accha kaun hai?']]
  };
  var OLD={clinic:'healthcare',coaching:'education',hotel:'hospitality',d2c:'ecommerce'};
  var chips=[].slice.call(document.querySelectorAll('.ichip')),qs=document.getElementById('qs'),tc=document.getElementById('t-city'),who=document.getElementById('t-who');
  var ind=document.getElementById('f-ind'),fcity=document.getElementById('f-city'),cur='healthcare';
  function draw(){var m=Q[cur],c=tc.value.trim()||m[1];who.textContent=m[0];
    while(qs.firstChild)qs.removeChild(qs.firstChild);
    m[2].forEach(function(t){var li=document.createElement('li'),s=document.createElement('span'),o=document.createElement('span');
      s.textContent=t.split('{c}').join(c);o.className='o';o.setAttribute('aria-hidden','true');for(var k=0;k<4;k++)o.appendChild(document.createElement('i'));
      li.appendChild(s);li.appendChild(o);qs.appendChild(li);});}
  function pick(k,flip){cur=Q[k]?k:'other';chips.forEach(function(c){c.setAttribute('aria-pressed',String(c.getAttribute('data-for')===cur));});
    draw();if(flip){qs.classList.remove('flip');void qs.offsetWidth;qs.classList.add('flip');}}
  chips.forEach(function(c){c.addEventListener('click',function(){pick(c.getAttribute('data-for'),true);});});
  tc.addEventListener('input',draw);
  document.getElementById('t-go').addEventListener('click',function(){ind.value=cur;if(tc.value.trim())fcity.value=tc.value.trim();});

  var p={};try{location.search.replace(/^\?/,'').split('&').forEach(function(x){var kv=x.split('=');if(kv[0])p[decodeURIComponent(kv[0])]=decodeURIComponent((kv[1]||'').replace(/\+/g,' '));});}catch(e){}
  var pre=p['for']||'';pre=OLD[pre]||pre;
  if(pre==='saas'){ind.value='saas';pick('other');}else if(Q[pre]){pick(pre);ind.value=pre;}else{pick('healthcare');}
  if(pre)document.getElementById('f-for').value=pre;
  if(p.site)document.getElementById('f-site').value=p.site;
  if(p.source)document.getElementById('f-src').value=p.source;

  /* KPI tabs */
  var kts=[].slice.call(document.querySelectorAll('.kt')),kps=[].slice.call(document.querySelectorAll('#kp [data-p]'));
  function show(i){kts.forEach(function(t,n){t.setAttribute('aria-selected',String(n===i));});kps.forEach(function(d,n){d.hidden=n!==i;});}
  kts.forEach(function(t,i){t.addEventListener('click',function(){show(i);});
    t.addEventListener('keydown',function(e){var d=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;if(!d)return;e.preventDefault();var n=(i+d+kts.length)%kts.length;show(n);kts[n].focus();});});

  /* counted work: numbers count up once when the row comes into view */
  var cnt=document.querySelector('.cnt');
  if(cnt&&!reduce&&'IntersectionObserver' in window){
    var nums=[].slice.call(cnt.querySelectorAll('[data-count]'));nums.forEach(function(b){b.textContent='0';});
    new IntersectionObserver(function(es,o){es.forEach(function(e){if(!e.isIntersecting)return;o.disconnect();
      nums.forEach(function(b){var to=+b.getAttribute('data-count'),t0=null;
        function step(ts){if(!t0)t0=ts;var k=Math.min(1,(ts-t0)/900);b.textContent=Math.round(to*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(step);}
        requestAnimationFrame(step);});});},{threshold:.3}).observe(cnt);}

  /* form: validate, then confirm. On the live site this posts to the company service and
     shows the thank-you page only when the service answers ok:true. */
  var form=document.getElementById('leadForm'),sec=document.getElementById('audit');
  function bad(el,isBad){var l=el.closest('[data-f]');if(l)l.classList.toggle('bad',isBad);return isBad;}
  form.addEventListener('submit',function(ev){ev.preventDefault();var first=null;
    ['f-biz','f-site','f-city','f-name'].forEach(function(id){var e=document.getElementById(id);if(bad(e,!e.value.trim())&&!first)first=e;});
    if(bad(ind,!ind.value)&&!first)first=ind;
    var em=document.getElementById('f-email');if(bad(em,!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim()))&&!first)first=em;
    var wa=document.getElementById('f-wa'),d=wa.value.replace(/[\s-]/g,'');if(bad(wa,d!==''&&!/^(\+\d{8,15}|\d{10})$/.test(d))&&!first)first=wa;
    var ok=document.getElementById('f-ok');if(bad(ok,!ok.checked)&&!first)first=ok;
    if(first){first.focus();return;}
    tglSend(form,sec,em.value.trim(),'aeo');});
  form.addEventListener('input',function(e){var l=e.target.closest('[data-f]');if(l)l.classList.remove('bad');});

  /* sticky phone button: after some scrolling, hidden while the form or footer is on screen */
  var st=document.getElementById('sticky'),ft=document.querySelector('footer');
  function upd(){var y=window.scrollY||0,vh=window.innerHeight,r=sec.getBoundingClientRect(),f=ft.getBoundingClientRect();
    st.classList.toggle('show',y>900&&!(r.top<vh&&r.bottom>0)&&!(f.top<vh));}
  window.addEventListener('scroll',upd,{passive:true});upd();
})();

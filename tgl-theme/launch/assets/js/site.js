(function(){
  var root=document.documentElement;
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduce) root.classList.add('anim');

  /* footer wordmark: always one line, sized to the column */
  var word=document.getElementById('word');
  function fitWord(){var l3=word.querySelector('.l3');word.style.fontSize='';
    var avail=word.clientWidth,w=l3.scrollWidth;if(w>avail&&w>0){var fs=parseFloat(getComputedStyle(word).fontSize);word.style.fontSize=Math.floor(fs*avail/w*0.985)+'px';}}
  fitWord();window.addEventListener('resize',fitWord);
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(fitWord);}

  /* dial ticks */
  var ticks=document.getElementById('ticks'),ns='http://www.w3.org/2000/svg';
  if(ticks){for(var h=0;h<24;h++){var a=h/24*2*Math.PI,r1=h%6?104:98,l=document.createElementNS(ns,'line');
    l.setAttribute('x1',150+r1*Math.sin(a));l.setAttribute('y1',150-r1*Math.cos(a));
    l.setAttribute('x2',150+110*Math.sin(a));l.setAttribute('y2',150-110*Math.cos(a));l.setAttribute('class','tick');ticks.appendChild(l);}}

  /* the "now" hand, in India time. On the live site a station fills only from a run time
     returned by /home/stats (runs_today); this prototype fills them from the clock. */
  function istHours(){var d=new Date(),u=d.getUTCHours()+d.getUTCMinutes()/60;return (u+5.5)%24;}
  function setHand(){var hrs=istHours(),deg=hrs/24*360;
    document.getElementById('hand').setAttribute('transform','rotate('+deg.toFixed(1)+' 150 150)');
    var hh=Math.floor(hrs),mm=Math.floor((hrs-hh)*60);document.getElementById('nowT').textContent=(hh<10?'0':'')+hh+':'+(mm<10?'0':'')+mm;
    document.querySelectorAll('.dial .st').forEach(function(g){g.classList.toggle('done',parseFloat(g.getAttribute('data-h'))<=hrs);});}
  /* live fill removed: stations show scheduled times until /home/stats returns runs_today */

  /* reveals */
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('go');io.unobserve(e.target);}});},{threshold:.3});
    document.querySelectorAll('[data-reveal]').forEach(function(el){io.observe(el);});
  } else {document.querySelectorAll('[data-reveal]').forEach(function(el){el.classList.add('go');});}

  /* forms: on the live site these open /aeo?site=...#audit; here they confirm in place */
  ['auditForm','ctaForm'].forEach(function(id){var f=document.getElementById(id);if(!f)return;
    f.addEventListener('submit',function(ev){ev.preventDefault();var i=f.querySelector('input'),v=i?i.value.trim():'';location.href='/aeo?site='+encodeURIComponent(v)+'&source='+(id==='auditForm'?'home_hero':'home_cta')+'#audit';});});

  /* rotating word + typed question + stamp */
  var rot=document.getElementById('rot'),typed=document.getElementById('typed'),who=document.getElementById('slipWho'),stamp=document.getElementById('stamp');
  var set=[
    ['clinic','Your patient asks','Which clinic is best for a root canal near me?'],
    ['institute','A parent asks','Which NEET coaching institute has the best results in my city?'],
    ['hotel','Your guest asks','Which hotel near the airport is good for a family stay?'],
    ['project','A home buyer asks','Which builder delivers 3BHK projects on time?'],
    ['brand','Your shopper asks','Which brand makes the best natural skincare for oily skin?']
  ];
  if(!rot)return;
  if(reduce){who.textContent=set[0][1];typed.textContent=set[0][2];return;}
  var i=0;
  function type(text,done){var n=0;typed.textContent='';(function step(){typed.textContent=text.slice(0,++n);if(n<text.length){setTimeout(step,32);}else{done();}})();}
  function cycle(){var s=set[i%set.length];i++;
    stamp.classList.remove('land');
    rot.classList.remove('swap');void rot.offsetWidth;rot.textContent=s[0];rot.classList.add('swap');
    who.textContent=s[1];
    type(s[2],function(){setTimeout(function(){stamp.classList.add('land');},250);setTimeout(cycle,2600);});}
  setTimeout(function(){stamp.classList.add('land');},900);
  setTimeout(cycle,2200);
})();

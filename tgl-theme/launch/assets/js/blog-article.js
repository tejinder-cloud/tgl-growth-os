(function(){
  var bar=document.getElementById('prog'),art=document.querySelector('article');
  function upd(){var r=art.getBoundingClientRect(),h=r.height-window.innerHeight;bar.style.width=(h>0?Math.max(0,Math.min(1,-r.top/h))*100:0)+'%';}
  window.addEventListener('scroll',upd,{passive:true});window.addEventListener('resize',upd);upd();
  var links=[].slice.call(document.querySelectorAll('.toc a'));
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+e.target.id);});}});},{rootMargin:'-20% 0px -65% 0px'});
    document.querySelectorAll('.prose h2[id]').forEach(function(h){io.observe(h);});}
})();

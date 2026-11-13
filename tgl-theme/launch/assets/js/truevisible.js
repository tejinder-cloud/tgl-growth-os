/* Guided tour, adapted from the TrueVisible chat's build: same steps, wording and camera moves; ids and classes namespaced. */
(function(){
  var PAGES={overview:2001,prompts:2952,citations:2139,recommendations:3275,report:1456};
  var STEPS=[
    {page:"overview",box:[200,393,512,349],dot:[505,428],cam:[720,600,1.12],side:"right",m:[456,590,1.0],h:"Your visibility score",p:"In this week's check, AI gave 60 answers to the clinic's 20 questions. 23 of them named Example Dental Clinic. That is the 38%."},
    {page:"overview",box:[728,393,512,349],dot:[744,414],cam:[720,600,1.12],side:"left",m:[984,590,1.0],h:"The number that matters",p:"Ask for a business by name and AI repeats the name. When patients don't type the clinic's name, 15 of 51 answers still named it."},
    {page:"overview",box:[200,783,1040,414],dot:[575,822],cam:[720,1000,1.08],side:"right",m:[720,1060,0.58],h:"Week by week, AI by AI",p:"One line each for ChatGPT, Gemini and Perplexity across four weekly checks. All three name the clinic more often on 26 Oct than on 5 Oct."},
    {page:"overview",box:[200,1237,512,444],dot:[698,1262],cam:[720,1450,1.1],side:"right",m:[456,1500,1.0],h:"You against your competitors",p:"Share of voice counts how many answers name you and how many name each competitor. Here Competitor A is named almost as often as the clinic."},
    {page:"prompts",box:[200,311,1040,270],dot:[600,332],cam:[720,560,1.05],side:"right",m:[540,560,0.9],h:"The questions your buyers ask",p:"Track up to 50 questions on the Track plan. Each one is asked on all three AIs every Monday, in the buyer's own words."},
    {page:"prompts",box:[200,933,1040,105],dot:[1010,938],cam:[720,985,1.15],side:"above",m:[720,1100,0.6],h:"Each question, each AI",p:"For “Best dental clinic in Example City”, ChatGPT and Perplexity name the clinic and Gemini doesn't. You also see which competitors were named."},
    {page:"citations",box:[200,471,1040,779],dot:[640,476],cam:[720,690,1.04],side:"above",m:[610,860,0.75],h:"Where AI gets its answers",p:"These are the sites AI read when it named someone else, most-cited first. Each row says who was named and what to do about it."},
    {page:"recommendations",box:[233,1073,974,117],dot:[300,1062],cam:[720,1110,1.12],side:"above",m:[640,1250,0.75],h:"A ranked fix list, with evidence",p:"Every recommendation shows the questions where you're missing and the site AI cited instead, counted from your stored answers."},
    {page:"recommendations",box:[233,1240,500,48],dot:[470,1264],cam:[720,1110,1.12],side:"below",m:[500,1250,1.0],h:"Do it yourself, or hand it over",p:"Each fix comes with a ready-made draft. Do it yourself, or choose Managed AEO and our team does the work."},
    {page:"report",box:[200,502,1040,178],dot:[1226,508],cam:[720,640,1.08],side:"above",m:[470,700,0.95],h:"A report every Monday",p:"What changed since last week, by AI and against competitors, on the dashboard and in your inbox. Here: 23 of 60 answers, up 3 on the week before."},
    {page:"report",end:true,box:null,dot:null,cam:[720,640,1.08],m:[470,700,0.95],h:"See what AI says about your business",p:"That's the tour. Early access opens in December."}
  ];
  var N=STEPS.length;
  function $(id){return document.getElementById('tv-'+id);}
  var box=$("box");if(!box)return;
  var stage=$("stage"),win=$("win"),view=$("view"),chrome=$("chrome"),wrap=$("wrap");
  var imgs=[].slice.call(view.querySelectorAll("img"));
  var wm='';for(var q=0;q<30;q++)wm+='<span>SAMPLE DATA</span>';$("mark").innerHTML=wm;
  var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  var G=null;
  function layout(){
    var w=box.clientWidth,narrow=w<700;
    box.classList.toggle("tv-narrow",narrow);wrap.classList.toggle("tv-narrow-mode",narrow);
    w=box.clientWidth;
    var W=narrow?640:1280,H=narrow?800:720,pad=narrow?12:40,top=narrow?12:34,bar=narrow?30:36;
    G={W:W,H:H,narrow:narrow,vx:pad,vy:top+bar,vw:W-pad*2,vh:H-top-bar-(narrow?12:34),k:w/W};
    stage.style.width=W+"px";stage.style.height=H+"px";stage.style.transform="scale("+G.k+")";
    win.style.cssText="left:"+pad+"px;top:"+top+"px;width:"+G.vw+"px;height:"+(G.vh+bar)+"px";
    chrome.style.height=bar+"px";view.style.top=bar+"px";
    $("badge").style.cssText="right:"+(pad+14)+"px;bottom:"+((narrow?12:34)+14)+"px";
  }
  function ease(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function camera(step){
    var base=G.vw/1440,s=G.narrow?step.m[2]:base*step.cam[2];
    var cx=G.narrow?step.m[0]:step.cam[0],cy=G.narrow?step.m[1]:step.cam[1];
    return {s:s,tx:clamp(G.vw/2-cx*s,G.vw-1440*s,0),ty:clamp(G.vh/2-cy*s,G.vh-PAGES[step.page]*s,0)};
  }
  function mix(a,b,t){return {s:a.s+(b.s-a.s)*t,tx:a.tx+(b.tx-a.tx)*t,ty:a.ty+(b.ty-a.ty)*t};}
  var lastIdx=-1;
  function render(pos,ms){
    var i=clamp(Math.floor(pos),0,N-1),j=Math.min(i+1,N-1),f=clamp(pos-i,0,1);
    var A=STEPS[i],B=STEPS[j],ca=camera(A),cb=camera(B),e=ease(f),same=A.page===B.page,show={};
    if(same)show[A.page]={cam:mix(ca,cb,e),o:1};
    else if(f<0.5)show[A.page]={cam:ca,o:1-ease(f*2)};
    else show[B.page]={cam:cb,o:ease((f-0.5)*2)};
    imgs.forEach(function(im){var v=show[im.getAttribute("data-page")];im.style.opacity=v?v.o:0;
      if(v)im.style.transform="translate("+v.cam.tx+"px,"+v.cam.ty+"px) scale("+v.cam.s+")";});
    var near=f<0.5?A:B,cam=f<0.5?ca:cb,alpha=f<0.5?clamp(1-f*5,0,1):clamp((f-0.8)*5,0,1),idx=f<0.5?i:j;
    var ring=$("ring"),beacon=$("beacon"),tip=$("tip");
    if(near.box){
      var x=near.box[0],y=near.box[1],w=near.box[2],h=near.box[3];
      ring.style.cssText="left:"+(cam.tx+x*cam.s-6)+"px;top:"+(cam.ty+y*cam.s-6)+"px;width:"+(w*cam.s+12)+"px;height:"+(h*cam.s+12)+"px;opacity:"+alpha;
      var bx=G.vx+cam.tx+near.dot[0]*cam.s,by=G.vy+cam.ty+near.dot[1]*cam.s,ph=((ms||0)%1600)/1600;
      beacon.style.cssText="left:"+bx+"px;top:"+by+"px;opacity:"+alpha+";--ps:"+(1+ph*1.6)+";--po:"+(reduce?0:0.45*(1-ph));
      beacon.hidden=false;
      var tw=330,th=tip.offsetHeight||170,gap=26;
      var tx=near.side==="left"?bx-gap-tw:near.side==="right"?bx+gap:bx-tw/2;
      var ty=near.side==="above"?by-gap-th:near.side==="below"?by+gap:by-34;
      tip.style.left=clamp(tx,14,G.W-tw-14)+"px";tip.style.top=clamp(ty,14,G.H-th-14)+"px";
      tip.style.opacity=alpha;tip.style.pointerEvents=alpha>0.5?"auto":"none";
    } else {ring.style.opacity=0;beacon.hidden=true;tip.style.opacity=0;tip.style.pointerEvents="none";}
    var endA=A.end?1:B.end?ease(f):0;
    $("dim").style.opacity=endA;$("end").style.opacity=endA;$("end").style.pointerEvents=endA>0.9?"auto":"none";
    if(lastIdx!==idx){lastIdx=idx;var st=STEPS[idx];
      $("tipH").textContent=st.h;$("tipP").textContent=st.p;$("capH").textContent=st.h;$("capP").textContent=st.p;
      $("tipN").textContent=(idx+1)+"/"+N;$("count").textContent="Step "+(idx+1)+" of "+N;
      $("back").disabled=idx===0;$("tipBack").style.visibility=idx===0?"hidden":"visible";
      $("next").hidden=idx===N-1;$("restart").hidden=idx!==N-1;}
  }
  var pos=0,target=0,anim=null,vis=true;
  function go(to){to=clamp(to,0,N-1);if(to===target&&!anim)return;target=to;
    if(reduce){pos=to;return;}
    var from=pos,t0=performance.now(),dur=850;
    anim=function(now){var t=clamp((now-t0)/dur,0,1);pos=from+(to-from)*t;if(t>=1){pos=to;anim=null;}};}
  function frame(now){if(vis){if(anim)anim(now);render(pos,now);}requestAnimationFrame(frame);}
  $("next").onclick=$("tipNext").onclick=$("beacon").onclick=function(){go(target+1);};
  $("back").onclick=$("tipBack").onclick=function(){go(target-1);};
  $("restart").onclick=function(){go(0);};
  document.addEventListener("keydown",function(e){if(!vis)return;var tg=e.target&&e.target.tagName;if(tg==="INPUT"||tg==="TEXTAREA")return;
    if(e.key==="ArrowRight")go(target+1);if(e.key==="ArrowLeft")go(target-1);});
  window.addEventListener("resize",function(){layout();lastIdx=-1;});
  if("IntersectionObserver" in window){new IntersectionObserver(function(es){vis=es[0].isIntersecting;},{threshold:0}).observe(box);}
  layout();render(0,0);requestAnimationFrame(frame);
})();
(function(){
  var st=document.getElementById('sticky'),ft=document.querySelector('footer');
  function upd(){var y=window.scrollY||0,f=ft.getBoundingClientRect();st.classList.toggle('show',y>700&&!(f.top<window.innerHeight));}
  window.addEventListener('scroll',upd,{passive:true});upd();
})();

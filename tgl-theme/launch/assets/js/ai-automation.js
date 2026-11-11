(function(){
  var J={
    enquiries:['Enquiry Responder',['Replies to every new enquiry within minutes, day or night.','Answers the common questions from answers you have approved.','Passes anything unusual to a person, with the conversation so far.'],'Your enquiry form or inbox, and the answers you want given.','Someone on your team reads its daily report and can take over any conversation.'],
    followup:['Follow-up Agent',['Sends the next message on WhatsApp and email when a lead goes quiet.','Stops the moment a lead replies, books or says no.','Keeps a note of every message in your customer list.'],'Your customer list or lead sheet, and message wording you have approved.','You approve the wording before anything is sent. The agent never writes a new promise on its own.'],
    qualify:['Lead Qualifier',['Asks each lead the few questions your team always asks.','Scores the lead against rules you set.','Hands over the ready ones with a short brief.'],'Your questions, and what "ready to call" means for you.','Your sales team calls the ready ones and tells us when the scoring is off.'],
    booking:['Appointment Desk',['Offers free slots and books the appointment.','Sends a reminder before each one.','Reschedules when asked, and fills the gap.'],'Your calendar and your booking rules.','Every booking is in your calendar for your front desk to see and change.'],
    reports:['Lead Reporting Agent',['Counts yesterday\'s enquiries, replies, follow-ups and bookings.','Writes one page in plain words.','Flags the leads nobody has answered and what needs a decision.'],'Read-only access to the tools your leads live in.','You read it each morning. It never changes anything; it only reports.'],
    other:['Your job, written with you',['Tell us the routine work your team never gets to.','We say plainly whether an agent can do it well, or not yet.','If it can, we write its job card on the call.'],'A line or two about the job, in the form below.','The same rule as every agent: a person approves anything that involves money or reaches a customer.']
  };
  var chips=[].slice.call(document.querySelectorAll('.jchip')),jd=document.getElementById('jd'),sel=document.getElementById('f-job'),cur='enquiries';
  function pick(k,flip){cur=k;var j=J[k];chips.forEach(function(c){c.setAttribute('aria-pressed',String(c.getAttribute('data-j')===k));});
    document.getElementById('j-title').textContent=j[0];var ul=document.getElementById('j-do');while(ul.firstChild)ul.removeChild(ul.firstChild);
    j[1].forEach(function(t){var li=document.createElement('li'),s=document.createElement('span');s.textContent=t;li.appendChild(s);ul.appendChild(li);});
    document.getElementById('j-need').textContent=j[2];document.getElementById('j-who').textContent=j[3];
    if(flip){jd.classList.remove('flip');void jd.offsetWidth;jd.classList.add('flip');}}
  chips.forEach(function(c){c.addEventListener('click',function(){pick(c.getAttribute('data-j'),true);});});
  document.getElementById('j-go').addEventListener('click',function(){sel.value=cur;});
  pick('enquiries');

  /* form: validate, then confirm. On the live site this posts to the company service and
     opens the thank-you page only when the service answers ok:true. */
  var form=document.getElementById('leadForm'),sec=document.getElementById('talk');
  function bad(el,isBad){var l=el.closest('[data-f]');if(l)l.classList.toggle('bad',isBad);return isBad;}
  form.addEventListener('submit',function(ev){ev.preventDefault();var first=null;
    ['f-name','f-biz'].forEach(function(id){var e=document.getElementById(id);if(bad(e,!e.value.trim())&&!first)first=e;});
    var em=document.getElementById('f-email');if(bad(em,!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim()))&&!first)first=em;
    var wa=document.getElementById('f-wa'),d=wa.value.replace(/[\s-]/g,'');if(bad(wa,d!==''&&!/^(\+\d{8,15}|\d{10})$/.test(d))&&!first)first=wa;
    if(bad(sel,!sel.value)&&!first)first=sel;
    var ok=document.getElementById('f-ok');if(bad(ok,!ok.checked)&&!first)first=ok;
    if(first){first.focus();return;}
    tglSend(form,sec,em.value.trim(),'automation');});
  form.addEventListener('input',function(e){var l=e.target.closest('[data-f]');if(l)l.classList.remove('bad');});

  var st=document.getElementById('sticky'),ft=document.querySelector('footer');
  function upd(){var y=window.scrollY||0,vh=window.innerHeight,r=sec.getBoundingClientRect(),f=ft.getBoundingClientRect();
    st.classList.toggle('show',y>800&&!(r.top<vh&&r.bottom>0)&&!(f.top<vh));}
  window.addEventListener('scroll',upd,{passive:true});upd();
})();

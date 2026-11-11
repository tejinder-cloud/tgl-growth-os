(function(){
  var chips=[].slice.call(document.querySelectorAll('.fchip')),items=[].slice.call(document.querySelectorAll('#grid li')),feat=document.getElementById('feat'),none=document.getElementById('none');
  function show(f){var n=0;chips.forEach(function(c){c.setAttribute('aria-pressed',String(c.getAttribute('data-f')===f));});
    items.forEach(function(li){var ok=f==='all'||li.getAttribute('data-c')===f;li.hidden=!ok;if(ok)n++;});
    var fo=f==='all'||feat.getAttribute('data-c')===f;feat.hidden=!fo;none.hidden=(n>0||fo);}
  chips.forEach(function(c){c.addEventListener('click',function(){show(c.getAttribute('data-f'));});});
})();

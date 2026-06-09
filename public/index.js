'use strict';
(function(){
  const io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(function(el){ io.observe(el); });

  const form = document.getElementById('contact-form');
  if(!form) return;
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    const btn    = document.getElementById('cf-btn');
    const status = document.getElementById('cf-status');
    const name   = document.getElementById('cf-name').value.trim();
    const email  = document.getElementById('cf-email').value.trim();
    const message= document.getElementById('cf-msg').value.trim();
    btn.disabled = true; btn.textContent = 'Sending…'; status.textContent = ''; status.style.color = '';
    try {
      const r = await fetch('/api/contact', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name,email,message}) });
      const j = await r.json();
      if(!j.ok) throw new Error(j.error || 'Error sending message.');
      status.textContent = "Message sent. We'll get back to you soon."; status.style.color = 'var(--green)';
      form.reset();
    } catch(err) {
      status.textContent = err.message; status.style.color = '#c0392b';
    } finally {
      btn.disabled = false; btn.textContent = 'Send message →';
    }
  });
})();

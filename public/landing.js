// GDPR banner
if (!localStorage.getItem('gdpr_ok')) {
  var g = document.getElementById('gdpr');
  if (g) g.style.display = 'flex';
}

// Analytics
(function () {
  function ev(event, meta) {
    fetch('/api/track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...(meta || {}) })
    }).catch(() => {});
  }
  const ref = document.referrer
    ? new URL(document.referrer).hostname
    : (new URLSearchParams(location.search).get('ref') || 'direct');
  ev('page_view', { ref: ref.slice(0, 100) });
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href="/app"],a[href^="/app?"]');
    if (!a) return;
    const near = a.closest('section,nav');
    const ref = near?.id || near?.className?.split(' ')[0] || 'unknown';
    ev('cta_click', { ref: ref.slice(0, 80) });
  });
  const pricing = document.getElementById('pricing');
  if (pricing && 'IntersectionObserver' in window) {
    let fired = false;
    new IntersectionObserver(function (entries, obs) {
      if (fired || !entries[0].isIntersecting) return;
      fired = true; obs.disconnect();
      ev('pricing_view');
    }, { threshold: 0.2 }).observe(pricing);
  }
})();

// Hero animation
(function () {
  var rows = [
    { row: 'am-r0', cell: 'am-p0', chk: 'am-c0', orig: '89.00',  sale: '69.00'  },
    { row: 'am-r1', cell: 'am-p1', chk: 'am-c1', orig: '89.00',  sale: '69.00'  },
    { row: 'am-r2', cell: 'am-p2', chk: 'am-c2', orig: '149.00', sale: '119.00' }
  ];
  var badge = 0;
  function $id(id) { return document.getElementById(id); }
  function reset() {
    badge = 0;
    var sb = $id('am-save-badge');
    var sv = $id('am-save-btn');
    var st = $id('am-status');
    if (sb) sb.textContent = '0';
    if (sv) { sv.style.opacity = '.35'; sv.classList.remove('am-save-pulse', 'am-save-on'); }
    if (st) { st.textContent = 'Ready'; st.style.color = ''; }
    rows.forEach(function (r) {
      var row  = $id(r.row);
      var cell = $id(r.cell);
      var chk  = $id(r.chk);
      if (row)  row.classList.remove('mod');
      if (cell) cell.innerHTML = r.orig;
      if (chk)  chk.checked = false;
    });
  }
  function editRow(idx) {
    var r    = rows[idx];
    var cell = $id(r.cell);
    var row  = $id(r.row);
    var chk  = $id(r.chk);
    if (!cell || !row) return;
    cell.classList.add('am-cell-flash');
    setTimeout(function () { cell.classList.remove('am-cell-flash'); }, 450);
    setTimeout(function () {
      cell.innerHTML = '<span class="am-old">' + r.orig + '</span><span class="am-new am-new-anim">' + r.sale + '</span>';
      if (chk) chk.checked = true;
      row.classList.add('mod');
      badge++;
      var sb = $id('am-save-badge');
      var sv = $id('am-save-btn');
      var st = $id('am-status');
      if (sb) sb.textContent = badge;
      if (sv) sv.style.opacity = '1';
      if (st) st.textContent = badge + ' change' + (badge > 1 ? 's' : '') + ' staged';
    }, 350);
  }
  function run() {
    reset();
    setTimeout(function () { editRow(0); }, 900);
    setTimeout(function () { editRow(1); }, 2200);
    setTimeout(function () { editRow(2); }, 3500);
    setTimeout(function () {
      var sv = $id('am-save-btn');
      if (sv) sv.classList.add('am-save-pulse');
    }, 4800);
    setTimeout(function () {
      var st = $id('am-status');
      if (st) { st.textContent = 'Pushing to Shopify…'; st.style.color = '#1a5c38'; }
      var sv = $id('am-save-btn');
      if (sv) { sv.classList.remove('am-save-pulse'); sv.classList.add('am-save-on'); }
    }, 5800);
    setTimeout(function () {
      var st = $id('am-status');
      if (st) { st.textContent = '✓ 3 changes saved'; st.style.color = '#1a5c38'; }
    }, 6600);
    setTimeout(run, 9000);
  }
  setTimeout(run, 800);
})();

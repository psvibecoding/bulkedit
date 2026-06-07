/* ═══════════════════════════════════════════════════════
   BulkEdit — app.js v2
   Light mode · Product images · Bulk price · Review & Publish
═══════════════════════════════════════════════════════ */

const App = (() => {

  /* ─── STATE ──────────────────────────────────────── */
  let session   = { shop: '', token: '', demo: false };
  let products  = [];
  let originals = {};   // snapshot of products at load time for diff
  let changes   = {};   // staged changes, NOT yet saved
  let schedules = [];
  let timers    = new Map();
  let past = [], future = [];
  const MAX_HISTORY = 80;

  let activeFilter = 'all', searchQuery = '';
  let selectedRows = new Set();
  let schedModalCtx = null;
  let exportFields = ['title','status','vendor','tags','sku','price','compareAtPrice'];

  /* ─── DEMO DATA ──────────────────────────────────── */
  const DEMO = [
    { id:'gid://shopify/Product/1', title:'Merino Wool Crew Neck Sweater', status:'ACTIVE', vendor:'NordWear', tags:['knitwear','winter','new-arrivals'],
      images:{nodes:[{src:'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=80&q=70'}]},
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/11', title:'S', sku:'NW-MERINO-S', price:'89.00', compareAtPrice:'', inventoryQuantity:45, metafields:{nodes:[{namespace:'custom',key:'material',type:'single_line_text_field',value:'100% Merino Wool'}]}},
        {id:'gid://shopify/ProductVariant/12', title:'M', sku:'NW-MERINO-M', price:'89.00', compareAtPrice:'', inventoryQuantity:62, metafields:{nodes:[]}},
        {id:'gid://shopify/ProductVariant/13', title:'L', sku:'NW-MERINO-L', price:'89.00', compareAtPrice:'', inventoryQuantity:28, metafields:{nodes:[]}}
      ]}},
    { id:'gid://shopify/Product/2', title:'Leather Crossbody Bag — Tan', status:'ACTIVE', vendor:'StudioLeather', tags:['bags','accessories','sale'],
      images:{nodes:[{src:'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=80&q=70'}]},
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/21', title:'Default', sku:'SL-CROSS-TAN', price:'149.00', compareAtPrice:'189.00', inventoryQuantity:18, metafields:{nodes:[{namespace:'custom',key:'campaign_label',type:'single_line_text_field',value:'Summer Sale'}]}}
      ]}},
    { id:'gid://shopify/Product/3', title:'Organic Cotton Oversized Tee', status:'ACTIVE', vendor:'EarthBasics', tags:['apparel','sustainable','basics'],
      images:{nodes:[{src:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=80&q=70'}]},
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/31', title:'XS / White', sku:'EB-TEE-XS-WHT', price:'34.00', compareAtPrice:'', inventoryQuantity:0, metafields:{nodes:[]}},
        {id:'gid://shopify/ProductVariant/32', title:'S / White', sku:'EB-TEE-S-WHT', price:'34.00', compareAtPrice:'', inventoryQuantity:55, metafields:{nodes:[]}},
        {id:'gid://shopify/ProductVariant/33', title:'M / Black', sku:'EB-TEE-M-BLK', price:'34.00', compareAtPrice:'', inventoryQuantity:40, metafields:{nodes:[]}}
      ]}},
    { id:'gid://shopify/Product/4', title:'Ceramic Pour-Over Coffee Set', status:'DRAFT', vendor:'KitchenStudio', tags:['kitchen','coffee','gifts'],
      images:{nodes:[{src:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=80&q=70'}]},
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/41', title:'White', sku:'KS-POUROVER-WHT', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:22, metafields:{nodes:[{namespace:'seo',key:'custom_title',type:'single_line_text_field',value:''}]}},
        {id:'gid://shopify/ProductVariant/42', title:'Matte Black', sku:'KS-POUROVER-BLK', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:14, metafields:{nodes:[]}}
      ]}},
    { id:'gid://shopify/Product/5', title:'Natural Rubber Yoga Mat 6mm', status:'ACTIVE', vendor:'MoveWell', tags:['fitness','yoga','eco'],
      images:{nodes:[{src:'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=80&q=70'}]},
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/51', title:'Default', sku:'MW-YOGAMAT-6MM', price:'78.00', compareAtPrice:'', inventoryQuantity:33, metafields:{nodes:[{namespace:'custom',key:'thickness_mm',type:'number_integer',value:'6'}]}}
      ]}},
    { id:'gid://shopify/Product/6', title:'Linen Duvet Cover Set — King', status:'ARCHIVED', vendor:'HomeTextile', tags:['bedding','linen','home'],
      images:{nodes:[]},
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/61', title:'Sand', sku:'HT-DUVET-K-SND', price:'189.00', compareAtPrice:'229.00', inventoryQuantity:7, metafields:{nodes:[]}}
      ]}},
  ];

  /* ─── HELPERS ────────────────────────────────────── */
  const $  = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const escAttr = s => String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
  const cloneState = () => JSON.parse(JSON.stringify({ products, changes }));
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const fmt = iso => new Date(iso).toLocaleString();

  function normalizeProduct(p) {
    return {
      ...p,
      images: { nodes: p.images?.nodes || p.featuredImage ? [p.featuredImage] : [] },
      variants: {
        nodes: (p.variants?.nodes || []).map(v => ({
          ...v,
          metafields: { nodes: v.metafields?.nodes || [] }
        }))
      }
    };
  }

  function getProduct(id) { return products.find(p => p.id === id); }
  function getVariantById(variantId) {
    for (const p of products) {
      const v = p.variants.nodes.find(v => v.id === variantId);
      if (v) return { p, v };
    }
    return {};
  }
  function ensureChange(productId) {
    if (!changes[productId]) changes[productId] = { productId, product: {}, variants: {}, metafields: [] };
    return changes[productId];
  }
  function getProductImage(p) {
    return p.images?.nodes?.[0]?.src || p.featuredImage?.url || null;
  }

  /* ─── TOAST ──────────────────────────────────────── */
  let toastTimer;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function setStatus(msg, cls = '') {
    const el = $('status-msg'); el.textContent = msg;
    el.className = 'status-msg' + (cls ? ' ' + cls : '');
  }

  /* ─── SCREENS ────────────────────────────────────── */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
  }
  function goConnect() { showScreen('connect'); }

  /* ─── API ────────────────────────────────────────── */
  function apiHeaders() {
    return { 'Content-Type': 'application/json', 'X-Shopify-Shop': session.shop, 'X-Shopify-Token': session.token };
  }
  async function apiPost(path, body = {}) {
    const r = await fetch(path, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
    const json = await r.json();
    if (!json.ok) throw new Error(json.error || 'Request failed');
    return json;
  }

  /* ─── CONNECT ────────────────────────────────────── */
  async function connect() {
    session.shop  = $('inp-shop').value.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
    session.token = $('inp-token').value.trim();
    session.demo  = false;
    if (!session.shop || !session.token) return toast('Enter store domain and access token.');
    $('connectBtn').disabled = true;
    setStatus('Connecting…');
    try {
      const test = await apiPost('/api/test');
      $('shopName').textContent = test.shop.name;
      await loadProducts();
      showScreen('workspace');
      $('demo-pill').style.display = 'none';
      $('session-pill').style.display = '';
      $('demo-banner').classList.remove('show');
      toast('Connected. Token is session-only.');
    } catch (e) {
      toast(e.message); setStatus('Connection failed', 'dirty');
    } finally { $('connectBtn').disabled = false; }
  }

  function loadDemo() {
    session = { shop: 'demo.myshopify.com', token: 'demo', demo: true };
    products = DEMO.map(normalizeProduct);
    originals = JSON.parse(JSON.stringify(products));
    $('shopName').textContent = 'Demo store';
    showScreen('workspace');
    $('demo-pill').style.display = '';
    $('session-pill').style.display = 'none';
    $('demo-banner').classList.add('show');
    render(); initExportFields();
    toast('Demo loaded. Connect your store to save real changes.');
  }

  async function loadProducts(query = '') {
    setStatus('Loading…');
    try {
      const res = await apiPost('/api/products', { query, first: 50 });
      products = res.products.map(normalizeProduct);
      originals = JSON.parse(JSON.stringify(products));
      render(); initExportFields();
      setStatus(`${products.length} products loaded`);
    } catch (e) { toast(e.message); setStatus('Load failed', 'dirty'); }
  }

  function disconnect() {
    session = { shop: '', token: '', demo: false };
    products = []; originals = {}; changes = {}; schedules = [];
    past = []; future = []; selectedRows.clear();
    timers.forEach(t => clearTimeout(t)); timers.clear();
    $('inp-token').value = '';
    showScreen('connect');
    updateUndoUI(); updatePublishBtn();
    toast('Disconnected.');
  }

  /* ─── UNDO / REDO ────────────────────────────────── */
  function pushHistory(label) {
    past.push({ label, state: cloneState() });
    if (past.length > MAX_HISTORY) past.shift();
    future = []; updateUndoUI();
  }
  function undo() {
    if (!past.length) return;
    future.push({ label: 'redo', state: cloneState() });
    const h = past.pop(); applyState(h.state);
    render(); updateUndoUI(); updatePublishBtn();
    toast('Undone: ' + h.label);
  }
  function redo() {
    if (!future.length) return;
    past.push({ label: 'undo', state: cloneState() });
    const f = future.pop(); applyState(f.state);
    render(); updateUndoUI(); updatePublishBtn();
    toast('Redone');
  }
  function applyState(s) {
    products = JSON.parse(JSON.stringify(s.products));
    changes  = JSON.parse(JSON.stringify(s.changes));
  }
  function updateUndoUI() {
    $('btn-undo').disabled = !past.length;
    $('btn-redo').disabled = !future.length;
    const bar = $('undo-bar');
    if (past.length || future.length) {
      bar.classList.add('visible');
      $('undo-bar-msg').textContent = `${past.length} action${past.length !== 1 ? 's' : ''} in history${future.length ? ' · ' + future.length + ' redo' : ''}`;
    } else { bar.classList.remove('visible'); }
  }
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
  });

  /* ─── FILTER / SEARCH ────────────────────────────── */
  function flatRows() { return products.flatMap(p => p.variants.nodes.map(v => ({ p, v }))); }

  function getFiltered() {
    const q = searchQuery.toLowerCase();
    return flatRows().filter(({ p, v }) => {
      const ms = !q || [p.title, p.vendor, (p.tags||[]).join(' '), v.title, v.sku].join(' ').toLowerCase().includes(q);
      const hasSched = schedules.some(s => s.variantId === v.id && s.state === 'queued');
      const mf =
        activeFilter === 'all'       ? true :
        activeFilter === 'changed'   ? !!changes[p.id] :
        activeFilter === 'scheduled' ? hasSched :
        p.status === activeFilter;
      return ms && mf;
    });
  }

  /* ─── RENDER ─────────────────────────────────────── */
  function render() {
    const rows = getFiltered();
    const tbody = $('rows');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--t3)">No products match.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(({ p, v }) => rowHTML(p, v)).join('');
    }
    renderScheduleTab(); renderAudit(); updatePublishBtn(); buildSuggestions(); updateBulkBar(); updateExportPreview();
  }

  function rowHTML(p, v) {
    const isChanged  = !!changes[p.id];
    const hasSched   = schedules.some(s => s.variantId === v.id && s.state === 'queued');
    const isSelected = selectedRows.has(v.id);
    const rowClass = [isChanged?'row-changed':'', hasSched?'row-scheduled':'', isSelected?'row-selected':''].filter(Boolean).join(' ');

    const imgSrc = getProductImage(p);
    const imgCell = imgSrc
      ? `<img class="prod-img" src="${esc(imgSrc)}" alt="${esc(p.title)}" loading="lazy" />`
      : `<div class="prod-img-placeholder">□</div>`;

    const statusCls = { ACTIVE: 'ACTIVE', DRAFT: 'DRAFT', ARCHIVED: 'ARCHIVED' }[p.status] || 'DRAFT';
    const statusLabel = { ACTIVE: '● Active', DRAFT: '○ Draft', ARCHIVED: '⊘ Archived' }[p.status] || p.status;

    const tagsHTML = (p.tags||[]).map(t =>
      `<span class="tag-chip">${esc(t)}<span class="tag-del" onclick="App.removeTag('${esc(p.id)}','${escAttr(t)}')">×</span></span>`
    ).join('') + `<span class="tag-add" onclick="App.addTag('${esc(p.id)}')">+</span>`;

    const metaHTML = v.metafields.nodes.map((m,i) => metaRowHTML(v.id, m, i)).join('') +
      `<button class="meta-add-btn" onclick="App.addMetafield('${esc(v.id)}')">+ metafield</button>`;

    const schedSched = schedules.find(s => s.variantId === v.id && s.state === 'queued');
    const schedCell = schedSched
      ? `<div class="sched-pill" onclick="App.switchTab('schedule')" title="${esc(schedSched.name)}">⏱ ${esc(schedSched.name)}</div>`
      : `<button class="sched-add-btn" onclick="App.openScheduleModal({productId:'${esc(p.id)}',variantId:'${esc(v.id)}'})">+ schedule</button>`;

    return `<tr class="${rowClass}" data-product="${esc(p.id)}" data-variant="${esc(v.id)}">
<td><input type="checkbox" class="row-check" data-variant="${esc(v.id)}" ${isSelected?'checked':''} onchange="App.toggleRow('${esc(v.id)}',this.checked)" /></td>
<td>${imgCell}</td>
<td style="min-width:160px"><input class="ce${isChanged?' changed':''}" value="${esc(p.title)}" oninput="App.markProduct('${esc(p.id)}','title',this.value,this)" /></td>
<td><div class="status-badge ${statusCls}" onclick="App.cycleStatus('${esc(p.id)}')">${statusLabel}</div></td>
<td><input class="ce" value="${esc(p.vendor||'')}" oninput="App.markProduct('${esc(p.id)}','vendor',this.value,this)" /></td>
<td style="min-width:140px"><div class="tags-cell" id="tags-${esc(p.id)}">${tagsHTML}</div></td>
<td style="color:var(--t2);font-size:12px">${esc(v.title||'Default')}</td>
<td><input class="ce" value="${esc(v.sku||'')}" oninput="App.markVariant('${esc(v.id)}','sku',this.value,this)" /></td>
<td><input class="ce num" type="number" step=".01" min="0" value="${esc(v.price||'')}" oninput="App.markVariant('${esc(v.id)}','price',this.value,this)" /></td>
<td><input class="ce num" type="number" step=".01" min="0" value="${esc(v.compareAtPrice||'')}" placeholder="—" oninput="App.markVariant('${esc(v.id)}','compareAtPrice',this.value,this)" /></td>
<td><div class="meta-cell" id="meta-${esc(v.id)}">${metaHTML}</div></td>
<td>${schedCell}</td>
</tr>`;
  }

  function metaRowHTML(variantId, m, i) {
    return `<div class="meta-row">
<input class="meta-input" placeholder="ns" value="${esc(m.namespace||'custom')}" oninput="App.markMetafield('${esc(variantId)}',${i},'namespace',this.value,this)" />
<input class="meta-input" placeholder="key" value="${esc(m.key||'')}" oninput="App.markMetafield('${esc(variantId)}',${i},'key',this.value,this)" />
<input class="meta-input" placeholder="value" value="${esc(m.value||'')}" oninput="App.markMetafield('${esc(variantId)}',${i},'value',this.value,this)" />
<button class="meta-del" onclick="App.removeMetafield('${esc(variantId)}',${i})">×</button>
</div>`;
  }

  /* ─── MARK CHANGES ───────────────────────────────── */
  function markProduct(productId, field, value, el) {
    pushHistory(`Edit ${field} on "${getProduct(productId)?.title||productId}"`);
    const p = getProduct(productId); if (!p) return;
    p[field] = field === 'tags' ? value.split(',').map(x=>x.trim()).filter(Boolean) : value;
    ensureChange(productId).product[field] = p[field];
    if (el) el.classList.add('changed');
    updatePublishBtn(); renderAudit();
  }

  function markVariant(variantId, field, value, el) {
    const { p, v } = getVariantById(variantId); if (!p||!v) return;
    pushHistory(`Edit ${field} on variant "${v.title||'Default'}"`);
    v[field] = value;
    const c = ensureChange(p.id);
    if (!c.variants[variantId]) c.variants[variantId] = { id: variantId };
    c.variants[variantId][field] = value;
    if (el) el.classList.add('changed');
    updatePublishBtn(); renderAudit();
  }

  function markMetafield(variantId, index, field, value, el) {
    const { p, v } = getVariantById(variantId); if (!p||!v) return;
    pushHistory(`Edit metafield on "${v.title||'Default'}"`);
    v.metafields.nodes[index][field] = value;
    const m = v.metafields.nodes[index];
    const c = ensureChange(p.id);
    c.metafields = c.metafields.filter(x => !(x.ownerId === variantId && x._idx === index));
    if (m.namespace && m.key) c.metafields.push({ ownerId: variantId, namespace: m.namespace, key: m.key, type: m.type||'single_line_text_field', value: String(m.value??''), _idx: index });
    if (el) el.classList.add('changed');
    updatePublishBtn(); renderAudit();
  }

  function cycleStatus(productId) {
    const p = getProduct(productId); if (!p) return;
    pushHistory(`Cycle status on "${p.title}"`);
    const cycle = { ACTIVE:'DRAFT', DRAFT:'ARCHIVED', ARCHIVED:'ACTIVE' };
    p.status = cycle[p.status] || 'ACTIVE';
    ensureChange(productId).product.status = p.status;
    render(); updatePublishBtn();
  }

  function removeTag(productId, tag) {
    const p = getProduct(productId); if (!p) return;
    pushHistory(`Remove tag "${tag}" from "${p.title}"`);
    p.tags = (p.tags||[]).filter(t => t !== tag);
    ensureChange(productId).product.tags = [...p.tags];
    const cell = $(`tags-${productId}`);
    if (cell) cell.innerHTML = p.tags.map(t=>`<span class="tag-chip">${esc(t)}<span class="tag-del" onclick="App.removeTag('${esc(productId)}','${escAttr(t)}')">×</span></span>`).join('')+`<span class="tag-add" onclick="App.addTag('${esc(productId)}')">+</span>`;
    updatePublishBtn(); renderAudit();
  }

  function addTag(productId) {
    const tag = prompt('New tag:'); if (!tag?.trim()) return;
    const p = getProduct(productId); if (!p||p.tags.includes(tag.trim())) return;
    pushHistory(`Add tag "${tag.trim()}" to "${p.title}"`);
    p.tags.push(tag.trim());
    ensureChange(productId).product.tags = [...p.tags];
    const cell = $(`tags-${productId}`);
    if (cell) cell.innerHTML = p.tags.map(t=>`<span class="tag-chip">${esc(t)}<span class="tag-del" onclick="App.removeTag('${esc(productId)}','${escAttr(t)}')">×</span></span>`).join('')+`<span class="tag-add" onclick="App.addTag('${esc(productId)}')">+</span>`;
    updatePublishBtn(); renderAudit();
  }

  function addMetafield(variantId) {
    const { v } = getVariantById(variantId); if (!v) return;
    pushHistory('Add metafield');
    v.metafields.nodes.push({ namespace:'custom', key:'', type:'single_line_text_field', value:'' });
    const cell = $(`meta-${variantId}`);
    if (cell) cell.innerHTML = v.metafields.nodes.map((m,i)=>metaRowHTML(variantId,m,i)).join('')+`<button class="meta-add-btn" onclick="App.addMetafield('${esc(variantId)}')">+ metafield</button>`;
  }

  function removeMetafield(variantId, index) {
    const { p, v } = getVariantById(variantId); if (!p||!v) return;
    pushHistory('Remove metafield');
    v.metafields.nodes.splice(index, 1);
    const c = ensureChange(p.id);
    c.metafields = c.metafields.filter(x => !(x.ownerId === variantId && x._idx === index));
    const cell = $(`meta-${variantId}`);
    if (cell) cell.innerHTML = v.metafields.nodes.map((m,i)=>metaRowHTML(variantId,m,i)).join('')+`<button class="meta-add-btn" onclick="App.addMetafield('${esc(variantId)}')">+ metafield</button>`;
    updatePublishBtn();
  }

  /* ─── BULK ACTIONS ───────────────────────────────── */
  function toggleRow(variantId, checked) {
    checked ? selectedRows.add(variantId) : selectedRows.delete(variantId);
    updateBulkBar();
    const row = document.querySelector(`tr[data-variant="${variantId}"]`);
    if (row) row.classList.toggle('row-selected', checked);
  }
  function toggleAllRows(checked) { document.querySelectorAll('.row-check').forEach(cb => { cb.checked = checked; toggleRow(cb.dataset.variant, checked); }); }
  function updateBulkBar() {
    const n = selectedRows.size;
    $('bulk-actions').classList.toggle('visible', n > 0);
    $('bulk-label').textContent = `${n} selected`;
  }
  function getSelectedProductIds() {
    const ids = new Set();
    for (const vid of selectedRows) { const { p } = getVariantById(vid); if (p) ids.add(p.id); }
    return [...ids];
  }

  function bulkStatus(status) {
    const pids = getSelectedProductIds(); if (!pids.length) return;
    pushHistory(`Bulk set status → ${status}`);
    pids.forEach(id => { const p = getProduct(id); if (!p) return; p.status = status; ensureChange(id).product.status = status; });
    render(); updatePublishBtn(); toast(`Status set to ${status} on ${pids.length} product${pids.length!==1?'s':''}.`);
  }

  function bulkAddTag() {
    const tag = prompt('Tag to add:'); if (!tag?.trim()) return;
    const pids = getSelectedProductIds(); if (!pids.length) return;
    pushHistory(`Bulk add tag "${tag.trim()}"`);
    pids.forEach(id => { const p = getProduct(id); if (!p) return; if (!p.tags.includes(tag.trim())) p.tags.push(tag.trim()); ensureChange(id).product.tags = [...p.tags]; });
    render(); updatePublishBtn(); toast(`Tag "${tag.trim()}" added to ${pids.length} products.`);
  }

  function bulkRemoveTag() {
    const tag = prompt('Tag to remove:'); if (!tag?.trim()) return;
    const pids = getSelectedProductIds(); if (!pids.length) return;
    pushHistory(`Bulk remove tag "${tag.trim()}"`);
    pids.forEach(id => { const p = getProduct(id); if (!p) return; p.tags = p.tags.filter(t=>t!==tag.trim()); ensureChange(id).product.tags = [...p.tags]; });
    render(); updatePublishBtn(); toast(`Tag "${tag.trim()}" removed from ${pids.length} products.`);
  }

  function bulkSetPrice() {
    const price = prompt('Set price for all selected variants (e.g. 29.99):'); if (!price?.trim()) return;
    const n = Number(price); if (isNaN(n) || n < 0) return toast('Invalid price.');
    const vids = [...selectedRows]; if (!vids.length) return;
    pushHistory(`Bulk set price → ${n}`);
    vids.forEach(vid => {
      const { p, v } = getVariantById(vid); if (!p||!v) return;
      v.price = n.toFixed(2);
      const c = ensureChange(p.id);
      if (!c.variants[vid]) c.variants[vid] = { id: vid };
      c.variants[vid].price = v.price;
    });
    render(); updatePublishBtn(); toast(`Price set to ${n.toFixed(2)} on ${vids.length} variant${vids.length!==1?'s':''}.`);
  }

  /* ─── PUBLISH BUTTON ─────────────────────────────── */
  function updatePublishBtn() {
    const n = Object.keys(changes).length;
    $('publishBtn').disabled = !n;
    $('changeCount').textContent = n;
    if (n) setStatus(`${n} unsaved change${n!==1?'s':''} — ready to review`, 'dirty');
    else setStatus('No pending changes', 'ok');
  }

  /* ─── REVIEW MODAL ───────────────────────────────── */
  function openReviewModal() {
    const payloads = Object.values(changes);
    if (!payloads.length) return toast('No changes to review.');
    const list = $('review-list');
    $('review-sub').textContent = `${payloads.length} product${payloads.length!==1?'s':''} with changes`;
    $('review-commit-msg').value = '';

    if (!payloads.length) { list.innerHTML = '<div class="review-empty">No changes.</div>'; }
    else {
      list.innerHTML = payloads.map(c => {
        const p = getProduct(c.productId);
        if (!p) return '';
        const imgSrc = getProductImage(p);
        const imgEl = imgSrc
          ? `<img class="review-item-img" src="${esc(imgSrc)}" alt="" />`
          : `<div class="review-item-img-ph">□</div>`;

        // build diff lines
        const orig = originals.find ? originals.find(x=>x.id===c.productId) : null;
        const diffs = [];

        Object.entries(c.product||{}).forEach(([field, newVal]) => {
          const oldVal = orig ? orig[field] : '?';
          const oldStr = Array.isArray(oldVal) ? oldVal.join(', ') : String(oldVal??'');
          const newStr = Array.isArray(newVal) ? newVal.join(', ') : String(newVal??'');
          if (oldStr !== newStr) {
            diffs.push(`<div class="review-change">
              <span class="review-field">${esc(field)}</span>
              <span class="review-from">${esc(oldStr||'—')}</span>
              <span class="review-arrow">→</span>
              <span class="review-to">${esc(newStr)}</span>
            </div>`);
          }
        });

        Object.values(c.variants||{}).forEach(v => {
          const vid = v.id;
          let origV = null;
          if (orig) { for (const ov of orig.variants?.nodes||[]) { if (ov.id === vid) { origV = ov; break; } } }
          ['price','compareAtPrice','sku'].forEach(field => {
            if (v[field] !== undefined) {
              const oldStr = origV ? String(origV[field]??'') : '?';
              const newStr = String(v[field]??'');
              if (oldStr !== newStr) {
                const vLabel = p.variants.nodes.find(x=>x.id===vid)?.title || 'variant';
                diffs.push(`<div class="review-change">
                  <span class="review-field">${esc(vLabel)} ${esc(field)}</span>
                  <span class="review-from">${esc(oldStr||'—')}</span>
                  <span class="review-arrow">→</span>
                  <span class="review-to">${esc(newStr)}</span>
                </div>`);
              }
            }
          });
        });

        if ((c.metafields||[]).length) {
          diffs.push(`<div class="review-change"><span class="review-field">metafields</span><span class="review-to">${c.metafields.length} change${c.metafields.length!==1?'s':''}</span></div>`);
        }

        return `<div class="review-item">
          <div class="review-item-header">${imgEl}<span class="review-item-title">${esc(p.title)}</span></div>
          <div class="review-changes">${diffs.length ? diffs.join('') : '<div style="font-size:12px;color:var(--t3)">Metafields or variant changes</div>'}</div>
        </div>`;
      }).join('');
    }

    $('modal-review').classList.add('open');
  }

  function closeReviewModal() { $('modal-review').classList.remove('open'); }

  async function confirmPublish() {
    const payloads = Object.values(changes);
    if (!payloads.length) return;
    $('confirm-publish-btn').disabled = true;
    setStatus('Publishing…', 'saving');

    try {
      if (session.demo) {
        await delay(600);
      } else {
        for (const c of payloads) {
          const mf = (c.metafields||[]).map(({ _idx, ...rest }) => rest);
          await apiPost('/api/save-product', { productId: c.productId, product: c.product, variants: Object.values(c.variants||{}), metafields: mf });
        }
      }
      const n = payloads.length;
      changes = {}; past = []; future = [];
      originals = JSON.parse(JSON.stringify(products));
      document.querySelectorAll('.changed').forEach(el => el.classList.remove('changed'));
      closeReviewModal();
      render();
      toast(`${n} product${n!==1?'s':''} published successfully.`);
      setStatus('All changes published', 'ok');
    } catch (e) {
      toast(e.message); setStatus('Publish failed', 'dirty');
    } finally {
      $('confirm-publish-btn').disabled = false;
      updatePublishBtn();
    }
  }

  /* ─── AUDIT ──────────────────────────────────────── */
  function renderAudit() {
    const list = Object.values(changes).map(c => ({
      product: getProduct(c.productId)?.title || c.productId,
      fields: c.product,
      variants: Object.values(c.variants||{}),
      metafields: (c.metafields||[]).map(m=>({namespace:m.namespace,key:m.key,value:m.value}))
    }));
    $('audit').textContent = list.length ? JSON.stringify(list, null, 2) : 'No pending changes.';
  }

  function clearChanges() {
    if (!Object.keys(changes).length) return toast('No changes to clear.');
    if (!confirm('Clear all unsaved changes?')) return;
    pushHistory('Clear all changes');
    changes = {};
    document.querySelectorAll('.changed').forEach(el => el.classList.remove('changed'));
    render(); updatePublishBtn();
    toast('All changes cleared.');
  }

  /* ─── SEARCH ─────────────────────────────────────── */
  function buildSuggestions() {
    const q = searchQuery; const box = $('suggestions');
    if (!q) { box.classList.remove('open'); return; }
    const vals = [...new Set(flatRows().flatMap(({p,v})=>[p.title,p.vendor,v.sku,...(p.tags||[])]).filter(Boolean))].filter(x=>x.toLowerCase().includes(q.toLowerCase())).slice(0,8);
    if (!vals.length) { box.classList.remove('open'); return; }
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    box.innerHTML = vals.map(v=>`<div class="sug-item" onmousedown="App.useSuggestion('${escAttr(v)}')"><span>${esc(v).replace(re,'<mark>$1</mark>')}</span></div>`).join('');
    box.classList.add('open');
  }
  function useSuggestion(v) { $('search').value = v; searchQuery = v.toLowerCase(); $('suggestions').classList.remove('open'); render(); }
  function setFilter(f) { activeFilter = f; document.querySelectorAll('.filter-chip').forEach(c=>c.classList.toggle('active',c.dataset.filter===f)); render(); }

  /* ─── TABS ───────────────────────────────────────── */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));
    if (name==='audit') renderAudit();
    if (name==='export') updateExportPreview();
  }

  /* ─── SCHEDULE ───────────────────────────────────── */
  function openScheduleModal(ctx) {
    schedModalCtx = ctx;
    const overlay = $('modal-schedule'); overlay.classList.add('open');
    const tom = new Date(); tom.setDate(tom.getDate()+1);
    $('sched-date').value = tom.toISOString().split('T')[0];
    $('sched-time').value = '09:00';
    $('sched-revert').checked = false;
    $('sched-revert-fields').classList.add('hidden');
    $('sched-name').value = '';
    let targetRows;
    if (ctx === 'bulk' || ctx === 'new') targetRows = ctx==='bulk' ? flatRows().filter(({v})=>selectedRows.has(v.id)) : flatRows().slice(0,20);
    else if (ctx?.variantId) targetRows = flatRows().filter(({v})=>v.id===ctx.variantId);
    else targetRows = flatRows().slice(0,20);
    $('modal-sched-sub').textContent = ctx==='bulk' ? `${targetRows.length} selected variants` : ctx?.variantId ? `${targetRows[0]?.p.title||''} — ${targetRows[0]?.v.title||'Default'}` : `${targetRows.length} products`;
    const list = $('sched-prod-list');
    list.innerHTML = targetRows.map(({p,v})=>`<div class="sched-prod-item" data-vid="${esc(v.id)}" data-pid="${esc(p.id)}"><span class="spi-name">${esc(p.title)} — ${esc(v.title||'Default')}</span><div class="spi-price" id="sprice-${esc(v.id)}"></div></div>`).join('');
    $('sched-prod-count').textContent = `(${targetRows.length})`;
    renderSchedTypeFields();
  }
  function closeScheduleModal() { $('modal-schedule').classList.remove('open'); schedModalCtx = null; }
  function toggleRevert() { $('sched-revert-fields').classList.toggle('hidden', !$('sched-revert').checked); }
  function renderSchedTypeFields() {
    const type = $('sched-type').value; const wrap = $('sched-type-fields');
    const prodItems = document.querySelectorAll('#sched-prod-list .sched-prod-item');
    if (type==='price') {
      wrap.innerHTML=`<div class="modal-field"><label>Default price <span class="label-hint">(override per-variant below)</span></label><input id="sched-default-price" type="number" step=".01" min="0" placeholder="0.00" oninput="App.applyDefaultSchedPrice(this.value)"/></div>`;
      prodItems.forEach(item=>{const vid=item.dataset.vid;const{v}=getVariantById(vid);const el=item.querySelector('.spi-price');if(el)el.innerHTML=`<input id="spriceinp-${esc(vid)}" type="number" step=".01" min="0" placeholder="${esc(v?.price||'')}"/>`;});
    } else if (type==='status') {
      wrap.innerHTML=`<div class="modal-field"><label>New status</label><select id="sched-status-val"><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select></div>`;
      prodItems.forEach(item=>{const el=item.querySelector('.spi-price');if(el)el.innerHTML='';});
    } else {
      wrap.innerHTML=`<div class="modal-field"><label>${type==='tags_add'?'Tags to add':'Tags to remove'}</label><input id="sched-tags-val" type="text" placeholder="sale, promo"/></div>`;
      prodItems.forEach(item=>{const el=item.querySelector('.spi-price');if(el)el.innerHTML='';});
    }
  }
  function applyDefaultSchedPrice(v) { if(!v)return; document.querySelectorAll('[id^="spriceinp-"]').forEach(inp=>{if(!inp.value)inp.placeholder=v;}); }
  function confirmSchedule() {
    const name=$('sched-name').value.trim()||'Scheduled task';
    const date=$('sched-date').value; const time=$('sched-time').value||'09:00';
    const type=$('sched-type').value;
    if(!date) return toast('Please set a date.');
    const runAt=new Date(`${date}T${time}`);
    if(isNaN(runAt.getTime())||runAt<new Date()) return toast('Date must be in the future.');
    const items=[...document.querySelectorAll('#sched-prod-list .sched-prod-item')];
    const targets=items.map(item=>({productId:item.dataset.pid,variantId:item.dataset.vid,overridePrice:document.getElementById(`spriceinp-${item.dataset.vid}`)?.value||null}));
    const revert=$('sched-revert').checked;
    const revertAt=revert?new Date(`${$('sched-revert-date').value}T${$('sched-revert-time').value}`):null;
    let value=null;
    if(type==='price') value=$('sched-default-price')?.value||null;
    if(type==='status') value=$('sched-status-val')?.value||'ACTIVE';
    if(type==='tags_add'||type==='tags_remove') value=$('sched-tags-val')?.value||'';
    targets.forEach(({productId,variantId,overridePrice})=>{
      const{p,v}=getVariantById(variantId);if(!p||!v)return;
      const action={id:crypto.randomUUID(),name,productId,variantId,productTitle:p.title,variantTitle:v.title||'Default',runAt:runAt.toISOString(),revertAt:revert&&revertAt&&!isNaN(revertAt.getTime())?revertAt.toISOString():null,type,value:type==='price'?(overridePrice||value):value,original:{price:v.price,status:p.status,tags:[...(p.tags||[])]},state:'queued'};
      schedules.push(action);armTimer(action);
    });
    updateSchedBadge();closeScheduleModal();render();toast(`"${name}" scheduled for ${date} ${time}.`);
  }
  function armTimer(s){if(timers.has(s.id))clearTimeout(timers.get(s.id));const ms=new Date(s.runAt)-new Date();if(ms<0)return;timers.set(s.id,setTimeout(()=>runSchedule(s.id,false),ms));}
  async function runSchedule(id,isRevert){
    const s=schedules.find(x=>x.id===id);if(!s)return;
    const{p,v}=getVariantById(s.variantId);if(!p||!v)return;
    const product={},variants={};
    if(isRevert){if(s.original.status)product.status=s.original.status;if(s.original.price)variants[s.variantId]={id:s.variantId,price:s.original.price};s.state='reverted';}
    else{if(s.type==='price'&&s.value)variants[s.variantId]={id:s.variantId,price:s.value};if(s.type==='status'&&s.value)product.status=s.value;if(s.type==='tags_add'&&s.value){s.value.split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{if(!p.tags.includes(t))p.tags.push(t);});product.tags=[...p.tags];}if(s.type==='tags_remove'&&s.value){p.tags=p.tags.filter(t=>!s.value.split(',').map(x=>x.trim()).includes(t));product.tags=[...p.tags];}s.state='running';}
    const c={productId:s.productId,product,variants,metafields:[]};
    if(!session.demo){try{const mf=(c.metafields||[]).map(({_idx,...rest})=>rest);await apiPost('/api/save-product',{productId:c.productId,product:c.product,variants:Object.values(c.variants||{}),metafields:mf});}catch(e){toast('Schedule error: '+e.message);}}
    if(!isRevert&&s.revertAt){const ms=new Date(s.revertAt)-new Date();if(ms>0)setTimeout(()=>runSchedule(id,true),ms);}else if(!isRevert)s.state='done';
    renderScheduleTab();render();
  }
  function cancelSchedule(id){if(timers.has(id))clearTimeout(timers.get(id));schedules=schedules.filter(s=>s.id!==id);updateSchedBadge();renderScheduleTab();render();toast('Cancelled.');}
  function updateSchedBadge(){const n=schedules.filter(s=>s.state==='queued').length;const b=$('tab-sched-count');b.textContent=n;b.style.display=n?'':'none';}
  function renderScheduleTab(){
    updateSchedBadge();const el=$('scheduleList');
    if(!schedules.length){el.className='sched-list empty';el.textContent='No scheduled actions yet.';return;}
    el.className='sched-list';
    const sorted=[...schedules].sort((a,b)=>new Date(b.runAt)-new Date(a.runAt));
    el.innerHTML=sorted.map(s=>{
      const isPast=new Date(s.runAt)<new Date();
      const typeLabel={price:'Price change',status:'Status change',tags_add:'Add tags',tags_remove:'Remove tags'}[s.type]||s.type;
      return`<div class="sched-item"><div class="sched-item-top"><div><div class="sched-item-name">${esc(s.name)}</div><div class="sched-item-meta"><span>${typeLabel}</span>${s.value?`<span>· ${esc(String(s.value))}</span>`:''}<span>· ${esc(s.state)}</span>${s.revertAt?`<span class="revert-tag">↺ auto-revert ${new Date(s.revertAt).toLocaleDateString()}</span>`:''}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="sched-item-time${isPast||s.state!=='queued'?' done':''}">${fmt(s.runAt)}</span><button class="btn-ghost xs danger" onclick="App.cancelSchedule('${s.id}')">Cancel</button></div></div><div class="sched-item-prods"><span class="sched-prod-tag">${esc(s.productTitle)} — ${esc(s.variantTitle)}</span></div></div>`;
    }).join('');
  }
  function exportScheduleJSON(){const blob=new Blob([JSON.stringify(schedules,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`bulkedit-schedule-${Date.now()}.json`;a.click();toast('Exported.');}
  function importScheduleFile(file){const r=new FileReader();r.onload=()=>{try{const imp=JSON.parse(r.result);if(!Array.isArray(imp))throw 0;schedules=imp;schedules.forEach(s=>{if(s.state==='queued')armTimer(s);});renderScheduleTab();toast(`${imp.length} schedule${imp.length!==1?'s':''} imported.`);}catch{toast('Invalid JSON.');}};r.readAsText(file);}

  /* ─── EXPORT ─────────────────────────────────────── */
  const EX_ALL=['id','title','status','vendor','tags','variant','sku','price','compareAtPrice','inventoryQuantity'];
  const EX_LABELS={id:'ID',title:'Title',status:'Status',vendor:'Vendor',tags:'Tags',variant:'Variant',sku:'SKU',price:'Price',compareAtPrice:'Compare at',inventoryQuantity:'Inventory'};
  function initExportFields(){
    const el=$('export-fields');if(!el)return;
    el.innerHTML=EX_ALL.map(f=>`<label class="export-field${exportFields.includes(f)?' on':''}"><input type="checkbox" ${exportFields.includes(f)?'checked':''} value="${f}" onchange="App.toggleExportField('${f}',this.checked,this.closest('.export-field'))" />${EX_LABELS[f]||f}</label>`).join('');
    updateExportPreview();
  }
  function toggleExportField(f,checked,el){if(checked){if(!exportFields.includes(f))exportFields.push(f);}else exportFields=exportFields.filter(x=>x!==f);el.classList.toggle('on',checked);updateExportPreview();}
  function getExportValue(p,v,f){if(f==='tags')return(p.tags||[]).join('|');if(f==='variant')return v.title||'Default';if(f==='sku')return v.sku||'';if(f==='price')return v.price||'';if(f==='compareAtPrice')return v.compareAtPrice||'';if(f==='inventoryQuantity')return String(v.inventoryQuantity??'');return String(p[f]??'');}
  function buildCSV(){return[exportFields.join(','),...flatRows().map(({p,v})=>exportFields.map(f=>{const val=getExportValue(p,v,f);return val.includes(',')||val.includes('"')?`"${val.replace(/"/g,'""')}"`:`${val}`;}).join(','))].join('\n');}
  function buildJSON(){return JSON.stringify(flatRows().map(({p,v})=>{const o={};exportFields.forEach(f=>o[f]=getExportValue(p,v,f));return o;}),null,2);}
  function updateExportPreview(){const pre=$('export-preview');if(!pre)return;const rows=flatRows().slice(0,3);pre.textContent=[exportFields.join(','),...rows.map(({p,v})=>exportFields.map(f=>{const val=getExportValue(p,v,f);return val.includes(',')?`"${val}"`:val;}).join(','))].join('\n')+(flatRows().length>3?`\n… (${flatRows().length} total rows)`:'');}
  function doExport(fmt){const data=fmt==='csv'?buildCSV():buildJSON();const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:fmt==='csv'?'text/csv':'application/json'}));a.download=`shopify-products-${Date.now()}.${fmt}`;a.click();toast(`${fmt.toUpperCase()} downloaded.`);}
  function copyExport(){navigator.clipboard?.writeText(buildCSV()).then(()=>toast('CSV copied.')).catch(()=>toast('Clipboard not available.'));}

  /* ─── BOOT ───────────────────────────────────────── */
  function boot() {
    $('connectBtn').onclick = connect;
    $('demoBtn').onclick    = loadDemo;
    $('disconnectBtn').onclick = disconnect;
    $('btn-undo').onclick = undo;
    $('btn-redo').onclick = redo;
    $('chk-all').onchange = e => toggleAllRows(e.target.checked);
    $('search').oninput = e => { searchQuery = e.target.value.trim(); render(); if(!session.demo&&searchQuery.length>2){clearTimeout(window._st);window._st=setTimeout(()=>loadProducts(searchQuery),350);} };
    $('search').onfocus = () => { if(searchQuery) buildSuggestions(); };
    document.addEventListener('click', e => { if(!e.target.closest('.search-wrap')) $('suggestions').classList.remove('open'); });
    document.querySelectorAll('.filter-chip').forEach(btn => { btn.onclick = () => setFilter(btn.dataset.filter); });
    document.querySelectorAll('.tab').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });
    $('exportSchedule').onclick = exportScheduleJSON;
    $('importScheduleBtn').onclick = () => $('importSchedule').click();
    $('importSchedule').onchange = e => e.target.files[0] && importScheduleFile(e.target.files[0]);
    document.addEventListener('keydown', e => { if(e.key==='Escape'){closeReviewModal();closeScheduleModal();} });
  }

  function showModes() {
    $('connect-modes').style.display = 'flex';
    $('oauth-form').style.display    = 'none';
    $('token-form').style.display    = 'none';
  }
  function showOAuthForm() {
    $('connect-modes').style.display = 'none';
    $('oauth-form').style.display    = 'flex';
    $('token-form').style.display    = 'none';
    setTimeout(() => $('inp-shop-oauth')?.focus(), 50);
  }
  function showTokenForm() {
    $('connect-modes').style.display = 'none';
    $('oauth-form').style.display    = 'none';
    $('token-form').style.display    = 'flex';
    setTimeout(() => $('inp-shop')?.focus(), 50);
  }

  function startOAuth() {
    const shop = ($('inp-shop-oauth') || $('inp-shop')).value.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
    if (!shop || !shop.includes('.myshopify.com')) return toast('Enter your store domain (e.g. your-store.myshopify.com)');
    window.location.href = `/auth/start?shop=${encodeURIComponent(shop)}`;
  }

  return {
    connect, loadDemo, disconnect, goConnect,
    startOAuth, showModes, showOAuthForm, showTokenForm,
    markProduct, markVariant, markMetafield,
    cycleStatus, removeTag, addTag, addMetafield, removeMetafield,
    toggleRow, toggleAllRows, bulkStatus, bulkAddTag, bulkRemoveTag, bulkSetPrice,
    undo, redo,
    openReviewModal, closeReviewModal, confirmPublish, clearChanges,
    useSuggestion, setFilter, switchTab,
    openScheduleModal, closeScheduleModal, renderSchedTypeFields, toggleRevert,
    applyDefaultSchedPrice, confirmSchedule, cancelSchedule,
    toggleExportField, doExport, copyExport,
    boot
  };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());

/* ═══════════════════════════════════════════════════════
   OAuth boot — reads ?shop=...&token=... from URL after
   Shopify redirects back via /auth/callback
═══════════════════════════════════════════════════════ */
(function checkOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const shop  = params.get('shop');
  const token = params.get('token');
  if (shop && token) {
    // Clean URL immediately — token should never sit in browser history
    window.history.replaceState({}, '', '/');
    // Auto-connect
    document.addEventListener('DOMContentLoaded', () => {
      // Pre-fill and trigger connect
      const shopInput  = document.getElementById('inp-shop');
      const tokenInput = document.getElementById('inp-token');
      if (shopInput && tokenInput) {
        shopInput.value  = decodeURIComponent(shop);
        tokenInput.value = decodeURIComponent(token);
        // Small delay to let App.boot() finish
        setTimeout(() => App.connect(), 100);
      }
    });
  }
})();

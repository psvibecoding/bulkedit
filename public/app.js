/* ═══════════════════════════════════════════════════════
   BulkEdit — app.js
   Compatible with server.js proxy API:
     POST /api/test
     POST /api/products
     POST /api/save-product
═══════════════════════════════════════════════════════ */

const App = (() => {

  /* ─── STATE ──────────────────────────────────────── */
  let session   = { shop: '', token: '', demo: false };
  let products  = [];
  let changes   = {};         // { productId: { productId, product:{}, variants:{}, metafields:[] } }
  let schedules = [];
  let timers    = new Map();

  /* Undo/redo stacks — each entry is a deep-clone snapshot */
  let past   = [];
  let future = [];
  const MAX_HISTORY = 80;

  /* UI state */
  let activeFilter   = 'all';
  let searchQuery    = '';
  let selectedRows   = new Set();   // variant ids
  let schedModalCtx  = null;        // null | 'bulk' | 'new' | { productId, variantId }
  let exportFields   = ['title','status','vendor','tags','sku','price','compareAtPrice'];

  /* ─── DEMO DATA ──────────────────────────────────── */
  const DEMO = [
    { id:'gid://shopify/Product/1', title:'Click Bottle Rose Cobalt', status:'ACTIVE', vendor:'air up', tags:['hydration','new-arrivals'],
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/11', title:'600ml', sku:'CLICK-ROSE-600', price:'29.99', compareAtPrice:'', inventoryQuantity:120,
          metafields:{nodes:[{namespace:'custom',key:'material',type:'single_line_text_field',value:'Tritan'}]}},
        {id:'gid://shopify/ProductVariant/12', title:'850ml', sku:'CLICK-ROSE-850', price:'34.99', compareAtPrice:'39.99', inventoryQuantity:34,
          metafields:{nodes:[]}}
      ]}},
    { id:'gid://shopify/Product/2', title:'Twist Pro Stormy Blue', status:'DRAFT', vendor:'air up', tags:['twist','pro','sale'],
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/21', title:'850ml', sku:'TWIST-STORMY-850', price:'34.99', compareAtPrice:'39.99', inventoryQuantity:45,
          metafields:{nodes:[{namespace:'custom',key:'campaign_label',type:'single_line_text_field',value:'Summer24'}]}}
      ]}},
    { id:'gid://shopify/Product/3', title:'Kids Shrimp Pink', status:'ACTIVE', vendor:'air up', tags:['kids','gift'],
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/31', title:'480ml', sku:'KIDS-SHRIMP-480', price:'24.99', compareAtPrice:'29.99', inventoryQuantity:0,
          metafields:{nodes:[]}}
      ]}},
    { id:'gid://shopify/Product/4', title:'Iced Ocean Starter Set', status:'ARCHIVED', vendor:'air up', tags:['bundle','summer','sale'],
      variants:{nodes:[
        {id:'gid://shopify/ProductVariant/41', title:'Default', sku:'ICE-OCEAN-SET', price:'59.99', compareAtPrice:'79.99', inventoryQuantity:12,
          metafields:{nodes:[{namespace:'seo',key:'custom_title',type:'single_line_text_field',value:''}]}}
      ]}},
  ];

  /* ─── HELPERS ────────────────────────────────────── */
  const $  = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const escAttr = s => String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
  const cloneState = () => JSON.parse(JSON.stringify({ products, changes }));
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const fmt = iso => new Date(iso).toLocaleString();

  function normalizeProduct(p) {
    return {
      ...p,
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

  /* ─── TOAST ──────────────────────────────────────── */
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ─── STATUS BAR ─────────────────────────────────── */
  function setStatus(msg, cls = '') {
    const el = $('status-msg');
    el.textContent = msg;
    el.className = 'status-msg' + (cls ? ' ' + cls : '');
  }

  /* ─── SCREENS ────────────────────────────────────── */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
  }

  /* ─── API ────────────────────────────────────────── */
  function apiHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Shop': session.shop,
      'X-Shopify-Token': session.token
    };
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
      $('shopName').textContent = test.shop.name + ' · ' + test.shop.myshopifyDomain;
      await loadProducts();
      showScreen('workspace');
      toast('Connected. Token is session-only and never stored.');
    } catch (e) {
      toast(e.message);
      setStatus('Connection failed', 'dirty');
    } finally {
      $('connectBtn').disabled = false;
    }
  }

  function loadDemo() {
    session = { shop: 'demo.myshopify.com', token: 'demo_session_only', demo: true };
    products = DEMO.map(normalizeProduct);
    $('shopName').textContent = 'Demo store';
    showScreen('workspace');
    render();
    toast('Demo loaded. Changes won\'t be sent to Shopify.');
    setStatus('Demo mode — no real API calls');
  }

  async function loadProducts(query = '') {
    if (session.demo) { products = DEMO.map(normalizeProduct); render(); return; }
    setStatus('Loading…');
    try {
      const res = await apiPost('/api/products', { query, first: 50 });
      products = res.products.map(normalizeProduct);
      render();
      setStatus(`${products.length} products loaded`);
    } catch (e) {
      toast(e.message);
      setStatus('Load failed', 'dirty');
    }
  }

  function disconnect() {
    session = { shop: '', token: '', demo: false };
    products = []; changes = {}; schedules = [];
    past = []; future = []; selectedRows.clear();
    timers.forEach(t => clearTimeout(t)); timers.clear();
    $('inp-token').value = '';
    showScreen('connect');
    updateUndoUI(); updateSaveButton();
    toast('Disconnected. Session cleared.');
  }

  /* ─── UNDO / REDO ────────────────────────────────── */
  function pushHistory(label) {
    past.push({ label, state: cloneState() });
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
    updateUndoUI();
  }
  function undo() {
    if (!past.length) return;
    future.push({ label: 'redo', state: cloneState() });
    const h = past.pop();
    applyState(h.state);
    render(); updateUndoUI(); updateSaveButton();
    toast('Undone: ' + h.label);
  }
  function redo() {
    if (!future.length) return;
    past.push({ label: 'undo', state: cloneState() });
    const f = future.pop();
    applyState(f.state);
    render(); updateUndoUI(); updateSaveButton();
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
      $('undo-bar-msg').textContent =
        `History: ${past.length} action${past.length !== 1 ? 's' : ''}` +
        (future.length ? ` · ${future.length} redo` : '');
    } else {
      bar.classList.remove('visible');
    }
  }

  /* Keyboard shortcuts */
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
  });

  /* ─── FILTER & SEARCH ────────────────────────────── */
  function flatRows() {
    return products.flatMap(p => p.variants.nodes.map(v => ({ p, v })));
  }

  function getFiltered() {
    const q = searchQuery.toLowerCase();
    return flatRows().filter(({ p, v }) => {
      const matchSearch = !q ||
        [p.title, p.vendor, (p.tags || []).join(' '), v.title, v.sku].join(' ').toLowerCase().includes(q);

      const hasSched = schedules.some(s => s.variantId === v.id && s.state === 'queued');
      const isChanged = !!changes[p.id];

      const matchFilter =
        activeFilter === 'all'       ? true :
        activeFilter === 'changed'   ? isChanged :
        activeFilter === 'scheduled' ? hasSched :
        p.status === activeFilter;

      return matchSearch && matchFilter;
    });
  }

  /* ─── RENDER ─────────────────────────────────────── */
  function render() {
    const rows = getFiltered();
    const tbody = $('rows');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--t3)">No products match.</td></tr>';
    } else {
      tbody.innerHTML = rows.map(({ p, v }) => rowHTML(p, v)).join('');
    }

    renderScheduleTab();
    renderAudit();
    updateSaveButton();
    buildSuggestions();
    updateBulkBar();
    updateExportPreview();
  }

  function rowHTML(p, v) {
    const isChanged  = !!changes[p.id];
    const hasSched   = schedules.some(s => s.variantId === v.id && s.state === 'queued');
    const isSelected = selectedRows.has(v.id);

    const rowClass = [
      isChanged  ? 'row-changed'  : '',
      hasSched   ? 'row-scheduled': '',
      isSelected ? 'row-selected' : ''
    ].filter(Boolean).join(' ');

    const statusBadge = `<div class="status-badge ${esc(p.status)}" onclick="App.cycleStatus('${esc(p.id)}')" title="Click to cycle status">${statusLabel(p.status)}</div>`;

    const tagsHTML = (p.tags || [])
      .map(t => `<span class="tag-chip">${esc(t)}<span class="tag-del" onclick="App.removeTag('${esc(p.id)}','${escAttr(t)}')">×</span></span>`)
      .join('') + `<span class="tag-add" onclick="App.addTag('${esc(p.id)}')">+</span>`;

    const metaHTML = v.metafields.nodes
      .map((m, i) => metaRowHTML(v.id, m, i))
      .join('') +
      `<button class="meta-add-btn" onclick="App.addMetafield('${esc(v.id)}')">+ metafield</button>`;

    const schedSched = schedules.find(s => s.variantId === v.id && s.state === 'queued');
    const schedCell  = schedSched
      ? `<div class="sched-pill" onclick="App.switchTab('schedule')" title="${esc(schedSched.name)}">${esc(schedSched.name)}</div>`
      : `<button class="sched-add-btn" onclick="App.openScheduleModal({productId:'${esc(p.id)}',variantId:'${esc(v.id)}'})">+ schedule</button>`;

    return `<tr class="${rowClass}" data-product="${esc(p.id)}" data-variant="${esc(v.id)}">
  <td><input type="checkbox" class="row-check" data-variant="${esc(v.id)}" ${isSelected?'checked':''} onchange="App.toggleRow('${esc(v.id)}',this.checked)" /></td>
  <td><input class="ce${isChanged?' changed':''}" value="${esc(p.title)}" oninput="App.markProduct('${esc(p.id)}','title',this.value,this)" /></td>
  <td>${statusBadge}</td>
  <td><input class="ce" value="${esc(p.vendor||'')}" oninput="App.markProduct('${esc(p.id)}','vendor',this.value,this)" /></td>
  <td><div class="tags-cell" id="tags-${esc(p.id)}">${tagsHTML}</div></td>
  <td style="color:var(--t2);font-size:12px">${esc(v.title || 'Default')}</td>
  <td><input class="ce" value="${esc(v.sku||'')}" oninput="App.markVariant('${esc(v.id)}','sku',this.value,this)" /></td>
  <td><input class="ce num" type="number" step="0.01" min="0" value="${esc(v.price||'')}" oninput="App.markVariant('${esc(v.id)}','price',this.value,this)" /></td>
  <td><input class="ce num" type="number" step="0.01" min="0" value="${esc(v.compareAtPrice||'')}" oninput="App.markVariant('${esc(v.id)}','compareAtPrice',this.value,this)" /></td>
  <td><div class="meta-cell" id="meta-${esc(v.id)}">${metaHTML}</div></td>
  <td>${schedCell}</td>
</tr>`;
  }

  function metaRowHTML(variantId, m, i) {
    return `<div class="meta-row" data-mf-idx="${i}">
  <input class="meta-input" placeholder="namespace" value="${esc(m.namespace||'custom')}" oninput="App.markMetafield('${esc(variantId)}',${i},'namespace',this.value,this)" />
  <input class="meta-input" placeholder="key" value="${esc(m.key||'')}" oninput="App.markMetafield('${esc(variantId)}',${i},'key',this.value,this)" />
  <input class="meta-input" placeholder="value" value="${esc(m.value||'')}" oninput="App.markMetafield('${esc(variantId)}',${i},'value',this.value,this)" />
  <button class="meta-del" onclick="App.removeMetafield('${esc(variantId)}',${i})" title="Remove">×</button>
</div>`;
  }

  function statusLabel(s) {
    return { ACTIVE: '● Active', DRAFT: '○ Draft', ARCHIVED: '⊘ Archived' }[s] || s;
  }

  /* ─── MARK CHANGES ───────────────────────────────── */
  function markProduct(productId, field, value, el) {
    pushHistory(`Edit ${field} on "${getProduct(productId)?.title || productId}"`);
    const p = getProduct(productId); if (!p) return;
    p[field] = field === 'tags'
      ? value.split(',').map(x => x.trim()).filter(Boolean)
      : value;
    ensureChange(productId).product[field] = p[field];
    if (el) el.classList.add('changed');
    updateSaveButton(); renderAudit();
  }

  function markVariant(variantId, field, value, el) {
    const { p, v } = getVariantById(variantId); if (!p || !v) return;
    pushHistory(`Edit ${field} on variant "${v.title || 'Default'}"`);
    v[field] = value;
    const c = ensureChange(p.id);
    if (!c.variants[variantId]) c.variants[variantId] = { id: variantId };
    c.variants[variantId][field] = value;
    if (el) el.classList.add('changed');
    updateSaveButton(); renderAudit();
  }

  function markMetafield(variantId, index, field, value, el) {
    const { p, v } = getVariantById(variantId); if (!p || !v) return;
    pushHistory(`Edit metafield on "${v.title || 'Default'}"`);
    v.metafields.nodes[index][field] = value;
    const m = v.metafields.nodes[index];
    const c = ensureChange(p.id);
    // Replace or push
    c.metafields = c.metafields.filter(x => !(x.ownerId === variantId && x._idx === index));
    if (m.namespace && m.key) {
      c.metafields.push({
        ownerId:   variantId,
        namespace: m.namespace,
        key:       m.key,
        type:      m.type || 'single_line_text_field',
        value:     String(m.value ?? ''),
        _idx:      index
      });
    }
    if (el) el.classList.add('changed');
    updateSaveButton(); renderAudit();
  }

  function cycleStatus(productId) {
    const p = getProduct(productId); if (!p) return;
    pushHistory(`Cycle status on "${p.title}"`);
    const cycle = { ACTIVE: 'DRAFT', DRAFT: 'ARCHIVED', ARCHIVED: 'ACTIVE' };
    p.status = cycle[p.status] || 'ACTIVE';
    ensureChange(productId).product.status = p.status;
    render(); updateSaveButton();
  }

  function removeTag(productId, tag) {
    const p = getProduct(productId); if (!p) return;
    pushHistory(`Remove tag "${tag}" from "${p.title}"`);
    p.tags = (p.tags || []).filter(t => t !== tag);
    ensureChange(productId).product.tags = [...p.tags];
    // Re-render just the tags cell
    const cell = $(`tags-${productId}`);
    if (cell) {
      cell.innerHTML = p.tags
        .map(t => `<span class="tag-chip">${esc(t)}<span class="tag-del" onclick="App.removeTag('${esc(productId)}','${escAttr(t)}')">×</span></span>`)
        .join('') + `<span class="tag-add" onclick="App.addTag('${esc(productId)}')">+</span>`;
    }
    updateSaveButton(); renderAudit();
  }

  function addTag(productId) {
    const tag = prompt('New tag:'); if (!tag?.trim()) return;
    const p = getProduct(productId); if (!p) return;
    if (p.tags.includes(tag.trim())) return toast('Tag already exists.');
    pushHistory(`Add tag "${tag.trim()}" to "${p.title}"`);
    p.tags.push(tag.trim());
    ensureChange(productId).product.tags = [...p.tags];
    const cell = $(`tags-${productId}`);
    if (cell) {
      cell.innerHTML = p.tags
        .map(t => `<span class="tag-chip">${esc(t)}<span class="tag-del" onclick="App.removeTag('${esc(productId)}','${escAttr(t)}')">×</span></span>`)
        .join('') + `<span class="tag-add" onclick="App.addTag('${esc(productId)}')">+</span>`;
    }
    updateSaveButton(); renderAudit();
  }

  function addMetafield(variantId) {
    const { v } = getVariantById(variantId); if (!v) return;
    pushHistory(`Add metafield to variant`);
    v.metafields.nodes.push({ namespace: 'custom', key: '', type: 'single_line_text_field', value: '' });
    const cell = $(`meta-${variantId}`);
    if (cell) cell.innerHTML = v.metafields.nodes.map((m, i) => metaRowHTML(variantId, m, i)).join('') +
      `<button class="meta-add-btn" onclick="App.addMetafield('${esc(variantId)}')">+ metafield</button>`;
  }

  function removeMetafield(variantId, index) {
    const { p, v } = getVariantById(variantId); if (!p || !v) return;
    pushHistory(`Remove metafield from variant`);
    v.metafields.nodes.splice(index, 1);
    const c = ensureChange(p.id);
    c.metafields = c.metafields.filter(x => !(x.ownerId === variantId && x._idx === index));
    const cell = $(`meta-${variantId}`);
    if (cell) cell.innerHTML = v.metafields.nodes.map((m, i) => metaRowHTML(variantId, m, i)).join('') +
      `<button class="meta-add-btn" onclick="App.addMetafield('${esc(variantId)}')">+ metafield</button>`;
    updateSaveButton();
  }

  /* ─── BULK ACTIONS ───────────────────────────────── */
  function toggleRow(variantId, checked) {
    checked ? selectedRows.add(variantId) : selectedRows.delete(variantId);
    updateBulkBar();
    // keep row style
    const row = document.querySelector(`tr[data-variant="${variantId}"]`);
    if (row) row.classList.toggle('row-selected', checked);
  }

  function toggleAllRows(checked) {
    document.querySelectorAll('.row-check').forEach(cb => {
      cb.checked = checked;
      toggleRow(cb.dataset.variant, checked);
    });
  }

  function updateBulkBar() {
    const n = selectedRows.size;
    const bar = $('bulk-actions');
    bar.classList.toggle('visible', n > 0);
    $('bulk-label').textContent = `${n} selected`;
  }

  function getSelectedProductIds() {
    const ids = new Set();
    for (const variantId of selectedRows) {
      const { p } = getVariantById(variantId);
      if (p) ids.add(p.id);
    }
    return [...ids];
  }

  function bulkStatus(status) {
    const pids = getSelectedProductIds(); if (!pids.length) return;
    pushHistory(`Bulk set status → ${status} (${pids.length} products)`);
    pids.forEach(id => {
      const p = getProduct(id); if (!p) return;
      p.status = status;
      ensureChange(id).product.status = status;
    });
    render(); updateSaveButton();
    toast(`Status set to ${status} on ${pids.length} product${pids.length !== 1 ? 's' : ''}.`);
  }

  function bulkAddTag() {
    const tag = prompt('Tag to add to all selected products:'); if (!tag?.trim()) return;
    const pids = getSelectedProductIds(); if (!pids.length) return;
    pushHistory(`Bulk add tag "${tag.trim()}" (${pids.length} products)`);
    pids.forEach(id => {
      const p = getProduct(id); if (!p) return;
      if (!p.tags.includes(tag.trim())) p.tags.push(tag.trim());
      ensureChange(id).product.tags = [...p.tags];
    });
    render(); updateSaveButton();
    toast(`Tag "${tag.trim()}" added to ${pids.length} product${pids.length !== 1 ? 's' : ''}.`);
  }

  function bulkRemoveTag() {
    const tag = prompt('Tag to remove from all selected products:'); if (!tag?.trim()) return;
    const pids = getSelectedProductIds(); if (!pids.length) return;
    pushHistory(`Bulk remove tag "${tag.trim()}" (${pids.length} products)`);
    pids.forEach(id => {
      const p = getProduct(id); if (!p) return;
      p.tags = p.tags.filter(t => t !== tag.trim());
      ensureChange(id).product.tags = [...p.tags];
    });
    render(); updateSaveButton();
    toast(`Tag "${tag.trim()}" removed from ${pids.length} product${pids.length !== 1 ? 's' : ''}.`);
  }

  /* ─── SAVE ───────────────────────────────────────── */
  function updateSaveButton() {
    const n = Object.keys(changes).length;
    $('changeCount').textContent = n;
    $('saveBtn').disabled = !n;
    if (n) setStatus(`${n} unsaved change${n !== 1 ? 's' : ''}`, 'dirty');
    else setStatus('All changes saved', 'ok');
  }

  function renderAudit() {
    const list = Object.values(changes).map(c => ({
      product: c.productId,
      title:   getProduct(c.productId)?.title,
      fields:  c.product,
      variants: Object.values(c.variants || {}),
      metafields: (c.metafields || []).map(m => ({ namespace: m.namespace, key: m.key, value: m.value }))
    }));
    $('audit').textContent = list.length ? JSON.stringify(list, null, 2) : 'No pending changes.';
  }

  async function saveChanges(overridePayloads = null) {
    const payloads = overridePayloads || Object.values(changes);
    if (!payloads.length) return toast('No changes to save.');
    $('saveBtn').disabled = true;
    setStatus('Saving…', 'saving');

    try {
      if (session.demo) {
        await delay(500);
      } else {
        for (const c of payloads) {
          // Strip internal _idx from metafields before sending
          const mf = (c.metafields || []).map(({ _idx, ...rest }) => rest);
          await apiPost('/api/save-product', {
            productId:  c.productId,
            product:    c.product,
            variants:   Object.values(c.variants || {}),
            metafields: mf
          });
        }
      }
      if (!overridePayloads) { changes = {}; past = []; future = []; }
      document.querySelectorAll('.changed').forEach(el => el.classList.remove('changed'));
      render();
      toast('Changes saved.');
      setStatus('All changes saved', 'ok');
    } catch (e) {
      toast(e.message);
      setStatus('Save failed', 'dirty');
    } finally {
      updateSaveButton();
      updateUndoUI();
    }
  }

  function clearChanges() {
    if (!Object.keys(changes).length) return toast('No changes to clear.');
    if (!confirm('Clear all unsaved changes?')) return;
    pushHistory('Clear all changes');
    changes = {};
    document.querySelectorAll('.changed').forEach(el => el.classList.remove('changed'));
    render(); updateSaveButton();
    toast('All changes cleared.');
  }

  /* ─── SEARCH / AUTOCOMPLETE ──────────────────────── */
  function buildSuggestions() {
    const q = searchQuery;
    const box = $('suggestions');
    if (!q) { box.classList.remove('open'); return; }
    const vals = [...new Set(
      flatRows().flatMap(({ p, v }) => [p.title, p.vendor, v.sku, ...(p.tags || [])])
        .filter(Boolean)
    )].filter(x => x.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

    if (!vals.length) { box.classList.remove('open'); return; }
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    box.innerHTML = vals.map(v =>
      `<div class="sug-item" onmousedown="App.useSuggestion('${escAttr(v)}')">
        <span>${esc(v).replace(re, '<mark>$1</mark>')}</span>
        <span class="sug-meta">${getVariantById(v)?.p?.vendor || ''}</span>
      </div>`
    ).join('');
    box.classList.add('open');
  }

  function useSuggestion(v) {
    $('search').value = v;
    searchQuery = v.toLowerCase();
    $('suggestions').classList.remove('open');
    render();
  }

  /* ─── FILTER ─────────────────────────────────────── */
  function setFilter(f) {
    activeFilter = f;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
    render();
  }

  /* ─── TABS ───────────────────────────────────────── */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'audit') renderAudit();
    if (name === 'export') updateExportPreview();
  }

  /* ─── SCHEDULE ───────────────────────────────────── */
  function openScheduleModal(ctx) {
    schedModalCtx = ctx;
    const overlay = $('modal-schedule');
    overlay.classList.add('open');

    // defaults
    const tom = new Date(); tom.setDate(tom.getDate() + 1);
    $('sched-date').value = tom.toISOString().split('T')[0];
    $('sched-time').value = '09:00';
    $('sched-revert').checked = false;
    $('sched-revert-fields').classList.add('hidden');
    $('sched-name').value = '';

    // populate product list
    let targetRows;
    if (ctx === 'bulk' || ctx === 'new') {
      targetRows = ctx === 'bulk'
        ? flatRows().filter(({ v }) => selectedRows.has(v.id))
        : flatRows().slice(0, 20);
    } else if (ctx?.variantId) {
      targetRows = flatRows().filter(({ v }) => v.id === ctx.variantId);
    } else {
      targetRows = flatRows().slice(0, 20);
    }

    const sub = ctx === 'bulk'
      ? `${targetRows.length} selected variants`
      : ctx?.variantId
        ? `${targetRows[0]?.p.title || ''} — ${targetRows[0]?.v.title || 'Default'}`
        : `${targetRows.length} products`;
    $('modal-sched-sub').textContent = sub;

    const list = $('sched-prod-list');
    list.innerHTML = targetRows.map(({ p, v }) =>
      `<div class="sched-prod-item" data-vid="${esc(v.id)}" data-pid="${esc(p.id)}">
        <span class="spi-name">${esc(p.title)} — ${esc(v.title || 'Default')}</span>
        <div class="spi-price" id="sprice-${esc(v.id)}"></div>
      </div>`
    ).join('');

    $('sched-prod-count').textContent = `(${targetRows.length})`;
    renderSchedTypeFields();
  }

  function closeScheduleModal() {
    $('modal-schedule').classList.remove('open');
    schedModalCtx = null;
  }

  function toggleRevert() {
    $('sched-revert-fields').classList.toggle('hidden', !$('sched-revert').checked);
    if ($('sched-revert').checked) {
      const d = new Date($('sched-date').value || new Date());
      $('sched-revert-date').value = d.toISOString().split('T')[0];
      $('sched-revert-time').value = '23:59';
    }
  }

  function renderSchedTypeFields() {
    const type = $('sched-type').value;
    const wrap = $('sched-type-fields');
    const prodItems = document.querySelectorAll('#sched-prod-list .sched-prod-item');

    if (type === 'price') {
      wrap.innerHTML = `
        <div class="modal-field">
          <label>Default new price <span class="label-hint">(you can override per-product below)</span></label>
          <input id="sched-default-price" type="number" step="0.01" min="0" placeholder="0.00"
            oninput="App.applyDefaultSchedPrice(this.value)" />
        </div>`;
      // Add price input per product
      prodItems.forEach(item => {
        const vid = item.dataset.vid;
        const { v } = getVariantById(vid);
        const priceEl = item.querySelector('.spi-price');
        if (priceEl) priceEl.innerHTML = `
          <span style="font-size:10px;color:var(--t3);margin-right:4px">€</span>
          <input id="spriceinp-${esc(vid)}" type="number" step="0.01" min="0" placeholder="${esc(v?.price||'')}" />`;
      });
    } else if (type === 'status') {
      wrap.innerHTML = `
        <div class="modal-field">
          <label>New status</label>
          <select id="sched-status-val">
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>`;
      prodItems.forEach(item => { const el = item.querySelector('.spi-price'); if (el) el.innerHTML = ''; });
    } else {
      wrap.innerHTML = `
        <div class="modal-field">
          <label>${type === 'tags_add' ? 'Tags to add' : 'Tags to remove'} <span class="label-hint">(comma-separated)</span></label>
          <input id="sched-tags-val" type="text" placeholder="sale, promo, new-arrivals" />
        </div>`;
      prodItems.forEach(item => { const el = item.querySelector('.spi-price'); if (el) el.innerHTML = ''; });
    }
  }

  function applyDefaultSchedPrice(v) {
    if (!v) return;
    document.querySelectorAll('[id^="spriceinp-"]').forEach(inp => {
      if (!inp.value) inp.placeholder = v;
    });
  }

  function confirmSchedule() {
    const name = $('sched-name').value.trim() || 'Scheduled task';
    const date = $('sched-date').value;
    const time = $('sched-time').value || '09:00';
    const type = $('sched-type').value;
    if (!date) return toast('Please set a date.');

    const runAt = new Date(`${date}T${time}`);
    if (isNaN(runAt.getTime()) || runAt < new Date()) return toast('Date must be in the future.');

    // Collect targets
    const items = [...document.querySelectorAll('#sched-prod-list .sched-prod-item')];
    const targets = items.map(item => ({
      productId: item.dataset.pid,
      variantId: item.dataset.vid,
      overridePrice: document.getElementById(`spriceinp-${item.dataset.vid}`)?.value || null
    }));

    const revert = $('sched-revert').checked;
    const revertAt = revert ? new Date(`${$('sched-revert-date').value}T${$('sched-revert-time').value}`) : null;

    // Build value
    let value = null;
    if (type === 'price')      value = $('sched-default-price')?.value || null;
    if (type === 'status')     value = $('sched-status-val')?.value || 'ACTIVE';
    if (type === 'tags_add' || type === 'tags_remove') value = $('sched-tags-val')?.value || '';

    // One schedule entry per target variant
    targets.forEach(({ productId, variantId, overridePrice }) => {
      const { p, v } = getVariantById(variantId); if (!p || !v) return;
      const action = {
        id: crypto.randomUUID(),
        name,
        productId, variantId,
        productTitle: p.title,
        variantTitle: v.title || 'Default',
        runAt:  runAt.toISOString(),
        revertAt: revert && revertAt && !isNaN(revertAt.getTime()) ? revertAt.toISOString() : null,
        type,
        value: type === 'price' ? (overridePrice || value) : value,
        original: { price: v.price, status: p.status, tags: [...(p.tags||[])] },
        state: 'queued'
      };
      schedules.push(action);
      armTimer(action);
    });

    updateSchedBadge();
    closeScheduleModal();
    render();
    toast(`"${name}" scheduled for ${date} ${time}.`);
  }

  function armTimer(s) {
    if (timers.has(s.id)) clearTimeout(timers.get(s.id));
    const ms = new Date(s.runAt) - new Date(); if (ms < 0) return;
    timers.set(s.id, setTimeout(() => runSchedule(s.id, false), ms));
  }

  async function runSchedule(id, isRevert) {
    const s = schedules.find(x => x.id === id); if (!s) return;
    const { p, v } = getVariantById(s.variantId); if (!p || !v) return;

    const productPayload  = {};
    const variantPayload  = {};
    const metaPayload     = [];

    if (isRevert) {
      if (s.original.status) productPayload.status = s.original.status;
      if (s.original.price)  variantPayload[s.variantId] = { id: s.variantId, price: s.original.price };
      s.state = 'reverted';
    } else {
      if (s.type === 'price' && s.value)     variantPayload[s.variantId] = { id: s.variantId, price: s.value };
      if (s.type === 'status' && s.value)    productPayload.status = s.value;
      if (s.type === 'tags_add' && s.value) {
        const tags = s.value.split(',').map(t => t.trim()).filter(Boolean);
        tags.forEach(t => { if (!p.tags.includes(t)) p.tags.push(t); });
        productPayload.tags = [...p.tags];
      }
      if (s.type === 'tags_remove' && s.value) {
        const remove = s.value.split(',').map(t => t.trim());
        p.tags = p.tags.filter(t => !remove.includes(t));
        productPayload.tags = [...p.tags];
      }
      s.state = 'running';
    }

    await saveChanges([{
      productId:  s.productId,
      product:    productPayload,
      variants:   variantPayload,
      metafields: metaPayload
    }]);

    if (!isRevert && s.revertAt) {
      const ms = new Date(s.revertAt) - new Date();
      if (ms > 0) setTimeout(() => runSchedule(id, true), ms);
    } else if (!isRevert) {
      s.state = 'done';
    }

    renderScheduleTab();
    render();
  }

  function cancelSchedule(id) {
    if (timers.has(id)) clearTimeout(timers.get(id));
    schedules = schedules.filter(s => s.id !== id);
    updateSchedBadge();
    renderScheduleTab();
    render();
    toast('Scheduled task cancelled.');
  }

  function updateSchedBadge() {
    const n = schedules.filter(s => s.state === 'queued').length;
    $('tab-sched-count').textContent = n;
    $('tab-sched-count').style.display = n ? '' : 'none';
  }

  function renderScheduleTab() {
    updateSchedBadge();
    const el = $('scheduleList');
    if (!schedules.length) {
      el.className = 'sched-list empty';
      el.textContent = 'No scheduled actions yet.';
      return;
    }
    el.className = 'sched-list';
    const sorted = [...schedules].sort((a, b) => new Date(b.runAt) - new Date(a.runAt));
    el.innerHTML = sorted.map(s => {
      const isPast = new Date(s.runAt) < new Date();
      const typeLabel = { price: 'Price change', status: 'Status change', tags_add: 'Add tags', tags_remove: 'Remove tags' }[s.type] || s.type;
      return `<div class="sched-item">
  <div class="sched-item-top">
    <div>
      <div class="sched-item-name">${esc(s.name)}</div>
      <div class="sched-item-meta">
        <span>${typeLabel}</span>
        ${s.value ? `<span>· ${esc(String(s.value))}</span>` : ''}
        <span>· ${esc(s.state)}</span>
        ${s.revertAt ? `<span class="revert-tag">↺ auto-revert ${new Date(s.revertAt).toLocaleDateString()}</span>` : ''}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <span class="sched-item-time${isPast||s.state!=='queued'?' done':''}">${fmt(s.runAt)}</span>
      <button class="btn-ghost xs danger" onclick="App.cancelSchedule('${s.id}')">Cancel</button>
    </div>
  </div>
  <div class="sched-item-prods">
    <span class="sched-prod-tag">${esc(s.productTitle)} — ${esc(s.variantTitle)}</span>
  </div>
</div>`;
    }).join('');
  }

  function exportScheduleJSON() {
    const blob = new Blob([JSON.stringify(schedules, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `bulkedit-schedule-${Date.now()}.json`; a.click();
    toast('Schedule exported.');
  }

  function importScheduleFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const imported = JSON.parse(r.result);
        if (!Array.isArray(imported)) throw new Error('Not an array');
        schedules = imported;
        schedules.forEach(s => { if (s.state === 'queued') armTimer(s); });
        renderScheduleTab();
        toast(`${imported.length} schedule${imported.length !== 1 ? 's' : ''} imported.`);
      } catch { toast('Invalid schedule JSON.'); }
    };
    r.readAsText(file);
  }

  /* ─── EXPORT ─────────────────────────────────────── */
  const EXPORT_ALL    = ['title','status','vendor','tags','variant','sku','price','compareAtPrice','inventoryQuantity'];
  const EXPORT_LABELS = { title:'Title', status:'Status', vendor:'Vendor', tags:'Tags', variant:'Variant', sku:'SKU', price:'Price', compareAtPrice:'Compare at', inventoryQuantity:'Inventory' };

  function initExportFields() {
    const el = $('export-fields');
    el.innerHTML = EXPORT_ALL.map(f =>
      `<label class="export-field${exportFields.includes(f)?' on':''}">
        <input type="checkbox" ${exportFields.includes(f)?'checked':''} value="${f}"
          onchange="App.toggleExportField('${f}',this.checked,this.closest('.export-field'))" />
        ${EXPORT_LABELS[f]||f}
      </label>`
    ).join('');
  }

  function toggleExportField(f, checked, el) {
    if (checked) { if (!exportFields.includes(f)) exportFields.push(f); }
    else exportFields = exportFields.filter(x => x !== f);
    el.classList.toggle('on', checked);
    updateExportPreview();
  }

  function getExportValue(p, v, f) {
    if (f === 'tags')             return (p.tags || []).join('|');
    if (f === 'variant')          return v.title || 'Default';
    if (f === 'sku')              return v.sku || '';
    if (f === 'price')            return v.price || '';
    if (f === 'compareAtPrice')   return v.compareAtPrice || '';
    if (f === 'inventoryQuantity')return String(v.inventoryQuantity ?? '');
    return String(p[f] ?? '');
  }

  function buildCSV() {
    const rows = flatRows();
    const header = exportFields.join(',');
    const lines = rows.map(({ p, v }) =>
      exportFields.map(f => {
        const val = getExportValue(p, v, f);
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g,'""')}"` : val;
      }).join(',')
    );
    return [header, ...lines].join('\n');
  }

  function buildJSON() {
    return JSON.stringify(
      flatRows().map(({ p, v }) => {
        const obj = {};
        exportFields.forEach(f => obj[f] = getExportValue(p, v, f));
        return obj;
      }), null, 2
    );
  }

  function updateExportPreview() {
    const rows = flatRows().slice(0, 3);
    const header = exportFields.join(',');
    const lines = rows.map(({ p, v }) =>
      exportFields.map(f => {
        const val = getExportValue(p, v, f);
        return val.includes(',') ? `"${val}"` : val;
      }).join(',')
    );
    const pre = $('export-preview');
    if (pre) pre.textContent = [header, ...lines].join('\n') +
      (flatRows().length > 3 ? `\n… (${flatRows().length} total rows)` : '');
  }

  function doExport(fmt) {
    const data = fmt === 'csv' ? buildCSV() : buildJSON();
    const mime = fmt === 'csv' ? 'text/csv' : 'application/json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: mime }));
    a.download = `shopify-products-${Date.now()}.${fmt}`;
    a.click();
    toast(`${fmt.toUpperCase()} downloaded.`);
  }

  function copyExport() {
    navigator.clipboard?.writeText(buildCSV())
      .then(() => toast('CSV copied to clipboard.'))
      .catch(() => toast('Clipboard not available.'));
  }

  /* ─── BOOT ───────────────────────────────────────── */
  function boot() {
    /* Connect buttons */
    $('connectBtn').onclick = connect;
    $('demoBtn').onclick    = loadDemo;
    $('disconnectBtn').onclick = disconnect;
    $('saveBtn').onclick    = () => saveChanges();

    /* Undo/redo buttons */
    $('btn-undo').onclick = undo;
    $('btn-redo').onclick = redo;

    /* Checkbox all */
    $('chk-all').onchange = e => toggleAllRows(e.target.checked);

    /* Search */
    $('search').oninput = e => {
      searchQuery = e.target.value.trim();
      render();
      if (!session.demo && searchQuery.length > 2) {
        clearTimeout(window._searchTimer);
        window._searchTimer = setTimeout(() => loadProducts(searchQuery), 350);
      }
    };
    $('search').onfocus = () => { if (searchQuery) buildSuggestions(); };
    document.addEventListener('click', e => {
      if (!e.target.closest('.search-wrap')) $('suggestions').classList.remove('open');
    });

    /* Filter chips */
    document.querySelectorAll('.filter-chip').forEach(btn => {
      btn.onclick = () => setFilter(btn.dataset.filter);
    });

    /* Tabs */
    document.querySelectorAll('.tab').forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });

    /* Schedule import/export */
    $('exportSchedule').onclick    = exportScheduleJSON;
    $('importScheduleBtn').onclick = () => $('importSchedule').click();
    $('importSchedule').onchange   = e => e.target.files[0] && importScheduleFile(e.target.files[0]);

    /* Export fields init */
    initExportFields();

    /* Modal keyboard close */
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeScheduleModal(); });
  }

  /* ─── PUBLIC API ─────────────────────────────────── */
  return {
    /* connect */
    connect, loadDemo, disconnect,
    /* editing */
    markProduct, markVariant, markMetafield,
    cycleStatus, removeTag, addTag,
    addMetafield, removeMetafield,
    /* bulk */
    toggleRow, toggleAllRows,
    bulkStatus, bulkAddTag, bulkRemoveTag,
    /* undo */
    undo, redo,
    /* save */
    saveChanges, clearChanges,
    /* search */
    useSuggestion,
    /* filter */
    setFilter,
    /* tabs */
    switchTab,
    /* schedule */
    openScheduleModal, closeScheduleModal,
    renderSchedTypeFields, toggleRevert,
    applyDefaultSchedPrice, confirmSchedule,
    cancelSchedule,
    /* export */
    toggleExportField, doExport, copyExport,
    /* boot */
    boot
  };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());

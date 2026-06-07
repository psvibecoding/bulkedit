/* ═══════════════════════════════════════════════
   BulkEdit — app.js v4
   Clean event delegation · No inline handlers
   OAuth · Bulk modal · Review & Save · Recap
═══════════════════════════════════════════════ */
'use strict';

/* ─── HELPERS ─────────────────────────────── */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
const delay = ms => new Promise(r => setTimeout(r, ms));
const fmt   = iso => new Date(iso).toLocaleString();
const clone = obj => JSON.parse(JSON.stringify(obj));

/* ─── STATE ───────────────────────────────── */
let S = {
  shop: '', token: '', demo: false,
  products: [],
  originals: [],   // snapshot at load time — used for diff
  changes: {},     // { productId: { productId, product:{}, variants:{}, metafields:[] } }
  schedules: [],
  timers: new Map(),
  past: [], future: [],
  filter: 'all',
  searchQ: '',
  selectedVids: new Set(),
  exportFields: ['title','status','vendor','tags','variant','sku','price','compareAtPrice'],
  bulkModalType: null,
  schedCtx: null,
};
const MAX_HIST = 80;

/* ─── DEMO DATA ───────────────────────────── */
const DEMO_PRODUCTS = [
  { id:'gid://shopify/Product/1', title:'Merino Wool Crew Neck Sweater', status:'ACTIVE', vendor:'NordWear', tags:['knitwear','winter','new-arrivals'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/11', title:'S', sku:'NW-MERINO-S', price:'89.00', compareAtPrice:'', inventoryQuantity:45, metafields:{ nodes:[{ namespace:'custom', key:'material', type:'single_line_text_field', value:'100% Merino Wool' }] } },
      { id:'gid://shopify/ProductVariant/12', title:'M', sku:'NW-MERINO-M', price:'89.00', compareAtPrice:'', inventoryQuantity:62, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/13', title:'L', sku:'NW-MERINO-L', price:'89.00', compareAtPrice:'', inventoryQuantity:28, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/2', title:'Leather Crossbody Bag — Tan', status:'ACTIVE', vendor:'StudioLeather', tags:['bags','accessories','sale'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/21', title:'Default', sku:'SL-CROSS-TAN', price:'149.00', compareAtPrice:'189.00', inventoryQuantity:18, metafields:{ nodes:[{ namespace:'custom', key:'campaign_label', type:'single_line_text_field', value:'Summer Sale' }] } },
    ]}},
  { id:'gid://shopify/Product/3', title:'Organic Cotton Oversized Tee', status:'ACTIVE', vendor:'EarthBasics', tags:['apparel','sustainable','basics'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/31', title:'XS / White', sku:'EB-TEE-XS-WHT', price:'34.00', compareAtPrice:'', inventoryQuantity:0,  metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/32', title:'S / White',  sku:'EB-TEE-S-WHT',  price:'34.00', compareAtPrice:'', inventoryQuantity:55, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/33', title:'M / Black',  sku:'EB-TEE-M-BLK',  price:'34.00', compareAtPrice:'', inventoryQuantity:40, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/4', title:'Ceramic Pour-Over Coffee Set', status:'DRAFT', vendor:'KitchenStudio', tags:['kitchen','coffee','gifts'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/41', title:'White',      sku:'KS-POUROVER-WHT', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:22, metafields:{ nodes:[{ namespace:'seo', key:'custom_title', type:'single_line_text_field', value:'' }] } },
      { id:'gid://shopify/ProductVariant/42', title:'Matte Black', sku:'KS-POUROVER-BLK', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:14, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/5', title:'Natural Rubber Yoga Mat 6mm', status:'ACTIVE', vendor:'MoveWell', tags:['fitness','yoga','eco'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/51', title:'Default', sku:'MW-YOGAMAT-6MM', price:'78.00', compareAtPrice:'', inventoryQuantity:33, metafields:{ nodes:[{ namespace:'custom', key:'thickness_mm', type:'number_integer', value:'6' }] } },
    ]}},
  { id:'gid://shopify/Product/6', title:'Linen Duvet Cover Set — King', status:'ARCHIVED', vendor:'HomeTextile', tags:['bedding','linen','home'],
    featuredImage: null,
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/61', title:'Sand', sku:'HT-DUVET-K-SND', price:'189.00', compareAtPrice:'229.00', inventoryQuantity:7, metafields:{ nodes:[] } },
    ]}},
];

/* ─── NORMALISE PRODUCT FROM API ─────────── */
function normProd(p) {
  return {
    ...p,
    featuredImage: p.featuredImage || null,
    variants: { nodes: (p.variants?.nodes || []).map(v => ({
      ...v, metafields: { nodes: v.metafields?.nodes || [] }
    }))}
  };
}

/* ─── LOOKUPS ─────────────────────────────── */
function getProd(id) { return S.products.find(p => p.id === id); }
function getVar(vid) {
  for (const p of S.products) {
    const v = p.variants.nodes.find(v => v.id === vid);
    if (v) return { p, v };
  }
  return {};
}
function ensureChange(pid) {
  if (!S.changes[pid]) S.changes[pid] = { productId:pid, product:{}, variants:{}, metafields:[] };
  return S.changes[pid];
}
function prodImg(p) { return p.featuredImage?.url || null; }

/* ─── TOAST ───────────────────────────────── */
let _toastTmr;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTmr);
  _toastTmr = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ─── STATUS ──────────────────────────────── */
function setStatus(msg, cls = '') {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = 'status-text' + (cls ? ' ' + cls : '');
}

/* ─── SCREENS ─────────────────────────────── */
function showScreen(name) {
  ['s-connect','s-loading','s-app'].forEach(id => {
    const el = $(id);
    el.classList.remove('active');
    el.style.display = '';
  });
  const target = $(name);
  target.classList.add('active');
  if (name === 's-loading' || name === 's-connect') target.style.display = 'flex';
}

/* ─── CONNECT SCREEN STEPS ───────────────── */
function showStep(step) {
  ['c-choose','c-oauth','c-token'].forEach(id => $(id).classList.add('hidden'));
  $(step).classList.remove('hidden');
}

/* ─── MODALS ──────────────────────────────── */
function openModal(id) { const el = $(id); el.classList.remove('hidden'); el.classList.add('open'); }
function closeModal(id) { const el = $(id); el.classList.remove('open'); el.classList.add('hidden'); }

/* ─── API ─────────────────────────────────── */
function apiHeaders() {
  return { 'Content-Type':'application/json', 'X-Shopify-Shop':S.shop, 'X-Shopify-Token':S.token };
}
async function apiPost(path, body = {}) {
  const r = await fetch(path, { method:'POST', headers:apiHeaders(), body:JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Request failed');
  return j;
}

/* ─── CONNECT: OAuth ─────────────────────── */
function startOAuth() {
  const raw = ($('f-shop-oauth')?.value || '').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
  if (!raw || !raw.includes('.myshopify.com')) return toast('Enter your store domain (e.g. your-store.myshopify.com)');
  window.location.href = `/auth/start?shop=${encodeURIComponent(raw)}`;
}

/* ─── CONNECT: Token ─────────────────────── */
async function connectWithToken() {
  S.shop  = $('f-shop').value.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
  S.token = $('f-token').value.trim();
  S.demo  = false;
  if (!S.shop || !S.token) return toast('Enter store domain and access token.');
  showScreen('s-loading'); $('loading-msg').textContent = 'Connecting…';
  try {
    const t = await apiPost('/api/test');
    await afterConnect(t.shop.name, false);
  } catch(e) { showScreen('s-connect'); toast(e.message); }
}

async function afterConnect(storeName, isDemo) {
  $('store-name').textContent = storeName;
  $('demo-badge').classList.toggle('hidden', !isDemo);
  $('demo-banner').classList.toggle('hidden', !isDemo);
  if (isDemo) { S.products = DEMO_PRODUCTS.map(normProd); S.originals = clone(S.products); renderTable(); initExportFields(); showScreen('s-app'); toast('Demo loaded.'); return; }
  $('loading-msg').textContent = 'Loading products…';
  await loadProducts();
  showScreen('s-app');
  toast('Connected. Token is session-only.');
}

function loadDemoMode() {
  S.shop = 'demo.myshopify.com'; S.token = 'demo'; S.demo = true;
  afterConnect('Demo store', true);
}

async function loadProducts(q = '') {
  setStatus('Loading…');
  try {
    const r = await apiPost('/api/products', { query:q, first:50 });
    S.products  = r.products.map(normProd);
    S.originals = clone(S.products);
    renderTable(); initExportFields();
    setStatus(`${S.products.length} products loaded`);
  } catch(e) { toast(e.message); setStatus('Load failed','dirty'); }
}

function disconnect() {
  Object.assign(S, { shop:'', token:'', demo:false, products:[], originals:[], changes:{}, schedules:[], past:[], future:[], filter:'all', searchQ:'', selectedVids:new Set(), bulkModalType:null, schedCtx:null });
  S.timers.forEach(t => clearTimeout(t)); S.timers.clear();
  $('f-token').value = '';
  showStep('c-choose');
  showScreen('s-connect');
  updateUndoUI(); updateSaveBtn();
  toast('Disconnected.');
}

/* ─── UNDO / REDO ─────────────────────────── */
function snapState() { return clone({ products:S.products, changes:S.changes }); }
function pushHist(label) {
  S.past.push({ label, snap:snapState() });
  if (S.past.length > MAX_HIST) S.past.shift();
  S.future = []; updateUndoUI();
}
function applySnap(snap) { S.products = clone(snap.products); S.changes = clone(snap.changes); }

function undo() {
  if (!S.past.length) return;
  S.future.push({ label:'redo', snap:snapState() });
  const h = S.past.pop(); applySnap(h.snap);
  renderTable(); updateUndoUI(); updateSaveBtn();
  toast('Undone: ' + h.label);
}
function redo() {
  if (!S.future.length) return;
  S.past.push({ label:'undo', snap:snapState() });
  const f = S.future.pop(); applySnap(f.snap);
  renderTable(); updateUndoUI(); updateSaveBtn();
  toast('Redone');
}
function updateUndoUI() {
  $('btn-undo').disabled = !S.past.length;
  $('btn-redo').disabled = !S.future.length;
  const hint = $('undo-hint');
  if (S.past.length || S.future.length) {
    hint.classList.remove('hidden');
    $('undo-hint-msg').textContent = `${S.past.length} action${S.past.length !== 1 ? 's' : ''} in history${S.future.length ? ' · ' + S.future.length + ' redo' : ''}`;
  } else hint.classList.add('hidden');
}
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
});

/* ─── RENDER TABLE ────────────────────────── */
function flatRows() { return S.products.flatMap(p => p.variants.nodes.map(v => ({ p, v }))); }

function getFiltered() {
  const q = S.searchQ.toLowerCase();
  return flatRows().filter(({ p, v }) => {
    const ms = !q || [p.title, p.vendor, (p.tags||[]).join(' '), v.title, v.sku].join(' ').toLowerCase().includes(q);
    const mf = S.filter === 'all'     ? true
             : S.filter === 'changed' ? !!S.changes[p.id]
             : p.status === S.filter;
    return ms && mf;
  });
}

function renderTable() {
  const rows = getFiltered();
  const tbody = $('tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:48px;color:var(--t3)">No products match.</td></tr>'; }
  else tbody.innerHTML = rows.map(({ p, v }) => rowHTML(p, v)).join('');
  updateSaveBtn(); buildSuggestions(); updateBulkBar(); updateExportPreview();
}

function rowHTML(p, v) {
  const dirty = !!S.changes[p.id];
  const sel   = S.selectedVids.has(v.id);
  const hasSched = S.schedules.some(s => s.variantId === v.id && s.state === 'queued');
  const cls = [dirty?'r-changed':'', sel?'r-selected':''].filter(Boolean).join(' ');
  const imgSrc = prodImg(p);
  const imgCell = imgSrc
    ? `<img class="prod-thumb" src="${esc(imgSrc)}" alt="" loading="lazy">`
    : `<div class="prod-thumb-ph">□</div>`;
  const stCls = { ACTIVE:'ACTIVE', DRAFT:'DRAFT', ARCHIVED:'ARCHIVED' }[p.status] || 'DRAFT';
  const stLbl = { ACTIVE:'● Active', DRAFT:'○ Draft', ARCHIVED:'⊘ Archived' }[p.status] || p.status;
  const tagsHTML = (p.tags||[]).map(t =>
    `<span class="tag">${esc(t)}<span class="tag-rm" data-pid="${esc(p.id)}" data-tag="${esc(t)}">×</span></span>`
  ).join('') + `<span class="tag-add" data-pid="${esc(p.id)}">+</span>`;
  const mfHTML = v.metafields.nodes.map((m,i) => mfRowHTML(v.id, m, i)).join('')
    + `<button class="mf-add" data-vid="${esc(v.id)}">+ metafield</button>`;
  const schedSched = S.schedules.find(s => s.variantId === v.id && s.state === 'queued');
  const schedCell = schedSched
    ? `<span class="sched-pill" data-switchtab="schedule" title="${esc(schedSched.name)}">⏱ ${esc(schedSched.name)}</span>`
    : `<button class="sched-add" data-pid="${esc(p.id)}" data-vid="${esc(v.id)}">+ schedule</button>`;
  return `<tr class="${cls}" data-pid="${esc(p.id)}" data-vid="${esc(v.id)}">
<td><input type="checkbox" class="row-chk" data-vid="${esc(v.id)}" ${sel?'checked':''}></td>
<td>${imgCell}</td>
<td><input class="ce${dirty?' dirty':''}" data-pid="${esc(p.id)}" data-field="title" value="${esc(p.title)}"></td>
<td><span class="status-pill ${stCls}" data-pid="${esc(p.id)}">${stLbl}</span></td>
<td><input class="ce" data-pid="${esc(p.id)}" data-field="vendor" value="${esc(p.vendor||'')}"></td>
<td><div class="tags-wrap" id="tw-${esc(p.id)}">${tagsHTML}</div></td>
<td style="color:var(--t2);font-size:12px">${esc(v.title||'Default')}</td>
<td><input class="ce" data-vid="${esc(v.id)}" data-vfield="sku" value="${esc(v.sku||'')}"></td>
<td><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vfield="price" value="${esc(v.price||'')}"></td>
<td><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vfield="compareAtPrice" placeholder="—" value="${esc(v.compareAtPrice||'')}"></td>
<td><div class="mf-cell" id="mf-${esc(v.id)}">${mfHTML}</div></td>
<td>${schedCell}</td>
</tr>`;
}

function mfRowHTML(vid, m, i) {
  return `<div class="mf-row" data-vidx="${esc(vid)}" data-midx="${i}">
<input class="mf-inp" placeholder="ns"    data-vid="${esc(vid)}" data-idx="${i}" data-mf="namespace" value="${esc(m.namespace||'custom')}">
<input class="mf-inp" placeholder="key"   data-vid="${esc(vid)}" data-idx="${i}" data-mf="key"       value="${esc(m.key||'')}">
<input class="mf-inp" placeholder="value" data-vid="${esc(vid)}" data-idx="${i}" data-mf="value"     value="${esc(m.value||'')}">
<button class="mf-del" data-vid="${esc(vid)}" data-idx="${i}">×</button>
</div>`;
}

/* ─── TABLE EVENT DELEGATION ─────────────── */
function bindTableEvents() {
  const tbody = $('tbody');
  tbody.addEventListener('change', e => {
    if (e.target.classList.contains('row-chk')) toggleRowSel(e.target.dataset.vid, e.target.checked);
  });
  tbody.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.field)  { markProd(el.dataset.pid, el.dataset.field, el.value, el); return; }
    if (el.dataset.vfield) { markVar(el.dataset.vid, el.dataset.vfield, el.value, el); return; }
    if (el.dataset.mf)     { markMf(el.dataset.vid, +el.dataset.idx, el.dataset.mf, el.value, el); return; }
  });
  tbody.addEventListener('click', e => {
    const el = e.target;
    if (el.classList.contains('status-pill')) { cycleStatus(el.dataset.pid); return; }
    if (el.classList.contains('tag-rm'))      { removeTag(el.dataset.pid, el.dataset.tag); return; }
    if (el.classList.contains('tag-add'))     { addTagPrompt(el.dataset.pid); return; }
    if (el.classList.contains('mf-add'))      { addMf(el.dataset.vid); return; }
    if (el.classList.contains('mf-del'))      { removeMf(el.dataset.vid, +el.dataset.idx); return; }
    if (el.classList.contains('sched-add'))   { openSchedModal({ productId:el.dataset.pid, variantId:el.dataset.vid }); return; }
    if (el.dataset.switchtab)                 { switchTab(el.dataset.switchtab); return; }
  });
}

/* ─── MARK CHANGES ────────────────────────── */
function markProd(pid, field, value, el) {
  pushHist(`Edit ${field} on "${getProd(pid)?.title || pid}"`);
  const p = getProd(pid); if (!p) return;
  p[field] = field === 'tags' ? value.split(',').map(x => x.trim()).filter(Boolean) : value;
  ensureChange(pid).product[field] = p[field];
  if (el) el.classList.add('dirty');
  updateSaveBtn();
}
function markVar(vid, field, value, el) {
  const { p, v } = getVar(vid); if (!p || !v) return;
  pushHist(`Edit ${field} on "${v.title||'Default'}"`);
  v[field] = value;
  const c = ensureChange(p.id);
  if (!c.variants[vid]) c.variants[vid] = { id:vid };
  c.variants[vid][field] = value;
  if (el) el.classList.add('dirty');
  updateSaveBtn();
}
function markMf(vid, idx, field, value, el) {
  const { p, v } = getVar(vid); if (!p || !v) return;
  pushHist('Edit metafield');
  v.metafields.nodes[idx][field] = value;
  const m = v.metafields.nodes[idx];
  const c = ensureChange(p.id);
  c.metafields = c.metafields.filter(x => !(x.ownerId === vid && x._idx === idx));
  if (m.namespace && m.key) c.metafields.push({ ownerId:vid, namespace:m.namespace, key:m.key, type:m.type||'single_line_text_field', value:String(m.value??''), _idx:idx });
  if (el) el.classList.add('dirty');
  updateSaveBtn();
}
function cycleStatus(pid) {
  const p = getProd(pid); if (!p) return;
  pushHist(`Cycle status on "${p.title}"`);
  const cyc = { ACTIVE:'DRAFT', DRAFT:'ARCHIVED', ARCHIVED:'ACTIVE' };
  p.status = cyc[p.status] || 'ACTIVE';
  ensureChange(pid).product.status = p.status;
  renderTable(); updateSaveBtn();
}
function removeTag(pid, tag) {
  const p = getProd(pid); if (!p) return;
  pushHist(`Remove tag "${tag}"`);
  p.tags = (p.tags||[]).filter(t => t !== tag);
  ensureChange(pid).product.tags = [...p.tags];
  rerenderTagCell(pid, p.tags); updateSaveBtn();
}
function addTagPrompt(pid) {
  const tag = prompt('New tag:'); if (!tag?.trim()) return;
  const p = getProd(pid); if (!p) return;
  if (p.tags.includes(tag.trim())) return toast('Tag already exists.');
  pushHist(`Add tag "${tag.trim()}"`);
  p.tags.push(tag.trim());
  ensureChange(pid).product.tags = [...p.tags];
  rerenderTagCell(pid, p.tags); updateSaveBtn();
}
function rerenderTagCell(pid, tags) {
  const cell = $(`tw-${pid}`); if (!cell) return;
  cell.innerHTML = tags.map(t =>
    `<span class="tag">${esc(t)}<span class="tag-rm" data-pid="${esc(pid)}" data-tag="${esc(t)}">×</span></span>`
  ).join('') + `<span class="tag-add" data-pid="${esc(pid)}">+</span>`;
}
function addMf(vid) {
  const { v } = getVar(vid); if (!v) return;
  pushHist('Add metafield');
  v.metafields.nodes.push({ namespace:'custom', key:'', type:'single_line_text_field', value:'' });
  rerenderMfCell(vid, v);
}
function removeMf(vid, idx) {
  const { p, v } = getVar(vid); if (!p || !v) return;
  pushHist('Remove metafield');
  v.metafields.nodes.splice(idx, 1);
  const c = ensureChange(p.id);
  c.metafields = c.metafields.filter(x => !(x.ownerId === vid && x._idx === idx));
  rerenderMfCell(vid, v); updateSaveBtn();
}
function rerenderMfCell(vid, v) {
  const cell = $(`mf-${vid}`); if (!cell) return;
  cell.innerHTML = v.metafields.nodes.map((m,i) => mfRowHTML(vid, m, i)).join('')
    + `<button class="mf-add" data-vid="${esc(vid)}">+ metafield</button>`;
}

/* ─── ROW SELECTION ───────────────────────── */
function toggleRowSel(vid, checked) {
  checked ? S.selectedVids.add(vid) : S.selectedVids.delete(vid);
  updateBulkBar();
  const row = document.querySelector(`tr[data-vid="${vid}"]`);
  if (row) row.classList.toggle('r-selected', checked);
}
function toggleAllRows(checked) {
  document.querySelectorAll('.row-chk').forEach(cb => { cb.checked = checked; toggleRowSel(cb.dataset.vid, checked); });
}
function updateBulkBar() {
  const n = S.selectedVids.size;
  $('bulk-bar').classList.toggle('hidden', n === 0);
  $('bulk-count').textContent = `${n} selected`;
}
function getSelPids() {
  const ids = new Set();
  S.selectedVids.forEach(vid => { const { p } = getVar(vid); if (p) ids.add(p.id); });
  return [...ids];
}

/* ─── SAVE BUTTON ─────────────────────────── */
function updateSaveBtn() {
  const n = Object.keys(S.changes).length;
  $('btn-save').disabled = !n;
  $('save-count').textContent = n;
  if (n) setStatus(`${n} unsaved change${n!==1?'s':''}`, 'dirty');
  else   setStatus('No pending changes', 'ok');
}

/* ─── BULK MODAL ──────────────────────────── */
function openBulkModal(type) {
  S.bulkModalType = type;
  const n = S.selectedVids.size;
  $('m-bulk-title').textContent = { status:'Change status', price:'Set price', tags:'Add or remove tags' }[type] || 'Bulk action';
  $('m-bulk-sub').textContent   = `Applied to ${n} selected variant${n!==1?'s':''}`;
  const body = $('m-bulk-body');
  if (type === 'status') {
    body.innerHTML = `<div class="bulk-field"><label>New status</label><select id="bv-status"><option value="ACTIVE">● Active</option><option value="DRAFT">○ Draft</option><option value="ARCHIVED">⊘ Archived</option></select></div>`;
  } else if (type === 'price') {
    body.innerHTML = `<div class="bulk-field"><label>New price</label><input id="bv-price" type="number" step=".01" min="0" placeholder="0.00" autofocus></div>`;
  } else if (type === 'tags') {
    body.innerHTML = `<div class="bulk-field"><label>Tag</label><div class="tag-with-action"><input id="bv-tag" type="text" placeholder="e.g. sale" autofocus><select id="bv-tag-action"><option value="add">Add</option><option value="remove">Remove</option></select></div></div>`;
  }
  openModal('m-bulk');
  setTimeout(() => body.querySelector('input,select')?.focus(), 60);
}

function applyBulkModal() {
  const type = S.bulkModalType;
  if (type === 'status') {
    const val = $('bv-status').value;
    const pids = getSelPids(); if (!pids.length) return;
    pushHist(`Bulk status → ${val}`);
    pids.forEach(pid => { const p = getProd(pid); if (!p) return; p.status = val; ensureChange(pid).product.status = val; });
    renderTable(); updateSaveBtn(); toast(`Status set to ${val} on ${pids.length} products.`);
  } else if (type === 'price') {
    const val = $('bv-price')?.value; const n = Number(val);
    if (!val || isNaN(n) || n < 0) return toast('Enter a valid price.');
    const vids = [...S.selectedVids];
    pushHist(`Bulk price → ${n.toFixed(2)}`);
    vids.forEach(vid => { const { p, v } = getVar(vid); if (!p||!v) return; v.price = n.toFixed(2); const c = ensureChange(p.id); if (!c.variants[vid]) c.variants[vid] = { id:vid }; c.variants[vid].price = v.price; });
    renderTable(); updateSaveBtn(); toast(`Price set to ${n.toFixed(2)} on ${vids.length} variants.`);
  } else if (type === 'tags') {
    const tag    = $('bv-tag')?.value.trim();
    const action = $('bv-tag-action')?.value;
    if (!tag) return toast('Enter a tag.');
    const pids = getSelPids();
    pushHist(`Bulk ${action} tag "${tag}"`);
    pids.forEach(pid => {
      const p = getProd(pid); if (!p) return;
      if (action === 'add') { if (!p.tags.includes(tag)) p.tags.push(tag); }
      else p.tags = p.tags.filter(t => t !== tag);
      ensureChange(pid).product.tags = [...p.tags];
    });
    renderTable(); updateSaveBtn(); toast(`Tag "${tag}" ${action==='add'?'added to':'removed from'} ${pids.length} products.`);
  }
  closeModal('m-bulk');
}

/* ─── REVIEW & SAVE MODAL ────────────────── */
function openSaveModal() {
  const payloads = Object.values(S.changes);
  if (!payloads.length) return toast('No changes to save.');
  $('m-save-sub').textContent = `${payloads.length} product${payloads.length!==1?'s':''} with pending changes`;
  const list = $('m-save-diff');
  list.innerHTML = payloads.map(c => {
    const p = getProd(c.productId); if (!p) return '';
    const imgSrc = prodImg(p);
    const imgEl = imgSrc ? `<img class="diff-thumb" src="${esc(imgSrc)}" alt="">` : `<div class="diff-thumb-ph">□</div>`;
    const orig = S.originals.find(x => x.id === c.productId);
    const diffs = [];
    Object.entries(c.product||{}).forEach(([field, newVal]) => {
      const oldVal = orig ? orig[field] : '?';
      const oldStr = Array.isArray(oldVal) ? oldVal.join(', ') : String(oldVal ?? '');
      const newStr = Array.isArray(newVal) ? newVal.join(', ') : String(newVal ?? '');
      if (oldStr !== newStr) diffs.push(`<div class="diff-row"><span class="diff-field">${esc(field)}</span><span class="diff-old">${esc(oldStr||'—')}</span><span class="diff-arr">→</span><span class="diff-new">${esc(newStr)}</span></div>`);
    });
    Object.values(c.variants||{}).forEach(v => {
      let origV = null; if (orig) origV = orig.variants?.nodes?.find(x => x.id === v.id);
      const vLbl = p.variants.nodes.find(x => x.id === v.id)?.title || 'variant';
      ['price','compareAtPrice','sku'].forEach(field => {
        if (v[field] !== undefined) { const old = origV ? String(origV[field]??'') : '?'; const nw = String(v[field]??''); if (old !== nw) diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl)} ${esc(field)}</span><span class="diff-old">${esc(old||'—')}</span><span class="diff-arr">→</span><span class="diff-new">${esc(nw)}</span></div>`); }
      });
    });
    if ((c.metafields||[]).length) diffs.push(`<div class="diff-row"><span class="diff-field">metafields</span><span class="diff-new">${c.metafields.length} change${c.metafields.length!==1?'s':''}</span></div>`);
    return `<div class="diff-item"><div class="diff-item-head">${imgEl}<span class="diff-title">${esc(p.title)}</span></div><div class="diff-rows">${diffs.length ? diffs.join('') : '<div style="font-size:12px;color:var(--t3)">Variant / metafield changes</div>'}</div></div>`;
  }).join('');
  openModal('m-save');
}

async function confirmSave() {
  const payloads = Object.values(S.changes); if (!payloads.length) return;
  const btn = $('m-save-confirm'); btn.disabled = true;
  setStatus('Saving…', 'saving');
  try {
    if (S.demo) { await delay(600); }
    else {
      for (const c of payloads) {
        const mf = (c.metafields||[]).map(({ _idx, ...rest }) => rest);
        await apiPost('/api/save-product', { productId:c.productId, product:c.product, variants:Object.values(c.variants||{}), metafields:mf });
      }
    }
    const recap = buildRecap(payloads);
    const n = payloads.length;
    S.changes = {}; S.past = []; S.future = [];
    S.originals = clone(S.products);
    document.querySelectorAll('.dirty').forEach(el => el.classList.remove('dirty'));
    closeModal('m-save'); renderTable(); updateSaveBtn(); updateUndoUI();
    toast(`${n} product${n!==1?'s':''} saved.`);
    setStatus('All changes saved', 'ok');
    downloadText(recap, `bulkedit-recap-${Date.now()}.txt`);
  } catch(e) { toast(e.message); setStatus('Save failed', 'dirty'); }
  finally { btn.disabled = false; }
}

/* ─── RECAP ───────────────────────────────── */
function buildRecap(payloads) {
  const lines = ['BulkEdit — Change recap', `Generated: ${new Date().toLocaleString()}`, ''];
  payloads.forEach(c => {
    const p = getProd(c.productId); if (!p) return;
    lines.push(`Product: ${p.title}`);
    const orig = S.originals.find(x => x.id === c.productId);
    Object.entries(c.product||{}).forEach(([field, newVal]) => {
      const oldVal = orig ? orig[field] : '?';
      const oldStr = Array.isArray(oldVal) ? oldVal.join(', ') : String(oldVal??'');
      const newStr = Array.isArray(newVal) ? newVal.join(', ') : String(newVal??'');
      if (oldStr !== newStr) lines.push(`  ${field}: "${oldStr}" → "${newStr}"`);
    });
    Object.values(c.variants||{}).forEach(v => {
      const origV = orig?.variants?.nodes?.find(x => x.id === v.id);
      const vLbl  = p.variants.nodes.find(x => x.id === v.id)?.title || v.id;
      ['price','compareAtPrice','sku'].forEach(field => {
        if (v[field] !== undefined) { const old = origV ? String(origV[field]??'') : '?'; const nw = String(v[field]??''); if (old !== nw) lines.push(`  ${vLbl} ${field}: "${old}" → "${nw}"`); }
      });
    });
    if ((c.metafields||[]).length) lines.push(`  metafields: ${c.metafields.length} change${c.metafields.length!==1?'s':''}`);
    lines.push('');
  });
  return lines.join('\n');
}
function downloadText(text, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type:'text/plain' }));
  a.download = filename; a.click();
}
function manualDownloadRecap() { downloadText(buildRecap(Object.values(S.changes)), `bulkedit-recap-${Date.now()}.txt`); }

/* ─── SEARCH ──────────────────────────────── */
function buildSuggestions() {
  const q = S.searchQ; const box = $('search-suggest');
  if (!q) { box.classList.remove('open'); return; }
  const all = [...new Set(flatRows().flatMap(({ p, v }) => [p.title, p.vendor, v.sku, ...(p.tags||[])]).filter(Boolean))];
  const hits = all.filter(x => x.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (!hits.length) { box.classList.remove('open'); return; }
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  box.innerHTML = hits.map(h => `<div class="suggest-item" data-val="${esc(h)}">${esc(h).replace(re,'<mark>$1</mark>')}</div>`).join('');
  box.classList.add('open');
}

/* ─── FILTER ──────────────────────────────── */
function setFilter(f) {
  S.filter = f;
  document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  renderTable();
}

/* ─── TABS ────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-'+name));
  if (name === 'export') updateExportPreview();
}

/* ─── SCHEDULE ────────────────────────────── */
function openSchedModal(ctx) {
  S.schedCtx = ctx;
  const modal = $('m-sched');
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  $('sched-date').value    = tom.toISOString().split('T')[0];
  $('sched-time').value    = '09:00';
  $('sched-name').value    = '';
  $('sched-revert').checked = false;
  $('sched-revert-wrap').classList.add('hidden');
  let rows;
  if (ctx === 'bulk' || ctx === 'new') rows = ctx === 'bulk' ? flatRows().filter(({ v }) => S.selectedVids.has(v.id)) : flatRows().slice(0, 20);
  else if (ctx?.variantId) rows = flatRows().filter(({ v }) => v.id === ctx.variantId);
  else rows = flatRows().slice(0, 20);
  $('m-sched-sub').textContent   = ctx === 'bulk' ? `${rows.length} selected variants` : ctx?.variantId ? `${rows[0]?.p.title||''} — ${rows[0]?.v.title||'Default'}` : `${rows.length} products`;
  $('sched-prod-count').textContent = `(${rows.length})`;
  $('sched-prod-list').innerHTML = rows.map(({ p, v }) =>
    `<div class="sched-prod-item" data-vid="${esc(v.id)}" data-pid="${esc(p.id)}"><span class="spi-name">${esc(p.title)} — ${esc(v.title||'Default')}</span><div id="spwrap-${esc(v.id)}"></div></div>`
  ).join('');
  renderSchedValueFields();
  openModal('m-sched');
}

function renderSchedValueFields() {
  const type = $('sched-type').value;
  const wrap = $('sched-value-wrap');
  const items = document.querySelectorAll('#sched-prod-list .sched-prod-item');
  if (type === 'price') {
    wrap.innerHTML = `<div class="field"><label>Default price <span class="text-muted">(override per-variant below)</span></label><input id="sched-default-price" type="number" step=".01" min="0" placeholder="0.00"></div>`;
    items.forEach(item => {
      const vid = item.dataset.vid; const { v } = getVar(vid);
      const el = $(`spwrap-${vid}`); if (el) el.innerHTML = `<input class="spi-price-inp" id="sprice-${esc(vid)}" type="number" step=".01" min="0" placeholder="${esc(v?.price||'')}">`;
    });
  } else if (type === 'status') {
    wrap.innerHTML = `<div class="field"><label>New status</label><select id="sched-status-val"><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select></div>`;
    items.forEach(item => { const el = $(`spwrap-${item.dataset.vid}`); if (el) el.innerHTML = ''; });
  } else {
    wrap.innerHTML = `<div class="field"><label>${type==='tags_add'?'Tags to add':'Tags to remove'}</label><input id="sched-tags-val" type="text" placeholder="sale, promo"></div>`;
    items.forEach(item => { const el = $(`spwrap-${item.dataset.vid}`); if (el) el.innerHTML = ''; });
  }
}

function confirmSched() {
  const name    = $('sched-name').value.trim() || 'Scheduled task';
  const date    = $('sched-date').value;
  const time    = $('sched-time').value || '09:00';
  const type    = $('sched-type').value;
  if (!date) return toast('Please set a date.');
  const runAt = new Date(`${date}T${time}`);
  if (isNaN(runAt.getTime()) || runAt < new Date()) return toast('Date must be in the future.');
  const revert    = $('sched-revert').checked;
  const revertAt  = revert ? new Date(`${$('sched-rv-date').value}T${$('sched-rv-time').value}`) : null;
  let defVal = null;
  if (type === 'price')  defVal = $('sched-default-price')?.value || null;
  if (type === 'status') defVal = $('sched-status-val')?.value || 'ACTIVE';
  if (type.startsWith('tags')) defVal = $('sched-tags-val')?.value || '';
  const items = [...document.querySelectorAll('#sched-prod-list .sched-prod-item')];
  items.forEach(item => {
    const { p, v } = getVar(item.dataset.vid); if (!p || !v) return;
    const overPrice = $(`sprice-${item.dataset.vid}`)?.value || null;
    S.schedules.push({ id:crypto.randomUUID(), name, productId:item.dataset.pid, variantId:item.dataset.vid, productTitle:p.title, variantTitle:v.title||'Default', runAt:runAt.toISOString(), revertAt:revert&&revertAt&&!isNaN(revertAt.getTime())?revertAt.toISOString():null, type, value:type==='price'?(overPrice||defVal):defVal, original:{ price:v.price, status:p.status, tags:clone(p.tags||[]) }, state:'queued' });
    const task = S.schedules[S.schedules.length - 1];
    armSchedTimer(task);
  });
  updateSchedBadge(); renderSchedList(); renderTable();
  closeModal('m-sched');
  toast(`"${name}" scheduled for ${date} ${time}.`);
}

function armSchedTimer(s) {
  if (S.timers.has(s.id)) clearTimeout(S.timers.get(s.id));
  const ms = new Date(s.runAt) - Date.now(); if (ms < 0) return;
  S.timers.set(s.id, setTimeout(() => runSchedTask(s.id, false), ms));
}

async function runSchedTask(id, isRevert) {
  const s = S.schedules.find(x => x.id === id); if (!s) return;
  const { p, v } = getVar(s.variantId); if (!p || !v) return;
  const product = {}, variants = {};
  if (isRevert) { if (s.original.status) product.status = s.original.status; if (s.original.price) variants[s.variantId] = { id:s.variantId, price:s.original.price }; s.state = 'reverted'; }
  else { if (s.type==='price'&&s.value) variants[s.variantId]={id:s.variantId,price:s.value}; if (s.type==='status'&&s.value) product.status=s.value; if (s.type==='tags_add'&&s.value){s.value.split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{if(!p.tags.includes(t))p.tags.push(t);});product.tags=clone(p.tags);} if (s.type==='tags_remove'&&s.value){p.tags=p.tags.filter(t=>!s.value.split(',').map(x=>x.trim()).includes(t));product.tags=clone(p.tags);} s.state='running'; }
  if (!S.demo) { try { await apiPost('/api/save-product',{productId:s.productId,product,variants,metafields:[]}); } catch(e) { toast('Schedule error: '+e.message); } }
  if (!isRevert && s.revertAt) { const ms = new Date(s.revertAt) - Date.now(); if (ms > 0) setTimeout(() => runSchedTask(id, true), ms); }
  else if (!isRevert) s.state = 'done';
  renderSchedList(); renderTable();
}

function cancelSched(id) {
  if (S.timers.has(id)) clearTimeout(S.timers.get(id));
  S.schedules = S.schedules.filter(s => s.id !== id);
  updateSchedBadge(); renderSchedList(); renderTable();
  toast('Task cancelled.');
}

function updateSchedBadge() {
  const n = S.schedules.filter(s => s.state === 'queued').length;
  const b = $('sched-count'); b.textContent = n; b.classList.toggle('hidden', !n);
}

function renderSchedList() {
  updateSchedBadge();
  const el = $('sched-list');
  if (!S.schedules.length) { el.innerHTML = '<p class="empty-msg">No scheduled tasks yet.</p>'; return; }
  const sorted = clone(S.schedules).sort((a,b) => new Date(b.runAt) - new Date(a.runAt));
  el.innerHTML = sorted.map(s => {
    const past = new Date(s.runAt) < new Date();
    const tl = { price:'Price change', status:'Status change', tags_add:'Add tags', tags_remove:'Remove tags' }[s.type] || s.type;
    return `<div class="sched-card">
<div class="sched-card-top">
<div><div class="sched-card-name">${esc(s.name)}</div><div class="sched-card-meta"><span>${tl}</span>${s.value?`<span>· ${esc(String(s.value))}</span>`:''}<span>· ${esc(s.state)}</span>${s.revertAt?`<span class="revert-tag">↺ auto-revert</span>`:''}</div></div>
<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="sched-card-time${past||s.state!=='queued'?' done':''}">${fmt(s.runAt)}</span><button class="btn-ghost sm sched-cancel" data-id="${s.id}">Cancel</button></div>
</div>
<div style="display:flex;flex-wrap:wrap;gap:4px"><span style="padding:2px 8px;background:var(--s2);border:1px solid var(--b1);border-radius:3px;font-size:11px;color:var(--t2);font-family:var(--mono)">${esc(s.productTitle)} — ${esc(s.variantTitle)}</span></div>
</div>`;
  }).join('');
  el.querySelectorAll('.sched-cancel').forEach(btn => btn.addEventListener('click', () => cancelSched(btn.dataset.id)));
}

function exportSchedJSON() {
  downloadText(JSON.stringify(S.schedules, null, 2), `bulkedit-schedule-${Date.now()}.json`);
  toast('Schedule exported.');
}
function importSchedFile(file) {
  const r = new FileReader();
  r.onload = () => { try { const imp = JSON.parse(r.result); if (!Array.isArray(imp)) throw 0; S.schedules = imp; S.schedules.forEach(s => { if (s.state==='queued') armSchedTimer(s); }); renderSchedList(); toast(`${imp.length} task${imp.length!==1?'s':''} imported.`); } catch { toast('Invalid JSON.'); } };
  r.readAsText(file);
}

/* ─── EXPORT ──────────────────────────────── */
const EX_FIELDS = ['id','title','status','vendor','tags','variant','sku','price','compareAtPrice','inventoryQuantity'];
const EX_LABELS = { id:'ID', title:'Title', status:'Status', vendor:'Vendor', tags:'Tags', variant:'Variant', sku:'SKU', price:'Price', compareAtPrice:'Compare at', inventoryQuantity:'Inventory' };

function initExportFields() {
  const el = $('export-field-list'); if (!el) return;
  el.innerHTML = EX_FIELDS.map(f =>
    `<label class="field-chip${S.exportFields.includes(f)?' on':''}"><input type="checkbox" data-ef="${f}" ${S.exportFields.includes(f)?'checked':''}>${EX_LABELS[f]||f}</label>`
  ).join('');
  el.querySelectorAll('input[data-ef]').forEach(cb => {
    cb.addEventListener('change', () => {
      const f = cb.dataset.ef;
      if (cb.checked) { if (!S.exportFields.includes(f)) S.exportFields.push(f); }
      else S.exportFields = S.exportFields.filter(x => x !== f);
      cb.closest('.field-chip').classList.toggle('on', cb.checked);
      updateExportPreview();
    });
  });
  updateExportPreview();
}

function exVal(p, v, f) {
  if (f==='tags') return (p.tags||[]).join('|');
  if (f==='variant') return v.title||'Default';
  if (f==='sku') return v.sku||'';
  if (f==='price') return v.price||'';
  if (f==='compareAtPrice') return v.compareAtPrice||'';
  if (f==='inventoryQuantity') return String(v.inventoryQuantity??'');
  return String(p[f]??'');
}
function buildCSV() {
  const rows = flatRows();
  return [S.exportFields.join(','), ...rows.map(({ p, v }) =>
    S.exportFields.map(f => { const val = exVal(p,v,f); return val.includes(',')||val.includes('"') ? `"${val.replace(/"/g,'""')}"` : val; }).join(',')
  )].join('\n');
}
function buildJSON() {
  return JSON.stringify(flatRows().map(({ p, v }) => { const o={}; S.exportFields.forEach(f => o[f]=exVal(p,v,f)); return o; }), null, 2);
}
function updateExportPreview() {
  const pre = $('export-preview'); if (!pre) return;
  const rows = flatRows().slice(0,3);
  pre.textContent = [S.exportFields.join(','), ...rows.map(({ p, v }) =>
    S.exportFields.map(f => { const val = exVal(p,v,f); return val.includes(',')?`"${val}"`:val; }).join(',')
  )].join('\n') + (flatRows().length > 3 ? `\n… (${flatRows().length} total rows)` : '');
}

/* ─── BOOT ────────────────────────────────── */
function boot() {
  /* Connect screen */
  $('c-oauth-btn').addEventListener('click', () => showStep('c-oauth'));
  $('c-token-btn').addEventListener('click', () => showStep('c-token'));
  $('c-demo-btn').addEventListener('click',  loadDemoMode);
  $('c-oauth-go').addEventListener('click',  startOAuth);
  $('c-token-go').addEventListener('click',  connectWithToken);
  document.querySelectorAll('.c-back').forEach(btn => btn.addEventListener('click', () => showStep('c-choose')));
  $('f-shop-oauth').addEventListener('keydown', e => { if (e.key==='Enter') startOAuth(); });
  $('f-shop').addEventListener('keydown',  e => { if (e.key==='Enter') connectWithToken(); });
  $('f-token').addEventListener('keydown', e => { if (e.key==='Enter') connectWithToken(); });

  /* Topbar */
  $('btn-undo').addEventListener('click',       undo);
  $('btn-redo').addEventListener('click',       redo);
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-demo-exit').addEventListener('click',  disconnect);
  $('btn-save').addEventListener('click',       openSaveModal);

  /* Search */
  $('search').addEventListener('input', e => {
    S.searchQ = e.target.value.trim(); renderTable();
    if (!S.demo && S.searchQ.length > 2) { clearTimeout(window._srt); window._srt = setTimeout(() => loadProducts(S.searchQ), 350); }
  });
  $('search').addEventListener('focus', () => { if (S.searchQ) buildSuggestions(); });
  $('search-suggest').addEventListener('mousedown', e => {
    const item = e.target.closest('.suggest-item'); if (!item) return;
    $('search').value = item.dataset.val; S.searchQ = item.dataset.val.toLowerCase();
    $('search-suggest').classList.remove('open'); renderTable();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search-box')) $('search-suggest').classList.remove('open'); });

  /* Filters */
  document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => setFilter(btn.dataset.f)));

  /* Tabs */
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  /* Select all */
  $('chk-all').addEventListener('change', e => toggleAllRows(e.target.checked));

  /* Undo hint bar */
  $('undo-hint-undo').addEventListener('click', undo);
  $('undo-hint-redo').addEventListener('click', redo);

  /* Bulk bar */
  $('bulk-status-btn').addEventListener('click', () => openBulkModal('status'));
  $('bulk-price-btn').addEventListener('click',  () => openBulkModal('price'));
  $('bulk-tags-btn').addEventListener('click',   () => openBulkModal('tags'));
  $('bulk-sched-btn').addEventListener('click',  () => openSchedModal('bulk'));

  /* Bulk modal */
  $('m-bulk-apply').addEventListener('click', applyBulkModal);

  /* Save/review modal */
  $('m-save-confirm').addEventListener('click',    confirmSave);
  $('btn-dl-recap').addEventListener('click',      manualDownloadRecap);

  /* Schedule modal */
  $('btn-new-sched').addEventListener('click',         () => openSchedModal('new'));
  $('btn-export-sched').addEventListener('click',      exportSchedJSON);
  $('btn-import-sched-trigger').addEventListener('click', () => $('btn-import-sched').click());
  $('btn-import-sched').addEventListener('change',     e => e.target.files[0] && importSchedFile(e.target.files[0]));
  $('sched-type').addEventListener('change',           renderSchedValueFields);
  $('sched-revert').addEventListener('change',         () => $('sched-revert-wrap').classList.toggle('hidden', !$('sched-revert').checked));
  $('m-sched-confirm').addEventListener('click',       confirmSched);

  /* Export */
  $('btn-dl-csv').addEventListener('click',   () => { downloadText(buildCSV(), `shopify-export-${Date.now()}.csv`); toast('CSV downloaded.'); });
  $('btn-dl-json').addEventListener('click',  () => { downloadText(buildJSON(), `shopify-export-${Date.now()}.json`); toast('JSON downloaded.'); });
  $('btn-copy-csv').addEventListener('click', () => { navigator.clipboard?.writeText(buildCSV()).then(()=>toast('CSV copied.')).catch(()=>toast('Clipboard not available.')); });

  /* Generic modal close — data-close attribute */
  document.addEventListener('click', e => {
    const closeId = e.target.closest('[data-close]')?.dataset.close;
    if (closeId) { closeModal(closeId); return; }
    // close if clicking overlay background
    if (e.target.classList.contains('overlay')) closeModal(e.target.id);
  });

  /* Keyboard */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['m-bulk','m-save','m-sched'].forEach(id => closeModal(id));
  });

  /* Table events */
  bindTableEvents();

  /* OAuth callback — reads ?shop=&token= from URL */
  (function checkOAuthCallback() {
    const p = new URLSearchParams(window.location.search);
    const shop = p.get('shop'), token = p.get('token');
    if (shop && token) {
      window.history.replaceState({}, '', '/');
      S.shop  = decodeURIComponent(shop);
      S.token = decodeURIComponent(token);
      S.demo  = false;
      showScreen('s-loading'); $('loading-msg').textContent = 'Connecting to your store…';
      apiPost('/api/test').then(t => afterConnect(t.shop.name, false)).catch(e => { showScreen('s-connect'); toast(e.message); });
    }
  })();
}

document.addEventListener('DOMContentLoaded', boot);

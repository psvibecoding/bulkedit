'use strict';
/* ═══════════════════════════════════════════
   BulkEdit — app-tool.js v8
   OAuth only · Metafield definitions · Collections
═══════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const delay = ms => new Promise(r => setTimeout(r, ms));

/* ── STATE ── */
let S = {
  shop:'', token:'', demo:false,
  products:[], originals:[], changes:{},
  mfDefs:[],
  collsCache:null,
  past:[], future:[],
  filter:'all', searchQ:'', tagFilter:'',
  selectedVids: new Set(),
  bulkType: null,
  schedules:[],
  exportFields:['title','status','vendor','tags','variant','sku','price','compareAtPrice'],
};
const MAX_H = 80;

/* ── DEMO DATA ── */
const DEMO_MF_DEFS = [
  { namespace:'custom', key:'material',       name:'Material',      type:'single_line_text_field' },
  { namespace:'custom', key:'campaign_label', name:'Campaign label', type:'single_line_text_field' },
  { namespace:'custom', key:'thickness_mm',   name:'Thickness (mm)', type:'number_integer' },
  { namespace:'seo',    key:'custom_title',   name:'SEO title',     type:'single_line_text_field' },
];
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
      { id:'gid://shopify/ProductVariant/41', title:'White',       sku:'KS-POUROVER-WHT', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:22, metafields:{ nodes:[{ namespace:'seo', key:'custom_title', type:'single_line_text_field', value:'' }] } },
      { id:'gid://shopify/ProductVariant/42', title:'Matte Black', sku:'KS-POUROVER-BLK', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:14, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/5', title:'Natural Rubber Yoga Mat 6mm', status:'ACTIVE', vendor:'MoveWell', tags:['fitness','yoga','eco'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/51', title:'Default', sku:'MW-YOGAMAT-6MM', price:'78.00', compareAtPrice:'', inventoryQuantity:33, metafields:{ nodes:[{ namespace:'custom', key:'thickness_mm', type:'number_integer', value:'6' }] } },
    ]}},
  { id:'gid://shopify/Product/6', title:'Linen Duvet Cover Set — King', status:'ARCHIVED', vendor:'HomeTextile', tags:['bedding','linen','home'],
    featuredImage:null,
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/61', title:'Sand', sku:'HT-DUVET-K-SND', price:'189.00', compareAtPrice:'229.00', inventoryQuantity:7, metafields:{ nodes:[] } },
    ]}},
];

/* ── HELPERS ── */
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3000); }
function setStatus(msg,cls=''){
  const el=$('status-msg'); if(!el)return;
  el.textContent=msg; el.className='status-txt'+(cls?' '+cls:'');
  document.querySelector('.statusbar')?.setAttribute('data-status',cls||'ready');
}
function showScreen(name){
  ['s-connect','s-loading','s-app'].forEach(id=>{ const el=$(id); if(!el)return; el.classList.remove('active'); el.style.display='none'; });
  const t=$(name); if(!t)return; t.classList.add('active');
  t.style.display=(name==='s-connect'||name==='s-loading')?'flex':'block';
}
function openModal(id){ const el=$(id); if(!el)return; el.classList.remove('hidden'); el.classList.add('open'); }
function closeModal(id){ const el=$(id); if(!el)return; el.classList.remove('open'); el.classList.add('hidden'); }

/* ── API ── */
function apiH(){ return {'Content-Type':'application/json','X-Shopify-Shop':S.shop,'X-Shopify-Token':S.token}; }
async function api(path,body={}){
  const r=await fetch(path,{method:'POST',headers:apiH(),body:JSON.stringify(body)});
  const j=await r.json(); if(!j.ok)throw new Error(j.error||'Request failed'); return j;
}

/* ── CONNECT ── */
function startOAuth(){
  const raw = $('f-shop').value.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
  if(!raw||!raw.includes('.myshopify.com')) return toast('Enter your store domain — e.g. your-store.myshopify.com');
  if(new URLSearchParams(location.search).get('openSchedules')==='1') sessionStorage.setItem('openSchedules','1');
  window.location.href = `/auth/start?shop=${encodeURIComponent(raw)}`;
}

async function afterOAuth(shop, token){
  S.shop=shop; S.token=token; S.demo=false;
  showScreen('s-loading'); $('loading-msg').textContent='Connecting to your store…';
  try{
    const t = await api('/api/test');
    $('store-name').textContent = t.shop.name;
    $('loading-msg').textContent='Loading products…';
    await Promise.all([ loadProducts(), loadMfDefs() ]);
    showScreen('s-app');
    loadSchedules();
    toast('Connected — all info loaded. Session only, no data stored.');
    const shouldOpenSchedules = new URLSearchParams(location.search).get('openSchedules')==='1' || sessionStorage.getItem('openSchedules')==='1';
    if(shouldOpenSchedules){
      history.replaceState(null,'',location.pathname);
      sessionStorage.removeItem('openSchedules');
      setTimeout(openScheduleModal, 400);
    }
  }catch(e){ showScreen('s-connect'); toast(e.message); }
}

async function loadProducts(q=''){
  setStatus('Loading…');
  try{
    const r=await api('/api/products',{query:q,first:50});
    S.products=r.products.map(normProd); S.originals=clone(S.products);
    renderTable(); initExportFields(); buildTagFilter();
    setStatus(`${S.products.length} products loaded`);
  }catch(e){ toast(e.message); setStatus('Load failed','dirty'); }
}

async function loadMfDefs(){
  if(S.demo) return;
  try{
    const r=await api('/api/metafield-definitions');
    S.mfDefs=r.definitions||[];
  }catch(e){ S.mfDefs=[]; }
}

function normProd(p){
  return { ...p,
    featuredImage: p.featuredImage||null,
    metafields: { nodes: p.metafields?.nodes||[] },
    variants:{ nodes:(p.variants?.nodes||[]).map(v=>({...v, metafields:{nodes:v.metafields?.nodes||[]}})) }
  };
}

function loadDemoMode(){
  S.shop='demo.myshopify.com'; S.token='demo'; S.demo=true;
  S.products=DEMO_PRODUCTS.map(normProd); S.originals=clone(S.products);
  S.mfDefs=DEMO_MF_DEFS;
  $('store-name').textContent='Demo Store';
  $('demo-banner').classList.remove('hidden');
  renderTable(); initExportFields(); buildTagFilter();
  showScreen('s-app');
  toast('Demo loaded — changes won\'t be saved.');
}

function disconnect(){
  Object.assign(S,{shop:'',token:'',demo:false,products:[],originals:[],changes:{},mfDefs:[],collsCache:null,past:[],future:[],filter:'all',searchQ:'',tagFilter:'',bulkType:null});
  S.selectedVids=new Set();
  $('f-shop').value='';
  $('demo-banner').classList.add('hidden');
  showScreen('s-connect');
  updateUndoUI(); updateSaveBtn();
  toast('Disconnected.');
}

/* ── UNDO/REDO ── */
function snap(){ return clone({products:S.products,changes:S.changes}); }
function pushH(label){ S.past.push({label,s:snap()}); if(S.past.length>MAX_H)S.past.shift(); S.future=[]; updateUndoUI(); }
function applySnap(s){ S.products=clone(s.products); S.changes=clone(s.changes); }
function undo(){ if(!S.past.length)return; S.future.push({label:'redo',s:snap()}); const h=S.past.pop(); applySnap(h.s); renderTable(); updateUndoUI(); updateSaveBtn(); toast('Undone: '+h.label); }
function redo(){ if(!S.future.length)return; S.past.push({label:'undo',s:snap()}); const f=S.future.pop(); applySnap(f.s); renderTable(); updateUndoUI(); updateSaveBtn(); toast('Redone'); }
function updateUndoUI(){
  $('btn-undo').disabled=!S.past.length; $('btn-redo').disabled=!S.future.length;
  const h=$('undo-hint');
  if(S.past.length||S.future.length){ h.classList.remove('hidden'); $('undo-hint-msg').textContent=`${S.past.length} action${S.past.length!==1?'s':''} in history`; }
  else h.classList.add('hidden');
}
document.addEventListener('keydown',e=>{
  const m=e.ctrlKey||e.metaKey;
  if(m&&!e.shiftKey&&e.key==='z'){e.preventDefault();undo();}
  if(m&&(e.key==='y'||(e.shiftKey&&e.key==='Z'))){e.preventDefault();redo();}
});

/* ── LOOKUP ── */
function getProd(id){ return S.products.find(p=>p.id===id); }
function getVar(vid){ for(const p of S.products){ const v=p.variants.nodes.find(v=>v.id===vid); if(v)return{p,v}; } return{}; }
function ensureC(pid){ if(!S.changes[pid])S.changes[pid]={productId:pid,product:{},variants:{},metafields:[]}; return S.changes[pid]; }
function prodImg(p){ return p.featuredImage?.url||null; }

/* ── FILTER/SEARCH ── */
function flatRows(){ return S.products.flatMap(p=>p.variants.nodes.map(v=>({p,v}))); }
function getFiltered(){
  const terms = S.searchQ ? S.searchQ.split(',').map(t=>t.trim().toLowerCase()).filter(Boolean) : [];
  return flatRows().filter(({p,v})=>{
    const hay=[p.title,p.vendor,(p.tags||[]).join(' '),v.title,v.sku].join(' ').toLowerCase();
    const ms=!terms.length||terms.some(t=>hay.includes(t));
    const mf=S.filter==='all'?true:S.filter==='changed'?!!S.changes[p.id]:p.status===S.filter;
    const mt=!S.tagFilter||(p.tags||[]).includes(S.tagFilter);
    return ms&&mf&&mt;
  });
}

function buildTagFilter(){
  const sel=$('tag-filter'); if(!sel)return;
  const prev=S.tagFilter;
  const tags=[...new Set(S.products.flatMap(p=>p.tags||[]))].sort((a,b)=>a.localeCompare(b));
  sel.innerHTML='<option value="">All tags</option>'+tags.map(t=>`<option value="${esc(t)}"${t===prev?' selected':''}>${esc(t)}</option>`).join('');
  if(!tags.includes(prev)) S.tagFilter='';
}

/* ── RENDER ── */
function renderTable(){
  const rows=getFiltered(); const tbody=$('tbody');
  if(!rows.length){ tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:48px;color:var(--t3)">No products match.</td></tr>'; return; }
  tbody.innerHTML=rows.map(({p,v})=>rowHTML(p,v)).join('');
  updateSaveBtn(); buildSuggestions(); updateBulkBar(); updateExportPreview();
}

function shopifyAdminUrl(gid){
  const numId=gid.split('/').pop();
  return `https://${S.shop}/admin/products/${numId}`;
}
function rowHTML(p,v){
  const dirty=!!S.changes[p.id], sel=S.selectedVids.has(v.id);
  const cls=[dirty?'r-changed':'',sel?'r-selected':''].filter(Boolean).join(' ');
  const imgSrc=prodImg(p);
  const imgCell=imgSrc?`<img class="prod-thumb" src="${esc(imgSrc)}" alt="" loading="lazy">`:`<div class="prod-thumb-ph">□</div>`;
  const stCls={ACTIVE:'ACTIVE',DRAFT:'DRAFT',ARCHIVED:'ARCHIVED'}[p.status]||'DRAFT';
  const stLbl={ACTIVE:'● Active',DRAFT:'○ Draft',ARCHIVED:'⊘ Archived'}[p.status]||p.status;
  const tagsHTML=(p.tags||[]).map(t=>`<span class="tag">${esc(t)}<span class="tag-rm" data-pid="${esc(p.id)}" data-tag="${esc(t)}">×</span></span>`).join('')+`<span class="tag-add" data-pid="${esc(p.id)}">+</span>`;
  const mfHTML=buildMfHTML(p,v);
  const shopUrl=shopifyAdminUrl(p.id);
  return `<tr class="${cls}" data-pid="${esc(p.id)}" data-vid="${esc(v.id)}">
<td><input type="checkbox" class="row-chk" data-vid="${esc(v.id)}" ${sel?'checked':''}></td>
<td>${imgCell}</td>
<td><div class="title-cell"><div class="title-row"><input class="ce${dirty?' dirty':''}" data-pid="${esc(p.id)}" data-field="title" value="${esc(p.title)}"><a class="shopify-link" href="${esc(shopUrl)}" target="_blank" rel="noopener" title="Open in Shopify">↗</a></div><span class="mod-chip">modified</span></div></td>
<td><span class="status-pill ${stCls}" data-pid="${esc(p.id)}">${stLbl}</span></td>
<td><input class="ce" data-pid="${esc(p.id)}" data-field="vendor" value="${esc(p.vendor||'')}"></td>
<td><div class="tags-wrap" id="tw-${esc(p.id)}">${tagsHTML}</div></td>
<td class="v-title">${esc(v.title||'Default')}</td>
<td><input class="ce ce-sku" data-vid="${esc(v.id)}" data-vf="sku" value="${esc(v.sku||'')}"></td>
<td><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vf="price" value="${esc(v.price||'')}"></td>
<td><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vf="compareAtPrice" placeholder="—" value="${esc(v.compareAtPrice||'')}"></td>
<td><div class="mf-cell" id="mf-${esc(v.id)}">${mfHTML}</div></td>
</tr>`;
}

/* ── METAFIELD RENDERING ── */
const MEASUREMENT_UNITS = {
  dimension: ['MILLIMETERS','CENTIMETERS','METERS','INCHES','FEET','YARDS'],
  weight:    ['GRAMS','KILOGRAMS','OUNCES','POUNDS'],
  volume:    ['MILLILITERS','CENTILITERS','LITERS','FLUID_OUNCES','PINTS','GALLONS'],
};
function measureUnits(type){ return MEASUREMENT_UNITS[(type||'').replace(/^list\./,'')]||null; }

function defRow(def, ownerId, currentVal){
  const units = measureUnits(def.type||'');
  const attrs = `data-owner-id="${esc(ownerId)}" data-owner-type="${esc(def.ownerType)}" data-ns="${esc(def.namespace)}" data-key="${esc(def.key)}" data-type="${esc(def.type||'single_line_text_field')}"`;
  if(units){
    let num='', unit=units[0];
    try{ const j=JSON.parse(currentVal); num=j.value??''; unit=j.unit??units[0]; }catch{}
    return `<div class="mf-def-row mf-meas">
      <span class="mf-def-label" title="${esc(def.namespace)}.${esc(def.key)}">${esc(def.name)}</span>
      <div class="mf-meas-wrap">
        <input class="mf-val-inp mf-num" type="number" step="any" placeholder="0" ${attrs} data-mf="measure-num" value="${esc(String(num))}">
        <select class="mf-unit-sel" ${attrs} data-mf="measure-unit">
          ${units.map(u=>`<option value="${u}"${u===unit?' selected':''}>${u.replace(/_/g,' ')}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }
  return `<div class="mf-def-row">
    <span class="mf-def-label" title="${esc(def.namespace)}.${esc(def.key)}">${esc(def.name)}</span>
    <input class="mf-val-inp" placeholder="—" ${attrs} data-mf="smart" value="${esc(currentVal)}">
  </div>`;
}

function buildMfHTML(p, v){
  if(S.mfDefs.length){
    const productDefs  = S.mfDefs.filter(d=>d.ownerType==='PRODUCT');
    const variantDefs  = S.mfDefs.filter(d=>d.ownerType==='PRODUCTVARIANT');
    const html =
      productDefs.map(def  => defRow(def, p.id, p.metafields.nodes.find(m=>m.namespace===def.namespace&&m.key===def.key)?.value??'')).join('') +
      variantDefs.map(def  => defRow(def, v.id, v.metafields.nodes.find(m=>m.namespace===def.namespace&&m.key===def.key)?.value??'')).join('');
    return html || `<span class="mf-empty">No definitions</span>`;
  }
  // Fallback raw mode: show all existing metafields (product + variant) with ns.key labels
  const prodRows = p.metafields.nodes.map(m =>
    defRow({namespace:m.namespace,key:m.key,name:`${m.namespace}.${m.key}`,type:m.type||'single_line_text_field',ownerType:'PRODUCT'}, p.id, m.value||'')
  ).join('');
  const varRows = v.metafields.nodes.map((m,i) => m.key
    ? defRow({namespace:m.namespace,key:m.key,name:`${m.namespace}.${m.key}`,type:m.type||'single_line_text_field',ownerType:'PRODUCTVARIANT'}, v.id, m.value||'')
    : `<div class="mf-row"><input class="mf-inp" placeholder="ns" data-vid="${esc(v.id)}" data-idx="${i}" data-mf="namespace" value="custom"><input class="mf-inp" placeholder="key" data-vid="${esc(v.id)}" data-idx="${i}" data-mf="key" value=""><input class="mf-inp" placeholder="value" data-vid="${esc(v.id)}" data-idx="${i}" data-mf="value" value=""><button class="mf-del" data-vid="${esc(v.id)}" data-idx="${i}">×</button></div>`
  ).join('');
  const rawContent = prodRows + varRows;
  return (rawContent || `<span class="mf-empty">—</span>`) + `<button class="mf-add" data-vid="${esc(v.id)}">+ metafield</button>`;
}

/* ── RESIZABLE COLUMNS ── */
function initColResize(){
  const table=document.querySelector('table'); if(!table)return;
  table.style.tableLayout='fixed';
  const ths=[...document.querySelectorAll('thead th')];
  const widths=[34,44,240,90,110,160,110,100,82,90,220];
  ths.forEach((th,i)=>{
    th.style.width=(widths[i]||100)+'px';
    if(i<2)return;
    const h=document.createElement('div');
    h.className='col-rz';
    th.appendChild(h);
    let x0,w0;
    h.addEventListener('mousedown',e=>{
      e.preventDefault(); x0=e.clientX; w0=th.offsetWidth;
      const mv=e2=>{th.style.width=Math.max(60,w0+e2.clientX-x0)+'px';};
      const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
      document.addEventListener('mousemove',mv);
      document.addEventListener('mouseup',up);
    });
  });
}

/* ── TABLE EVENT DELEGATION ── */
function bindTable(){
  const tbody=$('tbody');
  tbody.addEventListener('change',e=>{
    if(e.target.classList.contains('row-chk')) toggleRowSel(e.target.dataset.vid,e.target.checked);
    if(e.target.dataset.mf==='measure-unit'){ markMfMeasure(e.target); return; }
  });
  tbody.addEventListener('input',e=>{
    const el=e.target;
    if(el.dataset.field){  markProd(el.dataset.pid,el.dataset.field,el.value,el); return; }
    if(el.dataset.vf){     markVar(el.dataset.vid,el.dataset.vf,el.value,el); return; }
    if(el.dataset.mf==='smart'){       markMfSmart(el); return; }
    if(el.dataset.mf==='measure-num'){ markMfMeasure(el); return; }
    if(el.dataset.mf&&el.dataset.mf!=='smart'&&el.dataset.mf!=='measure-num'){ markMfRaw(el); return; }
  });
  tbody.addEventListener('click',e=>{
    const el=e.target;
    if(el.classList.contains('status-pill')){ cycleStatus(el.dataset.pid); return; }
    if(el.classList.contains('tag-rm')){ removeTag(el.dataset.pid,el.dataset.tag); return; }
    if(el.classList.contains('tag-add')){ addTagPrompt(el.dataset.pid); return; }
    if(el.classList.contains('mf-add')){ addMfRaw(el.dataset.vid); return; }
    if(el.classList.contains('mf-del')){ removeMfRaw(el.dataset.vid,+el.dataset.idx); return; }
  });
}

/* ── MARK CHANGES ── */
function addModChip(el){
  el?.closest('tr')?.classList.add('r-changed');
}
function markProd(pid,field,value,el){
  pushH(`Edit ${field}`);
  const p=getProd(pid); if(!p)return;
  p[field]=field==='tags'?value.split(',').map(x=>x.trim()).filter(Boolean):value;
  ensureC(pid).product[field]=p[field];
  if(el){ el.classList.add('dirty'); addModChip(el); }
  updateSaveBtn();
}
function markVar(vid,field,value,el){
  const{p,v}=getVar(vid); if(!p||!v)return;
  pushH(`Edit ${field}`);
  v[field]=value;
  const c=ensureC(p.id);
  if(!c.variants[vid])c.variants[vid]={id:vid};
  c.variants[vid][field]=value;
  if(el){ el.classList.add('dirty'); addModChip(el); }
  updateSaveBtn();
}
function applyMfChange(ownerId, ownerType, ns, key, type, val, dirtyEl){
  pushH(`Edit metafield ${key}`);
  let p, ownerNodes;
  if(ownerType==='PRODUCT'){
    p=getProd(ownerId); if(!p)return;
    ownerNodes=p.metafields.nodes;
  } else {
    const r=getVar(ownerId); p=r.p; if(!p||!r.v)return;
    ownerNodes=r.v.metafields.nodes;
  }
  const existing=ownerNodes.find(m=>m.namespace===ns&&m.key===key);
  if(existing) existing.value=val;
  else ownerNodes.push({namespace:ns,key,type,value:val});
  const c=ensureC(p.id);
  c.metafields=c.metafields.filter(m=>!(m.ownerId===ownerId&&m.namespace===ns&&m.key===key));
  if(val!=='') c.metafields.push({ownerId,namespace:ns,key,type,value:val});
  if(dirtyEl) dirtyEl.classList.add('dirty');
  if(ownerType==='PRODUCT') renderTable();
  else updateSaveBtn();
}
function markMfSmart(el){
  const{ownerId,ownerType,ns,key,type}=el.dataset;
  applyMfChange(ownerId,ownerType,ns,key,type,el.value,el);
}
function markMfMeasure(el){
  const row=el.closest('.mf-meas'); if(!row)return;
  const numEl=row.querySelector('[data-mf="measure-num"]');
  const unitEl=row.querySelector('[data-mf="measure-unit"]');
  const num=parseFloat(numEl.value);
  if(isNaN(num))return;
  const{ownerId,ownerType,ns,key,type}=numEl.dataset;
  applyMfChange(ownerId,ownerType,ns,key,type,JSON.stringify({value:num,unit:unitEl.value}),numEl);
}
function markMfRaw(el){
  const{p,v}=getVar(el.dataset.vid); if(!p||!v)return;
  const idx=+el.dataset.idx;
  pushH('Edit metafield');
  v.metafields.nodes[idx][el.dataset.mf]=el.value;
  const m=v.metafields.nodes[idx];
  const c=ensureC(p.id);
  c.metafields=c.metafields.filter(x=>!(x.ownerId===el.dataset.vid&&x._idx===idx));
  if(m.namespace&&m.key) c.metafields.push({ownerId:el.dataset.vid,namespace:m.namespace,key:m.key,type:m.type||'single_line_text_field',value:String(m.value??''),_idx:idx});
  updateSaveBtn();
}
function cycleStatus(pid){
  const p=getProd(pid); if(!p)return;
  pushH(`Cycle status`);
  const cy={ACTIVE:'DRAFT',DRAFT:'ARCHIVED',ARCHIVED:'ACTIVE'};
  p.status=cy[p.status]||'ACTIVE'; ensureC(pid).product.status=p.status;
  renderTable(); updateSaveBtn();
}
function removeTag(pid,tag){
  const p=getProd(pid); if(!p)return;
  pushH(`Remove tag "${tag}"`);
  p.tags=(p.tags||[]).filter(t=>t!==tag); ensureC(pid).product.tags=[...p.tags];
  rerenderTags(pid,p.tags); updateSaveBtn();
}
function addTagPrompt(pid){
  const cell=$(`tw-${pid}`); if(!cell)return;
  const addBtn=cell.querySelector('.tag-add'); if(!addBtn)return;
  const inp=document.createElement('input');
  inp.className='tag-inp'; inp.placeholder='new tag'; inp.type='text';
  addBtn.replaceWith(inp); inp.focus();
  let done=false;
  function commit(){
    if(done)return; done=true;
    const tag=inp.value.trim(); inp.replaceWith(addBtn);
    if(!tag)return;
    const p=getProd(pid); if(!p)return;
    if((p.tags||[]).includes(tag))return toast('Tag already exists.');
    pushH(`Add tag "${tag}"`);
    p.tags=[...(p.tags||[]),tag]; ensureC(pid).product.tags=[...p.tags];
    rerenderTags(pid,p.tags); updateSaveBtn();
  }
  function cancel(){ if(done)return; done=true; inp.replaceWith(addBtn); }
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape')cancel(); });
  inp.addEventListener('blur',commit);
}
function rerenderTags(pid,tags){
  const cell=$(`tw-${pid}`); if(!cell)return;
  cell.innerHTML=tags.map(t=>`<span class="tag">${esc(t)}<span class="tag-rm" data-pid="${esc(pid)}" data-tag="${esc(t)}">×</span></span>`).join('')+`<span class="tag-add" data-pid="${esc(pid)}">+</span>`;
}
function addMfRaw(vid){
  const{p,v}=getVar(vid); if(!p||!v)return;
  pushH('Add metafield');
  v.metafields.nodes.push({namespace:'custom',key:'',type:'single_line_text_field',value:''});
  const cell=$(`mf-${vid}`); if(cell)cell.innerHTML=buildMfHTML(p,v);
}
function removeMfRaw(vid,idx){
  const{p,v}=getVar(vid); if(!p||!v)return;
  pushH('Remove metafield');
  v.metafields.nodes.splice(idx,1);
  const c=ensureC(p.id); c.metafields=c.metafields.filter(x=>!(x.ownerId===vid&&x._idx===idx));
  const cell=$(`mf-${vid}`); if(cell)cell.innerHTML=buildMfHTML(p,v);
  updateSaveBtn();
}

/* ── ROW SELECTION ── */
function toggleRowSel(vid,checked){
  checked?S.selectedVids.add(vid):S.selectedVids.delete(vid);
  updateBulkBar();
  const row=document.querySelector(`tr[data-vid="${vid}"]`);
  if(row)row.classList.toggle('r-selected',checked);
}
function toggleAll(checked){ document.querySelectorAll('.row-chk').forEach(cb=>{cb.checked=checked;toggleRowSel(cb.dataset.vid,checked);}); }
function updateBulkBar(){
  const n=S.selectedVids.size;
  $('bulk-bar').classList.toggle('hidden',n===0);
  $('bulk-lbl').textContent=`${n} selected`;
}
function getSelPids(){ const ids=new Set(); S.selectedVids.forEach(vid=>{const{p}=getVar(vid);if(p)ids.add(p.id);}); return[...ids]; }

/* ── SAVE BUTTON ── */
function updateSaveBtn(){
  const n=Object.keys(S.changes).length;
  $('btn-save').disabled=!n; $('save-count').textContent=n;
  if(n){
    setStatus(`${n} unsaved change${n!==1?'s':''}`, 'dirty');
    Object.keys(S.changes).forEach(pid=>{
      document.querySelectorAll(`tr[data-pid="${pid}"]`).forEach(tr=>tr.classList.add('r-changed'));
    });
  }else{
    setStatus('Ready','ready');
  }
}

/* ── BULK MODAL ── */
function openBulkModal(type){
  S.bulkType=type;
  const n=S.selectedVids.size;
  $('m-bulk-title').textContent={status:'Change Status',price:'Change Prices',tags:'Edit Tags',metafield:'Edit Metafields',collections:'Add / Remove Collection'}[type]||'Bulk action';
  $('m-bulk-sub').textContent=`Applied to ${n} selected variant${n!==1?'s':''}`;
  const body=$('m-bulk-body');
  if(type==='status'){
    body.innerHTML=`<div class="bulk-field"><label>New status</label><select id="bv-status"><option value="ACTIVE">● Active</option><option value="DRAFT">○ Draft</option><option value="ARCHIVED">⊘ Archived</option></select></div>`;
  }else if(type==='price'){
    body.innerHTML=`<div class="bulk-field"><label>New price</label><input id="bv-price" type="number" step=".01" min="0" placeholder="0.00" autofocus></div>`;
  }else if(type==='tags'){
    body.innerHTML=`<div class="bulk-field"><label>Tag</label><div class="tag-with-action"><input id="bv-tag" type="text" placeholder="e.g. sale" autofocus><select id="bv-tag-action"><option value="add">Add</option><option value="remove">Remove</option></select></div></div>`;
  }else if(type==='metafield'){
    if(S.mfDefs.length){
      const opts=S.mfDefs.map(d=>`<option value="${esc(d.namespace)}|${esc(d.key)}|${esc(d.type||'single_line_text_field')}|${esc(d.ownerType||'PRODUCTVARIANT')}">${esc(d.name)}${d.ownerType==='PRODUCT'?' (product)':''}</option>`).join('');
      body.innerHTML=`<div class="bulk-field"><label>Metafield</label><select id="bv-mf-def"><option value="">Select metafield…</option>${opts}</select></div><div id="bv-mf-val-wrap" class="bulk-field"><label>Value</label><input id="bv-mf-val" type="text" placeholder="Value"></div>`;
      body.querySelector('#bv-mf-def').addEventListener('change',e=>{
        const parts=e.target.value.split('|'); const mftype=parts[2]||'';
        const units=measureUnits(mftype); const wrap=$('bv-mf-val-wrap');
        if(!wrap)return;
        if(units){
          wrap.innerHTML=`<label>Value</label><div class="mf-meas-wrap"><input id="bv-mf-num" type="number" step="any" placeholder="0" class="mf-num" style="border:1px solid var(--b1);border-radius:var(--r4);padding:3px 8px;font-size:13px"><select id="bv-mf-unit" class="mf-unit-sel">${units.map(u=>`<option value="${u}">${u.replace(/_/g,' ')}</option>`).join('')}</select></div>`;
        }else{
          wrap.innerHTML=`<label>Value</label><input id="bv-mf-val" type="text" placeholder="Value">`;
        }
      });
    }else{
      body.innerHTML=`<div class="bulk-field"><label>Namespace</label><input id="bv-mf-ns" type="text" value="custom"></div><div class="bulk-field"><label>Key</label><input id="bv-mf-key" type="text" placeholder="e.g. material" autofocus></div><div class="bulk-field"><label>Value</label><input id="bv-mf-val" type="text" placeholder="Value"></div>`;
    }
  }
  openModal('m-bulk');
  setTimeout(()=>body.querySelector('input,select')?.focus(),60);
}

function applyBulkModal(){
  const type=S.bulkType;
  if(type==='status'){
    const val=$('bv-status').value; const pids=getSelPids(); if(!pids.length)return;
    pushH(`Bulk status → ${val}`);
    pids.forEach(pid=>{const p=getProd(pid);if(!p)return;p.status=val;ensureC(pid).product.status=val;});
    renderTable(); updateSaveBtn(); toast(`Status set on ${pids.length} products.`);
  }else if(type==='price'){
    const val=$('bv-price')?.value; const n=Number(val);
    if(!val||isNaN(n)||n<0)return toast('Enter a valid price.');
    const vids=[...S.selectedVids];
    pushH(`Bulk price → ${n.toFixed(2)}`);
    vids.forEach(vid=>{const{p,v}=getVar(vid);if(!p||!v)return;v.price=n.toFixed(2);const c=ensureC(p.id);if(!c.variants[vid])c.variants[vid]={id:vid};c.variants[vid].price=v.price;});
    renderTable(); updateSaveBtn(); toast(`Price set on ${vids.length} variants.`);
  }else if(type==='tags'){
    const tag=$('bv-tag')?.value.trim(); const action=$('bv-tag-action')?.value;
    if(!tag)return toast('Enter a tag.');
    const pids=getSelPids();
    pushH(`Bulk ${action} tag "${tag}"`);
    pids.forEach(pid=>{const p=getProd(pid);if(!p)return;if(action==='add'){if(!p.tags.includes(tag))p.tags.push(tag);}else p.tags=p.tags.filter(t=>t!==tag);ensureC(pid).product.tags=[...p.tags];});
    renderTable(); updateSaveBtn(); toast(`Tag "${tag}" ${action==='add'?'added to':'removed from'} ${pids.length} products.`);
  }else if(type==='metafield'){
    let ns,key,mftype,ownerType,val;
    if(S.mfDefs.length){
      const sel=$('bv-mf-def')?.value; if(!sel)return toast('Select a metafield.');
      [ns,key,mftype,ownerType]=sel.split('|');
      ownerType=ownerType||'PRODUCTVARIANT';
      // measurement type: read num+unit inputs
      if($('bv-mf-num')){
        const num=parseFloat($('bv-mf-num').value);
        if(isNaN(num))return toast('Enter a valid number.');
        val=JSON.stringify({value:num,unit:$('bv-mf-unit').value});
      }else{
        val=$('bv-mf-val')?.value??'';
      }
    }else{
      ns=$('bv-mf-ns')?.value.trim()||'custom'; key=$('bv-mf-key')?.value.trim();
      mftype='single_line_text_field'; ownerType='PRODUCTVARIANT';
      val=$('bv-mf-val')?.value??'';
      if(!key)return toast('Enter a key.');
    }
    pushH(`Bulk metafield ${key}`);
    if(ownerType==='PRODUCT'){
      const pids=[...new Set([...S.selectedVids].map(vid=>getVar(vid).p?.id).filter(Boolean))];
      pids.forEach(pid=>{
        const p=getProd(pid); if(!p)return;
        const ex=p.metafields.nodes.findIndex(m=>m.namespace===ns&&m.key===key);
        if(ex>=0) p.metafields.nodes[ex].value=val;
        else p.metafields.nodes.push({namespace:ns,key,type:mftype,value:val});
        const c=ensureC(pid);
        c.metafields=c.metafields.filter(m=>!(m.ownerId===pid&&m.namespace===ns&&m.key===key));
        if(val!=='') c.metafields.push({ownerId:pid,namespace:ns,key,type:mftype,value:val});
      });
      renderTable(); updateSaveBtn(); toast(`Metafield "${key}" set on ${pids.length} products.`);
    }else{
      const vids=[...S.selectedVids];
      vids.forEach(vid=>{
        const{p,v}=getVar(vid);if(!p||!v)return;
        const ex=v.metafields.nodes.findIndex(m=>m.namespace===ns&&m.key===key);
        if(ex>=0)v.metafields.nodes[ex].value=val;
        else v.metafields.nodes.push({namespace:ns,key,type:mftype,value:val});
        const c=ensureC(p.id);
        c.metafields=c.metafields.filter(m=>!(m.ownerId===vid&&m.namespace===ns&&m.key===key));
        if(val!=='')c.metafields.push({ownerId:vid,namespace:ns,key,type:mftype,value:val});
      });
      renderTable(); updateSaveBtn(); toast(`Metafield "${key}" set on ${vids.length} variants.`);
    }
  }
  closeModal('m-bulk');
}

/* ── COLLECTIONS ── */
async function openCollModal(){
  const pids=getSelPids(); if(!pids.length)return toast('Select products first.');
  $('m-coll-sub').textContent=`${pids.length} product${pids.length!==1?'s':''} selected`;
  $('coll-prods').innerHTML=pids.map(pid=>{const p=getProd(pid);return p?`<div class="coll-prod-item">${esc(p.title)}</div>`:''}).join('');
  openModal('m-coll');
  if(S.demo){
    $('coll-loading').textContent='';
    $('coll-select').innerHTML='<option value="">Not available in demo mode</option>';
    return;
  }
  if(!S.collsCache){
    $('coll-loading').textContent='(loading…)';
    $('coll-select').innerHTML='<option value="">Loading…</option>';
    try{
      const r=await api('/api/collections',{first:100});
      S.collsCache=r.collections;
    }catch(e){ $('coll-loading').textContent=''; $('coll-select').innerHTML='<option value="">Failed to load</option>'; toast('Could not load collections: '+e.message); return; }
  }
  $('coll-loading').textContent='';
  $('coll-select').innerHTML=!S.collsCache.length
    ?'<option value="">No collections found</option>'
    :'<option value="">Select a collection…</option>'+S.collsCache.map(c=>`<option value="${esc(c.id)}">${esc(c.title)} (${c.productsCount?.count??'?'})</option>`).join('');
}

async function confirmColl(){
  const collId=$('coll-select').value; const action=$('coll-action').value;
  if(!collId)return toast('Select a collection.');
  const pids=getSelPids(); if(!pids.length)return;
  const btn=$('m-coll-confirm'); btn.disabled=true; btn.textContent='Saving…';
  try{
    const path=action==='add'?'/api/collection-add':'/api/collection-remove';
    await api(path,{collectionId:collId,productIds:pids});
    const name=S.collsCache?.find(c=>c.id===collId)?.title||'collection';
    toast(`${pids.length} product${pids.length!==1?'s':''} ${action==='add'?'added to':'removed from'} "${name}".`);
    closeModal('m-coll');
  }catch(e){ toast(e.message); }
  finally{ btn.disabled=false; btn.textContent='Apply →'; }
}

/* ── REVIEW & SAVE ── */
function openSaveModal(){
  const payloads=Object.values(S.changes); if(!payloads.length)return toast('No changes to save.');
  $('m-save-sub').textContent=`${payloads.length} product${payloads.length!==1?'s':''} with pending changes`;
  const list=$('m-save-diff');
  list.innerHTML=payloads.map(c=>{
    const p=getProd(c.productId); if(!p)return'';
    const img=prodImg(p);
    const imgEl=img?`<img class="diff-thumb" src="${esc(img)}" alt="">`:`<div class="diff-thumb-ph">□</div>`;
    const orig=S.originals.find(x=>x.id===c.productId);
    const diffs=[];
    Object.entries(c.product||{}).forEach(([field,newVal])=>{
      const oldVal=orig?orig[field]:'?';
      const oldStr=Array.isArray(oldVal)?oldVal.join(', '):String(oldVal??'');
      const newStr=Array.isArray(newVal)?newVal.join(', '):String(newVal??'');
      if(oldStr!==newStr)diffs.push(`<div class="diff-row"><span class="diff-field">${esc(field)}</span><span class="diff-old">${esc(oldStr||'—')}</span><span class="diff-arr">→</span><span class="diff-new">${esc(newStr)}</span></div>`);
    });
    Object.values(c.variants||{}).forEach(v=>{
      const origV=orig?.variants?.nodes?.find(x=>x.id===v.id);
      const vLbl=p.variants.nodes.find(x=>x.id===v.id)?.title||'variant';
      ['price','compareAtPrice','sku'].forEach(field=>{
        if(v[field]!==undefined){const old=origV?String(origV[field]??''):'?';const nw=String(v[field]??'');if(old!==nw)diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl)} ${esc(field)}</span><span class="diff-old">${esc(old||'—')}</span><span class="diff-arr">→</span><span class="diff-new">${esc(nw)}</span></div>`);}
      });
    });
    if((c.metafields||[]).length)diffs.push(`<div class="diff-row"><span class="diff-field">metafields</span><span class="diff-new">${c.metafields.length} change${c.metafields.length!==1?'s':''}</span></div>`);
    return `<div class="diff-item"><div class="diff-item-head">${imgEl}<span class="diff-title">${esc(p.title)}</span></div><div class="diff-rows">${diffs.length?diffs.join(''):'<span style="font-size:11px;color:var(--t3)">Variant / metafield changes</span>'}</div></div>`;
  }).join('');
  openModal('m-save');
}

async function confirmSave(){
  const payloads=Object.values(S.changes); if(!payloads.length)return;
  const btn=$('m-save-confirm'); btn.disabled=true;
  setStatus('Saving…','saving');
  try{
    if(S.demo){ await delay(600); }
    else{ for(const c of payloads){
      const mf=(c.metafields||[]).map(({_idx,...rest})=>rest);
      await api('/api/save-product',{productId:c.productId,product:c.product,variants:Object.values(c.variants||{}),metafields:mf});
    }}
    const recap=buildRecap(payloads);
    const n=payloads.length;
    S.changes={}; S.past=[]; S.future=[];
    S.originals=clone(S.products);
    document.querySelectorAll('.dirty').forEach(el=>el.classList.remove('dirty'));
    closeModal('m-save'); renderTable(); updateSaveBtn(); updateUndoUI();
    toast(`${n} product${n!==1?'s':''} saved.`);
    setStatus('All changes saved','saved');
    setTimeout(()=>setStatus('Ready','ready'),3000);
    dlText(recap,`bulkedit-recap-${Date.now()}.txt`);
  }catch(e){ toast(e.message); setStatus('Save failed','dirty'); }
  finally{ btn.disabled=false; }
}

function buildRecap(payloads){
  const lines=['BulkEdit — Change recap',`Generated: ${new Date().toLocaleString()}`,''];
  payloads.forEach(c=>{
    const p=getProd(c.productId); if(!p)return;
    lines.push(`Product: ${p.title}`);
    const orig=S.originals.find(x=>x.id===c.productId);
    Object.entries(c.product||{}).forEach(([field,newVal])=>{
      const oldVal=orig?orig[field]:'?';
      const oldStr=Array.isArray(oldVal)?oldVal.join(', '):String(oldVal??'');
      const newStr=Array.isArray(newVal)?newVal.join(', '):String(newVal??'');
      if(oldStr!==newStr)lines.push(`  ${field}: "${oldStr}" → "${newStr}"`);
    });
    Object.values(c.variants||{}).forEach(v=>{
      const origV=orig?.variants?.nodes?.find(x=>x.id===v.id);
      const vLbl=p.variants.nodes.find(x=>x.id===v.id)?.title||v.id;
      ['price','compareAtPrice','sku'].forEach(field=>{
        if(v[field]!==undefined){const old=origV?String(origV[field]??''):'?';const nw=String(v[field]??'');if(old!==nw)lines.push(`  ${vLbl} ${field}: "${old}" → "${nw}"`);}
      });
    });
    if((c.metafields||[]).length)lines.push(`  metafields: ${c.metafields.length} change${c.metafields.length!==1?'s':''}`);
    lines.push('');
  });
  return lines.join('\n');
}

function dlText(text,filename){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'})); a.download=filename; a.click(); }
function manualRecap(){ dlText(buildRecap(Object.values(S.changes)),`bulkedit-recap-${Date.now()}.txt`); }

/* ── SCHEDULES (server-side) ── */
function updateSchedBadge(){
  const n=(S.schedules||[]).filter(s=>s.status==='pending').length;
  const btn=$('btn-schedule'); if(!btn)return;
  btn.textContent=n?`Scheduled (${n})`:'Schedule edit';
}

async function loadSchedules(){
  if(S.demo){S.schedules=[];return;}
  try{ const r=await api('/api/schedule/list',{}); S.schedules=r.schedules||[]; }
  catch{ S.schedules=[]; }
  updateSchedBadge();
}

function openScheduleModal(){
  const hasChanges=Object.keys(S.changes).length>0;
  if(hasChanges){
    // Show create form
    $('m-sched-create').style.display='';
    $('m-sched-jobs').style.display='none';
    $('m-sched-confirm').style.display='';
    $('m-bulk-title2').textContent='Schedule edit';
    $('m-sched-sub').textContent=`${Object.keys(S.changes).length} product${Object.keys(S.changes).length!==1?'s':''} with staged changes`;
    $('m-sched-label').value='';
    $('m-sched-email').value='';
    $('m-sched-revert-toggle').checked=false;
    $('m-sched-revert-dt').style.display='none';
    $('m-sched-revert-hint').style.display='none';
    const d=new Date(); d.setHours(d.getHours()+1,0,0,0);
    $('m-sched-dt').value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    $('m-sched-preview').innerHTML=Object.values(S.changes).map(c=>{
      const prod=getProd(c.productId);
      const title=prod?.title||c.productId;
      const img=prod?.featuredImage?.url||'';
      const parts=[];
      const fields=Object.keys(c.product||{});
      if(fields.length)parts.push(fields.join(', '));
      const varCount=Object.keys(c.variants||{}).length;
      if(varCount)parts.push(`${varCount} variant${varCount!==1?'s':''}`);
      const mfCount=(c.metafields||[]).length;
      if(mfCount)parts.push(`${mfCount} metafield${mfCount!==1?'s':''}`);
      const imgEl=img
        ?`<img src="${esc(img)}" style="width:32px;height:32px;border-radius:5px;object-fit:cover;flex-shrink:0;border:1px solid var(--b1)" alt=""/>`
        :`<div style="width:32px;height:32px;border-radius:5px;background:var(--s3);flex-shrink:0"></div>`;
      return `<div class="sched-prev-row">${imgEl}<span class="sched-prod">${esc(title)}</span><span class="sched-fields">${esc(parts.join(' · ')||'—')}</span></div>`;
    }).join('');
  } else {
    // No staged changes — show jobs list
    $('m-sched-create').style.display='none';
    $('m-sched-jobs').style.display='';
    $('m-sched-confirm').style.display='none';
    $('m-bulk-title2').textContent='Scheduled jobs';
    $('m-sched-sub').textContent=S.shop;
    renderSchedJobsList();
  }
  openModal('m-sched');
}

function buildRevertChanges(){
  return Object.values(S.changes).map(c=>{
    const orig=S.originals.find(p=>p.id===c.productId); if(!orig)return null;
    const productRevert={};
    Object.keys(c.product||{}).forEach(field=>{ productRevert[field]=orig[field]; });
    const variantsRevert={};
    Object.entries(c.variants||{}).forEach(([vid,v])=>{
      const origV=orig.variants?.nodes?.find(x=>x.id===vid); if(!origV)return;
      const rv={id:vid};
      ['price','compareAtPrice','sku'].forEach(f=>{ if(v[f]!==undefined)rv[f]=origV[f]??''; });
      variantsRevert[vid]=rv;
    });
    const metafieldsRevert=(c.metafields||[]).map(mf=>{
      let origVal='';
      if(mf.ownerId===c.productId){
        origVal=orig.metafields?.nodes?.find(m=>m.namespace===mf.namespace&&m.key===mf.key)?.value??'';
      } else {
        const origV=orig.variants?.nodes?.find(v=>v.id===mf.ownerId);
        origVal=origV?.metafields?.nodes?.find(m=>m.namespace===mf.namespace&&m.key===mf.key)?.value??'';
      }
      return{...mf,value:origVal};
    });
    return{productId:c.productId,product:productRevert,variants:variantsRevert,metafields:metafieldsRevert};
  }).filter(Boolean);
}

async function confirmSchedule(){
  const dtVal=$('m-sched-dt').value;
  if(!dtVal)return toast('Select a date and time.');
  const scheduledFor=new Date(dtVal);
  if(isNaN(scheduledFor.getTime()))return toast('Invalid date.');
  if(scheduledFor<=new Date())return toast('Scheduled time must be in the future.');

  const revertEnabled=$('m-sched-revert-toggle')?.checked;
  const revertDtVal=$('m-sched-revert-dt')?.value;
  let revertAt=null;
  if(revertEnabled){
    if(!revertDtVal)return toast('Select a revert time.');
    revertAt=new Date(revertDtVal);
    if(isNaN(revertAt.getTime()))return toast('Invalid revert time.');
    if(revertAt<=scheduledFor)return toast('Revert time must be after the schedule time.');
  }

  const label=$('m-sched-label').value.trim();
  if(!label) return toast('Add a label — e.g. "Black Friday sale".');
  const btn=$('m-sched-confirm'); btn.disabled=true; btn.textContent='Scheduling…';
  try{
    const notifyEmail=($('m-sched-email')?.value||'').trim()||undefined;

    // Enrich changes with product title + original values (for before/after email)
    const changesWithMeta=Object.values(S.changes).map(c=>{
      const prod=getProd(c.productId);
      const orig=S.originals.find(p=>p.id===c.productId);
      const before={};
      if(orig) Object.keys(c.product||{}).forEach(f=>{ before[f]=orig[f]; });
      const variantsBefore={};
      if(orig) Object.keys(c.variants||{}).forEach(varId=>{
        const ov=(orig.variants?.nodes||[]).find(v=>v.id===varId);
        if(ov) variantsBefore[varId]={title:ov.title,price:ov.price,compareAtPrice:ov.compareAtPrice};
      });
      return{...c, productTitle:prod?.title||'', productImage:prod?.featuredImage?.url||'', before, variantsBefore};
    });

    const r=await api('/api/schedule/create',{
      scheduledFor:scheduledFor.toISOString(),
      label:label||undefined,
      changes:changesWithMeta,
      notifyEmail,
    });
    S.schedules=[r.schedule,...(S.schedules||[])];

    if(revertAt){
      const revertChanges=buildRevertChanges();
      if(revertChanges.length){
        // Add before values (= what the main schedule will set) for the revert email
        const revertWithMeta=revertChanges.map(c=>{
          const prod=getProd(c.productId);
          const staged=S.changes[c.productId];
          const before={};
          if(staged) Object.keys(c.product||{}).forEach(f=>{ before[f]=staged.product?.[f]; });
          const variantsBefore={};
          if(staged) Object.keys(c.variants||{}).forEach(varId=>{
            const sv=staged.variants?.[varId];
            const ov=(S.originals.find(p=>p.id===c.productId)?.variants?.nodes||[]).find(v=>v.id===varId);
            if(sv) variantsBefore[varId]={title:ov?.title||'',price:sv.price,compareAtPrice:sv.compareAtPrice};
          });
          return{...c, productTitle:prod?.title||'', productImage:prod?.featuredImage?.url||'', before, variantsBefore};
        });
        const r2=await api('/api/schedule/create',{
          scheduledFor:revertAt.toISOString(),
          label:(label?`↩ ${label}`:'↩ Revert'),
          changes:revertWithMeta,
          linkedTo:r.schedule.id,
          notifyEmail,
        });
        S.schedules=[r2.schedule,...S.schedules];
      }
    }

    updateSchedBadge();
    S.changes={}; S.past=[]; S.future=[];
    S.originals=clone(S.products);
    closeModal('m-sched');
    renderTable(); updateSaveBtn(); updateUndoUI();
    document.querySelectorAll('.dirty').forEach(el=>el.classList.remove('dirty'));
    const msg=revertAt?`Scheduled for ${scheduledFor.toLocaleString()} · reverts at ${revertAt.toLocaleString()}.`:`Scheduled for ${scheduledFor.toLocaleString()}.`;
    toast(msg);
  }catch(e){ toast(e.message); }
  finally{ btn.disabled=false; btn.textContent='Schedule →'; }
}

let _schedTab='pending';
function schedRowHTML(s){
  const dt=new Date(s.scheduledFor).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  const n=s.changes.length;
  const overdue=s.status==='pending'&&new Date(s.scheduledFor)<new Date();
  const sCls={pending:overdue?'sched-overdue':'sched-pending',executed:'sched-done',failed:'sched-fail',running:'sched-running',cancelled:'sched-cancelled'}[s.status]||'';
  const sLbl={pending:overdue?'Overdue':'Pending',executed:'Done',failed:'Failed',running:'Running',cancelled:'Cancelled'}[s.status]||s.status;
  const isRevert=!!s.linkedTo;
  const btns=s.status==='pending'
    ?`<button class="btn-ghost xs" data-sched-run="${s.id}">Run now</button><button class="btn-ghost xs" data-sched-cancel="${s.id}">Cancel</button>`
    :['failed','cancelled'].includes(s.status)?`<button class="btn-ghost xs" data-sched-retry="${s.id}">Retry</button>`:'';
  const firstImg=(s.changes||[]).reduce((acc,c)=>acc||(c.productImage||getProd(c.productId)?.featuredImage?.url||''),'');
  const imgBlock=firstImg
    ?`<img src="${esc(firstImg)}" style="width:36px;height:36px;border-radius:7px;object-fit:cover;border:1px solid var(--b1);flex-shrink:0" alt=""/>`
    :`<div style="width:36px;height:36px;border-radius:7px;background:var(--s3);flex-shrink:0"></div>`;
  return `<div class="sched-row${isRevert?' sched-revert':''}"><div style="flex-shrink:0;margin-right:10px">${imgBlock}</div><div class="sched-info"><span class="sched-lbl">${esc(s.label)}</span><span class="sched-dt">${esc(dt)} · ${n} product${n!==1?'s':''}</span>${s.error?`<span class="sched-err">${esc(s.error)}</span>`:''}</div><span class="sched-status ${sCls}">${sLbl}</span><div class="sched-btns">${btns}</div></div>`;
}

function renderSchedTabs(all){
  const pending=all.filter(s=>['pending','running','failed'].includes(s.status));
  const done=all.filter(s=>['executed','cancelled'].includes(s.status));
  const list=_schedTab==='pending'?pending:done;
  const body=$('m-sched-jobs'); if(!body)return;
  const tabsHTML=`<div class="sched-tabs">
    <button class="sched-tab${_schedTab==='pending'?' active':''}" data-sched-tab="pending">Pending${pending.length?` <span class="sched-tab-count">${pending.length}</span>`:''}</button>
    <button class="sched-tab${_schedTab==='done'?' active':''}" data-sched-tab="done">Done${done.length?` <span class="sched-tab-count">${done.length}</span>`:''}</button>
  </div>`;
  const listHTML=list.length
    ?list.map(schedRowHTML).join('')
    :`<p class="sched-empty">${_schedTab==='pending'?'No pending schedules.':'No completed schedules yet.'}</p>`;
  body.innerHTML=tabsHTML+`<div class="sched-list-inner">${listHTML}</div>`;
}

async function renderSchedJobsList(){
  const body=$('m-sched-jobs'); if(!body)return;
  body.innerHTML='<p class="sched-empty">Loading…</p>';
  try{
    const r=await api('/api/schedule/list',{});
    S.schedules=r.schedules||[];
    updateSchedBadge();
    renderSchedTabs(S.schedules);
  }catch(e){ body.innerHTML=`<p class="sched-empty" style="color:var(--red)">${esc(e.message)}</p>`; }
}

/* ── SEARCH ── */
function buildSuggestions(){
  const q=S.searchQ; const box=$('search-suggest');
  if(!q){box.classList.remove('open');return;}
  const all=[...new Set(flatRows().flatMap(({p,v})=>[p.title,p.vendor,v.sku,...(p.tags||[])]).filter(Boolean))];
  const hits=all.filter(x=>x.toLowerCase().includes(q.split(',')[0].trim().toLowerCase())).slice(0,6);
  if(!hits.length){box.classList.remove('open');return;}
  const re=new RegExp(`(${q.split(',')[0].trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  box.innerHTML=hits.map(h=>`<div class="suggest-item" data-val="${esc(h)}">${esc(h).replace(re,'<mark>$1</mark>')}</div>`).join('');
  box.classList.add('open');
}

/* ── FILTER ── */
function setFilter(f){ S.filter=f; document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b.dataset.f===f)); renderTable(); }

/* ── TABS ── */
function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));
  if(name==='export')updateExportPreview();
}

/* ── EXPORT ── */
const EX_ALL=['id','title','status','vendor','tags','variant','sku','price','compareAtPrice','inventoryQuantity'];
const EX_LBL={id:'ID',title:'Title',status:'Status',vendor:'Vendor',tags:'Tags',variant:'Variant',sku:'SKU',price:'Price',compareAtPrice:'Compare at',inventoryQuantity:'Inventory'};
function initExportFields(){
  const el=$('export-field-list'); if(!el)return;
  el.innerHTML=EX_ALL.map(f=>`<label class="field-chip${S.exportFields.includes(f)?' on':''}"><input type="checkbox" data-ef="${f}" ${S.exportFields.includes(f)?'checked':''}>${EX_LBL[f]||f}</label>`).join('');
  el.querySelectorAll('input[data-ef]').forEach(cb=>cb.addEventListener('change',()=>{const f=cb.dataset.ef;if(cb.checked){if(!S.exportFields.includes(f))S.exportFields.push(f);}else S.exportFields=S.exportFields.filter(x=>x!==f);cb.closest('.field-chip').classList.toggle('on',cb.checked);updateExportPreview();}));
  updateExportPreview();
}
function exVal(p,v,f){
  if(f==='tags')return(p.tags||[]).join('|');if(f==='variant')return v.title||'Default';
  if(f==='sku')return v.sku||'';if(f==='price')return v.price||'';
  if(f==='compareAtPrice')return v.compareAtPrice||'';if(f==='inventoryQuantity')return String(v.inventoryQuantity??'');
  return String(p[f]??'');
}
function buildCSV(){ return[S.exportFields.join(','),...flatRows().map(({p,v})=>S.exportFields.map(f=>{const val=exVal(p,v,f);return val.includes(',')||val.includes('"')?`"${val.replace(/"/g,'""')}"`:`${val}`;}).join(','))].join('\n'); }
function buildJSON(){ return JSON.stringify(flatRows().map(({p,v})=>{const o={};S.exportFields.forEach(f=>o[f]=exVal(p,v,f));return o;}),null,2); }
function updateExportPreview(){
  const pre=$('export-preview'); if(!pre)return;
  const rows=flatRows().slice(0,3);
  pre.textContent=[S.exportFields.join(','),...rows.map(({p,v})=>S.exportFields.map(f=>{const val=exVal(p,v,f);return val.includes(',')?`"${val}"`:val;}).join(','))].join('\n')+(flatRows().length>3?`\n… (${flatRows().length} total rows)`:'');
}

/* ── BOOT ── */
function boot(){
  // Connect
  $('btn-connect').addEventListener('click', startOAuth);
  $('f-shop').addEventListener('keydown', e=>{ if(e.key==='Enter') startOAuth(); });
  $('btn-demo').addEventListener('click', loadDemoMode);
  $('btn-demo-exit').addEventListener('click', disconnect);

  // Topbar
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-save').addEventListener('click', openSaveModal);
  $('btn-refresh').addEventListener('click', ()=>{ if(!S.demo) Promise.all([loadMfDefs(), loadProducts(S.searchQ)]); });

  // Search
  $('search').addEventListener('input', e=>{
    S.searchQ=e.target.value.trim(); renderTable();
    if(!S.demo){
      clearTimeout(window._srt);
      if(S.searchQ.length>2)      window._srt=setTimeout(()=>loadProducts(S.searchQ),400);
      else if(S.searchQ.length===0) loadProducts('');
    }
  });
  $('search').addEventListener('focus',()=>{ if(S.searchQ)buildSuggestions(); });
  $('search-suggest').addEventListener('mousedown',e=>{ const item=e.target.closest('.suggest-item'); if(!item)return; $('search').value=item.dataset.val; S.searchQ=item.dataset.val.toLowerCase(); $('search-suggest').classList.remove('open'); renderTable(); });
  document.addEventListener('click',e=>{ if(!e.target.closest('.search-box'))$('search-suggest').classList.remove('open'); });

  // Filters
  document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>setFilter(btn.dataset.f)));
  $('tag-filter').addEventListener('change', e=>{
    S.tagFilter=e.target.value;
    $('tag-filter').classList.toggle('active', !!S.tagFilter);
    renderTable();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));

  // Select all
  $('chk-all').addEventListener('change',e=>toggleAll(e.target.checked));

  // Undo hint
  $('undo-hint-undo').addEventListener('click', undo);
  $('undo-hint-redo').addEventListener('click', redo);

  // Bulk
  $('bulk-status-btn').addEventListener('click', ()=>openBulkModal('status'));
  $('bulk-price-btn').addEventListener('click',  ()=>openBulkModal('price'));
  $('bulk-tags-btn').addEventListener('click',   ()=>openBulkModal('tags'));
  $('bulk-mf-btn').addEventListener('click',     ()=>openBulkModal('metafield'));
  $('bulk-coll-btn').addEventListener('click',   ()=>openCollModal());

  // Bulk modal
  $('m-bulk-apply').addEventListener('click', applyBulkModal);

  // Save modal
  $('m-save-confirm').addEventListener('click', confirmSave);
  $('btn-dl-recap').addEventListener('click', manualRecap);

  // Collections modal
  $('m-coll-confirm').addEventListener('click', confirmColl);

  // Export
  $('btn-dl-csv').addEventListener('click',  ()=>{ dlText(buildCSV(),`shopify-export-${Date.now()}.csv`); toast('CSV downloaded.'); });
  $('btn-dl-json').addEventListener('click', ()=>{ dlText(buildJSON(),`shopify-export-${Date.now()}.json`); toast('JSON downloaded.'); });
  $('btn-copy-csv').addEventListener('click',()=>{ navigator.clipboard?.writeText(buildCSV()).then(()=>toast('CSV copied.')).catch(()=>toast('Clipboard not available.')); });

  // Feedback
  $('btn-feedback').addEventListener('click', ()=>{
    $('fb-message').value=''; $('fb-email').value='';
    openModal('m-feedback');
  });
  $('fb-submit').addEventListener('click', async ()=>{
    const message=$('fb-message').value.trim();
    if(!message) return toast('Write something — even one line helps.');
    const email=($('fb-email').value||'').trim();
    const btn=$('fb-submit'); btn.disabled=true; btn.textContent='Sending…';
    try{
      await api('/api/feedback',{message,email:email||undefined});
      closeModal('m-feedback');
      toast('Thanks for the feedback! It really helps.');
    }catch(e){ toast(e.message); }
    btn.disabled=false; btn.textContent='Send feedback →';
  });

  // Schedule
  $('btn-schedule').addEventListener('click', openScheduleModal);
  $('m-sched-confirm').addEventListener('click', confirmSchedule);
  $('m-sched-revert-toggle').addEventListener('change', e=>{
    const on=e.target.checked;
    $('m-sched-revert-dt').style.display=on?'':'none';
    $('m-sched-revert-hint').style.display=on?'':'none';
    if(on && $('m-sched-dt').value){
      // Default revert time: apply time + 3 hours
      const base=new Date($('m-sched-dt').value);
      base.setHours(base.getHours()+3);
      $('m-sched-revert-dt').value=new Date(base-base.getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
  });
  $('m-sched-jobs').addEventListener('click', async e=>{
    if(e.target.dataset.schedTab){ _schedTab=e.target.dataset.schedTab; renderSchedTabs(S.schedules); return; }
    const id=e.target.dataset.schedRun||e.target.dataset.schedCancel||e.target.dataset.schedRetry;
    if(!id)return;
    const btn=e.target; btn.disabled=true;
    try{
      if(e.target.dataset.schedRun){
        await api('/api/schedule/run',{id});
      } else if(e.target.dataset.schedCancel){
        await api('/api/schedule/cancel',{id});
      } else if(e.target.dataset.schedRetry){
        await api('/api/schedule/run',{id});
      }
      await renderSchedJobsList();
    }catch(err){ toast(err.message); btn.disabled=false; }
  });

  // Generic close buttons
  document.addEventListener('click',e=>{
    const id=e.target.closest('[data-close]')?.dataset.close;
    if(id)closeModal(id);
    if(e.target.classList.contains('overlay'))closeModal(e.target.id);
  });

  // Keyboard
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')['m-bulk','m-save','m-coll','m-sched'].forEach(id=>closeModal(id)); });

  // Table events
  bindTable();
  initColResize();

  // OAuth callback / demo URL
  (function(){
    const p=new URLSearchParams(window.location.search);
    const shop=p.get('shop'), token=p.get('token'), demo=p.get('demo');
    if(demo==='1'){ window.history.replaceState({},'','/app'); loadDemoMode(); return; }
    if(shop&&token){
      window.history.replaceState({},'','/app');
      afterOAuth(decodeURIComponent(shop), decodeURIComponent(token));
    }
  })();
}

document.addEventListener('DOMContentLoaded', boot);

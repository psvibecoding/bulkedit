'use strict';
/* ═══════════════════════════════════════════
   Lederly — app-tool.js v8
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
  locations:null,
  past:[], future:[],
  filter:'all', searchQ:'', tagFilter:'',
  selectedVids: new Set(),
  bulkType: null,
  schedules:[],
  pageInfo:{ hasNextPage:false, endCursor:null },
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
      { id:'gid://shopify/ProductVariant/11', title:'S', sku:'NW-MERINO-S', price:'89.00', compareAtPrice:'', inventoryQuantity:45, inventoryItem:{id:'gid://shopify/InventoryItem/11'}, metafields:{ nodes:[{ namespace:'custom', key:'material', type:'single_line_text_field', value:'100% Merino Wool' }] } },
      { id:'gid://shopify/ProductVariant/12', title:'M', sku:'NW-MERINO-M', price:'89.00', compareAtPrice:'', inventoryQuantity:62, inventoryItem:{id:'gid://shopify/InventoryItem/12'}, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/13', title:'L', sku:'NW-MERINO-L', price:'89.00', compareAtPrice:'', inventoryQuantity:28, inventoryItem:{id:'gid://shopify/InventoryItem/13'}, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/2', title:'Leather Crossbody Bag — Tan', status:'ACTIVE', vendor:'StudioLeather', tags:['bags','accessories','sale'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/21', title:'Default', sku:'SL-CROSS-TAN', price:'149.00', compareAtPrice:'189.00', inventoryQuantity:18, inventoryItem:{id:'gid://shopify/InventoryItem/21'}, metafields:{ nodes:[{ namespace:'custom', key:'campaign_label', type:'single_line_text_field', value:'Summer Sale' }] } },
    ]}},
  { id:'gid://shopify/Product/3', title:'Organic Cotton Oversized Tee', status:'ACTIVE', vendor:'EarthBasics', tags:['apparel','sustainable','basics'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/31', title:'XS / White', sku:'EB-TEE-XS-WHT', price:'34.00', compareAtPrice:'', inventoryQuantity:0,  inventoryItem:{id:'gid://shopify/InventoryItem/31'}, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/32', title:'S / White',  sku:'EB-TEE-S-WHT',  price:'34.00', compareAtPrice:'', inventoryQuantity:55, inventoryItem:{id:'gid://shopify/InventoryItem/32'}, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/33', title:'M / Black',  sku:'EB-TEE-M-BLK',  price:'34.00', compareAtPrice:'', inventoryQuantity:40, inventoryItem:{id:'gid://shopify/InventoryItem/33'}, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/4', title:'Ceramic Pour-Over Coffee Set', status:'DRAFT', vendor:'KitchenStudio', tags:['kitchen','coffee','gifts'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/41', title:'White',       sku:'KS-POUROVER-WHT', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:22, inventoryItem:{id:'gid://shopify/InventoryItem/41'}, metafields:{ nodes:[{ namespace:'seo', key:'custom_title', type:'single_line_text_field', value:'' }] } },
      { id:'gid://shopify/ProductVariant/42', title:'Matte Black', sku:'KS-POUROVER-BLK', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:14, inventoryItem:{id:'gid://shopify/InventoryItem/42'}, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/5', title:'Natural Rubber Yoga Mat 6mm', status:'ACTIVE', vendor:'MoveWell', tags:['fitness','yoga','eco'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=80&q=70' },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/51', title:'Default', sku:'MW-YOGAMAT-6MM', price:'78.00', compareAtPrice:'', inventoryQuantity:33, inventoryItem:{id:'gid://shopify/InventoryItem/51'}, metafields:{ nodes:[{ namespace:'custom', key:'thickness_mm', type:'number_integer', value:'6' }] } },
    ]}},
  { id:'gid://shopify/Product/6', title:'Linen Duvet Cover Set — King', status:'ARCHIVED', vendor:'HomeTextile', tags:['bedding','linen','home'],
    featuredImage:null,
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/61', title:'Sand', sku:'HT-DUVET-K-SND', price:'189.00', compareAtPrice:'229.00', inventoryQuantity:7, inventoryItem:{id:'gid://shopify/InventoryItem/61'}, metafields:{ nodes:[] } },
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

async function afterOAuth(shop, token, silent=false){
  S.shop=shop; S.token=token; S.demo=false;

  // Fast restore from cache — show app instantly, then refresh in background
  if(silent){
    const cache=loadProductsCache();
    if(cache){
      S.products=cache.products||[]; S.originals=clone(S.products);
      S.mfDefs=cache.mfDefs||[];
      $('store-name').textContent=cache.storeName||shop;
      showScreen('s-app');
      renderTable(); initExportFields(); buildTagFilter(); updateSaveBtn();
      loadSchedules();
      document.documentElement.removeAttribute('data-restoring');
      refreshInBackground();
      return;
    }
  }

  showScreen('s-loading'); $('loading-msg').textContent='Connecting to your store…';
  try{
    const t = await api('/api/test');
    sessionStorage.setItem('be_shop', shop);
    sessionStorage.setItem('be_token', token);
    $('store-name').textContent = t.shop.name;
    $('loading-msg').textContent='Loading products…';
    await Promise.all([ loadProducts(), loadMfDefs() ]);
    saveProductsCache(t.shop.name);
    showScreen('s-app');
    loadSchedules();
    if(!silent) toast('Connected — all info loaded. Session only, no data stored.');
    const shouldOpenSchedules = new URLSearchParams(location.search).get('openSchedules')==='1' || sessionStorage.getItem('openSchedules')==='1';
    if(shouldOpenSchedules){
      history.replaceState(null,'',location.pathname);
      sessionStorage.removeItem('openSchedules');
      setTimeout(openScheduleModal, 400);
    }
  }catch(e){
    sessionStorage.removeItem('be_shop');
    sessionStorage.removeItem('be_token');
    showScreen('s-connect');
    if(!silent) toast(e.message);
    else{ $('f-shop').value=shop; toast('Session expired — please reconnect.'); }
  }
}

async function loadProducts(q='', append=false){
  if(!append) S.pageInfo={hasNextPage:false,endCursor:null};
  setStatus(append?'Loading more…':'Loading…');
  try{
    const r=await api('/api/products',{query:q,first:50,after:append?S.pageInfo.endCursor:null});
    const newProds=r.products.map(normProd);
    if(append){
      S.products=[...S.products,...newProds];
      S.originals=[...S.originals,...newProds.map(p=>clone(p))];
    } else {
      S.products=newProds; S.originals=clone(newProds);
    }
    S.pageInfo=r.pageInfo||{hasNextPage:false,endCursor:null};
    renderTable();
    if(!append){ initExportFields(); buildTagFilter(); }
    setStatus(`${S.products.length} product${S.products.length!==1?'s':''} loaded${S.pageInfo.hasNextPage?' · more available':''}`);;
    renderLoadMore();
  }catch(e){ toast(e.message); setStatus('Load failed','dirty'); }
}

async function loadAllProducts(q=''){
  while(S.pageInfo.hasNextPage){
    setStatus(`Loading… ${S.products.length} products, fetching more…`);
    await loadProducts(q, true);
  }
  setStatus(`${S.products.length} product${S.products.length!==1?'s':''} loaded`);
}

function renderLoadMore(){
  let wrap=document.getElementById('load-more-wrap');
  if(!wrap){
    wrap=document.createElement('div');
    wrap.id='load-more-wrap';
    wrap.style.cssText='padding:10px 16px;border-top:1px solid var(--b1);display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap';
    document.querySelector('.table-scroll')?.after(wrap);
  }
  if(!S.pageInfo?.hasNextPage){ wrap.style.display='none'; return; }
  wrap.style.display='flex';
  const loaded=S.products.length;
  wrap.innerHTML=`<span style="font-size:12px;color:var(--t3);font-family:var(--mono)">${loaded} loaded · more available</span>
    <button class="btn-ghost sm" id="btn-load-more">Load 50 more</button>
    <button class="btn-ghost sm" id="btn-load-all">Load all ↓</button>`;
  const disable=()=>wrap.querySelectorAll('button').forEach(b=>b.disabled=true);
  wrap.querySelector('#btn-load-more').addEventListener('click',async()=>{ disable(); await loadProducts(S.searchQ,true); });
  wrap.querySelector('#btn-load-all').addEventListener('click',async()=>{ disable(); await loadAllProducts(S.searchQ); });
}

function renderPaginationWarning(){
  const existing=document.getElementById('page-warn');
  const show=S.pageInfo?.hasNextPage&&(S.filter!=='all'||S.tagFilter);
  if(!show){ if(existing)existing.remove(); return; }
  if(existing)return;
  const el=document.createElement('div');
  el.id='page-warn';
  el.style.cssText='margin:4px 16px 0;padding:6px 12px;background:#fefce8;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#78350f;font-family:var(--mono)';
  el.textContent=`⚠ Filters apply only to the ${S.products.length} loaded products — load all to filter the full catalog.`;
  document.querySelector('.toolbar')?.after(el);
}

async function loadMfDefs(){
  if(S.demo) return;
  try{
    const r=await api('/api/metafield-definitions');
    S.mfDefs=r.definitions||[];
  }catch(e){ S.mfDefs=[]; }
}

function normProd(p){
  const norm = { ...p,
    bodyHtml: p.bodyHtml ?? p.descriptionHtml ?? '',
    featuredImage: p.featuredImage||null,
    seo: p.seo||{title:'',description:''},
    metafields: { nodes: p.metafields?.nodes||[] },
    variants:{ nodes:(p.variants?.nodes||[]).map(v=>({
      ...v,
      inventoryItem: v.inventoryItem||null,
      metafields:{nodes:v.metafields?.nodes||[]}
    })) }
  };
  delete norm.descriptionHtml;
  return norm;
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

function saveProductsCache(storeName){
  try{ sessionStorage.setItem('be_cache',JSON.stringify({storeName,products:S.products,mfDefs:S.mfDefs,ts:Date.now()})); }catch{}
}
function loadProductsCache(){
  try{
    const raw=sessionStorage.getItem('be_cache'); if(!raw)return null;
    const c=JSON.parse(raw);
    if(Date.now()-c.ts>10*60*1000)return null; // 10-min TTL
    return c;
  }catch{return null;}
}
async function refreshInBackground(){
  try{
    const t=await api('/api/test');
    $('store-name').textContent=t.shop.name;
    // Only refresh if no unsaved changes (avoid overwriting user's work)
    if(Object.keys(S.changes).length===0){
      await Promise.all([loadProducts(),loadMfDefs()]);
      saveProductsCache(t.shop.name);
    }
  }catch{
    sessionStorage.removeItem('be_shop'); sessionStorage.removeItem('be_token'); sessionStorage.removeItem('be_cache');
    showScreen('s-connect'); toast('Session expired — please reconnect.');
  }
}

function disconnect(){
  sessionStorage.removeItem('be_shop');
  sessionStorage.removeItem('be_token');
  sessionStorage.removeItem('be_cache');
  Object.assign(S,{shop:'',token:'',demo:false,products:[],originals:[],changes:{},mfDefs:[],collsCache:null,locations:null,past:[],future:[],filter:'all',searchQ:'',tagFilter:'',bulkType:null,pageInfo:{hasNextPage:false,endCursor:null}});
  const lm=document.getElementById('load-more-wrap'); if(lm)lm.style.display='none';
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
  if(m&&e.key==='s'){e.preventDefault();const btn=$('btn-save');if(btn&&!btn.disabled)btn.click();}
});

/* ── LOOKUP ── */
function getProd(id){ return S.products.find(p=>p.id===id); }
function getVar(vid){ for(const p of S.products){ const v=p.variants.nodes.find(v=>v.id===vid); if(v)return{p,v}; } return{}; }
function getOrigV(pid,vid){ return S.originals.find(p=>p.id===pid)?.variants?.nodes?.find(v=>v.id===vid)||null; }
function ensureC(pid){ if(!S.changes[pid])S.changes[pid]={productId:pid,product:{},variants:{},metafields:[],inventory:{}}; return S.changes[pid]; }
function prodImg(p){ return p.featuredImage?.url||null; }
function applyPriceRule(current,rule,value){
  const p=parseFloat(current)||0, v=parseFloat(value)||0;
  switch(rule){
    case 'set':      return Math.max(0,v).toFixed(2);
    case 'pct-up':   return (p*(1+v/100)).toFixed(2);
    case 'pct-down': return Math.max(0,p*(1-v/100)).toFixed(2);
    case 'amt-up':   return Math.max(0,p+v).toFixed(2);
    case 'amt-down': return Math.max(0,p-v).toFixed(2);
    case 'round99':  return p===0?'0.00':Math.max(0.99,Math.ceil(p)-0.01).toFixed(2);
    case 'round00':  return Math.round(p).toFixed(2);
    default:         return p.toFixed(2);
  }
}

/* ── FILTER/SEARCH ── */
function buildShopifyQuery(q){
  if(!q) return '';
  const terms=q.split(',').map(t=>t.trim()).filter(Boolean);
  if(terms.length<=1) return q.trim();
  return terms.map(t=>`"${t}"`).join(' OR ');
}
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
  if(!rows.length){ tbody.innerHTML='<tr><td colspan="12" style="text-align:center;padding:48px;color:var(--t3)">No products match.</td></tr>'; return; }
  tbody.innerHTML=rows.map(({p,v})=>rowHTML(p,v)).join('');
  updateSaveBtn(); buildSuggestions(); updateBulkBar(); updateExportPreview(); renderPaginationWarning();
}

function shopifyAdminUrl(gid){
  const numId=gid.split('/').pop();
  return `https://${S.shop}/admin/products/${numId}`;
}
function rowHTML(p,v){
  const dirty=!!S.changes[p.id], sel=S.selectedVids.has(v.id);
  const schedList=getSchedBadges(p.id,v.id);
  const hasSched=schedList.length>0;
  const cls=[dirty?'r-changed':'',sel?'r-selected':'',hasSched?'r-scheduled':''].filter(Boolean).join(' ');
  const imgSrc=prodImg(p);
  const altVal=esc(p.featuredImage?.altText||'');
  const imgId=esc(p.featuredImage?.id||'');
  const imgCell=imgSrc
    ?`<div class="thumb-wrap"><img class="prod-thumb" src="${esc(imgSrc)}" alt="${altVal}" loading="lazy"><input class="alt-inp" data-pid="${esc(p.id)}" data-image-id="${imgId}" placeholder="Alt text…" value="${altVal}" title="Image alt text"></div>`
    :`<div class="prod-thumb-ph">□</div>`;
  const stCls={ACTIVE:'ACTIVE',DRAFT:'DRAFT',ARCHIVED:'ARCHIVED'}[p.status]||'DRAFT';
  const stLbl={ACTIVE:'● Active',DRAFT:'○ Draft',ARCHIVED:'⊘ Archived'}[p.status]||p.status;
  const tagsHTML=(p.tags||[]).map(t=>`<span class="tag">${esc(t)}<span class="tag-rm" data-pid="${esc(p.id)}" data-tag="${esc(t)}">×</span></span>`).join('')+`<span class="tag-add" data-pid="${esc(p.id)}">+</span>`;
  const mfHTML=buildMfHTML(p,v);
  const shopUrl=shopifyAdminUrl(p.id);
  const priceBadge=schedList.filter(b=>b.vf.price!==undefined).map(b=>`<div class="sched-val-badge">new price $${Number(b.vf.price).toFixed(2)} scheduled</div>`).join('');
  const catBadge=schedList.filter(b=>b.vf.compareAtPrice!==undefined).map(b=>{const val=b.vf.compareAtPrice?`$${Number(b.vf.compareAtPrice).toFixed(2)}`:'removed';return`<div class="sched-val-badge">compare at ${esc(val)} scheduled</div>`;}).join('');
  const statusBadge=schedList.filter(b=>b.pf.status).map(b=>`<div class="sched-val-badge">${esc(b.pf.status)} scheduled</div>`).join('');
  const vendorBadge=schedList.filter(b=>b.pf.vendor!==undefined).map(b=>`<div class="sched-val-badge">${esc(b.pf.vendor||'(none)')} scheduled</div>`).join('');
  const tagsBadge=schedList.filter(b=>b.pf.tags!==undefined).map(b=>{
    const cur=p.tags||[];
    const nxt=Array.isArray(b.pf.tags)?b.pf.tags:String(b.pf.tags).split(',').map(t=>t.trim()).filter(Boolean);
    const added=nxt.filter(t=>!cur.includes(t));
    const removed=cur.filter(t=>!nxt.includes(t));
    const parts=[];
    if(added.length) parts.push(`<div class="sched-val-badge">+ ${esc(added.join(', '))} scheduled</div>`);
    if(removed.length) parts.push(`<div class="sched-val-badge-red">- ${esc(removed.join(', '))} scheduled</div>`);
    return parts.join('');
  }).join('');
  const seoTitle=esc(p.seo?.title||''); const seoDesc=esc(p.seo?.description||'');
  const seoMissing=!p.seo?.title&&!p.seo?.description;
  const seoIndicator=seoMissing?`<span class="seo-missing" title="No SEO title/description set">SEO</span>`:'';
  return `<tr class="${cls}" data-pid="${esc(p.id)}" data-vid="${esc(v.id)}">
<td><input type="checkbox" class="row-chk" data-vid="${esc(v.id)}" ${sel?'checked':''}></td>
<td>${imgCell}</td>
<td><div class="title-cell"><div class="title-row"><input class="ce${dirty?' dirty':''}" data-pid="${esc(p.id)}" data-field="title" value="${esc(p.title)}"><a class="shopify-link" href="${esc(shopUrl)}" target="_blank" rel="noopener" title="Open in Shopify">↗</a>${seoIndicator}</div><div class="seo-row"><input class="ce seo-inp" data-pid="${esc(p.id)}" data-field="seo-title" placeholder="SEO title…" value="${seoTitle}"><input class="ce seo-inp" data-pid="${esc(p.id)}" data-field="seo-desc" placeholder="SEO description…" value="${seoDesc}"></div><span class="mod-chip">modified</span></div></td>
<td><div><span class="status-pill ${stCls}" data-pid="${esc(p.id)}">${stLbl}</span>${statusBadge}</div></td>
<td><div><input class="ce" data-pid="${esc(p.id)}" data-field="vendor" value="${esc(p.vendor||'')}"></div>${vendorBadge}</td>
<td><div class="tags-wrap" id="tw-${esc(p.id)}">${tagsHTML}</div>${tagsBadge}</td>
<td class="v-title">${esc(v.title||'Default')}</td>
<td><input class="ce ce-sku" data-vid="${esc(v.id)}" data-vf="sku" value="${esc(v.sku||'')}"></td>
<td><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vf="price" value="${esc(v.price||'')}">${priceBadge}</td>
<td><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vf="compareAtPrice" placeholder="—" value="${esc(v.compareAtPrice||'')}">${catBadge}</td>
<td><input class="ce ce-num" type="number" min="0" step="1" data-vid="${esc(v.id)}" data-vf="inventoryQuantity" value="${esc(String(v.inventoryQuantity??0))}"></td>
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
  const lbl = `<span class="mf-def-label" title="${esc(def.namespace)}.${esc(def.key)}">${esc(def.name)}</span>`;
  if(units){
    let num='', unit=units[0];
    try{ const j=JSON.parse(currentVal); num=j.value??''; unit=j.unit??units[0]; }catch{}
    return `<div class="mf-def-row mf-meas">${lbl}<div class="mf-meas-wrap">
        <input class="mf-val-inp mf-num" type="number" step="any" placeholder="0" ${attrs} data-mf="measure-num" value="${esc(String(num))}">
        <select class="mf-unit-sel" ${attrs} data-mf="measure-unit">
          ${units.map(u=>`<option value="${u}"${u===unit?' selected':''}>${u.replace(/_/g,' ')}</option>`).join('')}
        </select></div></div>`;
  }
  const t=def.type||'single_line_text_field';
  if(t==='boolean'){
    const checked=currentVal==='true';
    return `<div class="mf-def-row">${lbl}<label class="mf-bool-wrap"><input type="checkbox" class="mf-bool" ${attrs} data-mf="smart" ${checked?'checked':''}><span class="mf-bool-lbl">${checked?'true':'false'}</span></label></div>`;
  }
  if(t==='date'){
    return `<div class="mf-def-row">${lbl}<input class="mf-val-inp" type="date" ${attrs} data-mf="smart" value="${esc(currentVal)}"></div>`;
  }
  if(t==='date_time'){
    const dtVal=currentVal?currentVal.replace(' ','T').slice(0,16):'';
    return `<div class="mf-def-row">${lbl}<input class="mf-val-inp" type="datetime-local" ${attrs} data-mf="smart" value="${esc(dtVal)}"></div>`;
  }
  if(t==='json'){
    return `<div class="mf-def-row">${lbl}<textarea class="mf-val-inp mf-json" rows="2" ${attrs} data-mf="smart">${esc(currentVal)}</textarea></div>`;
  }
  if(t==='multi_line_text_field'){
    return `<div class="mf-def-row">${lbl}<textarea class="mf-val-inp" rows="2" ${attrs} data-mf="smart">${esc(currentVal)}</textarea></div>`;
  }
  return `<div class="mf-def-row">${lbl}<input class="mf-val-inp" placeholder="—" ${attrs} data-mf="smart" value="${esc(currentVal)}"></div>`;
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
  const widths=[34,44,240,90,110,160,110,100,82,90,72,220];
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
    if(e.target.classList.contains('mf-bool')){
      const lbl=e.target.nextElementSibling; if(lbl)lbl.textContent=e.target.checked?'true':'false';
      const fake={...e.target, value:e.target.checked?'true':'false', dataset:e.target.dataset};
      markMfSmart(fake); return;
    }
    if(e.target.dataset.mf==='measure-unit'){ markMfMeasure(e.target); return; }
  });
  tbody.addEventListener('input',e=>{
    const el=e.target;
    if(el.classList.contains('alt-inp')){ markAltText(el); return; }
    if(el.dataset.field==='seo-title'||el.dataset.field==='seo-desc'){ markSeo(el); return; }
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
function markSeo(el){
  const pid=el.dataset.pid; const p=getProd(pid); if(!p)return;
  pushH('Edit SEO'); if(!p.seo)p.seo={title:'',description:''};
  const isTitle=el.dataset.field==='seo-title';
  if(isTitle)p.seo.title=el.value; else p.seo.description=el.value;
  const c=ensureC(pid); if(!c.product.seo)c.product.seo={};
  if(isTitle)c.product.seo.title=el.value; else c.product.seo.description=el.value;
  el.classList.add('dirty'); addModChip(el); updateSaveBtn();
}
function markAltText(el){
  const pid=el.dataset.pid; const imageId=el.dataset.imageId; const p=getProd(pid); if(!p)return;
  pushH('Edit alt text');
  if(p.featuredImage)p.featuredImage.altText=el.value;
  const c=ensureC(pid); c.product.altText=el.value; c.product.imageId=imageId;
  el.classList.add('dirty'); addModChip(el); updateSaveBtn();
}
function markVar(vid,field,value,el){
  const{p,v}=getVar(vid); if(!p||!v)return;
  pushH(`Edit ${field}`);
  const c=ensureC(p.id);
  if(field==='inventoryQuantity'){
    const qty=parseInt(value,10);
    if(isNaN(qty)||qty<0)return;
    v.inventoryQuantity=qty;
    if(!c.inventory)c.inventory={};
    c.inventory[vid]={inventoryItemId:v.inventoryItem?.id||'',quantity:qty,oldQuantity:getOrigV(p.id,vid)?.inventoryQuantity??0};
    if(el){ el.classList.add('dirty'); addModChip(el); }
    updateSaveBtn(); return;
  }
  v[field]=value;
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
async function toggleAll(checked){
  if(checked && S.pageInfo.hasNextPage){
    const chkAll=$('chk-all');
    if(chkAll){chkAll.disabled=true;chkAll.indeterminate=true;}
    await loadAllProducts(S.searchQ);
    if(chkAll){chkAll.disabled=false;chkAll.indeterminate=false;chkAll.checked=true;}
  }
  document.querySelectorAll('.row-chk').forEach(cb=>{cb.checked=checked;toggleRowSel(cb.dataset.vid,checked);});
}
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
  $('m-bulk-title').textContent={status:'Change Status',price:'Change Prices',compareAt:'Change Compare at',tags:'Edit Tags',qty:'Change Inventory Qty',metafield:'Edit Metafields',description:'Edit Description',seo:'Edit SEO',collections:'Add / Remove Collection'}[type]||'Bulk action';
  $('m-bulk-sub').textContent=type==='seo'?`Applied to ${getSelPids().length} product${getSelPids().length!==1?'s':''}`:`Applied to ${n} selected variant${n!==1?'s':''}`;
  const body=$('m-bulk-body');
  if(type==='status'){
    body.innerHTML=`<div class="bulk-field"><label>New status</label><select id="bv-status"><option value="ACTIVE">● Active</option><option value="DRAFT">○ Draft</option><option value="ARCHIVED">⊘ Archived</option></select></div>`;
  }else if(type==='price'){
    body.innerHTML=`<div class="bulk-field"><label>Rule</label><select id="bv-price-rule"><option value="set">Set fixed price</option><option value="pct-up">Increase by %</option><option value="pct-down">Decrease by %</option><option value="amt-up">Increase by amount ($)</option><option value="amt-down">Decrease by amount ($)</option><option value="round99">Round to .99</option><option value="round00">Round to .00</option></select></div><div class="bulk-field" id="bv-price-val-wrap"><label id="bv-price-val-lbl">New price ($)</label><input id="bv-price-val" type="number" step=".01" min="0" placeholder="0.00" autofocus></div><div class="bulk-field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400"><input type="checkbox" id="bv-also-compare"> Also apply to Compare at price</label></div>`;
    body.querySelector('#bv-price-rule').addEventListener('change',e=>{
      const rule=e.target.value;
      const wrap=$('bv-price-val-wrap'),lbl=$('bv-price-val-lbl');
      const isRound=rule==='round99'||rule==='round00';
      if(wrap)wrap.style.display=isRound?'none':'';
      if(lbl){if(rule==='set')lbl.textContent='New price ($)';else if(rule==='pct-up'||rule==='pct-down')lbl.textContent='Percentage (%)';else lbl.textContent='Amount ($)';}
    });
  }else if(type==='compareAt'){
    body.innerHTML=`<div class="bulk-field"><label>Rule</label><select id="bv-cat-rule"><option value="set">Set fixed price</option><option value="pct-up">Increase by %</option><option value="pct-down">Decrease by %</option><option value="amt-up">Increase by amount ($)</option><option value="amt-down">Decrease by amount ($)</option><option value="round99">Round to .99</option><option value="round00">Round to .00</option><option value="clear">Clear (remove strikethrough)</option></select></div><div class="bulk-field" id="bv-cat-val-wrap"><label id="bv-cat-val-lbl">New price ($)</label><input id="bv-cat-val" type="number" step=".01" min="0" placeholder="0.00" autofocus></div><p style="font-size:11px;color:var(--t3);margin:0 0 4px;font-family:var(--mono)">Relative rules (%, amount, round) apply only to variants that already have a Compare at price.</p>`;
    body.querySelector('#bv-cat-rule').addEventListener('change',e=>{
      const rule=e.target.value;
      const wrap=$('bv-cat-val-wrap'),lbl=$('bv-cat-val-lbl');
      const hide=rule==='round99'||rule==='round00'||rule==='clear';
      if(wrap)wrap.style.display=hide?'none':'';
      if(lbl){if(rule==='set')lbl.textContent='New price ($)';else if(rule==='pct-up'||rule==='pct-down')lbl.textContent='Percentage (%)';else lbl.textContent='Amount ($)';}
    });
  }else if(type==='qty'){
    body.innerHTML=`<div class="bulk-field"><label>Action</label><select id="bv-qty-rule"><option value="set">Set exact quantity</option><option value="add">Increase by</option><option value="sub">Decrease by</option></select></div><div class="bulk-field"><label id="bv-qty-lbl">Quantity</label><input id="bv-qty-val" type="number" min="0" step="1" placeholder="0" autofocus></div>`;
    body.querySelector('#bv-qty-rule').addEventListener('change',e=>{
      const lbl=$('bv-qty-lbl');
      if(lbl)lbl.textContent={set:'Quantity',add:'Increase by',sub:'Decrease by'}[e.target.value]||'Quantity';
    });
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
  if(type==='description'){
    body.innerHTML=`<div class="bulk-field"><label>Description <span style="color:var(--t4);font-weight:400">(HTML allowed · replaces current)</span></label><textarea id="bv-desc" rows="6" placeholder="Product description…" style="resize:vertical;min-height:120px;font-family:var(--mono);font-size:12px" autofocus></textarea></div><div class="bulk-field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="bv-desc-clear" style="accent-color:var(--red)"> Clear description (set empty)</label></div>`;
    $('bv-desc-clear')?.addEventListener('change',e=>{ const ta=$('bv-desc'); if(ta){ta.disabled=e.target.checked;ta.style.opacity=e.target.checked?'.35':'1';} });
  }
  if(type==='seo'){
    body.innerHTML=`<div class="bulk-field"><label>SEO Title <span style="color:var(--t4);font-weight:400">(leave blank to keep current)</span></label><input id="bv-seo-title" type="text" maxlength="320" placeholder="e.g. Product Name | Store Name" autofocus></div><div class="bulk-field"><label>SEO Description</label><textarea id="bv-seo-desc" rows="3" maxlength="5000" placeholder="Brief description for search engines…" style="resize:vertical;min-height:72px"></textarea></div>`;
  }
  openModal('m-bulk');
  setTimeout(()=>body.querySelector('input,select,textarea')?.focus(),60);
}

function applyBulkModal(){
  const type=S.bulkType;
  if(type==='status'){
    const val=$('bv-status').value; const pids=getSelPids(); if(!pids.length)return;
    pushH(`Bulk status → ${val}`);
    pids.forEach(pid=>{const p=getProd(pid);if(!p)return;p.status=val;ensureC(pid).product.status=val;});
    renderTable(); updateSaveBtn(); toast(`Status set on ${pids.length} products.`);
  }else if(type==='price'){
    const rule=$('bv-price-rule')?.value||'set';
    const isRound=rule==='round99'||rule==='round00';
    const val=$('bv-price-val')?.value;
    const n=isRound?0:Number(val);
    if(!isRound&&(val===''||val==null||isNaN(n)))return toast('Enter a valid number.');
    const alsoCompare=$('bv-also-compare')?.checked;
    const vids=[...S.selectedVids];
    pushH(`Bulk price rule: ${rule}`);
    vids.forEach(vid=>{
      const{p,v}=getVar(vid); if(!p||!v)return;
      const newPrice=applyPriceRule(v.price,rule,n);
      v.price=newPrice;
      const c=ensureC(p.id);
      if(!c.variants[vid])c.variants[vid]={id:vid};
      c.variants[vid].price=newPrice;
      if(alsoCompare&&v.compareAtPrice){
        const newCat=applyPriceRule(v.compareAtPrice,rule,n);
        v.compareAtPrice=newCat; c.variants[vid].compareAtPrice=newCat;
      }
    });
    renderTable(); updateSaveBtn(); toast(`Price updated on ${vids.length} variant${vids.length!==1?'s':''}.`);
  }else if(type==='compareAt'){
    const rule=$('bv-cat-rule')?.value||'set';
    const isClear=rule==='clear';
    const isRound=rule==='round99'||rule==='round00';
    const val=$('bv-cat-val')?.value;
    const n=isRound||isClear?0:Number(val);
    if(!isRound&&!isClear&&(val===''||val==null||isNaN(n)))return toast('Enter a valid number.');
    const vids=[...S.selectedVids];
    pushH(`Bulk compare at: ${rule}`);
    let changed=0;
    vids.forEach(vid=>{
      const{p,v}=getVar(vid); if(!p||!v)return;
      const c=ensureC(p.id);
      if(!c.variants[vid])c.variants[vid]={id:vid};
      if(isClear){
        v.compareAtPrice=''; c.variants[vid].compareAtPrice=''; changed++;
      }else if(rule==='set'){
        const nv=Math.max(0,n).toFixed(2); v.compareAtPrice=nv; c.variants[vid].compareAtPrice=nv; changed++;
      }else{
        if(!v.compareAtPrice)return; // skip variants with no compare at for relative rules
        const nv=applyPriceRule(v.compareAtPrice,rule,n);
        v.compareAtPrice=nv; c.variants[vid].compareAtPrice=nv; changed++;
      }
    });
    renderTable(); updateSaveBtn(); toast(`Compare at updated on ${changed} variant${changed!==1?'s':''}.`);
  }else if(type==='qty'){
    const rule=$('bv-qty-rule')?.value||'set';
    const val=$('bv-qty-val')?.value;
    const n=parseInt(val,10);
    if(val===''||val==null||isNaN(n)||n<0)return toast('Enter a valid quantity.');
    const vids=[...S.selectedVids];
    pushH(`Bulk qty ${rule}: ${n}`);
    vids.forEach(vid=>{
      const{p,v}=getVar(vid); if(!p||!v)return;
      const c=ensureC(p.id);
      if(!c.inventory)c.inventory={};
      let newQty;
      if(rule==='set')       newQty=n;
      else if(rule==='add')  newQty=Math.max(0,(v.inventoryQuantity||0)+n);
      else                   newQty=Math.max(0,(v.inventoryQuantity||0)-n);
      v.inventoryQuantity=newQty;
      c.inventory[vid]={inventoryItemId:v.inventoryItem?.id||'',quantity:newQty,oldQuantity:getOrigV(p.id,vid)?.inventoryQuantity??0};
    });
    renderTable(); updateSaveBtn(); toast(`Qty updated on ${vids.length} variant${vids.length!==1?'s':''}.`);
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
  if(type==='description'){
    const clear=$('bv-desc-clear')?.checked;
    const val=clear?'':($('bv-desc')?.value||'');
    if(!clear&&!val.trim())return toast('Enter a description or check "Clear".');
    const pids=getSelPids(); if(!pids.length)return toast('Select products first.');
    pushH('Bulk description update');
    pids.forEach(pid=>{const p=getProd(pid);if(!p)return;p.bodyHtml=val;ensureC(pid).product.bodyHtml=val;});
    renderTable(); updateSaveBtn(); toast(`Description updated on ${pids.length} product${pids.length!==1?'s':''}.`);
  }
  if(type==='seo'){
    const title=($('bv-seo-title')?.value||'').trim();
    const desc=($('bv-seo-desc')?.value||'').trim();
    if(!title&&!desc)return toast('Enter at least a SEO title or description.');
    const pids=getSelPids(); if(!pids.length)return toast('Select products first.');
    pushH('Bulk SEO update');
    pids.forEach(pid=>{
      const p=getProd(pid); if(!p)return;
      if(!p.seo)p.seo={title:'',description:''};
      const c=ensureC(pid); if(!c.product.seo)c.product.seo={};
      if(title){p.seo.title=title;c.product.seo.title=title;}
      if(desc){p.seo.description=desc;c.product.seo.description=desc;}
    });
    renderTable(); updateSaveBtn(); toast(`SEO updated on ${pids.length} products.`);
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
    Object.entries(c.inventory||{}).forEach(([vid,inv])=>{
      const vLbl=p.variants.nodes.find(x=>x.id===vid)?.title||'variant';
      diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl)} inventory</span><span class="diff-old">${esc(String(inv.oldQuantity))}</span><span class="diff-arr">→</span><span class="diff-new">${esc(String(inv.quantity))}</span></div>`);
    });
    return `<div class="diff-item"><div class="diff-item-head">${imgEl}<span class="diff-title">${esc(p.title)}</span></div><div class="diff-rows">${diffs.length?diffs.join(''):'<span style="font-size:11px;color:var(--t3)">Variant / metafield changes</span>'}</div></div>`;
  }).join('');
  openModal('m-save');
}

function setSaveProgress(done,total,errors){
  const prog=$('m-save-prog'),bar=$('m-save-prog-bar'),lbl=$('m-save-prog-label'),pct=$('m-save-prog-pct');
  if(!prog)return;
  prog.style.display='';
  const p=total>0?Math.round(done/total*100):0;
  bar.style.width=p+'%';
  bar.style.background=errors>0?'#f59e0b':'#1a5c38';
  lbl.textContent=done>=total?(errors>0?`${errors} failed · ${done-errors} saved`:'All saved ✓'):`Saving ${done} of ${total}…`;
  pct.textContent=p+'%';
}

async function confirmSave(){
  const payloads=Object.values(S.changes); if(!payloads.length)return;
  const btn=$('m-save-confirm'); btn.disabled=true; btn.textContent='Saving…';
  const bar=$('m-save-prog-bar'); if(bar){bar.style.width='0%';bar.style.background='#1a5c38';}
  const prog=$('m-save-prog'); if(prog)prog.style.display='none';
  setStatus('Saving…','saving');
  try{
    if(S.demo){
      for(let i=1;i<=payloads.length;i++){await delay(35);setSaveProgress(i,payloads.length,0);}
      commitAll(payloads); return;
    }

    const savedPids=[], failed=[];
    let done=0;

    // Save in parallel batches of 5 — per-item error handling
    for(let i=0;i<payloads.length;i+=5){
      await Promise.all(payloads.slice(i,i+5).map(async c=>{
        try{
          const mf=(c.metafields||[]).map(({_idx,...rest})=>rest);
          await api('/api/save-product',{productId:c.productId,product:c.product,variants:Object.values(c.variants||{}),metafields:mf});
          savedPids.push(c.productId);
        }catch(e){
          failed.push({pid:c.productId,title:getProd(c.productId)?.title||c.productId,err:e.message});
        }
        done++;
        setSaveProgress(done,payloads.length,failed.length);
      }));
    }

    // Inventory — only for products that saved OK
    const savedSet=new Set(savedPids), invFailed=[];
    const invItems=[];
    for(const c of payloads){
      if(!savedSet.has(c.productId))continue;
      Object.entries(c.inventory||{}).forEach(([_,inv])=>{ if(inv.inventoryItemId)invItems.push({inventoryItemId:inv.inventoryItemId,quantity:inv.quantity}); });
    }
    if(invItems.length){
      try{ await api('/api/inventory-set',{quantities:invItems}); }
      catch(e){ invFailed.push(e.message); }
    }

    // Commit successes: update originals + remove from S.changes
    savedPids.forEach(pid=>{
      const cur=getProd(pid), origIdx=S.originals.findIndex(p=>p.id===pid);
      if(cur&&origIdx!==-1) S.originals[origIdx]=clone(cur);
      delete S.changes[pid];
    });

    renderTable(); updateSaveBtn(); updateUndoUI();

    const allFailed=[...failed,...(invFailed.length?[{pid:'inv',title:'Inventory',err:invFailed.join(', ')}]:[])];

    if(allFailed.length){
      // Show errors inside modal, keep it open for retry
      const errHTML=allFailed.map(f=>`<div class="diff-row"><span class="diff-field" style="color:var(--red)">✕ ${esc(f.title)}</span><span class="diff-new" style="color:var(--red);font-family:var(--mono);font-size:11px">${esc(f.err)}</span></div>`).join('');
      const banner=`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:14px"><div style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:8px">⚠ ${allFailed.length} failed · ${savedPids.length} saved</div>${errHTML}</div>`;
      const list=$('m-save-diff'); if(list)list.innerHTML=banner+list.innerHTML;
      $('m-save-sub').textContent=`${savedPids.length} saved · ${allFailed.length} failed — fix and retry`;
      toast(`${savedPids.length} saved · ${allFailed.length} failed.`);
      setStatus(`${allFailed.length} product${allFailed.length!==1?'s':''} failed`,'dirty');
    }else{
      S.past=[]; S.future=[];
      document.querySelectorAll('.dirty').forEach(el=>el.classList.remove('dirty'));
      closeModal('m-save');
      toast(`${savedPids.length} product${savedPids.length!==1?'s':''} saved.`);
      setStatus('All changes saved','saved');
      setTimeout(()=>setStatus('Ready','ready'),3000);
    }
  }catch(e){ toast(e.message); setStatus('Save failed','dirty'); }
  finally{ btn.disabled=false; btn.textContent='Save to Shopify →'; }
}

function commitAll(payloads){
  const n=payloads.length;
  S.changes={}; S.past=[]; S.future=[];
  S.originals=clone(S.products);
  document.querySelectorAll('.dirty').forEach(el=>el.classList.remove('dirty'));
  closeModal('m-save'); renderTable(); updateSaveBtn(); updateUndoUI();
  toast(`${n} product${n!==1?'s':''} saved.`);
  setStatus('All changes saved','saved');
  setTimeout(()=>setStatus('Ready','ready'),3000);
}

function buildRecap(payloads){
  const rows=[['Product','Variant','Field','Old Value','New Value']];
  payloads.forEach(c=>{
    const p=getProd(c.productId); if(!p)return;
    const orig=S.originals.find(x=>x.id===c.productId);
    const title=p.title;
    Object.entries(c.product||{}).forEach(([field,newVal])=>{
      const oldVal=orig?orig[field]:'';
      const oldStr=Array.isArray(oldVal)?oldVal.join(', '):String(oldVal??'');
      const newStr=Array.isArray(newVal)?newVal.join(', '):String(newVal??'');
      if(oldStr!==newStr) rows.push([title,'',field,oldStr,newStr]);
    });
    Object.values(c.variants||{}).forEach(v=>{
      const origV=orig?.variants?.nodes?.find(x=>x.id===v.id);
      const vLbl=p.variants.nodes.find(x=>x.id===v.id)?.title||'';
      ['price','compareAtPrice','sku'].forEach(field=>{
        if(v[field]!==undefined){
          const old=origV?String(origV[field]??''):'';
          const nw=String(v[field]??'');
          if(old!==nw) rows.push([title,vLbl,field,old,nw]);
        }
      });
    });
    (c.metafields||[]).forEach(mf=>{
      const vLbl=mf.ownerId===c.productId?'':p.variants.nodes.find(v=>v.id===mf.ownerId)?.title||'';
      rows.push([title,vLbl,`${mf.namespace}.${mf.key}`,'',mf.value??'']);
    });
    Object.entries(c.inventory||{}).forEach(([vid,inv])=>{
      const vLbl=p.variants.nodes.find(v=>v.id===vid)?.title||'';
      rows.push([title,vLbl,'inventoryQuantity',String(inv.oldQuantity),String(inv.quantity)]);
    });
  });
  return rows.map(r=>r.map(v=>csvQuote(String(v??''))).join(',')).join('\n');
}

function dlText(text,filename,mime='text/plain'){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:mime})); a.download=filename; a.click(); }
function manualRecap(){ dlText(buildRecap(Object.values(S.changes)),`lederly-recap-${Date.now()}.csv`,'text/csv'); }

/* ── SCHEDULES (server-side) ── */
function updateSchedBadge(){
  const n=(S.schedules||[]).filter(s=>s.status==='pending').length;
  const btn=$('btn-schedule'); if(!btn)return;
  btn.textContent=n?`Scheduled (${n})`:'Schedule edit';
}

async function loadSchedules(){
  if(S.demo){S.schedules=[];return;}
  try{
    const r=await api('/api/schedule/list',{});
    S.schedules=r.schedules||[];
    S.schedPersistWarning=!!r.persistWarning;
  }catch{ S.schedules=[]; }
  updateSchedBadge();
  renderTable();
}

function openScheduleModal(){
  if(S.schedPersistWarning){
    const warn=$('sched-persist-warn');
    if(warn)warn.style.display='';
  }
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
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
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
          timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
          label:(label?`↩ ${label}`:'↩ Revert'),
          changes:revertWithMeta,
          linkedTo:r.schedule.id,
          notifyEmail,
        });
        S.schedules=[r2.schedule,...S.schedules];
      }
    }

    updateSchedBadge();
    // Revert scheduled products back to current Shopify values
    const schedPids=new Set(changesWithMeta.map(c=>c.productId));
    schedPids.forEach(pid=>{
      const idx=S.products.findIndex(p=>p.id===pid);
      const orig=S.originals.find(p=>p.id===pid);
      if(idx!==-1&&orig)S.products[idx]=clone(orig);
    });
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
let _editingSchedId=null;

function getSchedBadges(productId, variantId){
  return (S.schedules||[])
    .filter(s=>s.status==='pending'&&(s.changes||[]).some(c=>c.productId===productId))
    .map(sched=>{
      const chg=(sched.changes||[]).find(c=>c.productId===productId);
      return{label:sched.label, pf:chg?.product||{}, vf:(variantId&&chg?.variants?.[variantId])||{}};
    });
}
function schedRowHTML(s){
  const isRevert=!!s.linkedTo;
  // Inline edit form
  if(s.id===_editingSchedId&&s.status==='pending'){
    const d=new Date(s.scheduledFor);
    const dtVal=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    return `<div class="sched-row${isRevert?' sched-revert':''}" style="flex-direction:column;align-items:stretch;gap:10px;padding:14px 16px">
      <span style="font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.06em">Editing schedule</span>
      <div style="display:flex;flex-direction:column;gap:8px">
        <input class="sched-input" id="se-label-${s.id}" value="${esc(s.label)}" placeholder="Label" style="font-size:13px"/>
        <input class="sched-input" type="datetime-local" id="se-dt-${s.id}" value="${dtVal}" style="font-size:13px"/>
        <input class="sched-input" type="email" id="se-email-${s.id}" value="${esc(s.notifyEmail||'')}" placeholder="Notification email (optional)" style="font-size:13px"/>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-ghost xs" data-sched-edit-cancel="${s.id}">Cancel</button>
        <button class="btn-cta xs" data-sched-edit-save="${s.id}">Save changes</button>
      </div>
    </div>`;
  }
  const dt=new Date(s.scheduledFor).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  const n=s.changes.length;
  const overdue=s.status==='pending'&&new Date(s.scheduledFor)<new Date();
  const sCls={pending:overdue?'sched-overdue':'sched-pending',executed:'sched-done',failed:'sched-fail',running:'sched-running',cancelled:'sched-cancelled'}[s.status]||'';
  const sLbl={pending:overdue?'Overdue':'Pending',executed:'Done',failed:'Failed',running:'Running',cancelled:'Cancelled'}[s.status]||s.status;
  const btns=s.status==='pending'
    ?`<button class="btn-ghost xs" data-sched-run="${s.id}">Run now</button><button class="btn-ghost xs" data-sched-edit="${s.id}">Edit</button><button class="btn-ghost xs" data-sched-cancel="${s.id}">Cancel</button>`
    :s.status==='failed'
      ?`<button class="btn-ghost xs" data-sched-retry="${s.id}">Retry</button><button class="btn-ghost xs" style="color:var(--red)" data-sched-delete="${s.id}">Delete</button>`
      :s.status==='cancelled'
        ?`<button class="btn-ghost xs" style="color:var(--red)" data-sched-delete="${s.id}">Delete</button>`
        :'';
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

function allMfFields(){
  const seen=new Set(), fields=[];
  const add=(ns,key,label,ownerType)=>{
    const k=`mf:${ns}.${key}`;
    if(seen.has(k))return; seen.add(k);
    fields.push({key:k, label:`${label||key} (${ns})`, ownerType});
  };
  for(const d of S.mfDefs||[]) add(d.namespace,d.key,d.name,d.ownerType);
  for(const p of S.products||[]){
    for(const m of p.metafields?.nodes||[]) add(m.namespace,m.key,m.key,'PRODUCT');
    for(const v of p.variants?.nodes||[]) for(const m of v.metafields?.nodes||[]) add(m.namespace,m.key,m.key,'PRODUCTVARIANT');
  }
  return fields;
}

function initExportFields(){
  const el=$('export-field-list'); if(!el)return;
  const mfFields=allMfFields();
  const baseChips=EX_ALL.map(f=>`<label class="field-chip${S.exportFields.includes(f)?' on':''}"><input type="checkbox" data-ef="${esc(f)}" ${S.exportFields.includes(f)?'checked':''}>${EX_LBL[f]||f}</label>`).join('');
  const mfChips=mfFields.length
    ? `<span class="export-section-lbl">Metafields</span>`+mfFields.map(({key,label})=>`<label class="field-chip${S.exportFields.includes(key)?' on':''}"><input type="checkbox" data-ef="${esc(key)}" ${S.exportFields.includes(key)?'checked':''}>${esc(label)}</label>`).join('')
    : '';
  el.innerHTML=baseChips+mfChips;
  el.querySelectorAll('input[data-ef]').forEach(cb=>cb.addEventListener('change',()=>{
    const f=cb.dataset.ef;
    if(cb.checked){if(!S.exportFields.includes(f))S.exportFields.push(f);}
    else S.exportFields=S.exportFields.filter(x=>x!==f);
    cb.closest('.field-chip').classList.toggle('on',cb.checked);
    updateExportPreview();
  }));
  updateExportPreview();
}

function exVal(p,v,f){
  if(f==='tags')return(p.tags||[]).join('|');
  if(f==='variant')return v.title||'Default';
  if(f==='sku')return v.sku||'';
  if(f==='price')return v.price||'';
  if(f==='compareAtPrice')return v.compareAtPrice||'';
  if(f==='inventoryQuantity')return String(v.inventoryQuantity??'');
  if(f.startsWith('mf:')){
    const nskey=f.slice(3), dot=nskey.indexOf('.');
    const ns=nskey.slice(0,dot), key=nskey.slice(dot+1);
    const pmf=(p.metafields?.nodes||[]).find(m=>m.namespace===ns&&m.key===key);
    if(pmf!==undefined)return pmf.value??'';
    const vmf=(v.metafields?.nodes||[]).find(m=>m.namespace===ns&&m.key===key);
    return vmf?.value??'';
  }
  return String(p[f]??'');
}

function exHeader(f){ return f.startsWith('mf:')?f.slice(3):f; }
function csvQuote(val){ return val.includes(',')||val.includes('"')||val.includes('\n')||val.includes('\r')?`"${val.replace(/"/g,'""')}"`:`${val}`; }
function buildCSV(){ return[S.exportFields.map(exHeader).join(','),...flatRows().map(({p,v})=>S.exportFields.map(f=>csvQuote(exVal(p,v,f))).join(','))].join('\n'); }
function buildJSON(){ return JSON.stringify(flatRows().map(({p,v})=>{const o={};S.exportFields.forEach(f=>o[exHeader(f)]=exVal(p,v,f));return o;}),null,2); }
function updateExportPreview(){
  const pre=$('export-preview'); if(!pre)return;
  const rows=flatRows().slice(0,3);
  pre.textContent=[S.exportFields.map(exHeader).join(','),...rows.map(({p,v})=>S.exportFields.map(f=>{const val=exVal(p,v,f);return val.includes(',')?`"${val}"`:val;}).join(','))].join('\n')+(flatRows().length>3?`\n… (${flatRows().length} total rows)`:'');
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
      if(S.searchQ.length>2){
        window._srt=setTimeout(async ()=>{
          await loadProducts(S.searchQ);
          // Multi-term (comma) search: auto-load all pages so all matching SKUs appear
          if(S.searchQ.includes(',') && S.pageInfo.hasNextPage) await loadAllProducts(S.searchQ);
        }, 400);
      } else if(S.searchQ.length===0) loadProducts('');
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
  $('bulk-cat-btn').addEventListener('click',    ()=>openBulkModal('compareAt'));
  $('bulk-qty-btn').addEventListener('click',    ()=>openBulkModal('qty'));
  $('bulk-tags-btn').addEventListener('click',   ()=>openBulkModal('tags'));
  $('bulk-mf-btn').addEventListener('click',     ()=>openBulkModal('metafield'));
  $('bulk-desc-btn').addEventListener('click',   ()=>openBulkModal('description'));
  $('bulk-seo-btn').addEventListener('click',    ()=>openBulkModal('seo'));
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
    if(e.target.dataset.schedEdit){ _editingSchedId=e.target.dataset.schedEdit; renderSchedTabs(S.schedules); return; }
    if(e.target.dataset.schedEditCancel){ _editingSchedId=null; renderSchedTabs(S.schedules); return; }
    const id=e.target.dataset.schedRun||e.target.dataset.schedCancel||e.target.dataset.schedRetry||e.target.dataset.schedDelete||e.target.dataset.schedEditSave;
    if(!id)return;
    const btn=e.target; btn.disabled=true;
    try{
      if(e.target.dataset.schedRun){
        await api('/api/schedule/run',{id});
      } else if(e.target.dataset.schedCancel){
        await api('/api/schedule/cancel',{id});
      } else if(e.target.dataset.schedRetry){
        await api('/api/schedule/run',{id});
      } else if(e.target.dataset.schedDelete){
        await api('/api/schedule/delete',{id});
      } else if(e.target.dataset.schedEditSave){
        const labelEl=document.getElementById(`se-label-${id}`);
        const dtEl=document.getElementById(`se-dt-${id}`);
        const emailEl=document.getElementById(`se-email-${id}`);
        const scheduledFor=new Date(dtEl?.value||'');
        if(isNaN(scheduledFor.getTime())){ btn.disabled=false; return toast('Invalid date.'); }
        if(scheduledFor<=new Date()){ btn.disabled=false; return toast('Scheduled time must be in the future.'); }
        await api('/api/schedule/update',{
          id,
          label:(labelEl?.value||'').trim(),
          scheduledFor:scheduledFor.toISOString(),
          timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
          notifyEmail:(emailEl?.value||'').trim()||undefined,
        });
        _editingSchedId=null;
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

  // OAuth callback / session restore / demo URL
  (function(){
    const p=new URLSearchParams(window.location.search);
    const shop=p.get('shop'), token=p.get('token'), demo=p.get('demo');
    if(demo==='1'){ window.history.replaceState({},'','/app'); loadDemoMode(); return; }
    if(shop&&token){
      window.history.replaceState({},'','/app');
      afterOAuth(decodeURIComponent(shop), decodeURIComponent(token));
      return;
    }
    // Restore session from sessionStorage (survives reload, clears on tab close)
    const savedShop=sessionStorage.getItem('be_shop');
    const savedToken=sessionStorage.getItem('be_token');
    if(savedShop&&savedToken){ afterOAuth(savedShop, savedToken, true); return; }
    // Pre-fill shop domain if remembered
    if(savedShop) $('f-shop').value=savedShop;
  })();
}

document.addEventListener('DOMContentLoaded', boot);

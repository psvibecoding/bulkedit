'use strict';
/* ═══════════════════════════════════════════
   Lederly — app-tool.js v8
   OAuth only · Metafield definitions · Collections
═══════════════════════════════════════════ */

// Credential persistence — localStorage with 7-day TTL
const CRED_TTL = 30 * 24 * 60 * 60 * 1000;
function saveCredentials(shop, token){
  try{ localStorage.setItem('be_cred', JSON.stringify({shop, token, exp: Date.now()+CRED_TTL})); }catch{}
}
function loadCredentials(){
  try{
    const c = JSON.parse(localStorage.getItem('be_cred')||'null');
    if(!c) return null;
    if(Date.now() > c.exp){ localStorage.removeItem('be_cred'); return null; }
    return c;
  }catch{ return null; }
}
function clearCredentials(){
  try{ localStorage.removeItem('be_cred'); }catch{}
}

// Runs synchronously before DOMContentLoaded
if (loadCredentials())
  document.documentElement.setAttribute('data-restoring', '1');

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
  filter:'all', searchQ:'', tagFilter:'', collFilter:'',
  selectedVids: new Set(),
  bulkType: null,
  schedules:[],
  plan:'basic', schedLimit:0, schedUsed:0, periodEnd:null, trialInfo:null,
  pageInfo:{ hasNextPage:false, endCursor:null },
  exportFields:['handle','title','status','vendor','tags','variant','sku','price','compareAtPrice'],
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
    collections:{ nodes:[{id:'gid://shopify/Collection/1',title:'Winter Sale'},{id:'gid://shopify/Collection/2',title:'Clothing'}] },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/11', title:'S', sku:'NW-MERINO-S', price:'89.00', compareAtPrice:'', inventoryQuantity:45, inventoryItem:{id:'gid://shopify/InventoryItem/11'}, metafields:{ nodes:[{ namespace:'custom', key:'material', type:'single_line_text_field', value:'100% Merino Wool' }] } },
      { id:'gid://shopify/ProductVariant/12', title:'M', sku:'NW-MERINO-M', price:'89.00', compareAtPrice:'', inventoryQuantity:62, inventoryItem:{id:'gid://shopify/InventoryItem/12'}, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/13', title:'L', sku:'NW-MERINO-L', price:'89.00', compareAtPrice:'', inventoryQuantity:28, inventoryItem:{id:'gid://shopify/InventoryItem/13'}, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/2', title:'Leather Crossbody Bag — Tan', status:'ACTIVE', vendor:'StudioLeather', tags:['bags','accessories','sale'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=80&q=70' },
    collections:{ nodes:[{id:'gid://shopify/Collection/3',title:'Accessories'},{id:'gid://shopify/Collection/1',title:'Winter Sale'}] },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/21', title:'Default', sku:'SL-CROSS-TAN', price:'149.00', compareAtPrice:'189.00', inventoryQuantity:18, inventoryItem:{id:'gid://shopify/InventoryItem/21'}, metafields:{ nodes:[{ namespace:'custom', key:'campaign_label', type:'single_line_text_field', value:'Summer Sale' }] } },
    ]}},
  { id:'gid://shopify/Product/3', title:'Organic Cotton Oversized Tee', status:'ACTIVE', vendor:'EarthBasics', tags:['apparel','sustainable','basics'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=80&q=70' },
    collections:{ nodes:[{id:'gid://shopify/Collection/2',title:'Clothing'}] },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/31', title:'XS / White', sku:'EB-TEE-XS-WHT', price:'34.00', compareAtPrice:'', inventoryQuantity:0,  inventoryItem:{id:'gid://shopify/InventoryItem/31'}, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/32', title:'S / White',  sku:'EB-TEE-S-WHT',  price:'34.00', compareAtPrice:'', inventoryQuantity:55, inventoryItem:{id:'gid://shopify/InventoryItem/32'}, metafields:{ nodes:[] } },
      { id:'gid://shopify/ProductVariant/33', title:'M / Black',  sku:'EB-TEE-M-BLK',  price:'34.00', compareAtPrice:'', inventoryQuantity:40, inventoryItem:{id:'gid://shopify/InventoryItem/33'}, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/4', title:'Ceramic Pour-Over Coffee Set', status:'DRAFT', vendor:'KitchenStudio', tags:['kitchen','coffee','gifts'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=80&q=70' },
    collections:{ nodes:[{id:'gid://shopify/Collection/4',title:'Gifts & Home'}] },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/41', title:'White',       sku:'KS-POUROVER-WHT', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:22, inventoryItem:{id:'gid://shopify/InventoryItem/41'}, metafields:{ nodes:[{ namespace:'seo', key:'custom_title', type:'single_line_text_field', value:'' }] } },
      { id:'gid://shopify/ProductVariant/42', title:'Matte Black', sku:'KS-POUROVER-BLK', price:'64.00', compareAtPrice:'79.00', inventoryQuantity:14, inventoryItem:{id:'gid://shopify/InventoryItem/42'}, metafields:{ nodes:[] } },
    ]}},
  { id:'gid://shopify/Product/5', title:'Natural Rubber Yoga Mat 6mm', status:'ACTIVE', vendor:'MoveWell', tags:['fitness','yoga','eco'],
    featuredImage:{ url:'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=80&q=70' },
    collections:{ nodes:[{id:'gid://shopify/Collection/5',title:'Sports & Fitness'}] },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/51', title:'Default', sku:'MW-YOGAMAT-6MM', price:'78.00', compareAtPrice:'', inventoryQuantity:33, inventoryItem:{id:'gid://shopify/InventoryItem/51'}, metafields:{ nodes:[{ namespace:'custom', key:'thickness_mm', type:'number_integer', value:'6' }] } },
    ]}},
  { id:'gid://shopify/Product/6', title:'Linen Duvet Cover Set — King', status:'ARCHIVED', vendor:'HomeTextile', tags:['bedding','linen','home'],
    featuredImage:null,
    collections:{ nodes:[{id:'gid://shopify/Collection/4',title:'Gifts & Home'}] },
    variants:{ nodes:[
      { id:'gid://shopify/ProductVariant/61', title:'Sand', sku:'HT-DUVET-K-SND', price:'189.00', compareAtPrice:'229.00', inventoryQuantity:7, inventoryItem:{id:'gid://shopify/InventoryItem/61'}, metafields:{ nodes:[] } },
    ]}},
];

/* ── ANALYTICS ── */
// ── Feedback/share popup ──
function getPushCount(){ return parseInt(localStorage.getItem('lederly_push_count')||'0',10); }
function incPushCount(){ const n=getPushCount()+1; localStorage.setItem('lederly_push_count',n); return n; }
function shouldShowShare(n){ return n===3 || n===6 || (n>6 && (n-6)%5===0); }

function showSharePopup(){
  const shareText = encodeURIComponent('I\'ve been using Lederly to bulk edit my Shopify products — saves me hours. Free to try:');
  const shareUrl  = encodeURIComponent('https://lederly.com');
  const links = [
    { label:'WhatsApp',  color:'#25D366', icon:'W', href:`https://wa.me/?text=${shareText}%20${shareUrl}` },
    { label:'Telegram',  color:'#2AABEE', icon:'T', href:`https://t.me/share/url?url=${shareUrl}&text=${shareText}` },
    { label:'LinkedIn',  color:'#0A66C2', icon:'in', href:`https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}` },
    { label:'X',         color:'#000',    icon:'𝕏', href:`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}` },
  ];
  const container = document.getElementById('share-links');
  if(container) container.innerHTML = links.map(l=>
    `<a href="${l.href}" target="_blank" rel="noopener" title="${l.label}"
        style="width:44px;height:44px;border-radius:10px;background:${l.color};color:#fff;
               display:flex;align-items:center;justify-content:center;font-size:13px;
               font-weight:700;text-decoration:none;font-family:system-ui">${l.icon}</a>`
  ).join('');
  openModal('m-share');
}

function trackPushAndMaybeShare(){
  if(S.demo) return;
  const n = incPushCount();
  if(shouldShowShare(n)) setTimeout(showSharePopup, 1200);
}

function trackEv(event, meta){
  if(S.demo) return;
  try{
    const headers={'Content-Type':'application/json'};
    if(S.shop) headers['X-Shopify-Shop']=S.shop;
    if(S.token) headers['X-Shopify-Token']=S.token;
    fetch('/api/track',{method:'POST',headers,body:JSON.stringify({event,...(meta||{})})}).catch(()=>{});
  }catch{}
}

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
async function api(path,body={},signal=null){
  const opts={method:'POST',headers:apiH(),body:JSON.stringify(body)};
  if(signal) opts.signal=signal;
  const r=await fetch(path,opts);
  const ct=r.headers.get('content-type')||'';
  if(!ct.includes('application/json')){
    throw new Error(`Server error (${r.status}) — please try again`);
  }
  const j=await r.json(); if(!j.ok)throw new Error(j.error||'Request failed'); return j;
}

/* ── CONNECT ── */
function startOAuth(){
  let raw = $('f-shop').value.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
  if(!raw) return toast('Enter your store name — e.g. your-store');
  if(!raw.includes('.myshopify.com')) raw = raw.replace(/\.myshopify\.com.*$/,'') + '.myshopify.com';
  if(new URLSearchParams(location.search).get('openSchedules')==='1') sessionStorage.setItem('openSchedules','1');
  window.location.href = `/auth/start?shop=${encodeURIComponent(raw)}`;
}

async function afterOAuth(shop, token, silent=false){
  S.shop=shop; S.token=token; S.demo=false;

  // Fast restore from cache — show app instantly, then refresh in background
  if(silent){
    trackEv('app_open', { returning: true });
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
      maybeStartTour();
      return;
    }
  }

  showScreen('s-loading'); $('loading-msg').textContent='Connecting to your store…';
  try{
    const t = await api('/api/test');
    saveCredentials(shop, token);
    $('store-name').textContent = t.shop.name;
    $('loading-msg').textContent='Loading products…';
    await Promise.all([ loadProducts(), loadMfDefs(), loadColls() ]);
    saveProductsCache(t.shop.name);
    showScreen('s-app');
    loadSchedules();
    if(!silent) toast('Connected — all info loaded. Session only, no data stored.');
    if(!silent) setTimeout(maybeShowWelcome, 800);
    if(localStorage.getItem('be_welcome_done_'+S.shop)) maybeStartTour();
    const shouldOpenSchedules = new URLSearchParams(location.search).get('openSchedules')==='1' || sessionStorage.getItem('openSchedules')==='1';
    if(shouldOpenSchedules){
      history.replaceState(null,'',location.pathname);
      sessionStorage.removeItem('openSchedules');
      setTimeout(openScheduleModal, 400);
    }
  }catch(e){
    clearCredentials();
    showScreen('s-connect');
    if(!silent) toast(e.message);
    else{ $('f-shop').value=shop; toast('Session expired — please reconnect.'); }
  }
}

let _loadAbort = null;
async function loadProducts(q='', append=false){
  if(!append){
    if(_loadAbort){ _loadAbort.abort(); }
    _loadAbort = new AbortController();
    S.pageInfo={hasNextPage:false,endCursor:null};
  }
  setStatus(append?'Loading more…':'Loading…');
  try{
    const r=await api('/api/products',{query:q,first:50,after:append?S.pageInfo.endCursor:null}, append?null:_loadAbort?.signal);
    const newProds=r.products.map(normProd);
    if(append){
      S.products=[...S.products,...newProds];
      S.originals=[...S.originals,...newProds.map(p=>clone(p))];
    } else {
      S.products=newProds; S.originals=clone(newProds);
    }
    S.pageInfo=r.pageInfo||{hasNextPage:false,endCursor:null};
    renderTable();
    if(!append){ initExportFields(); buildTagFilter(); buildCollFilter(); }
    setStatus(`${S.products.length} product${S.products.length!==1?'s':''} loaded${S.pageInfo.hasNextPage?' · more available':''}`);;
    renderLoadMore();
  }catch(e){
    if(e.name==='AbortError') return;
    toast(e.message); setStatus('Load failed','dirty');
  }
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
  document.getElementById('page-warn')?.remove();
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
    collections: (p.collections?.nodes||[]).map(c=>({id:c.id,title:c.title})),
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
  renderTable(); initExportFields(); buildTagFilter(); buildCollFilter();
  showScreen('s-app');
  toast('Demo loaded — changes won\'t be saved.');
  maybeStartTour();
  // Track demo start (not S.demo guard — we want this one)
  try{ fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'demo_start'})}).catch(()=>{}); }catch{}
}

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
function saveProductsCache(storeName){
  try{ localStorage.setItem('be_cache',JSON.stringify({storeName,products:S.products,mfDefs:S.mfDefs,ts:Date.now()})); }catch{}
}
function loadProductsCache(){
  try{
    const raw=localStorage.getItem('be_cache'); if(!raw)return null;
    const c=JSON.parse(raw);
    if(Date.now()-c.ts>CACHE_TTL)return null;
    return c;
  }catch{return null;}
}
async function refreshInBackground(){
  try{
    const t=await api('/api/test');
    $('store-name').textContent=t.shop.name;
    // Only refresh if no unsaved changes (avoid overwriting user's work)
    if(Object.keys(S.changes).length===0){
      await Promise.all([loadProducts(),loadMfDefs(),loadColls()]);
      saveProductsCache(t.shop.name);
    }
  }catch{
    clearCredentials(); localStorage.removeItem('be_cache');
    showScreen('s-connect'); toast('Session expired — please reconnect.');
  }
}

function disconnect(){
  trackEv('disconnect');
  clearCredentials();
  localStorage.removeItem('be_cache');
  Object.assign(S,{shop:'',token:'',demo:false,products:[],originals:[],changes:{},mfDefs:[],collsCache:null,locations:null,past:[],future:[],filter:'all',searchQ:'',tagFilter:'',collFilter:'',bulkType:null,pageInfo:{hasNextPage:false,endCursor:null}});
  const lm=document.getElementById('load-more-wrap'); if(lm)lm.style.display='none';
  S.selectedVids=new Set();
  $('f-shop').value='';
  $('demo-banner').classList.add('hidden');
  showScreen('s-connect');
  updateUndoUI(); updateSaveBtn();
  toast('Disconnected.');
}

/* ── UNDO/REDO ── */
function pushH(label){}
function updateUndoUI(){}
document.addEventListener('keydown',e=>{
  const m=e.ctrlKey||e.metaKey;
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
    const mc=!S.collFilter||(p.collections||[]).some(c=>c.id===S.collFilter);
    return ms&&mf&&mt&&mc;
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
function buildCollFilter(){
  const sel=$('coll-filter'); if(!sel) return;
  const prev=S.collFilter;
  const colls=S.collsCache?.length
    ?[...S.collsCache]
    :[...new Map(S.products.flatMap(p=>p.collections||[]).map(c=>[c.id,c])).values()].sort((a,b)=>a.title.localeCompare(b.title));
  sel.innerHTML='<option value="">All collections</option>'+colls.map(c=>`<option value="${esc(c.id)}"${c.id===prev?' selected':''}>${esc(c.title)}</option>`).join('');
  if(prev && !colls.find(c=>c.id===prev)) S.collFilter='';
}

async function loadColls(){
  if(S.demo){
    S.collsCache=null; // demo uses inline collections from products
    buildCollFilter(); return;
  }
  try{
    const r=await api('/api/collections',{first:100});
    S.collsCache=r.collections||[];
    buildCollFilter();
  }catch(e){ S.collsCache=[]; }
}

function renderTable(){
  const rows=getFiltered(); const tbody=$('tbody');
  if(!rows.length){ tbody.innerHTML='<tr><td colspan="13" style="text-align:center;padding:48px;color:var(--t3)">No products match.</td></tr>'; return; }
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
  const mainScheds=schedList.filter(b=>!b.isRevert);
  const revertScheds=schedList.filter(b=>b.isRevert);
  const tip=(b,action)=>{const dt=new Date(b.scheduledFor).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});return`Action: ${action}\nSchedule: ${b.label}\nScheduled: ${dt}`;};
  const rb=revertScheds.length>0?`<div class="sched-val-badge-amber" data-stip="${esc(tip(revertScheds[0],'Auto-revert'))}">⏰ ↩ auto-revert</div>`:'';
  const priceBadge=mainScheds.filter(b=>b.vf.price!==undefined).map(b=>`<div class="sched-val-badge" data-stip="${esc(tip(b,'Change price'))}">⏰ → ${Number(b.vf.price).toFixed(2)}</div>`).join('')+revertScheds.filter(b=>b.vf.price!==undefined).map(b=>`<div class="sched-val-badge-amber" data-stip="${esc(tip(b,'Revert price'))}">⏰ ↩ ${Number(b.vf.price).toFixed(2)}</div>`).join('');
  const catBadge=mainScheds.filter(b=>b.vf.compareAtPrice!==undefined).map(b=>{const val=b.vf.compareAtPrice?Number(b.vf.compareAtPrice).toFixed(2):'removed';return`<div class="sched-val-badge" data-stip="${esc(tip(b,'Change compare at'))}">⏰ → ${esc(val)}</div>`;}).join('')+revertScheds.filter(b=>b.vf.compareAtPrice!==undefined).map(b=>{const val=b.vf.compareAtPrice?Number(b.vf.compareAtPrice).toFixed(2):'removed';return`<div class="sched-val-badge-amber" data-stip="${esc(tip(b,'Revert compare at'))}">⏰ ↩ ${esc(val)}</div>`;}).join('');
  const statusBadge=mainScheds.filter(b=>b.pf.status).map(b=>`<div class="sched-val-badge" data-stip="${esc(tip(b,'Change status'))}">${esc(b.pf.status)} scheduled</div>`).join('')+(revertScheds.some(b=>b.pf.status)?rb:'');
  const vendorBadge=mainScheds.filter(b=>b.pf.vendor!==undefined).map(b=>`<div class="sched-val-badge" data-stip="${esc(tip(b,'Change vendor'))}">${esc(b.pf.vendor||'(none)')} scheduled</div>`).join('')+(revertScheds.some(b=>b.pf.vendor!==undefined)?rb:'');
  const tagsBadge=mainScheds.filter(b=>b.pf.tags!==undefined).map(b=>{
    const cur=p.tags||[];
    const nxt=Array.isArray(b.pf.tags)?b.pf.tags:String(b.pf.tags).split(',').map(t=>t.trim()).filter(Boolean);
    const added=nxt.filter(t=>!cur.includes(t));
    const removed=cur.filter(t=>!nxt.includes(t));
    const parts=[];
    if(added.length) parts.push(`<div class="sched-val-badge" data-stip="${esc(tip(b,'Edit tags'))}">+ ${esc(added.join(', '))} scheduled</div>`);
    if(removed.length) parts.push(`<div class="sched-val-badge-red" data-stip="${esc(tip(b,'Edit tags'))}">- ${esc(removed.join(', '))} scheduled</div>`);
    return parts.join('');
  }).join('')+(revertScheds.some(b=>b.pf.tags!==undefined)?rb:'');
  const descBadge=mainScheds.filter(b=>b.pf.bodyHtml!==undefined).map(b=>`<div class="sched-val-badge" data-stip="${esc(tip(b,'Edit description'))}">description scheduled</div>`).join('')+(revertScheds.some(b=>b.pf.bodyHtml!==undefined)?rb:'');
  const seoBadge=mainScheds.filter(b=>b.pf.seo!==undefined).map(b=>`<div class="sched-val-badge" data-stip="${esc(tip(b,'Edit SEO'))}">SEO scheduled</div>`).join('')+(revertScheds.some(b=>b.pf.seo!==undefined)?rb:'');
  const skuBadge=mainScheds.filter(b=>b.vf.sku!==undefined).map(b=>`<div class="sched-val-badge" data-stip="${esc(tip(b,'Change SKU'))}">→ ${esc(b.vf.sku||'(empty)')}</div>`).join('');
  const seoMissing=!p.seo?.title&&!p.seo?.description;
  const seoIndicator=seoMissing?`<span class="seo-missing" title="No SEO title/description set">SEO</span>`:'';
  const bodyStripped=(p.bodyHtml||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const descInp=`<input class="ce desc-inp" data-pid="${esc(p.id)}" data-field="bodyHtml" placeholder="Description…" value="${esc(bodyStripped)}">`;
  const collsHTML=(p.collections||[]).map(c=>`<span class="coll-tag" data-coll-id="${esc(c.id)}" title="Filter by ${esc(c.title)}">${esc(c.title)}</span>`).join('')||`<span class="mf-empty">—</span>`;
  return `<tr class="${cls}" data-pid="${esc(p.id)}" data-vid="${esc(v.id)}">
<td><input type="checkbox" class="row-chk" data-vid="${esc(v.id)}" ${sel?'checked':''}></td>
<td>${imgCell}</td>
<td><div class="title-cell"><div class="title-row"><input class="ce${dirty?' dirty':''}" data-pid="${esc(p.id)}" data-field="title" value="${esc(p.title)}"><a class="shopify-link" href="${esc(shopUrl)}" target="_blank" rel="noopener" title="Open in Shopify">↗</a>${seoIndicator}</div>${descInp}${descBadge||seoBadge?`<div class="badge-stack">${descBadge}${seoBadge}</div>`:''}<span class="mod-chip">modified</span></div></td>
<td><div><span class="status-pill ${stCls}" data-pid="${esc(p.id)}">${stLbl}</span>${statusBadge}</div></td>
<td><div><input class="ce" data-pid="${esc(p.id)}" data-field="vendor" value="${esc(p.vendor||'')}"></div>${vendorBadge}</td>
<td><div class="tags-wrap" id="tw-${esc(p.id)}">${tagsHTML}</div>${tagsBadge?`<div class="badge-stack">${tagsBadge}</div>`:''}</td>
<td><div class="colls-wrap">${collsHTML}</div></td>
<td class="v-title">${esc(v.title||'Default')}</td>
<td><div style="display:flex;flex-direction:column;gap:1px"><input class="ce ce-sku" data-vid="${esc(v.id)}" data-vf="sku" value="${esc(v.sku||'')}"><div class="badge-stack">${skuBadge}</div></div></td>
<td><div class="num-cell"><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vf="price" value="${esc(v.price||'')}"><div class="badge-stack">${priceBadge}</div></div></td>
<td><div class="num-cell"><input class="ce ce-num" type="number" step=".01" min="0" data-vid="${esc(v.id)}" data-vf="compareAtPrice" placeholder="—" value="${esc(v.compareAtPrice||'')}"><div class="badge-stack">${catBadge}</div></div></td>
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
    // Shopify stores UTC ISO strings — convert to local time for the datetime-local input
    let dtVal='';
    if(currentVal){
      const d=new Date(currentVal);
      dtVal=isNaN(d.getTime())?currentVal.replace(' ','T').slice(0,16)
        :new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
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
  const widths=[34,44,240,90,110,160,130,110,100,82,90,72,220];
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
    if(el.classList.contains('coll-tag')){
      const cid=el.dataset.collId; if(!cid) return;
      S.collFilter=S.collFilter===cid?'':cid;
      const sel=$('coll-filter'); if(sel){ sel.value=S.collFilter; sel.classList.toggle('active',!!S.collFilter); }
      renderTable(); return;
    }
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
  // Convert datetime-local (local time, no tz) to UTC ISO string for Shopify
  if(type==='date_time' && val){
    try{ const d=new Date(val); if(!isNaN(d.getTime())) val=d.toISOString(); }catch{}
  }
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
function toggleAll(checked){
  document.querySelectorAll('.row-chk').forEach(cb=>{cb.checked=checked;toggleRowSel(cb.dataset.vid,checked);});
}
function clearSelection(){
  S.selectedVids=new Set();
  const chkAll=$('chk-all'); if(chkAll)chkAll.checked=false;
  updateBulkBar();
}
function updateBulkBar(){
  const n=S.selectedVids.size;
  $('bulk-bar').classList.toggle('hidden',n===0);
  $('bulk-lbl').textContent=`${n} selected`;
  updateSaveBtn();
}
function getSelPids(){ const ids=new Set(); S.selectedVids.forEach(vid=>{const{p}=getVar(vid);if(p)ids.add(p.id);}); return[...ids]; }

/* ── SAVE BUTTON ── */
function updateSaveBtn(){
  const n=Object.keys(S.changes).length;
  const sel=S.selectedVids.size;
  $('btn-save').disabled=!n; $('save-count').textContent=n;
  $('btn-discard').classList.toggle('hidden',!n);
  if(n){
    const selPart=sel?` · ${sel} selected`:'';
    setStatus(`${n} unsaved change${n!==1?'s':''}${selPart}`, 'dirty');
    Object.keys(S.changes).forEach(pid=>{
      document.querySelectorAll(`tr[data-pid="${pid}"]`).forEach(tr=>tr.classList.add('r-changed'));
    });
  }else{
    const selPart=sel?`${sel} selected`:'Ready';
    setStatus(selPart, sel?'':'ready');
  }
}

function discardChanges(){
  if(!Object.keys(S.changes).length) return;
  S.products=clone(S.originals);
  S.changes={};
  renderTable(); updateSaveBtn();
  toast('Changes discarded.');
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
    body.innerHTML=`<div class="bulk-field"><label>Rule</label><select id="bv-price-rule"><option value="set">Set fixed price</option><option value="pct-up">Increase by %</option><option value="pct-down">Decrease by %</option><option value="amt-up">Increase by amount</option><option value="amt-down">Decrease by amount</option><option value="round99">Round to .99</option><option value="round00">Round to .00</option></select></div><div class="bulk-field" id="bv-price-val-wrap"><label id="bv-price-val-lbl">New price</label><input id="bv-price-val" type="number" step=".01" min="0" placeholder="0.00" autofocus></div><div style="margin-top:4px"><label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--t2);font-weight:400;font-family:var(--font);text-transform:none;letter-spacing:0"><input type="checkbox" id="bv-also-compare" style="width:14px;height:14px;flex-shrink:0;accent-color:var(--green);cursor:pointer"> Also apply to Compare at price</label></div>`;
    body.querySelector('#bv-price-rule').addEventListener('change',e=>{
      const rule=e.target.value;
      const wrap=$('bv-price-val-wrap'),lbl=$('bv-price-val-lbl');
      const isRound=rule==='round99'||rule==='round00';
      if(wrap)wrap.style.display=isRound?'none':'';
      if(lbl){if(rule==='set')lbl.textContent='New price';else if(rule==='pct-up'||rule==='pct-down')lbl.textContent='Percentage (%)';else lbl.textContent='Amount';}
    });
  }else if(type==='compareAt'){
    body.innerHTML=`<div class="bulk-field"><label>Rule</label><select id="bv-cat-rule"><option value="set">Set fixed price</option><option value="pct-up">Increase by %</option><option value="pct-down">Decrease by %</option><option value="amt-up">Increase by amount</option><option value="amt-down">Decrease by amount</option><option value="round99">Round to .99</option><option value="round00">Round to .00</option><option value="clear">Clear (remove strikethrough)</option></select></div><div class="bulk-field" id="bv-cat-val-wrap"><label id="bv-cat-val-lbl">New price</label><input id="bv-cat-val" type="number" step=".01" min="0" placeholder="0.00" autofocus></div><p style="font-size:11px;color:var(--t3);margin:0 0 4px;font-family:var(--mono)">Relative rules (%, amount, round) apply only to variants that already have a Compare at price.</p>`;
    body.querySelector('#bv-cat-rule').addEventListener('change',e=>{
      const rule=e.target.value;
      const wrap=$('bv-cat-val-wrap'),lbl=$('bv-cat-val-lbl');
      const hide=rule==='round99'||rule==='round00'||rule==='clear';
      if(wrap)wrap.style.display=hide?'none':'';
      if(lbl){if(rule==='set')lbl.textContent='New price';else if(rule==='pct-up'||rule==='pct-down')lbl.textContent='Percentage (%)';else lbl.textContent='Amount';}
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
    const htmlToText=h=>(h||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>\s*<p[^>]*>/gi,'\n\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
    const selPids=getSelPids();
    const firstDesc=htmlToText(selPids.length>0?(getProd(selPids[0])?.bodyHtml||''):'');
    const allSame=selPids.length>1&&selPids.every(pid=>htmlToText(getProd(pid)?.bodyHtml||'')===firstDesc);
    const hint=selPids.length>1&&!allSame?`<p style="font-size:11px;color:var(--t3);margin:4px 0 0;font-family:var(--mono)">Showing first product's description · ${selPids.length} products have different descriptions</p>`:'';
    body.innerHTML=`<div class="bulk-field"><label>Description <span style="color:var(--t4);font-weight:400">(plain text · replaces current)</span></label><textarea id="bv-desc" rows="6" placeholder="Product description…" style="resize:vertical;min-height:120px;font-size:13px;line-height:1.6" autofocus></textarea>${hint}</div><div class="bulk-field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="bv-desc-clear" style="accent-color:var(--red)"> Clear description (set empty)</label></div>`;
    $('bv-desc').value=firstDesc;
    $('bv-desc-clear')?.addEventListener('change',e=>{ const ta=$('bv-desc'); if(ta){ta.disabled=e.target.checked;ta.style.opacity=e.target.checked?'.35':'1';} });
  }
  if(type==='seo'){
    body.innerHTML=`<div class="bulk-field"><label>SEO Title <span style="color:var(--t4);font-weight:400">(leave blank to keep current)</span></label><input id="bv-seo-title" type="text" maxlength="320" placeholder="e.g. Product Name | Store Name" autofocus><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px;font-weight:400"><input type="checkbox" id="bv-seo-title-clear" style="accent-color:var(--red)"> Clear SEO title</label></div><div class="bulk-field"><label>SEO Description</label><textarea id="bv-seo-desc" rows="3" maxlength="5000" placeholder="Brief description for search engines…" style="resize:vertical;min-height:72px"></textarea><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px;font-weight:400"><input type="checkbox" id="bv-seo-desc-clear" style="accent-color:var(--red)"> Clear SEO description</label></div>`;
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
    const rawVal=clear?'':($('bv-desc')?.value||'');
    if(!clear&&!rawVal.trim())return toast('Enter a description or check "Clear".');
    const textToHtml=t=>{if(!t.trim())return'';const s=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return'<p>'+s.replace(/\n\n+/g,'</p><p>').replace(/\n/g,'<br>')+'</p>';};
    const val=clear?'':textToHtml(rawVal);
    const pids=getSelPids(); if(!pids.length)return toast('Select products first.');
    pushH('Bulk description update');
    pids.forEach(pid=>{const p=getProd(pid);if(!p)return;p.bodyHtml=val;ensureC(pid).product.bodyHtml=val;});
    renderTable(); updateSaveBtn(); toast(`Description updated on ${pids.length} product${pids.length!==1?'s':''}.`);
  }
  if(type==='seo'){
    const clearTitle=$('bv-seo-title-clear')?.checked;
    const clearDesc=$('bv-seo-desc-clear')?.checked;
    const title=clearTitle?'':($('bv-seo-title')?.value||'').trim();
    const desc=clearDesc?'':($('bv-seo-desc')?.value||'').trim();
    if(!clearTitle&&!clearDesc&&!title&&!desc)return toast('Enter a value or check Clear for at least one field.');
    const pids=getSelPids(); if(!pids.length)return toast('Select products first.');
    pushH('Bulk SEO update');
    pids.forEach(pid=>{
      const p=getProd(pid); if(!p)return;
      if(!p.seo)p.seo={title:'',description:''};
      const c=ensureC(pid); if(!c.product.seo)c.product.seo={};
      if(clearTitle||title){p.seo.title=title;c.product.seo.title=title;}
      if(clearDesc||desc){p.seo.description=desc;c.product.seo.description=desc;}
    });
    renderTable(); updateSaveBtn(); toast(`SEO updated on ${pids.length} products.`);
  }
  trackEv('bulk_action',{type, n: getSelPids().length});
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
  if(S.plan==='pending'||S.plan==='expired'){ showUpgradeModal(S.plan==='pending'?'No charge today. Try Lederly free for 7 days, then stay on the plan you pick.':'Your access has ended. Choose a plan to continue editing your products.', S.plan==='pending'?'Choose your plan to start':'Choose a plan to continue'); return; }
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
      const vTitle=p.variants.nodes.find(x=>x.id===v.id)?.title||'variant';
      const isDefault=p.variants.nodes.length===1||vTitle==='Default Title';
      const vLbl=isDefault?'':vTitle+' ';
      ['price','compareAtPrice','sku'].forEach(field=>{
        if(v[field]!==undefined){const old=origV?String(origV[field]??''):'?';const nw=String(v[field]??'');if(old!==nw)diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl+field)}</span><span class="diff-old">${esc(old||'—')}</span><span class="diff-arr">→</span><span class="diff-new">${esc(nw)}</span></div>`);}
      });
    });
    if((c.metafields||[]).length)diffs.push(`<div class="diff-row"><span class="diff-field">metafields</span><span class="diff-new">${c.metafields.length} change${c.metafields.length!==1?'s':''}</span></div>`);
    Object.entries(c.inventory||{}).forEach(([vid,inv])=>{
      const vLbl=p.variants.nodes.find(x=>x.id===vid)?.title||'variant';
      diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl)} inventory</span><span class="diff-old">${esc(String(inv.oldQuantity))}</span><span class="diff-arr">→</span><span class="diff-new">${esc(String(inv.quantity))}</span></div>`);
    });
    return `<div class="diff-item"><div class="diff-item-head">${imgEl}<span class="diff-title">${esc(p.title)}</span></div><div class="diff-rows">${diffs.length?diffs.join(''):'<span style="font-size:11px;color:var(--t3)">Variant / metafield changes</span>'}</div></div>`;
  }).join('');
  // Low-price warning — detect any price set below 1
  const lowPrices=[];
  for(const c of payloads){
    const p=getProd(c.productId); if(!p)continue;
    Object.entries(c.variants||{}).forEach(([vid,v])=>{
      if(v.price!==undefined&&Number(v.price)<1){
        const vTitle=p.variants.nodes.find(x=>x.id===vid)?.title||'';
        const isDefault=!vTitle||vTitle==='Default Title';
        lowPrices.push(`${esc(p.title)}${isDefault?'':` — ${esc(vTitle)}`}: <strong>${Number(v.price).toFixed(2)}</strong>`);
      }
    });
  }
  if(lowPrices.length){
    const affected=lowPrices.length===1?'1 product has a':''+lowPrices.length+' products have a';
    const rows=lowPrices.map(r=>`<div style="margin-top:4px;font-size:12px;color:#92400e">· ${r}</div>`).join('');
    const banner=`<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:2px">⚠ Price below 1.00 — is this correct?</div>
      <div style="font-size:12px;color:#92400e">${affected} price under 1.00 — double-check before saving.</div>
      ${rows}
    </div>`;
    list.innerHTML=banner+list.innerHTML;
  }
  // Reset cancel button to its initial state each time modal opens
  const cb=$('m-save-cancel');
  if(cb){cb.disabled=false;cb.textContent='Cancel';cb.setAttribute('data-close','m-save');}
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
  trackEv('save_attempt', { n: payloads.length });
  const btn=$('m-save-confirm'); btn.disabled=true; btn.textContent='Saving…';
  const cancelBtn=$('m-save-cancel'); if(cancelBtn){cancelBtn.disabled=true; cancelBtn.removeAttribute('data-close');}
  const bar=$('m-save-prog-bar'); if(bar){bar.style.width='0%';bar.style.background='#1a5c38';}
  const prog=$('m-save-prog'); if(prog)prog.style.display='none';
  setStatus('Saving…','saving');
  try{
    if(S.demo){
      for(let i=1;i<=payloads.length;i++){await delay(35);setSaveProgress(i,payloads.length,0);}
      commitAll(payloads); return;
    }

    // Validate JSON metafields before sending anything
    for(const c of payloads){
      for(const mf of (c.metafields||[])){
        if(mf.type==='json'&&mf.value){
          try{ JSON.parse(mf.value); }
          catch{
            const title=getProd(c.productId)?.title||c.productId;
            toast(`Invalid JSON in "${mf.namespace}.${mf.key}" for "${title}". Fix before saving.`);
            btn.disabled=false; btn.textContent='Save to Shopify →';
            if(cancelBtn){cancelBtn.disabled=false; cancelBtn.setAttribute('data-close','m-save');}
            return;
          }
        }
      }
    }

    const savedPids=[], failed=[];
    let done=0;
    const BATCH=20;
    const PARALLEL=3; // 3 batches in parallel → ~3× faster

    // Pre-build all batches, then send PARALLEL at a time
    const allBatches=[];
    for(let i=0;i<payloads.length;i+=BATCH) allBatches.push(payloads.slice(i,i+BATCH));

    for(let i=0;i<allBatches.length;i+=PARALLEL){
      await Promise.allSettled(
        allBatches.slice(i,i+PARALLEL).map(async chunk=>{
          try{
            const products=chunk.map(c=>({
              productId:c.productId,
              product:c.product,
              variants:Object.values(c.variants||{}),
              metafields:(c.metafields||[]).map(({_idx,...rest})=>rest),
            }));
            const r=await api('/api/save-products-bulk',{products});
            for(const res of r.results){
              if(res.ok){ savedPids.push(res.productId); }
              else{ failed.push({pid:res.productId,title:getProd(res.productId)?.title||res.productId,err:res.error||'Failed'}); }
              done++; setSaveProgress(done,payloads.length,failed.length);
            }
          }catch(e){
            chunk.forEach(c=>{
              failed.push({pid:c.productId,title:getProd(c.productId)?.title||c.productId,err:e.message});
              done++; setSaveProgress(done,payloads.length,failed.length);
            });
          }
        })
      );
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

    // Silently reload from Shopify so the table reflects actual saved values
    if(savedPids.length) { localStorage.removeItem('be_cache'); loadProducts(S.searchQ).catch(()=>{}); }

    const allFailed=[...failed,...(invFailed.length?[{pid:'inv',title:'Inventory',err:invFailed.join(', ')}]:[])];

    if(allFailed.length){
      // Show real errors inside modal, keep it open for retry
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
      trackPushAndMaybeShare();
    }
  }catch(e){
    if(/limit|upgrade|plan|100 products/i.test(e.message)) showUpgradeModal(e.message);
    else toast(e.message);
    setStatus('Save failed','dirty');
  }
  finally{
    btn.disabled=false; btn.textContent='Save to Shopify →';
    if(cancelBtn){cancelBtn.disabled=false; cancelBtn.textContent='Close'; cancelBtn.setAttribute('data-close','m-save');}
  }
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
function manualRecap(){ trackEv('export_csv'); dlText(buildRecap(Object.values(S.changes)),`lederly-recap-${Date.now()}.csv`,'text/csv'); }

/* ── SCHEDULES (server-side) ── */
function updateSchedBadge(){
  const n=(S.schedules||[]).filter(s=>s.status==='pending').length;
  const btn=$('btn-schedule'); if(!btn)return;
  btn.textContent=n?`✦ Scheduled (${n})`:'✦ Schedule';
}

function updatePlanBadge(){
  const el=$('plan-badge'); if(!el)return;
  const effectivePlan=S.plan||'basic';
  const inTrial=S.trialInfo?.inTrial;
  const fbBtn=$('btn-feedback');
  if(fbBtn) fbBtn.textContent=['starter','pro'].includes(effectivePlan)?'Support':'Feedback';
  const planLabel=effectivePlan==='pending'?'Choose plan':effectivePlan==='expired'?'Subscription ended':inTrial?`Trial (${S.trialInfo.daysLeft}d)`:effectivePlan==='pro'?'Pro':effectivePlan==='starter'?'Growth':effectivePlan==='beta'?'Beta':'Basic';
  const parts=[];
  if(S.schedLimit===0) parts.push('no scheduling');
  else if(S.schedLimit!==null) parts.push(`${S.schedUsed}/${S.schedLimit} schedules`);
  else parts.push('schedules unlimited');
  el.textContent=`${planLabel} · ${parts.join(' · ')}`;
  el.dataset.plan=effectivePlan;
  const atLimit=S.schedLimit!==null&&S.schedLimit>0&&S.schedUsed>=S.schedLimit;
  const warning=!atLimit&&S.schedLimit!==null&&S.schedLimit>0&&S.schedUsed>=S.schedLimit-1;
  el.dataset.atLimit=atLimit?'1':'0';
  el.dataset.warning=warning?'1':'0';
}

async function loadSchedules(){
  if(S.demo){S.schedules=[];return;}
  try{
    const r=await api('/api/schedule/list',{});
    S.schedules=r.schedules||[];
    S.schedPersistWarning=!!r.persistWarning;
    S.plan=r.plan||'basic';
    S.schedLimit=r.schedLimit??0;
    S.schedUsed=r.schedUsed??0;
    S.periodEnd=r.periodEnd||null;
    S.trialInfo=r.trialInfo||null;
    const trialBanner=document.getElementById('trial-banner');
    // New install: no plan chosen yet → show plan selection
    if(S.plan==='pending'){
      if(trialBanner) trialBanner.style.display='none';
      showUpgradeModal('No charge today. Try Lederly free for 7 days, then stay on the plan you pick.','Choose your plan to start');
      return;
    }
    // Expired: trial/subscription ended → show paywall
    if(S.plan==='expired'){
      const wasTrialOnly=!!S.trialInfo?.trialEndsAt&&!S.trialInfo?.inTrial;
      if(trialBanner){
        trialBanner.style.background='#991b1b';
        document.getElementById('trial-banner-text').textContent=wasTrialOnly?'Your free trial has ended.':'Your subscription has ended.';
        trialBanner.style.display='block';
      }
      showUpgradeModal(wasTrialOnly?'Your free trial has ended. Choose a plan to keep editing your products.':'Your access has ended. Choose a plan to continue editing your products.','Choose a plan to continue');
      return;
    }
    // Backward compat: server-side trial (old installs)
    const trialText=document.getElementById('trial-banner-text');
    if(trialBanner&&S.trialInfo?.inTrial){
      const d=S.trialInfo.daysLeft;
      trialText.textContent=`${d} day${d!==1?'s':''} left in your free trial`;
      trialBanner.style.display='block';
    } else if(trialBanner){ trialBanner.style.display='none'; }
  }catch{ S.schedules=[]; }
  updateSchedBadge();
  updatePlanBadge();
  renderTable();
  startSchedPoller(); // auto-start if any pending on load
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
    const hasRevert=S.plan==='pro'||S.plan==='beta';
    $('m-sched-revert-toggle').disabled=!hasRevert;
    $('revert-pro-badge').classList.toggle('hidden',hasRevert);
    $('revert-pro-hint').classList.toggle('hidden',hasRevert);
    // Last-schedule warning for Growth
    const limitWarn=$('sched-limit-warn');
    if(limitWarn){
      const remaining=S.schedLimit!==null&&S.schedLimit>0?S.schedLimit-S.schedUsed:null;
      if(remaining===1){
        $('sched-limit-warn-text').textContent='⚠ Last schedule available this month.';
        limitWarn.style.display='flex';
      } else { limitWarn.style.display='none'; }
    }
    const d=new Date(); d.setHours(d.getHours()+1,0,0,0);
    $('m-sched-dt').value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    $('m-sched-preview').innerHTML=Object.values(S.changes).map(c=>{
      const prod=getProd(c.productId);
      const title=prod?.title||c.productId;
      const img=prod?.featuredImage?.url||'';
      const parts=[];
      const fields=Object.keys(c.product||{});
      if(fields.length)parts.push(fields.join(', '));
      const varEntries=Object.entries(c.variants||{});
      if(varEntries.length){
        const priceOnly=varEntries.every(([,v])=>Object.keys(v).filter(k=>k!=='id').every(k=>k==='price'||k==='compareAtPrice'));
        if(priceOnly){
          const hasP=varEntries.some(([,v])=>v.price!==undefined);
          const hasC=varEntries.some(([,v])=>v.compareAtPrice!==undefined);
          parts.push(hasP&&hasC?'Price · Compare at':hasP?'Price':'Compare at');
        } else {
          parts.push(`${varEntries.length} variant${varEntries.length!==1?'s':''}`);
        }
      }
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
    }).filter(mf=>mf.value!==''); // skip metafields that were empty before — Shopify rejects blank values
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
          notifyEmail:r.schedule.notifyEmail||notifyEmail, // use resolved email from parent
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
    startSchedPoller(); // start polling now that a new schedule exists
    trackPushAndMaybeShare();
  }catch(e){
    if(/limit|upgrade|plan|schedules/i.test(e.message)) showUpgradeModal(e.message);
    else toast(e.message);
  }
  finally{ btn.disabled=false; btn.textContent='Schedule →'; }
}

let _schedTab='pending';
let _editingSchedId=null;

function getSchedBadges(productId, variantId){
  return (S.schedules||[])
    .filter(s=>s.status==='pending'&&(s.changes||[]).some(c=>c.productId===productId))
    .map(sched=>{
      const chg=(sched.changes||[]).find(c=>c.productId===productId);
      return{label:sched.label, scheduledFor:sched.scheduledFor, isRevert:!!sched.linkedTo, pf:chg?.product||{}, vf:(variantId&&chg?.variants?.[variantId])||{}};
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
  const n=s.changesCount??s.changes.length; // done schedules have changesCount instead of full array
  const overdue=s.status==='pending'&&new Date(s.scheduledFor)<new Date();
  // Detect partial/full failure from the error string "N/M products failed"
  const em=s.error&&s.error.match(/^(\d+)\/(\d+)/);
  const errN=em?parseInt(em[1]):0, errM=em?parseInt(em[2]):0;
  const allFailed=errN>0&&errN>=errM;
  const partFailed=errN>0&&errN<errM;
  const sCls={pending:overdue?'sched-overdue':'sched-pending',executed:allFailed?'sched-fail':partFailed?'sched-partial':'sched-done',failed:'sched-fail',running:'sched-running',cancelled:'sched-cancelled'}[s.status]||'';
  const sLbl={pending:overdue?'Overdue':'Pending',executed:allFailed?'Failed':partFailed?'Partial':'Done',failed:'Failed',running:'Running',cancelled:'Cancelled'}[s.status]||s.status;
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

function buildGroupedSchedHTML(list){
  const mainItems=list.filter(s=>!s.linkedTo);
  const revertsByParent={};
  list.filter(s=>s.linkedTo).forEach(s=>{ revertsByParent[s.linkedTo]=s; });
  const usedRevertIds=new Set();
  const parts=[];
  mainItems.forEach(s=>{
    const revert=revertsByParent[s.id];
    if(revert){
      usedRevertIds.add(revert.id);
      parts.push(`<div class="sched-group">${schedRowHTML(s)}<div class="sched-group-revert">${schedRowHTML(revert)}</div></div>`);
    } else {
      parts.push(schedRowHTML(s));
    }
  });
  list.filter(s=>s.linkedTo&&!usedRevertIds.has(s.id)).forEach(s=>parts.push(schedRowHTML(s)));
  return parts.join('');
}

function renderSchedTabs(all){
  // IDs of parent schedules whose auto-revert is still in flight
  const awaitingRevert=new Set(
    all.filter(s=>s.linkedTo&&['pending','running'].includes(s.status)).map(s=>s.linkedTo)
  );
  // A main schedule stays in Pending until its paired revert also completes
  const pending=all.filter(s=>
    ['pending','running','failed'].includes(s.status)||
    (s.status==='executed'&&awaitingRevert.has(s.id))
  );
  const done=all.filter(s=>['executed','cancelled'].includes(s.status)&&!awaitingRevert.has(s.id));
  const doneCount=done.filter(s=>!s.linkedTo).length;
  const list=_schedTab==='pending'?pending:done;
  const body=$('m-sched-jobs'); if(!body)return;
  const tabsHTML=`<div class="sched-tabs">
    <button class="sched-tab${_schedTab==='pending'?' active':''}" data-sched-tab="pending">Pending${pending.length?` <span class="sched-tab-count">${pending.length}</span>`:''}</button>
    <button class="sched-tab${_schedTab==='done'?' active':''}" data-sched-tab="done">Done${doneCount?` <span class="sched-tab-count">${doneCount}</span>`:''}</button>
  </div>`;
  // Usage meter for Growth plan
  const usageEl=$('sched-usage');
  if(usageEl&&S.plan==='starter'&&S.schedLimit!==null&&S.schedLimit>0){
    const used=S.schedUsed; const total=S.schedLimit; const pct=Math.min(used/total*100,100);
    const color=pct>=100?'#ef4444':pct>=80?'var(--amber)':'var(--green)';
    $('sched-usage-label').textContent=`${used} / ${total} schedules used this month`;
    $('sched-usage-fill').style.cssText=`width:${pct}%;background:${color}`;
    const upBtn=$('sched-usage-upgrade');
    if(upBtn) upBtn.style.display=pct>=80?'':'none';
    usageEl.style.display='flex';
  } else if(usageEl){ usageEl.style.display='none'; }
  const listHTML=list.length
    ?buildGroupedSchedHTML(list)
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
    startSchedPoller(); // start background polling if any pending
  }catch(e){ body.innerHTML=`<p class="sched-empty" style="color:var(--red)">${esc(e.message)}</p>`; }
}

// ── Background schedule poller ──
// Polls every 15s when there are pending/running schedules.
// Reloads products when a schedule completes.
let _schedPollTimer=null;
let _schedStatusSnap={}; // id → status last seen

function startSchedPoller(){
  if(_schedPollTimer) return; // already running
  const hasPending=(S.schedules||[]).some(s=>['pending','running'].includes(s.status));
  if(!hasPending) return;
  // Snapshot current statuses
  _schedStatusSnap={};
  (S.schedules||[]).forEach(s=>{_schedStatusSnap[s.id]=s.status;});
  _schedPollTimer=setInterval(_pollSchedTick, 15000);
}

function stopSchedPoller(){
  if(_schedPollTimer){ clearInterval(_schedPollTimer); _schedPollTimer=null; }
}

async function _pollSchedTick(){
  if(S.demo) return;
  try{
    const r=await api('/api/schedule/list',{});
    const fresh=r.schedules||[];
    // Detect completions
    let completed=[];
    for(const s of fresh){
      const prev=_schedStatusSnap[s.id];
      if(prev&&['pending','running'].includes(prev)&&s.status==='executed'){
        completed.push(s.label||s.id);
      }
    }
    // Update snapshot + store
    _schedStatusSnap={};
    fresh.forEach(s=>{_schedStatusSnap[s.id]=s.status;});
    S.schedules=fresh;
    updateSchedBadge();
    renderSchedTabs(S.schedules);

    if(completed.length){
      const names=completed.slice(0,2).map(l=>`"${l}"`).join(', ');
      toast(`Schedule ${names} completed — refreshing products…`);
      localStorage.removeItem('be_cache');
      await loadProducts(S.searchQ);
    }

    // Stop when no more pending
    const stillPending=fresh.some(s=>['pending','running'].includes(s.status));
    if(!stillPending) stopSchedPoller();
  }catch{} // silent — retry next tick
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
async function setFilter(f){
  S.filter=f;
  clearSelection();
  document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b.dataset.f===f));
  if(f!=='all' && S.pageInfo.hasNextPage && !S.demo) await loadAllProducts(S.searchQ);
  renderTable();
}

/* ── TABS ── */
function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));
  if(name==='export')updateExportPreview();
}

/* ── EXPORT ── */
const EX_ALL=['handle','id','title','status','vendor','tags','variant','sku','price','compareAtPrice','inventoryQuantity'];
const EX_LBL={handle:'Handle',id:'ID',title:'Title',status:'Status',vendor:'Vendor',tags:'Tags',variant:'Variant',sku:'SKU',price:'Price',compareAtPrice:'Compare at',inventoryQuantity:'Inventory'};

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
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-discard').addEventListener('click', discardChanges);
  $('btn-save').addEventListener('click', openSaveModal);
  $('btn-refresh').addEventListener('click', ()=>{ if(!S.demo) Promise.all([loadMfDefs(), loadProducts(S.searchQ)]); });

  // Search
  $('search').addEventListener('input', e=>{
    S.searchQ=e.target.value.trim(); clearSelection(); renderTable();
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
  $('search-suggest').addEventListener('mousedown',e=>{ const item=e.target.closest('.suggest-item'); if(!item)return; $('search').value=item.dataset.val; S.searchQ=item.dataset.val.toLowerCase(); $('search-suggest').classList.remove('open'); clearSelection(); renderTable(); });
  document.addEventListener('click',e=>{ if(!e.target.closest('.search-box'))$('search-suggest').classList.remove('open'); });

  // Filters
  document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>setFilter(btn.dataset.f)));
  $('tag-filter').addEventListener('change', async e=>{
    S.tagFilter=e.target.value; clearSelection();
    $('tag-filter').classList.toggle('active', !!S.tagFilter);
    if(S.tagFilter && S.pageInfo.hasNextPage && !S.demo) await loadAllProducts(S.searchQ);
    renderTable();
  });
  $('coll-filter').addEventListener('change', async e=>{
    S.collFilter=e.target.value; clearSelection();
    $('coll-filter').classList.toggle('active', !!S.collFilter);
    if(S.collFilter && S.pageInfo.hasNextPage && !S.demo) await loadAllProducts(S.searchQ);
    renderTable();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));

  // Select all
  $('chk-all').addEventListener('change',e=>toggleAll(e.target.checked));

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

  // Usage meter upgrade button
  const usageUpgradeBtn=$('sched-usage-upgrade');
  if(usageUpgradeBtn) usageUpgradeBtn.addEventListener('click',()=>{
    showUpgradeModal('Upgrade to Pro for unlimited schedules and auto-revert.','Unlock unlimited schedules');
  });

  // billing_ok / billing_error from redirect
  (()=>{
    const p=new URLSearchParams(location.search);
    const ok=p.get('billing_ok'), err=p.get('billing_error');
    if(ok){
      const n=ok==='starter'?'Growth':(ok.charAt(0).toUpperCase()+ok.slice(1));
      toast(`${n} plan activated! Welcome aboard.`);
      history.replaceState({},'','/app');
    }
    if(err){
      toast('Billing not completed. Try again from the upgrade modal.','warn');
      history.replaceState({},'','/app');
    }
  })();

  // Feedback / Support
  $('btn-feedback').addEventListener('click', ()=>{
    const isSupport = ['starter','pro'].includes(S.plan);
    $('fb-title').textContent   = isSupport ? 'Contact support'          : 'Share feedback';
    $('fb-sub').textContent     = isSupport ? 'Describe your issue and we\'ll get back to you.' : 'What\'s working? What\'s missing?';
    $('fb-label').innerHTML     = isSupport ? 'Your message <span style="color:var(--red)">*</span>' : 'Your feedback <span style="color:var(--red)">*</span>';
    $('fb-message').placeholder = isSupport ? 'Describe the issue or what you need help with…'  : 'Tell us what you think, what\'s broken, or what you\'d love to see…';
    $('fb-submit').textContent  = isSupport ? 'Send message →' : 'Send feedback →';
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
  $('btn-schedule').addEventListener('click', ()=>{
    if(S.schedLimit===0) return showUpgradeModal('Scheduling is available from the Growth plan (€9.99/mo).', 'Upgrade to schedule');
    openScheduleModal();
  });
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
        // Reload products so the table reflects current Shopify state after any schedule change
        localStorage.removeItem('be_cache');
        loadProducts(S.searchQ).catch(()=>{});
      }
      await renderSchedJobsList();
    }catch(err){ toast(err.message); btn.disabled=false; }
  });

  // CSV Import
  $('btn-import-csv').addEventListener('click', ()=>{
    if((S.plan==='basic')&&!S.demo){ showUpgradeModal('CSV Import is available from the Growth plan (€9.99/mo).','Upgrade to import CSV'); return; }
    $('csv-file-input').click();
  });
  $('btn-csv-template').addEventListener('click', downloadCSVTemplate);
  $('csv-file-input').addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f){ trackEv('csv_import'); openImportModal(f); } e.target.value=''; });
  $('m-import-apply').addEventListener('click', applyImport);
  $('m-import-tpl').addEventListener('click', downloadCSVTemplate);

  // Welcome modal
  $('btn-welcome-done').addEventListener('click', ()=>{
    const source=$('welcome-source').value;
    if(source) trackEv('beta_source',{source});
    localStorage.setItem('be_welcome_done_'+S.shop,'1');
    closeModal('m-welcome');
    setTimeout(maybeStartTour, 400);
  });

  // Generic close buttons
  document.addEventListener('click',e=>{
    const id=e.target.closest('[data-close]')?.dataset.close;
    if(id)closeModal(id);
    if(e.target.classList.contains('overlay'))closeModal(e.target.id);
  });

  // Custom schedule badge tooltip
  const stipEl=document.getElementById('stip');
  let stipTimer=null;
  document.addEventListener('mouseover',e=>{
    const el=e.target.closest('[data-stip]');
    if(!el||!stipEl)return;
    clearTimeout(stipTimer);
    stipTimer=setTimeout(()=>{
      const lines=el.dataset.stip.split('\n');
      stipEl.innerHTML=lines.map(l=>{
        const idx=l.indexOf(': ');
        if(idx<0)return`<div class="stip-row"><span class="stip-val">${esc(l)}</span></div>`;
        return`<div class="stip-row"><span class="stip-key">${esc(l.slice(0,idx))}</span><span class="stip-val">${esc(l.slice(idx+2))}</span></div>`;
      }).join('');
      const r=el.getBoundingClientRect();
      stipEl.style.display='block';
      const tw=stipEl.offsetWidth, th=stipEl.offsetHeight;
      let left=r.left, top=r.bottom+6;
      if(left+tw>window.innerWidth-8)left=window.innerWidth-tw-8;
      if(top+th>window.innerHeight-8)top=r.top-th-6;
      stipEl.style.left=left+'px'; stipEl.style.top=top+'px';
    },120);
  });
  document.addEventListener('mouseout',e=>{
    if(!e.target.closest('[data-stip]'))return;
    clearTimeout(stipTimer);
    if(stipEl)stipEl.style.display='none';
  });

  // Keyboard
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')['m-bulk','m-save','m-coll','m-sched'].forEach(id=>closeModal(id)); });

  // Table events
  bindTable();
  initColResize();

  // OAuth callback / session restore / demo URL
  (function(){
    const p=new URLSearchParams(window.location.search);
    const shop=p.get('shop'), code=p.get('code'), demo=p.get('demo');
    if(demo==='1'){ window.history.replaceState({},'','/app'); loadDemoMode(); return; }
    // New: one-time code flow — token never in URL
    if(shop && code){
      window.history.replaceState({},'','/app');
      showScreen('s-loading'); $('loading-msg').textContent='Authenticating…';
      fetch(`/auth/token?code=${encodeURIComponent(code)}`)
        .then(r=>r.json())
        .then(j=>{ if(!j.ok) throw new Error(j.error||'Authentication failed.'); return afterOAuth(j.shop, j.token); })
        .catch(e=>{ showScreen('s-connect'); toast(e.message); });
      return;
    }
    // Restore session from localStorage (persists 7 days across tab closes)
    const cred=loadCredentials();
    if(cred){ afterOAuth(cred.shop, cred.token, true); return; }
  })();
}

// ═══════════ CSV IMPORT ═══════════
let _importData = null;

function downloadCSVTemplate() {
  const headers = ['handle','title','vendor','tags','status','sku','price','compareAtPrice','Body (HTML)','SEO Title','SEO Description'];
  const example = ['my-summer-tee','Summer Classic Tee','My Brand','sale, summer','Active','SKU-001','29.99','49.99','<p>Lightweight cotton tee perfect for summer.</p>','Summer Classic Tee | My Brand','Lightweight cotton tee, perfect for warm days.'];
  const csv = [headers, example].map(r => r.map(v => `"${v.replace(/"/g,'""')}"`).join(',')).join('\n');
  dlText(csv, 'lederly-import-template.csv');
  toast('Template downloaded — fill it in and import it back.');
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) { row.push(cur); cur = ''; }
      else cur += c;
    }
    row.push(cur);
    result.push(row);
  }
  return result;
}

// Known column name aliases → internal field keys
const CSV_FIELD_MAP = {
  handle:           'handle',
  title:            'title',
  'body (html)':    'bodyHtml',
  body:             'bodyHtml',
  description:      'bodyHtml',
  vendor:           'vendor',
  tags:             'tags',
  published:        'status',
  status:           'status',
  type:             'productType',
  'product type':   'productType',
  'variant sku':    'sku',
  sku:              'sku',
  'variant price':  'price',
  price:            'price',
  'variant compare at price': 'compareAtPrice',
  'compare at price':         'compareAtPrice',
  'compare at':               'compareAtPrice',
  'variant inventory qty':    'inventoryQty',
  'inventory qty':            'inventoryQty',
  qty:              'inventoryQty',
  quantity:         'inventoryQty',
  'seo title':      'seoTitle',
  'seo description':'seoDesc',
  'meta title':     'seoTitle',
  'meta description':'seoDesc',
};
const IMPORT_FIELD_LABELS = {
  handle:'Handle (match key)', title:'Title', bodyHtml:'Description', vendor:'Vendor',
  tags:'Tags', status:'Status (Active/Draft)', productType:'Product Type',
  sku:'SKU (variant match)', price:'Price', compareAtPrice:'Compare at Price',
  inventoryQty:'Inventory Qty', seoTitle:'SEO Title', seoDesc:'SEO Description',
};

function autoDetectMapping(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = CSV_FIELD_MAP[h.toLowerCase().trim()];
    if (key && !map[key]) map[key] = i;
  });
  return map;
}

function openImportModal(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const rows = parseCSV(text);
    if (rows.length < 2) { toast('CSV has no data rows.'); return; }
    const headers = rows[0];
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));
    const mapping = autoDetectMapping(headers);
    _importData = { headers, dataRows, mapping, file: file.name };
    renderImportModal();
    openModal('m-import');
  };
  reader.readAsText(file, 'utf-8');
}

function renderImportModal() {
  const { headers, dataRows, mapping, file } = _importData;
  $('m-import-sub').textContent = `${file} — ${dataRows.length} rows`;

  const hasHandle = mapping.handle !== undefined;
  const hasSku    = mapping.sku    !== undefined;
  const hasTitle  = mapping.title  !== undefined;
  const matchKey  = hasHandle ? 'handle' : hasSku ? 'sku' : hasTitle ? 'title' : null;

  const fieldOptions = Object.entries(IMPORT_FIELD_LABELS)
    .map(([k,l]) => `<option value="${k}">${l}</option>`).join('');

  const colRows = headers.map((h, i) => {
    const autoField = Object.keys(mapping).find(k => mapping[k] === i) || '';
    const preview = dataRows.slice(0,3).map(r => esc(r[i]||'')).join(', ');
    return `<tr>
      <td style="padding:5px 8px;font-size:11px;font-family:var(--mono);color:var(--t2);white-space:nowrap">${esc(h)}</td>
      <td style="padding:5px 8px">
        <select class="import-col-sel mf-unit-sel" data-col="${i}" style="width:100%;font-size:11px">
          <option value="">— skip —</option>${fieldOptions}
        </select>
      </td>
      <td style="padding:5px 8px;font-size:10px;color:var(--t4);font-family:var(--mono);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</td>
    </tr>`;
  }).join('');

  $('m-import-body').innerHTML = `
    <div style="background:${matchKey?'var(--green-bg)':'#fef3c7'};border:1px solid ${matchKey?'var(--green-brd)':'#fde68a'};border-radius:var(--r6);padding:9px 12px;font-size:11px;color:${matchKey?'var(--green)':'#92400e'};font-family:var(--mono)">
      ${matchKey ? `✓ Products matched by <strong>${IMPORT_FIELD_LABELS[matchKey]}</strong>` : '⚠ No match column found (Handle, SKU, or Title required). Assign one below.'}
    </div>
    <div style="overflow-x:auto;max-height:320px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:6px 8px;font-size:9px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--t4);text-align:left;border-bottom:1px solid var(--b1);background:var(--s1);position:sticky;top:0">CSV Column</th>
          <th style="padding:6px 8px;font-size:9px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--t4);text-align:left;border-bottom:1px solid var(--b1);background:var(--s1);position:sticky;top:0">Import as</th>
          <th style="padding:6px 8px;font-size:9px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--t4);text-align:left;border-bottom:1px solid var(--b1);background:var(--s1);position:sticky;top:0">Preview</th>
        </tr></thead>
        <tbody>${colRows}</tbody>
      </table>
    </div>`;

  // Set auto-detected values on selects
  headers.forEach((_, i) => {
    const sel = $('m-import-body').querySelector(`[data-col="${i}"]`);
    const field = Object.keys(mapping).find(k => mapping[k] === i) || '';
    if (sel) sel.value = field;
  });

  // Bind select change → update mapping + preview
  $('m-import-body').querySelectorAll('.import-col-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const col = Number(sel.dataset.col);
      // Remove any existing assignment of this field
      const prev = Object.keys(_importData.mapping).find(k => _importData.mapping[k] === col);
      if (prev) delete _importData.mapping[prev];
      if (sel.value) {
        // Remove any prior column assigned to this field
        delete _importData.mapping[sel.value];
        _importData.mapping[sel.value] = col;
      }
      updateImportPreview();
    });
  });

  updateImportPreview();
}

function updateImportPreview() {
  const { dataRows, mapping } = _importData;
  const matchKey = mapping.handle !== undefined ? 'handle' : mapping.sku !== undefined ? 'sku' : mapping.title !== undefined ? 'title' : null;
  const matched = matchKey ? computeImportMatches() : [];
  const changed = matched.filter(m => Object.keys(m.changes.product||{}).length + Object.keys(m.changes.variants||{}).length > 0);
  const info = $('m-import-info');
  if (!matchKey) {
    info.textContent = 'Assign a match column to continue.';
    $('m-import-apply').disabled = true;
    return;
  }
  const total = dataRows.length;
  const notFound = matched.filter(m => !m.found).length;
  info.textContent = `${changed.length} product${changed.length!==1?'s':''} will change · ${notFound} not found in loaded products`;
  $('m-import-apply').disabled = changed.length === 0;
  _importData.matched = matched;
}

function computeImportMatches() {
  const { headers, dataRows, mapping } = _importData;
  const matchKey = mapping.handle !== undefined ? 'handle' : mapping.sku !== undefined ? 'sku' : 'title';
  const matchColIdx = mapping[matchKey];
  const results = [];
  // Group rows by handle (Shopify exports one row per variant)
  const groups = new Map();
  for (const row of dataRows) {
    const matchVal = (row[matchColIdx]||'').trim().toLowerCase();
    if (!matchVal) continue;
    if (!groups.has(matchVal)) groups.set(matchVal, []);
    groups.get(matchVal).push(row);
  }

  for (const [matchVal, rows] of groups) {
    let prod = null;
    if (matchKey === 'handle') {
      prod = S.products.find(p => p.handle?.toLowerCase() === matchVal);
    } else if (matchKey === 'sku') {
      // find product that has a variant with this SKU
      prod = S.products.find(p => (p.variants?.nodes||[]).some(v => v.sku?.toLowerCase() === matchVal));
    } else {
      prod = S.products.find(p => p.title?.toLowerCase() === matchVal);
    }

    const productChanges = {};
    const variantChanges = {};

    // Use first row for product-level fields
    const firstRow = rows[0];
    if (mapping.title !== undefined) {
      const v = (firstRow[mapping.title]||'').trim();
      if (v && prod && v !== prod.title) productChanges.title = v;
    }
    if (mapping.bodyHtml !== undefined) {
      const v = (firstRow[mapping.bodyHtml]||'').trim();
      if (v && prod) {
        // Plain text → wrap in <p>
        const html = v.startsWith('<') ? v : '<p>'+v.replace(/\n\n+/g,'</p><p>').replace(/\n/g,'<br>')+'</p>';
        if (html !== (prod.bodyHtml||'')) productChanges.bodyHtml = html;
      }
    }
    if (mapping.vendor !== undefined) {
      const v = (firstRow[mapping.vendor]||'').trim();
      if (v && prod && v !== prod.vendor) productChanges.vendor = v;
    }
    if (mapping.tags !== undefined) {
      const v = (firstRow[mapping.tags]||'').trim();
      if (v && prod && v !== (prod.tags||[]).join(', ')) productChanges.tags = v.split(',').map(t=>t.trim()).filter(Boolean);
    }
    if (mapping.status !== undefined) {
      const raw = (firstRow[mapping.status]||'').trim().toUpperCase();
      const mapped = raw === 'TRUE' || raw === 'ACTIVE' ? 'ACTIVE' : raw === 'FALSE' || raw === 'DRAFT' ? 'DRAFT' : raw === 'ARCHIVED' ? 'ARCHIVED' : null;
      if (mapped && prod && mapped !== prod.status) productChanges.status = mapped;
    }
    if (mapping.productType !== undefined) {
      const v = (firstRow[mapping.productType]||'').trim();
      if (v && prod && v !== prod.productType) productChanges.productType = v;
    }
    if (mapping.seoTitle !== undefined || mapping.seoDesc !== undefined) {
      const st = mapping.seoTitle !== undefined ? (firstRow[mapping.seoTitle]||'').trim() : null;
      const sd = mapping.seoDesc  !== undefined ? (firstRow[mapping.seoDesc ]||'').trim() : null;
      if (st && prod && st !== (prod.seo?.title||'')) productChanges.seoTitle = st;
      if (sd && prod && sd !== (prod.seo?.description||'')) productChanges.seoDesc = sd;
    }

    // Per-row variant fields
    for (const row of rows) {
      if (!prod) break;
      const rowSku = mapping.sku !== undefined ? (row[mapping.sku]||'').trim() : null;
      let variant = null;
      if (rowSku) {
        variant = (prod.variants?.nodes||[]).find(v => v.sku === rowSku);
      } else {
        variant = prod.variants?.nodes?.[0];
      }
      if (!variant) continue;
      const vc = variantChanges[variant.id] || {};
      if (mapping.price !== undefined) {
        const v = (row[mapping.price]||'').trim().replace(/[^0-9.]/g,'');
        if (v && v !== String(variant.price||'')) vc.price = v;
      }
      if (mapping.compareAtPrice !== undefined) {
        const v = (row[mapping.compareAtPrice]||'').trim().replace(/[^0-9.]/g,'');
        if (v && v !== String(variant.compareAtPrice||'')) vc.compareAtPrice = v;
      }
      if (Object.keys(vc).length) variantChanges[variant.id] = vc;
    }

    results.push({ matchVal, found: !!prod, prod, changes: { product: productChanges, variants: variantChanges } });
  }
  return results;
}

function applyImport() {
  const { matched } = _importData || {};
  if (!matched) return;
  let count = 0;
  for (const { found, prod, changes } of matched) {
    if (!found || !prod) continue;
    const { product: pf, variants: vf } = changes;
    if (!pf && !vf) continue;
    pushH('CSV import');
    if (pf.title    !== undefined) { prod.title    = pf.title;    ensureC(prod.id).product.title    = pf.title; }
    if (pf.bodyHtml !== undefined) { prod.bodyHtml  = pf.bodyHtml; ensureC(prod.id).product.bodyHtml  = pf.bodyHtml; }
    if (pf.vendor   !== undefined) { prod.vendor    = pf.vendor;   ensureC(prod.id).product.vendor    = pf.vendor; }
    if (pf.tags     !== undefined) { prod.tags      = pf.tags;     ensureC(prod.id).product.tags      = pf.tags; }
    if (pf.status   !== undefined) { prod.status    = pf.status;   ensureC(prod.id).product.status    = pf.status; }
    if (pf.productType !== undefined) { prod.productType = pf.productType; ensureC(prod.id).product.productType = pf.productType; }
    if (pf.seoTitle !== undefined || pf.seoDesc !== undefined) {
      if (!prod.seo) prod.seo = { title:'', description:'' };
      const c = ensureC(prod.id); if (!c.product.seo) c.product.seo = {};
      if (pf.seoTitle !== undefined) { prod.seo.title       = pf.seoTitle; c.product.seo.title       = pf.seoTitle; }
      if (pf.seoDesc  !== undefined) { prod.seo.description = pf.seoDesc;  c.product.seo.description = pf.seoDesc;  }
    }
    for (const [vid, vc] of Object.entries(vf || {})) {
      const variant = (prod.variants?.nodes||[]).find(v => v.id === vid);
      if (!variant) continue;
      const c = ensureC(prod.id);
      if (!c.variants) c.variants = {};
      if (!c.variants[vid]) c.variants[vid] = { id: vid };
      if (vc.price !== undefined)          { variant.price          = vc.price;          c.variants[vid].price          = vc.price; }
      if (vc.compareAtPrice !== undefined)  { variant.compareAtPrice  = vc.compareAtPrice; c.variants[vid].compareAtPrice  = vc.compareAtPrice; }
    }
    count++;
  }
  closeModal('m-import');
  _importData = null;
  renderTable();
  updateSaveBtn();
  toast(`${count} product${count!==1?'s':''} updated from CSV. Review changes and save.`);
}

function startTour(){
  // IIFE bundle exposes: window.driver.js.driver
  const driverFn = window.driver && window.driver.js && window.driver.js.driver;
  if(typeof driverFn !== 'function'){ console.warn('[tour] driver.js not found on window.driver.js.driver'); return; }
  const d = driverFn({
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Done',
    popoverClass: 'lederly-tour',
    onDestroyStarted: () => {
      const wasComplete = d.isLastStep();
      localStorage.setItem('lederly_tour_v1_'+S.shop,'1');
      d.destroy();
      trackEv(wasComplete ? 'tour_complete' : 'tour_skip');
    },
    onPopoverRender: (popover) => {
      const skip = document.createElement('button');
      skip.textContent = 'Skip tour';
      skip.className = 'driver-skip-btn';
      skip.addEventListener('click', () => d.destroy());
      popover.footer.appendChild(skip);
    },
    steps: [
      {
        popover: {
          title: 'Welcome to Lederly',
          description: 'Edit your entire Shopify catalog directly in the browser — no imports, no exports, no fuss. This tour takes about 60 seconds.',
          align: 'center'
        }
      },
      {
        element: '#search',
        popover: {
          title: 'Search products',
          description: 'Type to filter by title or handle. Use commas to search multiple terms at once — e.g. <code>shirt, jacket</code>.',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: '.filters',
        popover: {
          title: 'Filter by status, tag, or collection',
          description: 'Show only Active, Draft, or Archived products. Filter by tag or collection to focus on a specific part of your catalog.',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: '.table-scroll',
        popover: {
          title: 'Click any cell to edit',
          description: 'Click directly on a product title, price, status, tags, or description. Changes are staged locally — nothing is sent to Shopify until you push.',
          side: 'top', align: 'center'
        }
      },
      {
        element: '#chk-all',
        popover: {
          title: 'Select products for bulk actions',
          description: 'Check one or more rows to unlock the bulk toolbar: change prices, update status, edit tags, descriptions, SEO, metafields, and collections — all at once.',
          side: 'right', align: 'start'
        }
      },
      {
        element: '#status-msg',
        popover: {
          title: 'Live change counter',
          description: 'The status bar shows how many products have unsaved changes, and how many are selected. A <em>Discard</em> button appears whenever you have staged edits.',
          side: 'top', align: 'start'
        }
      },
      {
        element: '#btn-schedule',
        popover: {
          title: 'Schedule changes',
          description: 'Set changes to go live at a specific date and time. Ideal for flash sales or product launches. Pro plan includes auto-revert when the sale ends.',
          side: 'bottom', align: 'end'
        }
      },
      {
        element: '#btn-save',
        popover: {
          title: 'Push to Shopify',
          description: 'When you\'re happy with your edits, push them all to Shopify with one click. You\'ll see a full summary of every change before confirming.',
          side: 'bottom', align: 'end'
        }
      },
      {
        element: '.tab[data-tab="export"]',
        popover: {
          title: 'Export & Import CSV',
          description: 'Export your catalog, edit it in Excel or Sheets, then import it back to apply changes in bulk. The template includes all the columns you need.',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: '#btn-feedback',
        popover: {
          title: 'You\'re all set',
          description: 'Found a bug, or have a feature request? Hit <strong>Feedback</strong> — we read every message and reply to all of them.',
          side: 'bottom', align: 'end'
        }
      }
    ]
  });
  d.drive();
}

function maybeShowWelcome(){
  if(S.demo) return;
  if(localStorage.getItem('be_welcome_done_'+S.shop)) return;
  openModal('m-welcome');
}

function maybeStartTour(){
  if(localStorage.getItem('lederly_tour_v1_'+S.shop)) return;
  // If no products, start tour after a short delay anyway (no point waiting for rows that won't appear)
  const hasProducts = S.products && S.products.length > 0;
  if(!hasProducts){ setTimeout(startTour, 800); return; }
  // Wait until table has rendered at least one row (or 3s max) before starting tour
  let attempts = 0;
  const check = () => {
    if(document.querySelector('#tbody tr') || attempts++ > 10){ startTour(); return; }
    setTimeout(check, 300);
  };
  setTimeout(check, 800);
}

function showUpgradeModal(reason, title){
  const isPending = S.plan === 'pending';
  $('m-upgrade-title').textContent = title || (isPending ? 'Start your free trial' : 'Upgrade your plan');
  $('m-upgrade-sub').textContent = reason || 'Upgrade your plan to unlock this feature.';
  const errMsg=$('billing-error-msg'); if(errMsg){ errMsg.style.display='none'; errMsg.textContent=''; }
  // Update button labels based on context
  const suffix = isPending ? ' — Start free trial →' : ' →';
  const bBasic=$('m-billing-basic'); if(bBasic) bBasic.textContent='Basic'+suffix;
  const bStarter=$('m-billing-starter'); if(bStarter) bStarter.textContent='Growth'+suffix;
  const bPro=$('m-billing-pro'); if(bPro) bPro.textContent='Pro'+suffix;
  const footer=$('m-billing-footer');
  if(footer) footer.textContent = isPending
    ? 'No charge today · 7-day free trial · Cancel anytime'
    : 'Billed monthly via Shopify · Cancel anytime';
  openModal('m-upgrade');
}

async function startBilling(plan){
  const errMsg=$('billing-error-msg');
  if(errMsg){ errMsg.style.display='none'; errMsg.textContent=''; }
  try{
    const r=await api('/billing/subscribe',{plan});
    if(!r.ok||!r.confirmationUrl) throw new Error(r.error||'No confirmation URL');
    // Use top-level frame so Shopify billing page works outside the admin iframe
    window.top.location.href=r.confirmationUrl;
  }catch(e){
    const msg=e.message||'Billing error. Try again.';
    if(errMsg){ errMsg.textContent=msg; errMsg.style.display='block'; }
    toast(msg,'warn');
  }
}

// Expose billing functions globally so inline onclick attrs can reach them
window.showUpgradeModal = showUpgradeModal;
window.startBilling = startBilling;

document.addEventListener('DOMContentLoaded', boot);

# Inventory Multi-Location Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants with 2+ active Shopify locations see and adjust inventory per location (single variant via a modal, or across selected variants via the existing bulk "Change Inventory Qty" action); merchants with exactly 1 location see zero behavior change.

**Architecture:** Extend the existing inventory editing path end-to-end — client fetches active locations once at startup, a new read-only endpoint returns per-location stock for a batch of inventory items (fetched lazily, never in the initial product list query), the existing write endpoint takes an explicit `locationId` instead of guessing one, and the client's per-product change tracker (`c.inventory`) becomes keyed by location so the save/diff code has one shape to handle regardless of location count.

**Tech Stack:** Node.js/Express (server.js), Shopify Admin GraphQL (2025-10), vanilla JS/HTML (public/app-tool.js, public/app.html), no build step, no automated test framework.

## Global Constraints

- No automated test suite exists in this project (`package.json` has no test runner). Every "verify" step below is a manual check against `npm run dev` (local server) plus, where GraphQL is involved, a real dev store — do not invent test files.
- Scopes `read_inventory`, `write_inventory`, `read_locations` already exist in `shopify.app.toml` — do not touch that file.
- Feature is available on all plans (Basic/Growth/Pro) — do not add plan/paywall checks.
- Single-location stores (the majority) must see **zero** visual or behavioral change. Every task that touches shared code must preserve the current single-location path exactly.
- Follow existing patterns: `openModal`/`closeModal` + `[data-close]` for any new modal, `api()` helper for requests, `pushH()` for undo-history entries on any state mutation the user can trigger.

---

### Task 1: Backend — `/api/inventory-levels` read endpoint

**Files:**
- Modify: `server.js` (insert new route immediately after the existing `/api/locations` route, before `/api/inventory-set`, i.e. after line 1578)

**Interfaces:**
- Produces: `POST /api/inventory-levels` — request `{ inventoryItemIds: string[] }` (1-100 items), response `{ ok: true, levels: { [inventoryItemId]: [{ locationId, name, quantity }] } }`. Consumed by Task 6 (variant modal) and Task 7 (bulk qty).

- [ ] **Step 1: Add the route**

Insert after the closing `});` of `/api/locations` (server.js:1578):

```js
app.post('/api/inventory-levels', apiLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const { inventoryItemIds } = req.body || {};
    if (!Array.isArray(inventoryItemIds) || !inventoryItemIds.length || inventoryItemIds.length > 100) {
      throw new Error('Invalid inventoryItemIds');
    }
    inventoryItemIds.forEach(id => gid(id, 'InventoryItem'));

    const aliasQuery = inventoryItemIds.map((id, i) => `
      i${i}: inventoryItem(id: "${id}") {
        inventoryLevels(first: 50) {
          nodes {
            location { id name }
            quantities(names: ["available"]) { name quantity }
          }
        }
      }`).join('\n');
    const d = await gql(s, `query { ${aliasQuery} }`);

    const levels = {};
    inventoryItemIds.forEach((id, i) => {
      const nodes = d[`i${i}`]?.inventoryLevels?.nodes || [];
      levels[id] = nodes.map(n => ({
        locationId: n.location.id,
        name: n.location.name,
        quantity: n.quantities.find(q => q.name === 'available')?.quantity ?? 0,
      }));
    });
    res.json({ ok: true, levels });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});
```

- [ ] **Step 2: Verify the server boots and the route is registered**

Run: `npm run dev` (in `/Users/pask/Desktop/VIBECODING/lederly`)
Expected: server starts with no syntax errors (watch the console — Express logs its listen line same as before).

Run: `curl -s -X POST http://localhost:3000/api/inventory-levels -H "Content-Type: application/json" -d '{"inventoryItemIds":[]}'`
Expected: `{"ok":false,"error":"Invalid inventoryItemIds", ...}` — confirms the route exists and validates input before touching auth. (A real, non-empty request needs a live session cookie/token from an actual OAuth'd store — that end-to-end check happens in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /api/inventory-levels endpoint for per-location stock"
```

---

### Task 2: Backend — `/api/inventory-set` takes explicit `locationId`

**Files:**
- Modify: `server.js:1580-1617` (`/api/inventory-set`)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `POST /api/inventory-set` now requires each entry in `quantities` to include `locationId` (previously the server inferred it). Consumed by Task 4 (save flow) and Task 7 (bulk qty).

- [ ] **Step 1: Replace the handler body**

Replace the whole `/api/inventory-set` handler (server.js:1580-1617) with:

```js
app.post('/api/inventory-set', apiLimiter, writeLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const { quantities } = req.body || {};
    if (!Array.isArray(quantities) || !quantities.length || quantities.length > 100) throw new Error('Invalid quantities');

    const items = quantities.map(q => {
      gid(q.inventoryItemId, 'InventoryItem');
      gid(q.locationId, 'Location');
      const qty = Math.floor(Number(q.quantity));
      if (!Number.isFinite(qty) || qty < 0 || qty > 999999) throw new Error('Invalid quantity');
      return { inventoryItemId: q.inventoryItemId, locationId: q.locationId, quantity: qty };
    });

    const d = await gql(s, `
      mutation InventorySet($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`, { input: { name: 'available', reason: 'correction', quantities: items } });
    const errs = d.inventorySetQuantities?.userErrors || [];
    if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
    track('inventory_set', s.shop, { n: items.length });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});
```

This removes the old auto-lookup query (`inventoryLevels(first:1)` to guess a location) — every caller now supplies `locationId` directly, which is why Tasks 4 and 7 must always populate it (single-location stores use their one location's id, resolved from `S.locations[0].id`).

- [ ] **Step 2: Verify**

Run: `npm run dev`, then `curl -s -X POST http://localhost:3000/api/inventory-set -H "Content-Type: application/json" -d '{"quantities":[{"inventoryItemId":"gid://shopify/InventoryItem/1","quantity":5}]}'`
Expected: `{"ok":false,"error":"Invalid Location GID", ...}` — proves `locationId` is now mandatory and validated before any GraphQL call. Full write-path verification happens in Task 4's end-to-end check once the client sends `locationId`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: require explicit locationId in /api/inventory-set, drop auto-lookup"
```

---

### Task 3: Client — load active locations at startup

**Files:**
- Modify: `public/app-tool.js` (add `loadLocations()` near `loadMfDefs()` at line 287; wire into the three places products are loaded: `afterOAuth` line 207, `refreshInBackground` line 344; `loadDemoMode` needs no change — `S.locations` stays `null`, which the rest of the plan treats as "behave like single location")

**Interfaces:**
- Consumes: `POST /api/locations` (already exists, server.js:1571, unchanged).
- Produces: `S.locations` — `null` until loaded, then `Array<{id, name, isActive}>`. Every later task that branches on location count uses `(S.locations?.length || 0) >= 2`.

- [ ] **Step 1: Add `loadLocations()`**

Insert right after `loadMfDefs()` (public/app-tool.js:287-293):

```js
async function loadLocations(){
  if(S.demo) return;
  try{
    const r=await api('/api/locations');
    S.locations=r.locations||[];
    if(S.products.length) renderTable(); // in case product rows already rendered before this resolved
  }catch(e){ S.locations=[]; }
}
```

- [ ] **Step 2: Wire into initial load**

In `afterOAuth`, change (public/app-tool.js:207):
```js
await Promise.all([ loadProducts(), loadMfDefs(), loadColls() ]);
```
to:
```js
await Promise.all([ loadProducts(), loadMfDefs(), loadColls(), loadLocations() ]);
```

- [ ] **Step 3: Wire into background refresh**

In `refreshInBackground` (public/app-tool.js:344), change:
```js
await Promise.all([loadProducts(),loadMfDefs(),loadColls()]);
```
to:
```js
await Promise.all([loadProducts(),loadMfDefs(),loadColls(),loadLocations()]);
```

- [ ] **Step 4: Verify**

Run: `npm run dev`, open the app in a browser against a real dev store, open devtools console, connect/load the store, then type `S.locations` in the console.
Expected: an array with at least one `{id, name, isActive:true}` entry matching the store's locations in Shopify admin (Settings → Locations).

- [ ] **Step 5: Commit**

```bash
git add public/app-tool.js
git commit -m "feat: load active locations on app start and background refresh"
```

---

### Task 4: Client — `c.inventory` keyed by location (data model + save flow + diff)

This is the core refactor. All three call sites must change together because they share the same `c.inventory` shape.

**Files:**
- Modify: `public/app-tool.js` — `markVar` (line 674-692), bulk `qty` apply (line 967-985), diff render (line 1140-1143), save-flow inventory payload build (line 1250-1260)

**Interfaces:**
- Consumes: `S.locations` from Task 3.
- Produces: new `c.inventory` shape — `{ [variantId]: { [locationId]: { inventoryItemId, locationId, quantity, oldQuantity } } }`. Task 5 (table cell) and Task 6 (variant modal) and Task 7 (bulk modal) all read/write this shape via a shared helper `setInvChange(pid, vid, locationId, inventoryItemId, quantity, oldQuantity)` defined here.

- [ ] **Step 1: Add the shared helper**

Insert right before `markVar` (public/app-tool.js:674):

```js
function setInvChange(pid, vid, locationId, inventoryItemId, quantity, oldQuantity){
  const c=ensureC(pid);
  if(!c.inventory[vid])c.inventory[vid]={};
  c.inventory[vid][locationId]={inventoryItemId,locationId,quantity,oldQuantity};
}
function primaryLocationId(){ return S.locations?.[0]?.id||''; }
```

- [ ] **Step 2: Update `markVar`'s inventory branch**

Replace lines 678-685 (inside `markVar`):
```js
  if(field==='inventoryQuantity'){
    const qty=parseInt(value,10);
    if(isNaN(qty)||qty<0)return;
    v.inventoryQuantity=qty;
    if(!c.inventory)c.inventory={};
    c.inventory[vid]={inventoryItemId:v.inventoryItem?.id||'',quantity:qty,oldQuantity:getOrigV(p.id,vid)?.inventoryQuantity??0};
    if(el){ el.classList.add('dirty'); addModChip(el); }
    updateSaveBtn(); return;
  }
```
with:
```js
  if(field==='inventoryQuantity'){
    const qty=parseInt(value,10);
    if(isNaN(qty)||qty<0)return;
    v.inventoryQuantity=qty;
    setInvChange(p.id,vid,primaryLocationId(),v.inventoryItem?.id||'',qty,getOrigV(p.id,vid)?.inventoryQuantity??0);
    if(el){ el.classList.add('dirty'); addModChip(el); }
    updateSaveBtn(); return;
  }
```

This is the single-location table-cell path (Task 5 keeps this input for stores with `<2` locations) — behavior is identical, just stored one level deeper.

- [ ] **Step 3: Update bulk `qty` apply**

Replace lines 974-984 (inside `applyBulkModal`, `type==='qty'` branch):
```js
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
```
with:
```js
    vids.forEach(vid=>{
      const{p,v}=getVar(vid); if(!p||!v)return;
      let newQty;
      if(rule==='set')       newQty=n;
      else if(rule==='add')  newQty=Math.max(0,(v.inventoryQuantity||0)+n);
      else                   newQty=Math.max(0,(v.inventoryQuantity||0)-n);
      v.inventoryQuantity=newQty;
      setInvChange(p.id,vid,primaryLocationId(),v.inventoryItem?.id||'',newQty,getOrigV(p.id,vid)?.inventoryQuantity??0);
    });
```

Note: this keeps today's exact behavior (single implicit location, add/subtract against the aggregate `inventoryQuantity`). Task 7 adds the multi-location dropdown as an additional branch on top of this — it does not change this path for single-location stores.

- [ ] **Step 4: Update diff render**

Replace lines 1140-1143:
```js
    Object.entries(c.inventory||{}).forEach(([vid,inv])=>{
      const vLbl=p.variants.nodes.find(x=>x.id===vid)?.title||'variant';
      diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl)} inventory</span><span class="diff-old">${esc(String(inv.oldQuantity))}</span><span class="diff-arr">→</span><span class="diff-new">${esc(String(inv.quantity))}</span></div>`);
    });
```
with:
```js
    Object.entries(c.inventory||{}).forEach(([vid,byLoc])=>{
      const vLbl=p.variants.nodes.find(x=>x.id===vid)?.title||'variant';
      const multiLoc=(S.locations?.length||0)>=2;
      Object.values(byLoc).forEach(inv=>{
        const locLbl=multiLoc?` @ ${esc(S.locations.find(l=>l.id===inv.locationId)?.name||'location')}`:'';
        diffs.push(`<div class="diff-row"><span class="diff-field">${esc(vLbl)} inventory${locLbl}</span><span class="diff-old">${esc(String(inv.oldQuantity))}</span><span class="diff-arr">→</span><span class="diff-new">${esc(String(inv.quantity))}</span></div>`);
      });
    });
```

Single-location stores get the exact same line as before (no `@ location` suffix, since `multiLoc` is false).

- [ ] **Step 5: Update save-flow payload build**

Replace lines 1250-1260:
```js
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
```
with:
```js
    // Inventory — only for products that saved OK
    const savedSet=new Set(savedPids), invFailed=[];
    const invItems=[];
    for(const c of payloads){
      if(!savedSet.has(c.productId))continue;
      Object.values(c.inventory||{}).forEach(byLoc=>{
        Object.values(byLoc).forEach(inv=>{
          if(inv.inventoryItemId&&inv.locationId)invItems.push({inventoryItemId:inv.inventoryItemId,locationId:inv.locationId,quantity:inv.quantity});
        });
      });
    }
    if(invItems.length){
      try{ await api('/api/inventory-set',{quantities:invItems}); }
      catch(e){ invFailed.push(e.message); }
    }
```

- [ ] **Step 6: Verify — single-location regression check**

Run: `npm run dev`, open a real dev store with exactly 1 location (or temporarily treat any store as such — this check doesn't depend on Task 3's multi-location UI since that doesn't exist yet).
1. Edit a variant's inventory quantity directly in the table cell.
2. Open the save modal — confirm the diff line reads exactly as before: `<variant> inventory: <old> → <new>` (no `@ location` suffix).
3. Save — confirm no error, and reload confirms Shopify admin shows the new quantity at the store's one location.

Expected: identical to pre-refactor behavior end to end.

- [ ] **Step 7: Commit**

```bash
git add public/app-tool.js
git commit -m "refactor: key inventory changes by location, update diff and save flow"
```

---

### Task 5: Client — multi-location table cell

**Files:**
- Modify: `public/app-tool.js` — variant row render (line 511), inputs event delegation (find where `.ce-num[data-vf]` change events are bound and dispatched to `markVar`)
- Modify: `public/styles.css` — small new class for the clickable total

**Interfaces:**
- Consumes: `S.locations` (Task 3), `setInvChange`/`primaryLocationId` (Task 4).
- Produces: a `data-vid` clickable trigger `.inv-multi-btn` that Task 6's modal opens from.

- [ ] **Step 1: Find the input-change wiring for `.ce-num[data-vf]`**

Run: `grep -n "data-vf" public/app-tool.js` — locate the delegated `change`/`input` listener that reads `dataset.vf` and calls `markVar(vid, field, value, el)`. (It's a single delegated listener on the table body, shared by price/compareAtPrice/inventoryQuantity — do not duplicate it, just make sure the new trigger element for multi-location doesn't also carry `data-vf="inventoryQuantity"`, so it's never accidentally treated as a plain input by that listener.)

- [ ] **Step 2: Update the row template**

Replace line 511:
```js
<td><input class="ce ce-num" type="number" min="0" step="1" data-vid="${esc(v.id)}" data-vf="inventoryQuantity" value="${esc(String(v.inventoryQuantity??0))}"></td>
```
with:
```js
<td>${(S.locations?.length||0)>=2
  ? `<button type="button" class="inv-multi-btn" data-vid="${esc(v.id)}" title="Adjust inventory per location">${esc(String(v.inventoryQuantity??0))} <span class="inv-multi-ico">⊞</span></button>`
  : `<input class="ce ce-num" type="number" min="0" step="1" data-vid="${esc(v.id)}" data-vf="inventoryQuantity" value="${esc(String(v.inventoryQuantity??0))}">`
}</td>
```

- [ ] **Step 3: Wire the click**

Find the table body's delegated click listener (same one that handles `.status-pill` clicks or `.coll-tag` clicks — search `addEventListener('click'` near the table setup) and add a branch:
```js
  const invBtn=e.target.closest('.inv-multi-btn');
  if(invBtn){ openInventoryModal(invBtn.dataset.vid); return; }
```
(`openInventoryModal` is defined in Task 6 — this task only adds the call site; the app will have a temporary "function not defined" error in the browser console until Task 6 lands, which is expected mid-plan and resolved by the next task.)

- [ ] **Step 4: Add CSS**

Append to `public/styles.css`:
```css
.inv-multi-btn{font-family:var(--mono);font-size:12px;text-align:right;width:100%;background:transparent;border:1px dashed var(--b2);border-radius:var(--r4);padding:3px 6px;cursor:pointer;color:var(--tx);display:flex;align-items:center;justify-content:flex-end;gap:4px}
.inv-multi-btn:hover{background:var(--s2);border-color:var(--b3)}
.inv-multi-ico{font-size:10px;opacity:.6}
```

- [ ] **Step 5: Verify**

Manually set `S.locations=[{id:'a',name:'A',isActive:true},{id:'b',name:'B',isActive:true}]` in the browser console after the app loads, then call `renderTable()`.
Expected: every inventory cell becomes a dashed-border button showing the quantity, instead of a number input.

Reload the page against a real single-location dev store (no console override).
Expected: cells are plain number inputs exactly as before Task 5.

- [ ] **Step 6: Commit**

```bash
git add public/app-tool.js public/styles.css
git commit -m "feat: render inventory cell as location-adjust trigger for multi-location stores"
```

---

### Task 6: Client — per-variant location modal

**Files:**
- Modify: `public/app.html` (add new `<div id="m-inv" class="overlay hidden">…</div>` modal, modeled on the existing `#m-bulk` structure, placed right after the `m-bulk` block, i.e. after line 190)
- Modify: `public/app-tool.js` (add `openInventoryModal`, its apply handler, and the button wiring in the DOM-ready setup block near line 1937-1948)

**Interfaces:**
- Consumes: `POST /api/inventory-levels` (Task 1), `setInvChange`/`primaryLocationId` helpers (Task 4), `S.locations` (Task 3).
- Produces: working end-to-end multi-location edit for a single variant — the first fully-testable multi-location slice.

- [ ] **Step 1: Add the modal markup**

Insert after the `m-bulk` `</div>` (public/app.html:190):
```html
<!-- INVENTORY LOCATIONS MODAL -->
<div id="m-inv" class="overlay hidden">
  <div class="modal">
    <div class="modal-head">
      <div><h2>Inventory by location</h2><p id="m-inv-sub" class="modal-sub"></p></div>
      <button class="close-btn" data-close="m-inv">✕</button>
    </div>
    <div id="m-inv-body" class="modal-body"></div>
    <div class="modal-foot">
      <button class="btn-ghost sm" data-close="m-inv">Cancel</button>
      <button class="btn-cta sm" id="m-inv-apply">Apply →</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add `openInventoryModal`**

Insert near `openBulkModal` (public/app-tool.js, right before line 844):
```js
let S_invVid=null;
async function openInventoryModal(vid){
  const{p,v}=getVar(vid); if(!p||!v)return;
  S_invVid=vid;
  const invItemId=v.inventoryItem?.id;
  $('m-inv-sub').textContent=`${p.title}${v.title&&v.title!=='Default Title'?` — ${v.title}`:''}`;
  const body=$('m-inv-body');
  body.innerHTML='<p style="font-size:12px;color:var(--t3)">Loading locations…</p>';
  openModal('m-inv');
  try{
    const r=await api('/api/inventory-levels',{inventoryItemIds:[invItemId]});
    const rows=r.levels[invItemId]||[];
    body.innerHTML=rows.map(row=>{
      const pending=S.changes[p.id]?.inventory?.[vid]?.[row.locationId]?.quantity;
      const val=pending!==undefined?pending:row.quantity;
      return `<div class="bulk-field"><label>${esc(row.name)}</label><input type="number" min="0" step="1" class="inv-loc-inp" data-location-id="${esc(row.locationId)}" data-old="${esc(String(row.quantity))}" value="${esc(String(val))}"></div>`;
    }).join('')||'<p style="font-size:12px;color:var(--t3)">No locations stock this item.</p>';
  }catch(e){
    body.innerHTML=`<p style="font-size:12px;color:var(--red)">Failed to load: ${esc(e.message)}</p>`;
  }
}
function applyInventoryModal(){
  const vid=S_invVid; if(!vid)return;
  const{p,v}=getVar(vid); if(!p||!v)return closeModal('m-inv');
  pushH('Edit inventory by location');
  let total=0;
  document.querySelectorAll('#m-inv-body .inv-loc-inp').forEach(inp=>{
    const locationId=inp.dataset.locationId;
    const oldQty=Number(inp.dataset.old);
    const qty=parseInt(inp.value,10);
    if(isNaN(qty)||qty<0)return;
    total+=qty;
    setInvChange(p.id,vid,locationId,v.inventoryItem?.id||'',qty,oldQty);
  });
  v.inventoryQuantity=total;
  closeModal('m-inv');
  renderTable(); updateSaveBtn();
  toast('Inventory updated — review in Save changes.');
}
```

- [ ] **Step 3: Wire the button and click delegation**

Near the other modal-button wiring (public/app-tool.js:1937-1948), add:
```js
  $('m-inv-apply').addEventListener('click', applyInventoryModal);
```

In the `.inv-multi-btn` click branch added in Task 5 Step 3, this now resolves correctly since `openInventoryModal` exists.

Also add `'m-inv'` to the Escape-key close list (public/app-tool.js:2119):
```js
document.addEventListener('keydown',e=>{ if(e.key==='Escape')['m-bulk','m-save','m-coll','m-sched','m-inv'].forEach(id=>closeModal(id)); });
```

- [ ] **Step 4: End-to-end verify against a real multi-location dev store**

Run: `npm run dev`, connect a dev store that has 2+ active locations (create a second location in Shopify admin → Settings → Locations if needed).
1. Click a variant's inventory cell — modal opens, shows one row per location with current quantities.
2. Change one location's value, click Apply.
3. Open "Save changes" — diff shows `<variant> inventory @ <location name>: <old> → <new>`.
4. Save — confirm success toast, then check Shopify admin (Products → variant → Inventory) that only the edited location's quantity changed, the other location is untouched.

Expected: matches steps 1-4 exactly; this is the point where Tasks 1, 2, 3, 4, 5 all prove out together.

- [ ] **Step 5: Commit**

```bash
git add public/app.html public/app-tool.js
git commit -m "feat: per-variant inventory-by-location modal"
```

---

### Task 7: Client — bulk "Change Inventory Qty" location dropdown

**Files:**
- Modify: `public/app-tool.js` — `openBulkModal` (`type==='qty'` branch, line 870-875) and `applyBulkModal` (`type==='qty'` branch, replaced in Task 4 Step 3)

**Interfaces:**
- Consumes: `/api/inventory-levels` (Task 1), `setInvChange` (Task 4), `S.locations` (Task 3).
- Produces: nothing consumed further — this is the last task.

- [ ] **Step 1: Add the location dropdown to the bulk qty modal body**

Replace the `qty` branch body in `openBulkModal` (public/app-tool.js:870-875):
```js
  }else if(type==='qty'){
    body.innerHTML=`<div class="bulk-field"><label>Action</label><select id="bv-qty-rule"><option value="set">Set exact quantity</option><option value="add">Increase by</option><option value="sub">Decrease by</option></select></div><div class="bulk-field"><label id="bv-qty-lbl">Quantity</label><input id="bv-qty-val" type="number" min="0" step="1" placeholder="0" autofocus></div>`;
    body.querySelector('#bv-qty-rule').addEventListener('change',e=>{
      const lbl=$('bv-qty-lbl');
      if(lbl)lbl.textContent={set:'Quantity',add:'Increase by',sub:'Decrease by'}[e.target.value]||'Quantity';
    });
  }else if(type==='tags'){
```
with:
```js
  }else if(type==='qty'){
    const multiLoc=(S.locations?.length||0)>=2;
    const locSelect=multiLoc?`<div class="bulk-field"><label>Location</label><select id="bv-qty-loc">${S.locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></div>`:'';
    body.innerHTML=`${locSelect}<div class="bulk-field"><label>Action</label><select id="bv-qty-rule"><option value="set">Set exact quantity</option><option value="add">Increase by</option><option value="sub">Decrease by</option></select></div><div class="bulk-field"><label id="bv-qty-lbl">Quantity</label><input id="bv-qty-val" type="number" min="0" step="1" placeholder="0" autofocus></div>`;
    body.querySelector('#bv-qty-rule').addEventListener('change',e=>{
      const lbl=$('bv-qty-lbl');
      if(lbl)lbl.textContent={set:'Quantity',add:'Increase by',sub:'Decrease by'}[e.target.value]||'Quantity';
    });
    if(multiLoc){
      const vids=[...S.selectedVids];
      const invItemIds=vids.map(vid=>getVar(vid).v?.inventoryItem?.id).filter(Boolean);
      if(invItemIds.length) api('/api/inventory-levels',{inventoryItemIds:invItemIds}).then(r=>{ S.bulkQtyLevels=r.levels; }).catch(()=>{ S.bulkQtyLevels=null; });
    }
  }else if(type==='tags'){
```

- [ ] **Step 2: Update `applyBulkModal`'s qty branch to use the chosen location**

The qty branch was already rewritten in Task 4 Step 3 to call `setInvChange(p.id,vid,primaryLocationId(),...)`. Replace that block (single-location-only version) with the final version that branches on `multiLoc`:
```js
  }else if(type==='qty'){
    const rule=$('bv-qty-rule')?.value||'set';
    const val=$('bv-qty-val')?.value;
    const n=parseInt(val,10);
    if(val===''||val==null||isNaN(n)||n<0)return toast('Enter a valid quantity.');
    const multiLoc=(S.locations?.length||0)>=2;
    const locationId=multiLoc?$('bv-qty-loc')?.value:primaryLocationId();
    const vids=[...S.selectedVids];
    pushH(`Bulk qty ${rule}: ${n}`);
    vids.forEach(vid=>{
      const{p,v}=getVar(vid); if(!p||!v)return;
      const invItemId=v.inventoryItem?.id;
      const currentAtLoc=multiLoc
        ? (S.bulkQtyLevels?.[invItemId]?.find(l=>l.locationId===locationId)?.quantity ?? 0)
        : (v.inventoryQuantity||0);
      let newQty;
      if(rule==='set')       newQty=n;
      else if(rule==='add')  newQty=Math.max(0,currentAtLoc+n);
      else                   newQty=Math.max(0,currentAtLoc-n);
      if(!multiLoc) v.inventoryQuantity=newQty; // aggregate display only meaningful for single-location stores
      setInvChange(p.id,vid,locationId,invItemId||'',newQty,currentAtLoc);
    });
    renderTable(); updateSaveBtn(); toast(`Qty updated on ${vids.length} variant${vids.length!==1?'s':''}.`);
  }else if(type==='tags'){
```

Note: for multi-location stores, `v.inventoryQuantity` (the aggregate) is intentionally left untouched here — the table cell for these stores is the `.inv-multi-btn` showing the aggregate from the server, and it's only recomputed correctly when the user opens the per-variant modal (Task 6), which sums all locations. Bulk-editing one location doesn't attempt to keep the aggregate display live-accurate; the diff and the post-save reload (`loadProducts` after save, app-tool.js:1272) are the source of truth.

- [ ] **Step 3: Add `S.bulkQtyLevels` to state init**

In the `S` object (public/app-tool.js:34-48), add:
```js
  bulkQtyLevels:null,
```

- [ ] **Step 4: End-to-end verify**

Run: `npm run dev` against the same 2-location dev store from Task 6.
1. Select 3 variants, click "Change Inventory Qty" — modal shows a Location dropdown.
2. Choose a location, pick "Increase by", enter 5, Apply.
3. Open Save changes — diff shows each variant's inventory line with `@ <location>`, old value matching what that location actually had (not the aggregate).
4. Save, confirm in Shopify admin that only the chosen location changed for all 3 variants, by the right delta.
5. Repeat on a single-location store (or same store temporarily) — dropdown does not appear, behavior matches pre-Task-7 exactly.

- [ ] **Step 5: Commit**

```bash
git add public/app-tool.js
git commit -m "feat: location picker for bulk inventory qty action"
```

---

## Summary of manual regression checklist (run once, after all 7 tasks)

1. Single-location dev store: table cell is a plain input, bulk qty modal has no dropdown, diff has no `@ location` suffix — identical to pre-plan behavior.
2. Multi-location dev store: per-variant modal and bulk dropdown both work, only the targeted location(s) change in Shopify, diff and save messaging show location names.
3. Demo mode (`loadDemoMode`): loads and behaves like a single-location store (no console errors — `S.locations` stays `null`, all branches treat that as `<2`).

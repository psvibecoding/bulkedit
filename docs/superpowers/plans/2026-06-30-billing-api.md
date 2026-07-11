# Shopify Billing API + Piano Basic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare Shopify Billing API, sostituire il piano Free con Basic (€4.99/mo), aggiungere trial di 7 giorni per i nuovi utenti, e aggiornare UI homepage + app.

**Architecture:** Il trial viene tracciato server-side con `trial_ends_at` in `store_plans`. Durante il trial, `getStorePlan` restituisce `'pro'` (full access). Alla scadenza, il piano torna a `basic`. Il billing usa Shopify GraphQL `appSubscriptionCreate` con un `billing_sessions` table come relay state token tra l'auth iniziale e il callback. Il callback verifica la subscription con Shopify e aggiorna il piano in DB.

**Tech Stack:** Node.js/Express, PostgreSQL, Shopify Admin GraphQL API (2026-01), HTML/CSS/JS vanilla.

## Global Constraints
- Piano values nel DB: `beta` (admin), `basic` (€4.99), `starter` (€9.99/Growth), `pro` (€19.99)
- `beta` rimane come piano admin assegnabile manualmente — full access, nessun cambiamento
- Nessun free plan permanente — solo trial di 7 giorni
- Currency: EUR
- Interval: EVERY_30_DAYS
- `encryptToken` / `decryptToken` già esistono in server.js — riutilizzarle per billing_sessions
- `gql(session, query, vars)` già esiste — usarla per le chiamate Shopify
- No nuovi file — tutto in `server.js`, `public/app.html`, `public/index.html`, `public/admin.html`
- Commit dopo ogni task

---

## File Map

| File | Cosa cambia |
|------|-------------|
| `server.js` | DB init (2 nuove tabelle, 2 colonne), PLAN_SCHED_LIMIT, getStorePlan, getTrialInfo, isFirstConnect, 2 nuovi endpoint billing, rimozione check `free`, aggiornamento `/api/schedule/list` response, welcome email |
| `public/app.html` | Upgrade modal (Basic card + billing flow), trial banner, plan badge JS |
| `public/index.html` | Pricing cards (Free→Basic €4.99), CTAs, rimozione banner early access |
| `public/admin.html` | Dropdown piano: aggiunta `basic`, rimozione `free` |

---

## Task 1: DB Schema — nuove colonne e tabella billing_sessions

**Files:**
- Modify: `server.js:43-84` (sezione db init)

**Interfaces:**
- Produce: colonne `trial_ends_at TIMESTAMPTZ` e `shopify_charge_id TEXT` in `store_plans`; tabella `billing_sessions`

- [ ] **Step 1: Aggiungi ALTER TABLE per nuove colonne**

In `server.js`, dopo la riga `dbPool.query(\`CREATE TABLE IF NOT EXISTS store_plans ...`, aggiungi:

```js
  dbPool.query(`ALTER TABLE store_plans ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`).catch(() => {});
  dbPool.query(`ALTER TABLE store_plans ADD COLUMN IF NOT EXISTS shopify_charge_id TEXT`).catch(() => {});
  dbPool.query(`CREATE TABLE IF NOT EXISTS billing_sessions (
    state TEXT PRIMARY KEY,
    shop TEXT NOT NULL,
    plan TEXT NOT NULL,
    enc_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`).catch(e => console.error('[db] billing_sessions init error:', e.message));
  dbPool.query(`DELETE FROM billing_sessions WHERE expires_at < NOW()`).catch(() => {});
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/VIBECODING/lederly
git add server.js
git commit -m "feat: add trial_ends_at, shopify_charge_id columns and billing_sessions table"
```

---

## Task 2: Backend — Plan Logic

**Files:**
- Modify: `server.js:88-89` (PLAN constants), `server.js:91-97` (getStorePlan), `server.js:192-202` (isFirstConnect)

**Interfaces:**
- Produce: `getStorePlan(shop)` → effective plan string (rispetta trial); `getTrialInfo(shop)` → `{ inTrial: bool, trialEndsAt: string|null, daysLeft: number }`

- [ ] **Step 1: Aggiorna PLAN_SCHED_LIMIT e PLAN_PRO_FEATURES**

Riga 88 attuale:
```js
const PLAN_SCHED_LIMIT = { beta: 10, free: 0, starter: 5, pro: Infinity };
const PLAN_PRO_FEATURES = new Set(['beta', 'pro']);
```

Sostituisci con:
```js
const PLAN_SCHED_LIMIT = { beta: Infinity, basic: 0, starter: 5, pro: Infinity };
const PLAN_PRO_FEATURES = new Set(['beta', 'pro']);
```

- [ ] **Step 2: Aggiorna getStorePlan per rispettare il trial**

Sostituisci la funzione `getStorePlan` (righe 91-97):
```js
async function getStorePlan(shop) {
  if (!dbPool) return 'beta';
  try {
    const r = await dbPool.query('SELECT plan, trial_ends_at FROM store_plans WHERE shop=$1', [shop]);
    if (!r.rows[0]) return 'basic';
    const { plan, trial_ends_at } = r.rows[0];
    if (trial_ends_at && new Date(trial_ends_at) > new Date()) return 'pro';
    return plan || 'basic';
  } catch { return 'beta'; }
}
```

- [ ] **Step 3: Aggiungi getTrialInfo**

Dopo `getStorePlan`, aggiungi:
```js
async function getTrialInfo(shop) {
  if (!dbPool) return { inTrial: false, trialEndsAt: null, daysLeft: 0 };
  try {
    const r = await dbPool.query('SELECT plan, trial_ends_at FROM store_plans WHERE shop=$1', [shop]);
    const trialEndsAt = r.rows[0]?.trial_ends_at ? new Date(r.rows[0].trial_ends_at) : null;
    const inTrial = !!trialEndsAt && trialEndsAt > new Date();
    const daysLeft = inTrial ? Math.ceil((trialEndsAt - new Date()) / 86400000) : 0;
    const actualPlan = r.rows[0]?.plan || 'basic';
    return { inTrial, trialEndsAt: trialEndsAt?.toISOString() || null, daysLeft, actualPlan };
  } catch { return { inTrial: false, trialEndsAt: null, daysLeft: 0, actualPlan: 'basic' }; }
}
```

- [ ] **Step 4: Aggiorna isFirstConnect — nuovi store partono su basic con trial 7 giorni**

Sostituisci `isFirstConnect` (righe 192-202):
```js
async function isFirstConnect(shop) {
  if (!dbPool) return false;
  try {
    const r = await dbPool.query(
      `INSERT INTO store_plans (shop, plan, trial_ends_at, updated_at)
       VALUES ($1, 'basic', NOW() + interval '7 days', NOW())
       ON CONFLICT (shop) DO NOTHING`,
      [shop]
    );
    return r.rowCount > 0;
  } catch { return false; }
}
```

- [ ] **Step 5: Rimuovi i check sul piano `free` negli endpoint save**

Riga 1471-1473 (in `/api/save-product`):
```js
// RIMUOVI QUESTO BLOCCO:
if (plan === 'free') {
  const used = await getPushesThisMonth(s.shop);
  if (used >= 100) throw Object.assign(new Error('Free plan limit reached: 100 products pushed this month. Upgrade to Growth for unlimited pushes.'), { code: 'PLAN_LIMIT' });
}
```

Riga 1547 (in `/api/save-product`):
```js
// RIMUOVI questa riga:
if (plan === 'free') await incrementPushes(s.shop);
```

Riga 1560-1585 (in `/api/save` — il save bulk):

Trova il blocco:
```js
if (plan === 'free') {
  const used = await getPushesThisMonth(s.shop);
  if (used + products.length > 100) return res.status(400).json({ ok: false, error: 'Free plan limit reached: 100 products pushed this month.' });
}
```
e rimuovilo. Rimuovi anche `for (let i = 0; i < saved; i++) await incrementPushes(s.shop);` nel save bulk.

- [ ] **Step 6: Aggiorna `/api/schedule/list` per includere trialInfo**

Trova riga 1792-1793:
```js
const pushesUsed = (plan === 'free') ? await getPushesThisMonth(shop) : null;
res.json({ ok: true, schedules: mine, persistWarning, plan, schedLimit: isFinite(schedLimit) ? schedLimit : null, schedUsed, pushesUsed, periodEnd: periodEnd.toISOString() });
```

Sostituisci con:
```js
const trialInfo = await getTrialInfo(shop);
res.json({ ok: true, schedules: mine, persistWarning, plan, schedLimit: isFinite(schedLimit) ? schedLimit : null, schedUsed, periodEnd: periodEnd.toISOString(), trialInfo });
```

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: basic plan logic, 7-day trial, remove free plan enforcement"
```

---

## Task 3: Backend — Shopify Billing API Endpoints

**Files:**
- Modify: `server.js` — aggiungi dopo il blocco auth (dopo riga ~1320)

**Interfaces:**
- `POST /billing/subscribe` → `{ ok: true, confirmationUrl: string }` — richiede `X-Shopify-Token` + `X-Shopify-Shop` header
- `GET /billing/callback?state=&charge_id=` → redirect a `/app?billing_ok=<plan>` o `/app?billing_error=<reason>`

- [ ] **Step 1: Aggiungi PLAN_PRICES constant**

Dopo `PLAN_PRO_FEATURES`, aggiungi:
```js
const PLAN_PRICES = {
  basic:   { name: 'Lederly Basic',  price: '4.99'  },
  starter: { name: 'Lederly Growth', price: '9.99'  },
  pro:     { name: 'Lederly Pro',    price: '19.99' },
};
```

- [ ] **Step 2: Aggiungi POST /billing/subscribe**

Dopo `app.get('/auth/token', ...)` (riga ~1319), aggiungi:

```js
app.post('/billing/subscribe', apiLimiter, async (req, res) => {
  try {
    const { shop, token } = getSession(req);
    const { plan } = req.body || {};
    if (!PLAN_PRICES[plan]) throw new Error('Invalid plan');
    if (!dbPool) throw new Error('Database not configured');

    const cfg = PLAN_PRICES[plan];
    const state = crypto.randomBytes(16).toString('hex');
    const returnUrl = `${APP_URL}/billing/callback?state=${state}`;

    const encTok = encryptToken(token);
    await dbPool.query(
      `INSERT INTO billing_sessions (state, shop, plan, enc_token, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '1 hour')
       ON CONFLICT (state) DO NOTHING`,
      [state, shop, plan, encTok]
    );

    const d = await gql({ shop, token }, `
      mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems) {
          userErrors { field message }
          confirmationUrl
          appSubscription { id }
        }
      }`, {
      name: cfg.name,
      returnUrl,
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: cfg.price, currencyCode: 'EUR' },
            interval: 'EVERY_30_DAYS'
          }
        }
      }]
    });

    const { userErrors, confirmationUrl } = d.appSubscriptionCreate;
    if (userErrors?.length) throw new Error(userErrors.map(e => e.message).join(', '));
    if (!confirmationUrl) throw new Error('No confirmationUrl returned');

    res.json({ ok: true, confirmationUrl });
  } catch (e) {
    console.error('[billing/subscribe]', e.message);
    res.status(400).json({ ok: false, error: safeErr(e) });
  }
});
```

- [ ] **Step 3: Aggiungi GET /billing/callback**

Immediatamente dopo `/billing/subscribe`, aggiungi:

```js
app.get('/billing/callback', async (req, res) => {
  try {
    const { state } = req.query;
    if (!state || !dbPool) return res.redirect('/app?billing_error=invalid');

    const r = await dbPool.query(
      `SELECT * FROM billing_sessions WHERE state=$1 AND expires_at > NOW()`,
      [state]
    );
    if (!r.rows[0]) return res.redirect('/app?billing_error=expired');

    const { shop, plan, enc_token } = r.rows[0];
    const token = decryptToken(enc_token);
    if (!token) return res.redirect('/app?billing_error=token_error');

    const d = await gql({ shop, token }, `
      query { currentAppInstallation { activeSubscriptions { id status } } }
    `);
    const activeSubs = d.currentAppInstallation?.activeSubscriptions || [];
    if (!activeSubs.length) return res.redirect('/app?billing_error=not_active');

    await dbPool.query(
      `UPDATE store_plans SET plan=$1, shopify_charge_id=$2, trial_ends_at=NULL, updated_at=NOW() WHERE shop=$3`,
      [plan, activeSubs[0].id, shop]
    );
    await dbPool.query(`DELETE FROM billing_sessions WHERE state=$1`, [state]);

    track('billing_activated', shop, { plan });
    res.redirect(`/app?billing_ok=${encodeURIComponent(plan)}`);
  } catch (e) {
    console.error('[billing/callback]', e.message);
    res.redirect('/app?billing_error=server_error');
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: Shopify billing subscribe and callback endpoints"
```

---

## Task 4: Frontend — app.html

**Files:**
- Modify: `public/app.html:165` (plan-badge), `public/app.html:254-359` (upgrade modal + sezione usage)

**Interfaces:**
- Consuma: `trialInfo` dal response di `/api/schedule/list`
- Produce: trial banner, upgrade modal con billing flow, plan badge aggiornato

- [ ] **Step 1: Aggiorna il piano badge (riga 165)**

Sostituisci:
```html
<span id="plan-badge" class="plan-badge" data-plan="free">Free · 0/5 schedules this month</span>
```
con:
```html
<span id="plan-badge" class="plan-badge" data-plan="basic">Basic · 0/5 schedules</span>
```

- [ ] **Step 2: Aggiorna upgrade modal (riga 306-359)**

Trova il blocco `<div id="m-upgrade" class="overlay hidden">` e sostituisci tutto fino a `</div>` (fine modale):

```html
<div id="m-upgrade" class="overlay hidden">
  <div class="modal" style="max-width:680px">
    <div class="modal-header">
      <div><h2 id="m-upgrade-title">Upgrade your plan</h2><p id="m-upgrade-sub" class="modal-sub"></p></div>
      <button class="close-btn" data-close="m-upgrade">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--b1);border:1px solid var(--b1);border-radius:12px;overflow:hidden;margin:16px 0 20px">
      <div class="upgrade-plan" style="border-right:1px solid var(--b1)">
        <div class="upgrade-plan-name">Basic</div>
        <div class="upgrade-plan-price">€4.99<span>/mo</span></div>
        <ul class="upgrade-feat-list">
          <li>Unlimited edits</li>
          <li>Prices, tags, SEO, metafields</li>
          <li>CSV Export</li>
          <li class="upgrade-no">No scheduling</li>
          <li class="upgrade-no">No CSV import</li>
          <li class="upgrade-no">No auto-revert</li>
        </ul>
        <button class="btn-cta sm" style="margin-top:12px;width:100%" onclick="startBilling('basic')">Choose Basic →</button>
      </div>
      <div class="upgrade-plan upgrade-plan-mid" style="border-right:1px solid var(--b1)">
        <div class="upgrade-plan-badge">Growth</div>
        <div class="upgrade-plan-name">Growth</div>
        <div class="upgrade-plan-price">€9.99<span>/mo</span></div>
        <ul class="upgrade-feat-list">
          <li>Unlimited edits</li>
          <li>Prices, tags, SEO, metafields</li>
          <li>CSV Export + Import</li>
          <li>5 schedules / month</li>
          <li class="upgrade-no">No auto-revert</li>
        </ul>
        <button class="btn-cta sm" style="margin-top:12px;width:100%" onclick="startBilling('starter')">Choose Growth →</button>
      </div>
      <div class="upgrade-plan upgrade-plan-pro">
        <div class="upgrade-plan-badge upgrade-plan-badge-pro">Pro</div>
        <div class="upgrade-plan-name">Pro</div>
        <div class="upgrade-plan-price">€19.99<span>/mo</span></div>
        <ul class="upgrade-feat-list">
          <li>Unlimited edits</li>
          <li>Prices, tags, SEO, metafields</li>
          <li>CSV Export + Import</li>
          <li>Unlimited schedules</li>
          <li><strong>Auto-revert after sale</strong></li>
        </ul>
        <button class="btn-cta sm" style="margin-top:12px;width:100%;background:#7c3aed;border-color:#7c3aed" onclick="startBilling('pro')">Choose Pro →</button>
      </div>
    </div>
    <p id="billing-error" style="display:none;font-size:12px;color:#dc2626;text-align:center;margin:0"></p>
  </div>
</div>
```

- [ ] **Step 3: Aggiungi trial banner HTML**

Prima di `<div id="m-upgrade"`, aggiungi:

```html
<div id="trial-banner" style="display:none;background:#1a5c38;color:#fff;font-size:12px;font-family:var(--mono);padding:8px 16px;text-align:center;position:relative;z-index:40">
  <span id="trial-banner-text"></span>
  &nbsp;·&nbsp;
  <button onclick="showUpgradeModal('Choose a plan to keep access after your trial ends.','Upgrade before trial ends')" style="background:none;border:none;color:#fff;font-weight:700;cursor:pointer;font-family:var(--mono);font-size:12px;text-decoration:underline">Upgrade now →</button>
</div>
```

- [ ] **Step 4: Aggiorna JS — `startBilling` function e handling `billing_ok` + `billing_error` in URL**

Nel blocco `<script>` di app.html, aggiungi dopo le funzioni di gestione modale esistenti:

```js
async function startBilling(plan) {
  const errEl = document.getElementById('billing-error');
  errEl.style.display = 'none';
  try {
    const r = await api('/billing/subscribe', { plan });
    if (!r.ok || !r.confirmationUrl) throw new Error(r.error || 'No confirmation URL');
    window.location.href = r.confirmationUrl;
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}
```

- [ ] **Step 5: Aggiorna la funzione che processa la response di `/api/schedule/list`**

Trova dove `plan`, `schedLimit`, `schedUsed`, `pushesUsed`, `periodEnd` vengono letti dalla response e aggiorna per:

1. Leggere `trialInfo` dalla response
2. Mostrare il trial banner se `trialInfo.inTrial`
3. Aggiornare il plan badge con il piano reale (non il piano effettivo):

```js
// Dopo aver ricevuto la response da /api/schedule/list:
const { plan, schedLimit, schedUsed, periodEnd, trialInfo } = data;

// Trial banner
const trialBanner = document.getElementById('trial-banner');
const trialBannerText = document.getElementById('trial-banner-text');
if (trialInfo?.inTrial) {
  trialBannerText.textContent = `${trialInfo.daysLeft} day${trialInfo.daysLeft !== 1 ? 's' : ''} left in your free trial`;
  trialBanner.style.display = 'block';
} else {
  trialBanner.style.display = 'none';
}

// Plan badge — mostra piano reale, non quello effettivo durante il trial
const displayPlan = trialInfo?.inTrial ? 'Trial' : (plan === 'starter' ? 'Growth' : (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Basic'));
```

- [ ] **Step 6: Gestisci billing_ok e billing_error dai query param all'apertura dell'app**

All'inizio del JS, dopo il check della sessione, aggiungi:

```js
const urlParams = new URLSearchParams(window.location.search);
const billingOk = urlParams.get('billing_ok');
const billingError = urlParams.get('billing_error');
if (billingOk) {
  const planName = billingOk === 'starter' ? 'Growth' : (billingOk.charAt(0).toUpperCase() + billingOk.slice(1));
  showToast(`${planName} plan activated! Welcome aboard.`);
  window.history.replaceState({}, '', '/app');
}
if (billingError) {
  showToast('Billing not completed. You can try again from the upgrade modal.', 'error');
  window.history.replaceState({}, '', '/app');
}
```

- [ ] **Step 7: Commit**

```bash
git add public/app.html
git commit -m "feat: billing flow in app UI, trial banner, updated upgrade modal"
```

---

## Task 5: Frontend — index.html

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Aggiorna meta title e description**

```html
<!-- DA: -->
<title>Lederly — Bulk Edit &amp; Schedule Shopify Products | Free</title>
<meta name="description" content="... Free to start, no account needed."/>

<!-- A: -->
<title>Lederly — Bulk Edit &amp; Schedule Shopify Products</title>
<meta name="description" content="Bulk edit prices, tags and metafields across your entire Shopify catalog. Schedule changes to go live automatically — with auto-revert when the sale ends. 7-day free trial."/>
```

Aggiorna anche og:description e twitter:description rimuovendo "Free to start".

- [ ] **Step 2: Sostituisci pricing card Free con Basic**

Sostituisci il blocco `<!-- FREE -->` (righe 791-809):

```html
<!-- BASIC -->
<div class="pricing-card">
  <div class="pricing-card-tag">Start here</div>
  <div class="pricing-card-name">Basic</div>
  <div class="pricing-card-price">€4<span>.99/mo</span></div>
  <div class="pricing-card-sub">7-day free trial · No credit card upfront</div>
  <div class="pricing-divider"></div>
  <ul class="pricing-features">
    <li>Inline bulk editing</li>
    <li>Edit prices, tags, status, SEO and metafields</li>
    <li>Bulk actions</li>
    <li>Collections management</li>
    <li>CSV Export</li>
    <li>Unlimited product edits</li>
    <li class="off">CSV Import</li>
    <li class="off">Scheduling</li>
    <li class="off">Auto-revert</li>
  </ul>
</div>
```

- [ ] **Step 3: Rimuovi `pricing-beta-note` dalle card Growth e Pro**

Rimuovi le righe:
```html
<p class="pricing-beta-note">Free · your feedback shapes what we build.</p>
```
da entrambe le card Growth e Pro. Al loro posto aggiungi:
```html
<div class="pricing-card-sub" style="margin-top:12px;font-size:11px">7-day free trial included</div>
```

- [ ] **Step 4: Aggiorna section-sub e early access banner**

Riga 782:
```html
<!-- DA: -->
<p class="section-sub reveal">Free to start. Upgrade when you need more power.</p>

<!-- A: -->
<p class="section-sub reveal">7-day free trial on all plans. No credit card required upfront.</p>
```

Rimuovi il blocco early access banner (righe 783-787):
```html
<div class="early-access-banner reveal" ...>
  <strong>Free during early access</strong> — ...
</div>
```

- [ ] **Step 5: Aggiorna CTAs**

Ogni occorrenza di:
- `"Try now for free →"` → `"Start free trial →"`
- `"Free to use · No credit card required"` → `"7-day free trial · No credit card required"`
- `"Free · No credit card required"` → `"7-day free trial"`

Cerca tutte le occorrenze con grep e aggiornale.

- [ ] **Step 6: Aggiorna JSON-LD schema description**

Riga ~47:
```html
<!-- DA: -->
"description": "Free plan available"
<!-- A: -->
"description": "7-day free trial"
```

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: update homepage pricing — Basic €4.99, 7-day trial, remove free plan"
```

---

## Task 6: Admin Panel + Welcome Email

**Files:**
- Modify: `public/admin.html:673-677` (plan dropdown)
- Modify: `server.js` (welcome email copy)

- [ ] **Step 1: Aggiorna dropdown piani in admin.html**

Sostituisci il blocco `<select onchange="setPlan...">`:
```html
<select onchange="setPlan('${s.shop}',this)" ...>
  <option value="beta" ${s.plan==='beta'?'selected':''}>beta</option>
  <option value="basic" ${s.plan==='basic'?'selected':''}>basic</option>
  <option value="starter" ${s.plan==='starter'?'selected':''}>growth</option>
  <option value="pro" ${s.plan==='pro'?'selected':''}>pro</option>
</select>
```

Rimuovi `<option value="free" ...>free</option>`.

Aggiorna i colori nel JS della funzione `setPlan`:
```js
sel.style.background = plan==='beta'?'#dcfce7':plan==='pro'?'#ede9fe':plan==='starter'?'#eff6ff':plan==='basic'?'#f0f9ff':'#f1f5f9';
sel.style.color = plan==='beta'?'#166534':plan==='pro'?'#5b21b6':plan==='starter'?'#1d4ed8':plan==='basic'?'#0369a1':'#475569';
```

- [ ] **Step 2: Aggiorna welcome email in server.js**

Trova in `sendWelcomeEmail` la riga:
```js
Everything is <strong style="color:#1a5c38">free during early access</strong> — full features, no credit card required.
```

Sostituisci con:
```js
Your <strong style="color:#1a5c38">7-day free trial</strong> is active — full features unlocked, no credit card required.
```

Riga con "unlimited during early access":
```js
<strong>Scheduling</strong> — stage changes now, push them live at the perfect moment (unlimited during early access)
```
Sostituisci con:
```js
<strong>Scheduling</strong> — stage changes now, push them live at the perfect moment
```

- [ ] **Step 3: Commit**

```bash
git add public/admin.html server.js
git commit -m "feat: admin panel basic plan, updated welcome email for trial"
```

---

## Task 7: Deploy

- [ ] **Step 1: Push e verifica Railway deploy**

```bash
git push origin main
```

Aspetta il deploy Railway (di solito 1-2 min), poi verifica:
- `https://lederly.com` → pagina pricing mostra "Basic €4.99" + "7-day free trial"
- `https://lederly.com/admin` → dropdown piani include `basic`, non include `free`
- Installa l'app su uno store di test → verifica che `trial_ends_at` sia settato (controlla via admin panel o DB)

- [ ] **Step 2: Test billing flow su store di test**

1. Connetti uno store test
2. Apri la app → verifica trial banner "7 days left in your free trial"
3. Clicca "Upgrade now →" → upgrade modal con 3 piani
4. Clicca "Choose Basic →" → deve chiamare `/billing/subscribe` e redirigere a Shopify
5. Approva → redirect a `/app?billing_ok=basic`
6. Verifica toast "Basic plan activated!"

**Nota:** Per testare il billing in development, Shopify richiede che l'app sia in produzione (o usa `test: true` nel `appSubscriptionCreate` durante i test).

- [ ] **Step 3: Commit finale se ci sono fix post-deploy**

```bash
git add -A
git commit -m "fix: post-deploy billing adjustments"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✅ Rimozione piano Free permanente
- ✅ Piano Basic €4.99 con unlimited edits
- ✅ Trial 7 giorni full access per nuovi store
- ✅ Shopify Billing API (subscribe + callback)
- ✅ UI homepage aggiornata
- ✅ Upgrade modal con billing reale
- ✅ Trial banner in app
- ✅ Admin panel aggiornato

**Gap identificati:**
- Il webhook `app/subscriptions/cancelled` non è gestito — quando un merchant cancella il piano da Shopify, il DB non viene aggiornato. Da aggiungere come task separato post-launch.
- Il `test: true` flag per development non è nel piano — ricordati di non usare `test: true` in produzione.

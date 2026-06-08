import express from 'express';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();
const PORT       = Number(process.env.PORT || 8787);
const API_VERSION= process.env.SHOPIFY_API_VERSION || '2025-01';
const NODE_ENV   = process.env.NODE_ENV || 'development';
const IS_PROD    = NODE_ENV === 'production';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (IS_PROD ? '' : 'http://localhost:8787,http://127.0.0.1:8787'))
  .split(',').map(v => v.trim()).filter(Boolean);
const SHOPIFY_TIMEOUT_MS  = Number(process.env.SHOPIFY_TIMEOUT_MS || 15000);
const SHOPIFY_CLIENT_ID   = process.env.SHOPIFY_CLIENT_ID   || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const SHOPIFY_SCOPES      = process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_inventory,write_inventory,read_collections,write_collections';
const APP_URL             = (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '');
const SCHED_SECRET        = process.env.SCHED_SECRET || '';
const SCHED_FILE          = process.env.SCHED_FILE || path.join(__dirname, 'schedules.json');
const BREVO_API_KEY       = process.env.BREVO_API_KEY || '';
const NOTIFY_FROM         = process.env.NOTIFY_FROM || 'noreply@bulkedit.app';

// In-memory OAuth state (stateless — no DB)
const oauthStates = new Map();
setInterval(() => { const n = Date.now(); for (const [k,v] of oauthStates) if (n > v.exp) oauthStates.delete(k); }, 60000).unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('X-Request-Id', req.requestId); next(); });

// Allow OAuth callback through origin check
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) return next();
  return res.status(403).json({ ok: false, error: 'Origin not allowed' });
});

app.use(helmet({
  contentSecurityPolicy: false,   // handled via meta tag in HTML for flexibility
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: IS_PROD ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false
}));

app.use(express.json({ limit: '256kb', strict: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Never cache JS/HTML — always serve fresh
    if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', IS_PROD ? 'public, max-age=3600' : 'no-store');
    }
  }
}));

// ── RATE LIMITING ─────────────────────────────────────────
const buckets = new Map();
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const now = Date.now(), key = keyFn(req);
    const b = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > b.resetAt) { b.count = 0; b.resetAt = now + windowMs; }
    b.count++; buckets.set(key, b);
    if (b.count > max) return res.status(429).json({ ok: false, error: 'Too many requests.' });
    next();
  };
}
setInterval(() => { const n = Date.now(); for (const [k,v] of buckets) if (n > v.resetAt) buckets.delete(k); }, 60000).unref();

const byIpShop  = req => `${req.ip}:${req.headers['x-shopify-shop']||'?'}`;
const apiLimiter   = rateLimit({ windowMs: 60000, max: 120, keyFn: byIpShop });
const writeLimiter = rateLimit({ windowMs: 60000, max: 30,  keyFn: req => byIpShop(req)+':w' });
const authLimiter  = rateLimit({ windowMs: 60000, max: 20,  keyFn: req => req.ip });

// ── HELPERS ───────────────────────────────────────────────
function safeErr(err) {
  if (!IS_PROD) return err.message || 'Request failed';
  const m = String(err.message || 'Request failed');
  if (/token|secret|password|auth/i.test(m)) return 'Authentication failed';
  return m.slice(0, 180);
}

function cleanShop(s) {
  if (!s) throw new Error('Missing shop domain');
  const n = String(s).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(n)) throw new Error('Invalid shop domain');
  return n;
}

function getSession(req) {
  const shop  = cleanShop(req.headers['x-shopify-shop']);
  const token = String(req.headers['x-shopify-token'] || '').trim();
  if (!token || token.length < 20 || token.length > 256 || /\s/.test(token)) throw new Error('Invalid token');
  return { shop, token };
}

function safeProductInput(p = {}) {
  const allowed = new Set(['title','status','vendor','tags']);
  const clean = {};
  for (const [k, v] of Object.entries(p)) {
    if (!allowed.has(k)) throw new Error(`Field not allowed: ${k}`);
    if (k === 'status' && !['ACTIVE','DRAFT','ARCHIVED'].includes(String(v).toUpperCase())) throw new Error('Invalid status');
    if (k === 'tags' && !Array.isArray(v)) throw new Error('Tags must be array');
    clean[k] = k === 'status' ? String(v).toUpperCase() : v;
  }
  return clean;
}

function gid(v, type) {
  if (typeof v !== 'string' || !v.startsWith(`gid://shopify/${type}/`)) throw new Error(`Invalid ${type} GID`);
  return v;
}

function money(v, name) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999999) throw new Error(`Invalid ${name}`);
  return n.toFixed(2);
}

function safeMetafields(mf = []) {
  if (!Array.isArray(mf) || mf.length > 50) throw new Error('Invalid metafields');
  return mf.map(m => {
    const ownerId   = String(m.ownerId || '');
    const namespace = String(m.namespace || '').trim();
    const key       = String(m.key || '').trim();
    const type      = String(m.type || '').trim();
    const value     = String(m.value ?? '');
    if (!ownerId.match(/^gid:\/\/shopify\/(Product|ProductVariant)\//)) throw new Error('Invalid metafield owner');
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(namespace)) throw new Error('Invalid namespace');
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(key))       throw new Error('Invalid key');
    if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(type))     throw new Error('Invalid type');
    if (value.length > 5000)                        throw new Error('Value too long');
    return { ownerId, namespace, key, type, value };
  });
}

async function gql({ shop, token }, query, variables = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SHOPIFY_TIMEOUT_MS);
  try {
    const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token, 'User-Agent': 'BulkEdit/1.0' },
      body: JSON.stringify({ query, variables })
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!r.ok || json.errors) throw new Error((json.errors?.[0]?.message || json.raw || `API ${r.status}`).slice(0, 300));
    return json.data;
  } finally { clearTimeout(t); }
}

// ── SCHEDULE HELPERS ─────────────────────────────────────
function schedKey() {
  if (!SCHED_SECRET) throw new Error('SCHED_SECRET not set. Add it to environment variables to enable scheduling.');
  return crypto.createHash('sha256').update(SCHED_SECRET).digest();
}
function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', schedKey(), iv);
  const enc = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}
function decryptToken(enc) {
  try {
    const [ivHex, encHex] = enc.split(':');
    const d = crypto.createDecipheriv('aes-256-cbc', schedKey(), Buffer.from(ivHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
}
function readSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHED_FILE, 'utf8')); } catch { return []; }
}
function writeSchedules(arr) {
  try {
    const dir = path.dirname(SCHED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCHED_FILE, JSON.stringify(arr));
  } catch (e) { console.error('[scheduler] write error:', e.message); }
}
function schedFileStatus() {
  try { fs.accessSync(path.dirname(SCHED_FILE), fs.constants.W_OK); return 'writable'; } catch { return 'NOT writable'; }
}

async function sendNotification(sched, success) {
  if (!BREVO_API_KEY || !sched.notifyEmail) return;
  const dt = new Date(sched.scheduledFor).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' });
  const subject = success
    ? `✅ Schedule executed: ${sched.label}`
    : `❌ Schedule failed: ${sched.label}`;
  const rows = (sched.changes || []).map(c => {
    const varCount = Object.keys(c.variants || {}).length;
    const mfCount  = (c.metafields || []).length;
    const parts = [];
    if (Object.keys(c.product || {}).length) parts.push(Object.keys(c.product).join(', '));
    if (varCount) parts.push(`${varCount} variant${varCount !== 1 ? 's' : ''}`);
    if (mfCount)  parts.push(`${mfCount} metafield${mfCount !== 1 ? 's' : ''}`);
    return `<tr><td style="padding:4px 12px 4px 0;color:#374151">${c.productId.split('/').pop()}</td><td style="padding:4px 0;color:#6b7280">${parts.join(' · ') || '—'}</td></tr>`;
  }).join('');
  const htmlContent = `
    <div style="font-family:sans-serif;max-width:520px;color:#111">
      <h2 style="margin:0 0 8px">${subject}</h2>
      <p style="color:#6b7280;margin:0 0 16px">Store: <strong>${sched.shop}</strong> · Scheduled for: <strong>${dt}</strong></p>
      ${!success ? `<p style="color:#ef4444;margin:0 0 16px">Error: ${sched.error || 'unknown'}</p>` : ''}
      <table style="border-collapse:collapse;width:100%">
        <thead><tr><th style="text-align:left;padding:4px 12px 4px 0;color:#9ca3af;font-size:12px">Product</th><th style="text-align:left;color:#9ca3af;font-size:12px">Changes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">Sent by BulkEdit</p>
    </div>`;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'BulkEdit', email: NOTIFY_FROM },
        to: [{ email: sched.notifyEmail }],
        subject,
        htmlContent,
      }),
    });
    if (!r.ok) console.error('[notify] brevo error:', await r.text());
  } catch (e) { console.error('[notify] email error:', e.message); }
}

// Extracted save logic shared by /api/save-product and the schedule executor
async function execSaveProduct(session, { productId, product = {}, variants = [], metafields = [] }) {
  const results = [];
  if (productId && product && Object.keys(product).length) {
    gid(productId, 'Product');
    const input = { id: productId, ...safeProductInput(product) };
    const d = await gql(session, `
      mutation ProductUpdate($input: ProductInput!) {
        productUpdate(input:$input) { product { id } userErrors { field message } }
      }`, { input });
    const errs = d.productUpdate.userErrors;
    if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
    results.push({ type: 'product', id: productId });
  }
  if (Array.isArray(variants) && variants.length) {
    if (variants.length > 100) throw new Error('Too many variants');
    const byProduct = {};
    for (const v of variants) {
      gid(v.id, 'ProductVariant');
      if (!byProduct[productId]) byProduct[productId] = [];
      const inp = { id: v.id };
      if (v.price          !== undefined) inp.price          = money(v.price, 'price');
      if (v.compareAtPrice !== undefined) inp.compareAtPrice = money(v.compareAtPrice, 'compareAtPrice');
      if (v.sku            !== undefined) inp.inventoryItem  = { sku: String(v.sku || '').slice(0, 255) };
      byProduct[productId].push(inp);
    }
    for (const [pid, variantInputs] of Object.entries(byProduct)) {
      const d = await gql(session, `
        mutation VariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id } userErrors { field message }
          }
        }`, { productId: pid, variants: variantInputs });
      const errs = d.productVariantsBulkUpdate.userErrors;
      if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
      results.push({ type: 'variants', count: variantInputs.length });
    }
  }
  const cleanMf = safeMetafields(metafields);
  if (cleanMf.length) {
    const d = await gql(session, `
      mutation MetafieldsSet($metafields:[MetafieldsSetInput!]!) {
        metafieldsSet(metafields:$metafields) { metafields { id } userErrors { field message code } }
      }`, { metafields: cleanMf });
    const errs = d.metafieldsSet.userErrors;
    if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
    results.push({ type: 'metafields', count: cleanMf.length });
  }
  return results;
}

async function executeSchedule(sched, schedules) {
  sched.status = 'running';
  writeSchedules(schedules);
  try {
    const token = decryptToken(sched.encToken);
    if (!token) throw new Error('Could not decrypt token — was SCHED_SECRET changed?');
    const session = { shop: sched.shop, token };
    for (const c of sched.changes) {
      const mf = (c.metafields || []).map(({ _idx, ...rest }) => rest);
      await execSaveProduct(session, {
        productId: c.productId,
        product:   c.product   || {},
        variants:  Object.values(c.variants || {}),
        metafields: mf,
      });
    }
    sched.status     = 'executed';
    sched.executedAt = new Date().toISOString();
    sched.encToken   = null;
    sendNotification(sched, true).catch(() => {});
  } catch (e) {
    sched.status = 'failed';
    sched.error  = safeErr(e);
    sendNotification(sched, false).catch(() => {});
  }
  writeSchedules(schedules);
}

let _schedRunning = false;
async function runDueSchedules() {
  if (!SCHED_SECRET || _schedRunning) return;
  _schedRunning = true;
  try {
    const schedules = readSchedules();
    const due = schedules.filter(s => s.status === 'pending' && new Date(s.scheduledFor) <= new Date());
    if (due.length) {
      console.log(`[scheduler] ${due.length} due schedule(s)`);
      for (const s of due) await executeSchedule(s, schedules);
    }
  } finally { _schedRunning = false; }
}

// Primary: check every 30s — no .unref() so it always fires
setInterval(() => runDueSchedules().catch(e => console.error('[scheduler]', e.message)), 30_000);
// Also run immediately on startup
runDueSchedules().catch(e => console.error('[scheduler] startup:', e.message));

// Debounced trigger: also run on any authenticated API request (catches server wakeups)
let _lastSchedCheck = 0;
function maybeRunSchedules() {
  const now = Date.now();
  if (now - _lastSchedCheck < 30_000) return;
  _lastSchedCheck = now;
  runDueSchedules().catch(() => {});
}

// Serve /app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Handle OAuth callback redirect to /app
// Step 1 — if shop provided, redirect directly; otherwise redirect to Shopify account picker
app.get('/auth/start', authLimiter, (req, res) => {
  if (!SHOPIFY_CLIENT_ID) return res.status(500).send('OAuth not configured.');
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${APP_URL}/auth/callback`;

  // If shop domain provided, go directly to that shop's OAuth
  if (req.query.shop) {
    let shop;
    try { shop = cleanShop(String(req.query.shop)); } catch { return res.status(400).send('Invalid shop.'); }
    oauthStates.set(state, { shop, exp: Date.now() + 300000 });
    return res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`);
  }

  // No shop provided — return error
  return res.status(400).send('Missing shop domain. Please provide ?shop=your-store.myshopify.com');
});

// Step 2 — Shopify calls back with code
app.get('/auth/callback', authLimiter, async (req, res) => {
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) return res.status(500).send('OAuth not configured.');
  const { code, state, shop: rawShop, hmac } = req.query;

  const stored = oauthStates.get(String(state));
  if (!stored || Date.now() > stored.exp) return res.status(403).send('Invalid or expired state.');
  oauthStates.delete(String(state));

  let shop;
  try { shop = cleanShop(String(rawShop || '')); } catch { return res.status(400).send('Invalid shop.'); }

  // HMAC validation
  const qCopy = { ...req.query }; delete qCopy.hmac;
  const msg  = Object.keys(qCopy).sort().map(k => `${k}=${qCopy[k]}`).join('&');
  const expected = crypto.createHmac('sha256', SHOPIFY_CLIENT_SECRET).update(msg).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac || '', 'hex'), Buffer.from(expected, 'hex'))) return res.status(403).send('HMAC failed.');
  } catch { return res.status(403).send('HMAC failed.'); }

  // Exchange code for token
  try {
    const tr = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code })
    });
    const td = await tr.json();
    if (!td.access_token) throw new Error('No token');
    // Pass token to frontend via URL — never stored server-side
    res.redirect(`/app?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(td.access_token)}`);
  } catch (e) {
    res.status(500).send(IS_PROD ? 'Authentication error.' : e.message);
  }
});

// ── API ───────────────────────────────────────────────────
// Piggyback schedule check on every API call (catches server wakeups from sleep)
app.use('/api/', (req, res, next) => { maybeRunSchedules(); next(); });

app.post('/api/test', apiLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const d = await gql(s, `query { shop { name myshopifyDomain } }`);
    res.json({ ok: true, shop: d.shop });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/products', apiLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const raw = String(req.body?.query || '').trim().slice(0, 250);
    const terms = raw ? raw.split(',').map(t => t.trim().replace(/[^\w\s-]/g, '')).filter(Boolean) : [];
    const first = Math.min(Math.max(Number(req.body?.first || 50), 1), 100);
    const search = terms.length
      ? terms.map(t => `(title:*${t}* OR tag:${t} OR vendor:${t}* OR sku:${t}*)`).join(' OR ')
      : null;
    const d = await gql(s, `
      query Products($first:Int!, $query:String) {
        products(first:$first, query:$query, sortKey:UPDATED_AT, reverse:true) {
          nodes {
            id title status vendor tags
            featuredImage { url }
            metafields(first:50) { nodes { id namespace key type value } }
            variants(first:100) {
              nodes {
                id title sku price compareAtPrice inventoryQuantity
                metafields(first:50) { nodes { id namespace key type value } }
              }
            }
          }
        }
      }`, { first, query: search });
    res.json({ ok: true, products: d.products.nodes });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/metafield-definitions', apiLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const d = await gql(s, `
      query MfDefs($first: Int!) {
        productDefs:  metafieldDefinitions(ownerType: PRODUCT,        first: $first) { nodes { namespace key name type { name } } }
        variantDefs:  metafieldDefinitions(ownerType: PRODUCTVARIANT, first: $first) { nodes { namespace key name type { name } } }
      }`, { first: 200 });
    const map = (nodes, ownerType) => nodes.map(def => ({
      namespace: def.namespace,
      key:       def.key,
      name:      def.name,
      type:      def.type?.name || 'single_line_text_field',
      ownerType,
    }));
    const definitions = [
      ...map(d.productDefs.nodes,  'PRODUCT'),
      ...map(d.variantDefs.nodes,  'PRODUCTVARIANT'),
    ];
    res.json({ ok: true, definitions });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/save-product', apiLimiter, writeLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const { productId, product, variants = [], metafields = [] } = req.body || {};
    const results = [];

    // Update product fields
    if (productId && product && Object.keys(product).length) {
      gid(productId, 'Product');
      const input = { id: productId, ...safeProductInput(product) };
      const d = await gql(s, `
        mutation ProductUpdate($input: ProductInput!) {
          productUpdate(input:$input) {
            product { id title status }
            userErrors { field message }
          }
        }`, { input });
      const errs = d.productUpdate.userErrors;
      if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
      results.push({ type: 'product', id: productId });
    }

    // Update variants using productVariantsBulkUpdate
    if (Array.isArray(variants) && variants.length) {
      if (variants.length > 100) throw new Error('Too many variants');
      // Group variants by product
      const byProduct = {};
      for (const v of variants) {
        gid(v.id, 'ProductVariant');
        // Extract product ID from variant GID or use productId
        const pid = productId;
        if (!byProduct[pid]) byProduct[pid] = [];
        const input = { id: v.id };
        if (v.price          !== undefined) input.price          = money(v.price, 'price');
        if (v.compareAtPrice !== undefined) input.compareAtPrice = money(v.compareAtPrice, 'compareAtPrice');
        if (v.sku            !== undefined) input.inventoryItem  = { sku: String(v.sku || '').slice(0, 255) };
        byProduct[pid].push(input);
      }
      for (const [pid, variantInputs] of Object.entries(byProduct)) {
        const d = await gql(s, `
          mutation VariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants { id price compareAtPrice inventoryItem { sku } }
              userErrors { field message }
            }
          }`, { productId: pid, variants: variantInputs });
        const errs = d.productVariantsBulkUpdate.userErrors;
        if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
        results.push({ type: 'variants', count: variantInputs.length });
      }
    }

    // Update metafields
    const cleanMf = safeMetafields(metafields);
    if (cleanMf.length) {
      const d = await gql(s, `
        mutation MetafieldsSet($metafields:[MetafieldsSetInput!]!) {
          metafieldsSet(metafields:$metafields) {
            metafields { id namespace key }
            userErrors { field message code }
          }
        }`, { metafields: cleanMf });
      const errs = d.metafieldsSet.userErrors;
      if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
      results.push({ type: 'metafields', count: cleanMf.length });
    }

    res.json({ ok: true, results });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

// ── COLLECTIONS API ───────────────────────────────────────

// Get all collections (custom + smart)
app.post('/api/collections', apiLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const first = Math.min(Number(req.body?.first || 50), 100);
    const d = await gql(s, `
      query Collections($first: Int!) {
        collections(first: $first, sortKey: TITLE) {
          nodes {
            id
            title
            handle
            productsCount { count }
          }
        }
      }`, { first });
    res.json({ ok: true, collections: d.collections.nodes });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

// Add products to a collection
app.post('/api/collection-add', apiLimiter, writeLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const { collectionId, productIds } = req.body || {};
    if (!collectionId || !Array.isArray(productIds) || !productIds.length) throw new Error('Missing collectionId or productIds');
    gid(collectionId, 'Collection');
    if (productIds.length > 100) throw new Error('Too many products (max 100)');
    productIds.forEach(id => gid(id, 'Product'));
    const d = await gql(s, `
      mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection { id title productsCount { count } }
          userErrors { field message }
        }
      }`, { id: collectionId, productIds });
    const errs = d.collectionAddProducts.userErrors;
    if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
    res.json({ ok: true, collection: d.collectionAddProducts.collection });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

// Remove products from a collection
app.post('/api/collection-remove', apiLimiter, writeLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const { collectionId, productIds } = req.body || {};
    if (!collectionId || !Array.isArray(productIds) || !productIds.length) throw new Error('Missing collectionId or productIds');
    gid(collectionId, 'Collection');
    productIds.forEach(id => gid(id, 'Product'));
    const d = await gql(s, `
      mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) {
          job { id }
          userErrors { field message }
        }
      }`, { id: collectionId, productIds });
    const errs = d.collectionRemoveProducts.userErrors;
    if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

// Public ping endpoint — no auth needed, safe to expose
// Used by external cron services (cron-job.org, UptimeRobot) to keep server alive
// and trigger schedule checks even when no users are active
app.get('/api/schedule/ping', async (req, res) => {
  const before = readSchedules();
  const pendingBefore = before.filter(s => s.status === 'pending').length;
  await runDueSchedules().catch(e => console.error('[ping]', e.message));
  const after = readSchedules();
  const fileExists   = (() => { try { return fs.existsSync(SCHED_FILE); } catch { return false; } })();
  const dirWritable  = schedFileStatus() === 'writable';
  const now = new Date();
  const pendingList = after
    .filter(s => s.status === 'pending')
    .map(({ id, label, scheduledFor }) => ({
      id, label, scheduledFor,
      overdue: new Date(scheduledFor) <= now,
      secondsUntilDue: Math.round((new Date(scheduledFor) - now) / 1000),
    }));
  res.json({
    ok: true,
    ts: now.toISOString(),
    schedEnabled: !!SCHED_SECRET,
    schedFile: SCHED_FILE,
    fileExists,
    dirWritable,
    totalSchedules:    after.length,
    pendingSchedules:  after.filter(s => s.status === 'pending').length,
    executedSchedules: after.filter(s => s.status === 'executed').length,
    failedSchedules:   after.filter(s => s.status === 'failed').length,
    justExecuted:      pendingBefore - after.filter(s => s.status === 'pending').length,
    pending: pendingList,
  });
});

// ── SCHEDULE API ─────────────────────────────────────────

app.post('/api/schedule/create', apiLimiter, async (req, res) => {
  try {
    if (!SCHED_SECRET) throw new Error('Scheduling not enabled. Set SCHED_SECRET in environment variables.');
    const { shop, token } = getSession(req);
    const { scheduledFor, label, changes, linkedTo } = req.body || {};
    if (!scheduledFor) throw new Error('Missing scheduledFor');
    const dt = new Date(scheduledFor);
    if (isNaN(dt.getTime())) throw new Error('Invalid scheduledFor');
    if (dt <= new Date()) throw new Error('Scheduled time must be in the future');
    if (!Array.isArray(changes) || !changes.length || changes.length > 200) throw new Error('Invalid changes');
    if (!label || !String(label).trim()) throw new Error('Label is required');
    let notifyEmail = '';
    try {
      const sd = await gql({ shop, token }, `query { shop { email } }`);
      notifyEmail = sd.shop?.email || '';
    } catch {}
    const id = crypto.randomBytes(12).toString('hex');
    const sched = {
      id, shop,
      createdAt: new Date().toISOString(),
      scheduledFor: dt.toISOString(),
      label: String(label).trim().slice(0, 120),
      linkedTo: linkedTo || null,
      notifyEmail,
      changes,
      encToken: encryptToken(token),
      status: 'pending',
      executedAt: null,
      error: null,
    };
    const schedules = readSchedules();
    schedules.push(sched);
    writeSchedules(schedules);
    const { encToken: _, ...safe } = sched;
    res.json({ ok: true, schedule: safe });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/list', apiLimiter, (req, res) => {
  try {
    const { shop } = getSession(req);
    const schedules = readSchedules();
    const mine = schedules
      .filter(s => s.shop === shop)
      .map(({ encToken: _, ...rest }) => rest)
      .sort((a, b) => new Date(b.scheduledFor) - new Date(a.scheduledFor));
    res.json({ ok: true, schedules: mine });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/cancel', apiLimiter, (req, res) => {
  try {
    const { shop } = getSession(req);
    const { id } = req.body || {};
    if (!id) throw new Error('Missing id');
    const schedules = readSchedules();
    const sched = schedules.find(s => s.id === id && s.shop === shop);
    if (!sched) throw new Error('Schedule not found');
    if (!['pending', 'failed'].includes(sched.status)) throw new Error('Cannot cancel this schedule');
    sched.status = 'cancelled';
    sched.encToken = null;
    writeSchedules(schedules);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/run', apiLimiter, writeLimiter, async (req, res) => {
  try {
    if (!SCHED_SECRET) throw new Error('Scheduling not enabled.');
    const { shop } = getSession(req);
    const { id } = req.body || {};
    if (!id) throw new Error('Missing id');
    const schedules = readSchedules();
    const sched = schedules.find(s => s.id === id && s.shop === shop);
    if (!sched) throw new Error('Schedule not found');
    if (!['pending', 'failed'].includes(sched.status)) throw new Error('Schedule cannot be run');
    if (!sched.encToken) throw new Error('Token unavailable — please recreate this schedule');
    sched.status = 'pending'; sched.error = null;
    await executeSchedule(sched, schedules);
    const { encToken: _, ...safe } = sched;
    res.json({ ok: true, schedule: safe });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.use((err, req, res, _n) => res.status(err.status || 500).json({ ok: false, error: safeErr(err), requestId: req.requestId }));

app.listen(PORT, () => {
  console.log(`BulkEdit on http://localhost:${PORT}`);
  console.log(`OAuth: ${SHOPIFY_CLIENT_ID ? 'OK' : 'NOT configured'}`);
  if (SCHED_SECRET) {
    console.log(`Scheduling: ENABLED — file: ${SCHED_FILE} (${schedFileStatus()})`);
    const existing = readSchedules();
    console.log(`Scheduling: ${existing.length} schedule(s) on disk, ${existing.filter(s=>s.status==='pending').length} pending`);
  } else {
    console.log(`Scheduling: DISABLED (set SCHED_SECRET)`);
  }
});

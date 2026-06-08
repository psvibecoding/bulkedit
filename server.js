import express from 'express';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
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

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.use((err, req, res, _n) => res.status(err.status || 500).json({ ok: false, error: safeErr(err), requestId: req.requestId }));

app.listen(PORT, () => {
  console.log(`BulkEdit on http://localhost:${PORT}`);
  console.log(`OAuth: ${SHOPIFY_CLIENT_ID ? 'OK' : 'NOT configured'}`);
});

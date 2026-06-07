import express from 'express';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (IS_PROD ? '' : 'http://localhost:8787,http://127.0.0.1:8787'))
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const MAX_BODY_BYTES = '256kb';
const SHOPIFY_TIMEOUT_MS = Number(process.env.SHOPIFY_TIMEOUT_MS || 15000);
const TOKEN_PREFIX_ALLOWLIST = ['shpat_', 'shpca_', 'shppa_', 'shpss_'];

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) return next();
  return res.status(403).json({ ok: false, error: 'Origin not allowed' });
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: IS_PROD ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: IS_PROD ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false
}));

app.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: IS_PROD ? '1h' : 0,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', IS_PROD ? 'public, max-age=3600' : 'no-store');
  }
}));

const buckets = new Map();
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) return res.status(429).json({ ok: false, error: 'Too many requests. Try again shortly.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets.entries()) if (now > value.resetAt) buckets.delete(key);
}, 60000).unref();

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  keyFn: req => `${req.ip}:${String(req.headers['x-shopify-shop'] || 'unknown')}`
});

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.WRITE_LIMIT_PER_MINUTE || 30),
  keyFn: req => `${req.ip}:${String(req.headers['x-shopify-shop'] || 'unknown')}:write`
});

function safeError(err) {
  if (!IS_PROD) return err.message || 'Request failed';
  const msg = String(err.message || 'Request failed');
  if (/token|access|authorization|secret|password/i.test(msg)) return 'Authentication failed';
  return msg.slice(0, 180);
}

function cleanShop(shop) {
  if (!shop || typeof shop !== 'string') throw new Error('Missing shop domain');
  const normalized = shop.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new Error('Invalid shop domain. Use your-store.myshopify.com');
  }
  return normalized;
}

function getSession(req) {
  const shop = cleanShop(req.headers['x-shopify-shop']);
  const token = String(req.headers['x-shopify-token'] || '').trim();
  const hasAllowedPrefix = TOKEN_PREFIX_ALLOWLIST.some(prefix => token.startsWith(prefix));
  if (!hasAllowedPrefix || token.length < 32 || token.length > 256 || /\s/.test(token)) {
    throw new Error('Missing or invalid Admin API access token');
  }
  return { shop, token };
}

function ensureSafeProductInput(product = {}) {
  const allowed = new Set(['title', 'status', 'vendor', 'tags']);
  const clean = {};
  for (const [key, value] of Object.entries(product)) {
    if (!allowed.has(key)) throw new Error(`Field not allowed: ${key}`);
    if (key === 'status' && !['ACTIVE', 'DRAFT', 'ARCHIVED', 'active', 'draft', 'archived'].includes(String(value))) throw new Error('Invalid product status');
    if (key === 'tags' && !Array.isArray(value)) throw new Error('Tags must be an array');
    clean[key] = key === 'status' ? String(value).toUpperCase() : value;
  }
  return clean;
}

function ensureGid(value, type) {
  if (typeof value !== 'string' || !value.startsWith(`gid://shopify/${type}/`)) throw new Error(`Invalid ${type} id`);
  return value;
}

function money(value, fieldName) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999) throw new Error(`Invalid ${fieldName}`);
  return n.toFixed(2);
}

function ensureMetafields(metafields = []) {
  if (!Array.isArray(metafields)) throw new Error('Metafields must be an array');
  if (metafields.length > 50) throw new Error('Too many metafields in one request');
  return metafields.map(m => {
    const ownerId = String(m.ownerId || '');
    if (!ownerId.startsWith('gid://shopify/ProductVariant/') && !ownerId.startsWith('gid://shopify/Product/')) {
      throw new Error('Invalid metafield owner');
    }
    const namespace = String(m.namespace || '').trim();
    const key = String(m.key || '').trim();
    const type = String(m.type || '').trim();
    const value = String(m.value ?? '');
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(namespace)) throw new Error('Invalid metafield namespace');
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(key)) throw new Error('Invalid metafield key');
    if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(type)) throw new Error('Invalid metafield type');
    if (value.length > 5000) throw new Error('Metafield value too long');
    return { ownerId, namespace, key, type, value };
  });
}

async function shopifyGraphQL({ shop, token }, query, variables = {}) {
  if (!query || typeof query !== 'string' || query.length > 12000) throw new Error('Invalid GraphQL query');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        'User-Agent': 'Shopify-Privacy-Bulk-Tool/0.2'
      },
      body: JSON.stringify({ query, variables })
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok || json.errors) {
      const msg = json.errors?.[0]?.message || json.raw || `Shopify API error ${res.status}`;
      throw new Error(String(msg).slice(0, 300));
    }
    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

app.post('/api/test', apiLimiter, async (req, res) => {
  try {
    const session = getSession(req);
    const data = await shopifyGraphQL(session, `query { shop { name myshopifyDomain } }`);
    res.json({ ok: true, shop: data.shop });
  } catch (err) {
    res.status(400).json({ ok: false, error: safeError(err), requestId: req.requestId });
  }
});

app.post('/api/products', apiLimiter, async (req, res) => {
  try {
    const session = getSession(req);
    const q = String(req.body?.query || '').trim().slice(0, 80);
    const first = Math.min(Math.max(Number(req.body?.first || 30), 1), 100);
    const safeQ = q.replace(/[^\w\s-]/g, '').trim();
    const search = safeQ ? `title:*${safeQ}* OR tag:*${safeQ}* OR sku:*${safeQ}*` : null;
    const data = await shopifyGraphQL(session, `
      query Products($first:Int!, $query:String) {
        products(first:$first, query:$query, sortKey:UPDATED_AT, reverse:true) {
          nodes {
            id legacyResourceId title status vendor tags handle updatedAt
            variants(first:50) {
              nodes {
                id legacyResourceId title sku price compareAtPrice inventoryQuantity
                metafields(first:25) { nodes { id namespace key type value } }
              }
            }
          }
        }
      }`, { first, query: search });
    res.json({ ok: true, products: data.products.nodes });
  } catch (err) {
    res.status(400).json({ ok: false, error: safeError(err), requestId: req.requestId });
  }
});

app.post('/api/save-product', apiLimiter, writeLimiter, async (req, res) => {
  try {
    const session = getSession(req);
    const { productId, product, variants = [], metafields = [] } = req.body || {};
    const results = [];

    if (productId && product && Object.keys(product).length) {
      ensureGid(productId, 'Product');
      const input = { id: productId, ...ensureSafeProductInput(product) };
      const data = await shopifyGraphQL(session, `
        mutation ProductUpdate($input: ProductInput!) {
          productUpdate(input:$input) { product { id title status vendor tags } userErrors { field message } }
        }`, { input });
      const errors = data.productUpdate.userErrors;
      if (errors.length) throw new Error(errors.map(e => e.message).join(', '));
      results.push({ type: 'product', id: productId });
    }

    if (!Array.isArray(variants) || variants.length > 50) throw new Error('Invalid variants payload');
    for (const v of variants) {
      const input = { id: ensureGid(v.id, 'ProductVariant') };
      if (v.price !== undefined) input.price = money(v.price, 'price');
      if (v.compareAtPrice !== undefined) input.compareAtPrice = money(v.compareAtPrice, 'compare at price');
      if (v.sku !== undefined) input.sku = String(v.sku || '').slice(0, 255);
      const data = await shopifyGraphQL(session, `
        mutation VariantUpdate($input: ProductVariantInput!) {
          productVariantUpdate(input:$input) { productVariant { id price compareAtPrice sku } userErrors { field message } }
        }`, { input });
      const errors = data.productVariantUpdate.userErrors;
      if (errors.length) throw new Error(errors.map(e => e.message).join(', '));
      results.push({ type: 'variant', id: v.id });
    }

    const cleanMetafields = ensureMetafields(metafields);
    if (cleanMetafields.length) {
      const data = await shopifyGraphQL(session, `
        mutation MetafieldsSet($metafields:[MetafieldsSetInput!]!) {
          metafieldsSet(metafields:$metafields) { metafields { id namespace key ownerType } userErrors { field message code } }
        }`, { metafields: cleanMetafields });
      const errors = data.metafieldsSet.userErrors;
      if (errors.length) throw new Error(errors.map(e => `${e.message}${e.code ? ` (${e.code})` : ''}`).join(', '));
      results.push({ type: 'metafields', count: cleanMetafields.length });
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: safeError(err), requestId: req.requestId });
  }
});

if (!IS_PROD && process.env.ENABLE_RAW_GRAPHQL === 'true') {
  app.post('/api/graphql', apiLimiter, async (req, res) => {
    try {
      const session = getSession(req);
      const { query, variables } = req.body || {};
      const data = await shopifyGraphQL(session, query, variables || {});
      res.json({ ok: true, data });
    } catch (err) {
      res.status(400).json({ ok: false, error: safeError(err), requestId: req.requestId });
    }
  });
}

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({ ok: false, error: safeError(err), requestId: req.requestId });
});

app.listen(PORT, () => {
  console.log(`Shopify Privacy Bulk Tool running on http://localhost:${PORT}`);
  console.log('Security mode: stateless proxy, no token storage, strict headers, rate limits, validated payloads.');
});

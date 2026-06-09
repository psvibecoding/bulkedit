import express from 'express';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();
const PORT       = Number(process.env.PORT || 8787);
const API_VERSION= process.env.SHOPIFY_API_VERSION || '2026-01';
const NODE_ENV   = process.env.NODE_ENV || 'development';
const IS_PROD    = NODE_ENV === 'production';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (IS_PROD ? '' : 'http://localhost:8787,http://127.0.0.1:8787'))
  .split(',').map(v => v.trim()).filter(Boolean);
const SHOPIFY_TIMEOUT_MS  = Number(process.env.SHOPIFY_TIMEOUT_MS || 15000);
const SHOPIFY_CLIENT_ID   = process.env.SHOPIFY_CLIENT_ID   || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const SHOPIFY_SCOPES      = process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_inventory,write_inventory,read_locations,read_collections,write_collections';
const APP_URL             = (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '');
const SCHED_SECRET        = process.env.SCHED_SECRET || '';
const SCHED_FILE          = process.env.SCHED_FILE || path.join(__dirname, 'schedules.json');
const RESEND_API_KEY      = process.env.RESEND_API_KEY || '';
const NOTIFY_FROM         = process.env.NOTIFY_FROM || 'noreply@lederly.com';
const NOTIFY_TZ           = process.env.NOTIFY_TZ   || 'UTC';
const CONTACT_TO          = process.env.CONTACT_TO  || '';
const PING_SECRET         = process.env.PING_SECRET || '';

// PostgreSQL pool (optional — falls back to file if DATABASE_URL not set)
const { Pool } = pg;
let dbPool = null;
if (process.env.DATABASE_URL) {
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
  });
  dbPool.query(`CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(e => console.error('[db] init error:', e.message));
}

// In-memory OAuth state (stateless — no DB)
const oauthStates = new Map();
setInterval(() => { const n = Date.now(); for (const [k,v] of oauthStates) if (n > v.exp) oauthStates.delete(k); }, 60000).unref();

// ── ANALYTICS (in-memory + structured logs) ───────────────
const analytics = { stores: new Set(), counts: {}, start: Date.now() };
function track(event, shop, meta = {}) {
  analytics.counts[event] = (analytics.counts[event] || 0) + 1;
  if (shop) analytics.stores.add(shop);
  const entry = { ev: event, ...(shop ? { s: shop.replace(/\.myshopify\.com$/, '').slice(0, 30) } : {}), ...meta, t: new Date().toISOString() };
  console.log(`[ev] ${JSON.stringify(entry)}`);
}

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
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
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

const byIpShop     = req => `${req.ip}:${req.headers['x-shopify-shop']||'?'}`;
const apiLimiter     = rateLimit({ windowMs: 60000,  max: 600, keyFn: byIpShop });
const writeLimiter   = rateLimit({ windowMs: 60000,  max: 600, keyFn: req => byIpShop(req)+':w' });
const authLimiter    = rateLimit({ windowMs: 60000,  max: 20,  keyFn: req => req.ip });
const contactLimiter  = rateLimit({ windowMs: 900000, max: 5,   keyFn: req => req.ip });
const feedbackLimiter = rateLimit({ windowMs: 3600000, max: 10, keyFn: req => req.ip });

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
  const allowed = new Set(['title','status','vendor','tags','bodyHtml']);
  const clean = {};
  for (const [k, v] of Object.entries(p)) {
    if (!allowed.has(k)) continue; // skip seo/altText — handled separately
    if (k === 'status' && !['ACTIVE','DRAFT','ARCHIVED'].includes(String(v).toUpperCase())) throw new Error('Invalid status');
    if (k === 'tags' && !Array.isArray(v)) throw new Error('Tags must be array');
    // Shopify API 2024-01+: bodyHtml was renamed to descriptionHtml on ProductInput
    if (k === 'bodyHtml') { clean['descriptionHtml'] = String(v || '').slice(0, 100000); continue; }
    clean[k] = k === 'status' ? String(v).toUpperCase() : v;
  }
  return clean;
}
function safeSeo(seo = {}) {
  if (!seo || typeof seo !== 'object') return null;
  const clean = {};
  if (seo.title       !== undefined) clean.title       = String(seo.title       || '').slice(0, 320);
  if (seo.description !== undefined) clean.description = String(seo.description || '').slice(0, 5000);
  return Object.keys(clean).length ? clean : null;
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

async function gql({ shop, token }, query, variables = {}, _retry = 0) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SHOPIFY_TIMEOUT_MS);
  try {
    const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token, 'User-Agent': 'Lederly/1.0' },
      body: JSON.stringify({ query, variables })
    });
    // HTTP 429 — wait Retry-After then retry (max 4 attempts)
    if (r.status === 429 && _retry < 4) {
      const wait = parseFloat(r.headers.get('Retry-After') || '2') * 1000;
      await new Promise(res => setTimeout(res, wait));
      return gql({ shop, token }, query, variables, _retry + 1);
    }
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    // GraphQL THROTTLED — backoff and retry
    if (json.errors?.some(e => e.extensions?.code === 'THROTTLED') && _retry < 4) {
      await new Promise(res => setTimeout(res, (1 + _retry) * 1000));
      return gql({ shop, token }, query, variables, _retry + 1);
    }
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
async function readSchedules() {
  if (dbPool) {
    try {
      const r = await dbPool.query('SELECT data FROM schedules ORDER BY created_at ASC');
      return r.rows.map(row => row.data);
    } catch (e) { console.error('[db] readSchedules:', e.message); return []; }
  }
  try { return JSON.parse(fs.readFileSync(SCHED_FILE, 'utf8')); } catch { return []; }
}
async function writeSchedules(arr) {
  if (dbPool) {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM schedules');
      for (const s of arr) {
        await client.query('INSERT INTO schedules (id, data) VALUES ($1, $2)', [s.id, s]);
      }
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[db] writeSchedules:', e.message);
      return false;
    } finally { client.release(); }
  }
  try {
    const dir = path.dirname(SCHED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCHED_FILE, JSON.stringify(arr));
    return true;
  } catch (e) { console.error('[scheduler] write error:', e.message); return false; }
}
function schedFileStatus() {
  if (dbPool) return 'postgres';
  try { fs.accessSync(path.dirname(SCHED_FILE), fs.constants.W_OK); return 'writable'; } catch { return 'NOT writable'; }
}

async function pruneSchedules() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const schedules = await readSchedules();
  const before = schedules.length;
  const keep = schedules.filter(s =>
    s.status === 'pending' ||
    (s.executedAt || s.scheduledFor) > cutoff
  );
  if (keep.length < before) {
    await writeSchedules(keep);
    console.log(`[scheduler] pruned ${before - keep.length} old schedule(s)`);
  }
}

async function recoverStuckSchedules() {
  const schedules = await readSchedules();
  let changed = false;
  for (const s of schedules) {
    if (s.status === 'running') {
      s.status = 'failed';
      s.error = 'Interrupted by server restart. Please retry.';
      changed = true;
      console.log(`[scheduler] recovered stuck schedule: ${s.id}`);
    }
  }
  if (changed) await writeSchedules(schedules);
}

function fmtStatus(v) {
  return { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' }[v] || v || '—';
}
function fmtPrice(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(v);
  return isNaN(n) ? String(v) : `$${n.toFixed(2)}`;
}
function fmtTags(v) {
  if (!v) return '—';
  return Array.isArray(v) ? (v.length ? v.join(', ') : '—') : String(v);
}
function fmtField(field, v) {
  if (field === 'status') return fmtStatus(v);
  if (field === 'price' || field === 'compareAtPrice') return fmtPrice(v);
  if (field === 'tags') return fmtTags(v);
  if (field === 'bodyHtml') {
    if (!v) return '—';
    const stripped = String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.length > 120 ? stripped.slice(0, 120) + '…' : (stripped || '—');
  }
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function tagsCount(v) {
  if (!v || v === '—') return 0;
  if (Array.isArray(v)) return v.filter(Boolean).length;
  return String(v).split(',').map(t => t.trim()).filter(Boolean).length;
}
function afterColor(field, beforeVal, afterVal) {
  if (field === 'tags') return tagsCount(afterVal) < tagsCount(beforeVal) ? '#dc2626' : '#1a5c38';
  const empty = afterVal === null || afterVal === undefined || afterVal === '' || String(afterVal) === '—';
  return empty ? '#dc2626' : '#1a5c38';
}

function schedRecapToken(id) {
  if (!SCHED_SECRET) return null;
  return crypto.createHmac('sha256', SCHED_SECRET).update(String(id)).digest('hex').slice(0, 32);
}

function buildChangesCSV(changes) {
  const FL = { status:'Status',vendor:'Vendor',title:'Title',tags:'Tags',productType:'Type',price:'Price',compareAtPrice:'Compare at',bodyHtml:'Description' };
  const esc = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  const rows = [['Product','Field','Before','After'].map(esc).join(',')];
  for (const c of (changes || [])) {
    const name = c.productTitle || c.productId.split('/').pop();
    Object.entries(c.product || {}).forEach(([f, nv]) => {
      rows.push([name, FL[f]||f, fmtField(f,c.before?.[f]), fmtField(f,nv)].map(esc).join(','));
    });
    Object.entries(c.variants || {}).forEach(([vid, v]) => {
      const vb = c.variantsBefore?.[vid];
      const sfx = vb?.title && vb.title !== 'Default Title' ? ` · ${vb.title}` : '';
      if (v.price !== undefined) rows.push([name,`Price${sfx}`,fmtPrice(vb?.price),fmtPrice(v.price)].map(esc).join(','));
      if (v.compareAtPrice !== undefined) rows.push([name,`Compare at${sfx}`,fmtPrice(vb?.compareAtPrice),fmtPrice(v.compareAtPrice)].map(esc).join(','));
    });
    const mfc = (c.metafields||[]).length;
    if (mfc) rows.push([name,'Metafields','',`${mfc} field${mfc!==1?'s':''} updated`].map(esc).join(','));
  }
  return rows.join('\n');
}

function buildEmailHtml(sched, success, linkedRevert = null) {
  const tz = sched.timezone || NOTIFY_TZ;
  const dt = new Date(sched.executedAt || sched.scheduledFor)
    .toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
  const n = (sched.changes || []).length;

  const FIELD_LABELS = { status: 'Status', vendor: 'Vendor', title: 'Title', tags: 'Tags', productType: 'Type', price: 'Price', compareAtPrice: 'Compare at', bodyHtml: 'Description' };

  const recapToken = schedRecapToken(sched.id);
  const visibleChanges = (sched.changes || []).slice(0, 10);
  const hiddenCount = n - visibleChanges.length;

  const productBlocks = visibleChanges.map(c => {
    const prodTitle = c.productTitle || c.productId.split('/').pop();
    const imgUrl    = c.productImage || '';
    const rows = [];

    // Product-level field changes with before/after
    Object.entries(c.product || {}).forEach(([field, newVal]) => {
      const label  = FIELD_LABELS[field] || field;
      const before = fmtField(field, c.before?.[field]);

      let afterHtml;
      if (field === 'tags') {
        const toArr = v => Array.isArray(v) ? v : (v ? String(v).split(',').map(t=>t.trim()).filter(Boolean) : []);
        const bTags = toArr(c.before?.[field]);
        const aTags = toArr(newVal);
        const kept    = aTags.filter(t =>  bTags.includes(t));
        const removed = bTags.filter(t => !aTags.includes(t));
        const added   = aTags.filter(t => !bTags.includes(t));
        const parts = [
          ...kept.map(t    => `<span style="color:#1a5c38;font-weight:600">${t}</span>`),
          ...removed.map(t => `<span style="color:#dc2626;text-decoration:line-through">${t}</span>`),
          ...added.map(t   => `<span style="color:#1a5c38;font-weight:700">+${t}</span>`),
        ];
        afterHtml = parts.join('<span style="color:#9ca3af">, </span>') || '—';
      } else {
        const color = afterColor(field, c.before?.[field], newVal);
        afterHtml = `<span style="color:${color};font-weight:600">${fmtField(field, newVal)}</span>`;
      }

      rows.push(`
        <tr>
          <td style="padding:5px 12px 5px 0;width:28%;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;font-weight:600;vertical-align:top;word-break:break-word">${label}</td>
          <td style="padding:5px 12px 5px 0;width:31%;font-size:13px;color:#9ca3af;text-decoration:line-through;vertical-align:top;word-break:break-word">${before}</td>
          <td style="padding:5px 10px 5px 0;width:6%;font-size:13px;color:#9ca3af;vertical-align:top">→</td>
          <td style="padding:5px 0;width:35%;font-size:13px;vertical-align:top;word-break:break-word">${afterHtml}</td>
        </tr>`);
    });

    // Variant price changes
    Object.entries(c.variants || {}).forEach(([varId, v]) => {
      const vb = c.variantsBefore?.[varId];
      const varLabel = vb?.title && vb.title !== 'Default Title' ? vb.title : null;
      const prefixStyle = `padding:5px 12px 5px 0;width:28%;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;font-weight:600;vertical-align:top;word-break:break-word`;
      if (v.price !== undefined) {
        rows.push(`
          <tr>
            <td style="${prefixStyle}">${varLabel ? `Price · ${varLabel}` : 'Price'}</td>
            <td style="padding:5px 12px 5px 0;width:31%;font-size:13px;color:#9ca3af;text-decoration:line-through;vertical-align:top">${fmtPrice(vb?.price)}</td>
            <td style="padding:5px 10px 5px 0;width:6%;font-size:13px;color:#9ca3af;vertical-align:top">→</td>
            <td style="padding:5px 0;width:35%;font-size:13px;font-weight:600;color:#1a5c38;vertical-align:top">${fmtPrice(v.price)}</td>
          </tr>`);
      }
      if (v.compareAtPrice !== undefined) {
        rows.push(`
          <tr>
            <td style="${prefixStyle}">${varLabel ? `Compare · ${varLabel}` : 'Compare at'}</td>
            <td style="padding:5px 12px 5px 0;width:31%;font-size:13px;color:#9ca3af;text-decoration:line-through;vertical-align:top">${fmtPrice(vb?.compareAtPrice)}</td>
            <td style="padding:5px 10px 5px 0;width:6%;font-size:13px;color:#9ca3af;vertical-align:top">→</td>
            <td style="padding:5px 0;width:35%;font-size:13px;font-weight:600;color:#1a5c38;vertical-align:top">${fmtPrice(v.compareAtPrice)}</td>
          </tr>`);
      }
    });

    // Metafields (no before/after available, just a summary)
    const mfCount = (c.metafields || []).length;
    if (mfCount) rows.push(`
      <tr>
        <td style="padding:5px 12px 5px 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Metafields</td>
        <td colspan="3" style="padding:5px 0;font-size:13px;color:#6b7280">${mfCount} field${mfCount !== 1 ? 's' : ''} updated</td>
      </tr>`);

    const innerTable = rows.length
      ? `<table style="width:100%;table-layout:fixed;border-collapse:collapse;margin-top:8px">${rows.join('')}</table>`
      : `<div style="font-size:13px;color:#9ca3af;margin-top:6px">—</div>`;

    const imgBlock = imgUrl
      ? `<img src="${imgUrl.replace(/"/g,'&quot;')}" width="44" height="44" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid #f0f0ec;flex-shrink:0"/>`
      : `<div style="width:44px;height:44px;border-radius:8px;background:#f0f0ec;flex-shrink:0"></div>`;

    return `
      <div style="padding:18px 0;border-bottom:1px solid #f0f0ec">
        <table style="border-collapse:collapse;width:100%"><tr>
          <td style="vertical-align:top;padding-right:14px;width:44px">${imgBlock}</td>
          <td style="vertical-align:top">
            <div style="font-size:14px;font-weight:600;color:#0e0e0c;letter-spacing:-.01em;margin-bottom:2px">${prodTitle}</div>
            ${innerTable}
          </td>
        </tr></table>
      </div>`;
  }).join('');

  const isRevert = (sched.label || '').startsWith('↩');

  const revertBanner = (linkedRevert && success && !isRevert) ? (() => {
    const revertDt = new Date(linkedRevert.scheduledFor)
      .toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
    return `
    <div style="margin:24px 40px 0;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px 20px">
      <table style="border-collapse:collapse;width:100%"><tr>
        <td style="vertical-align:top;width:32px;padding-right:12px;font-size:20px;line-height:1">⏰</td>
        <td style="vertical-align:top">
          <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:5px">Revert scheduled for ${revertDt}</div>
          <div style="font-size:13px;color:#78350f;line-height:1.6">
            Your changes will be automatically reverted at that time.
            If you want to keep them permanently, cancel the revert from Lederly.
          </div>
          <div style="margin-top:12px">
            <a href="${APP_URL}/app?openSchedules=1" style="display:inline-block;background:#1a5c38;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:8px 16px;border-radius:8px;letter-spacing:.01em">Open Lederly to cancel revert →</a>
          </div>
        </td>
      </tr></table>
    </div>`;
  })() : '';
  const cardColor = success ? (isRevert ? '#1e40af' : '#1a5c38') : '#991b1b';
  const badgeBg   = success ? (isRevert ? '#eff6ff' : '#f0fdf4') : '#fef2f2';
  const badgeBdr  = success ? (isRevert ? '#bfdbfe' : '#bbf7d0') : '#fecaca';
  const badgeTxt  = success ? (isRevert ? '#1d4ed8' : '#166534') : '#dc2626';
  const icon      = success ? (isRevert ? '↩' : '✓') : '✕';
  const headline  = success ? (isRevert ? 'Revert applied' : 'Changes applied') : 'Schedule failed';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lederly notification</title>
</head>
<body style="margin:0;padding:0;background:#eeecea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<div style="max-width:580px;margin:0 auto;padding:48px 20px 64px">

  <!-- Wordmark -->
  <div style="text-align:center;margin-bottom:28px">
    <table style="margin:0 auto;border-collapse:collapse"><tr>
      <td style="padding-right:8px;vertical-align:middle">
        <div style="background:#1a5c38;border-radius:7px;width:28px;height:28px;text-align:center;line-height:28px">
          <span style="color:#fff;font-size:10px;font-weight:700;letter-spacing:.04em">L</span>
        </div>
      </td>
      <td style="vertical-align:middle">
        <span style="font-size:12px;font-weight:600;color:#4b5563;letter-spacing:.12em;text-transform:uppercase">Lederly</span>
      </td>
    </tr></table>
  </div>

  <!-- Card -->
  <div style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.05)">

    <!-- Colour top bar -->
    <div style="background:${cardColor};height:5px"></div>

    <!-- Hero -->
    <div style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid #f3f3f1">
      <div style="display:inline-block;background:${badgeBg};border:1px solid ${badgeBdr};border-radius:50%;width:52px;height:52px;line-height:52px;text-align:center;margin-bottom:16px">
        <span style="font-size:20px;color:${badgeTxt}">${icon}</span>
      </div>
      <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#0e0e0c;letter-spacing:-.02em">${headline}</h1>
      <div style="margin:0 0 8px"><span style="display:inline-block;background:${badgeBg};border:1.5px solid ${badgeBdr};border-radius:20px;padding:4px 14px;font-size:13px;font-weight:600;color:${badgeTxt};letter-spacing:-.01em">${sched.label}</span></div>
      <p style="margin:0;font-size:13px;color:#9ca3af">${dt} &nbsp;·&nbsp; ${sched.shop}</p>
    </div>

    ${!success ? `
    <div style="margin:24px 40px 0;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px">
      <div style="font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Error</div>
      <div style="font-size:13px;color:#b91c1c">${sched.error || 'Unknown error'}</div>
    </div>` : ''}

    ${revertBanner}

    <!-- Products -->
    <div style="padding:4px 40px 8px">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.08em;padding:20px 0 4px">
        ${n} product${n !== 1 ? 's' : ''} updated
      </div>
      ${productBlocks || `<div style="padding:16px 0;font-size:13px;color:#9ca3af">No product details available.</div>`}
      ${hiddenCount > 0 ? `
      <div style="padding:14px 0 6px;border-top:1px solid #f0f0ec;text-align:center">
        <span style="font-size:13px;color:#9ca3af">+${hiddenCount} more product${hiddenCount !== 1 ? 's' : ''} not shown in this email</span>
        ${recapToken ? `&nbsp;&nbsp;<a href="${APP_URL}/api/schedule/recap/${sched.id}?token=${recapToken}" style="color:#1a5c38;font-size:13px;font-weight:600;text-decoration:none">View all →</a>` : ''}
      </div>` : ''}
      ${recapToken && n > 0 ? `
      <div style="padding:8px 0 12px${hiddenCount === 0 ? ';margin-top:8px;border-top:1px solid #f0f0ec' : ''}">
        <a href="${APP_URL}/api/schedule/recap/${sched.id}/csv?token=${recapToken}" style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;text-decoration:none;font-size:12px;font-weight:600;padding:7px 14px;border-radius:8px">↓ Download CSV</a>
      </div>` : ''}
    </div>

    <!-- Feedback nudge -->
    <div style="margin:8px 40px 0;background:#f9f9f7;border-radius:12px;padding:16px 20px;text-align:center">
      <p style="margin:0 0 10px;font-size:13px;color:#6b7280;line-height:1.5">Enjoying Lederly? We're in early access and your opinion shapes what we build next.</p>
      <a href="https://tally.so/r/D4abPX" style="display:inline-block;background:#1a5c38;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:8px 18px;border-radius:8px">Share feedback — 1 question →</a>
    </div>

    <!-- Footer -->
    <div style="margin:8px 40px 0;padding:20px 0;border-top:1px solid #f3f3f1">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.7">
        Sent by <a href="https://lederly.com" style="color:#1a5c38;text-decoration:none;font-weight:500">Lederly</a> — bulk product editing for Shopify.<br>
        You received this because you enabled email notifications for this scheduled update.
      </p>
    </div>

    <!-- Bottom bar -->
    <div style="background:#f9f9f7;border-top:1px solid #efefed;padding:14px 40px">
      <table style="width:100%;border-collapse:collapse"><tr>
        <td style="font-size:11px;color:#b0b0a8">© 2026 Lederly</td>
        <td style="text-align:right;font-size:11px">
          <a href="https://lederly.com/privacy" style="color:#b0b0a8;text-decoration:none">Privacy</a>
          &nbsp;·&nbsp;
          <a href="https://lederly.com/terms" style="color:#b0b0a8;text-decoration:none">Terms</a>
        </td>
      </tr></table>
    </div>

  </div>
</div>
</body></html>`;
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  if (!RESEND_API_KEY) { console.error('[notify] RESEND_API_KEY not set'); return { ok: false, error: 'RESEND_API_KEY not set' }; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `Lederly <${NOTIFY_FROM}>`, to: [to], subject, html, ...(attachments.length ? { attachments } : {}) }),
  });
  const body = await r.text();
  if (!r.ok) { console.error('[notify] resend error:', body); return { ok: false, error: `Resend error (${r.status}): ${body}` }; }
  return { ok: true };
}

async function sendNotification(sched, success, linkedRevert = null) {
  if (!RESEND_API_KEY || !sched.notifyEmail) return;
  const subject = success ? `✅ Schedule executed: ${sched.label}` : `❌ Schedule failed: ${sched.label}`;
  const attachments = [];
  if ((sched.changes || []).length > 0) {
    const csv = buildChangesCSV(sched.changes);
    const label = (sched.label || sched.id).slice(0, 40).replace(/[^a-z0-9]/gi, '-');
    attachments.push({ filename: `lederly-${label}.csv`, content: Buffer.from(csv, 'utf-8').toString('base64') });
  }
  const result = await sendEmail({ to: sched.notifyEmail, subject, html: buildEmailHtml(sched, success, linkedRevert), attachments });
  if (!result.ok) console.error('[notify] failed to send:', result.error);
}

// Extracted save logic shared by /api/save-product and the schedule executor
async function execSaveProduct(session, { productId, product = {}, variants = [], metafields = [] }) {
  const results = [];
  if (productId && product && Object.keys(product).length) {
    gid(productId, 'Product');
    const input = { id: productId, ...safeProductInput(product) };
    const seo = safeSeo(product.seo);
    if (seo) input.seo = seo;
    if (product.altText !== undefined && product.imageId) {
      input.images = [{ id: String(product.imageId), altText: String(product.altText || '').slice(0, 512) }];
    }
    if (Object.keys(input).length > 1) {
      const d = await gql(session, `
        mutation ProductUpdate($input: ProductInput!) {
          productUpdate(input:$input) { product { id } userErrors { field message } }
        }`, { input });
      const errs = d.productUpdate.userErrors;
      if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
      results.push({ type: 'product', id: productId });
    }
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
  await writeSchedules(schedules);
  try {
    const token = decryptToken(sched.encToken);
    if (!token) throw new Error('Could not decrypt token — was SCHED_SECRET changed?');
    const session = { shop: sched.shop, token };
    const changes = sched.changes;
    const prodErrors = [];

    // Process in parallel batches of 5 — per-product error tracking
    for (let i = 0; i < changes.length; i += 5) {
      await Promise.all(changes.slice(i, i + 5).map(async c => {
        try {
          const mf = (c.metafields || []).map(({ _idx, ...rest }) => rest);
          await execSaveProduct(session, {
            productId:  c.productId,
            product:    c.product   || {},
            variants:   Object.values(c.variants || {}),
            metafields: mf,
          });
        } catch (e) {
          prodErrors.push(safeErr(e));
        }
      }));
    }

    sched.status     = 'executed';
    sched.executedAt = new Date().toISOString();
    sched.encToken   = null;
    if (prodErrors.length) {
      sched.error = `${prodErrors.length}/${changes.length} products failed: ${prodErrors.slice(0, 3).join('; ')}`;
    }
    const linkedRevert = schedules.find(s => s.linkedTo === sched.id && s.status === 'pending') || null;
    sendNotification(sched, prodErrors.length === 0, linkedRevert).catch(() => {});
  } catch (e) {
    sched.status = 'failed';
    sched.error  = safeErr(e);
    sendNotification(sched, false, null).catch(() => {});
  }
  await writeSchedules(schedules);
}

let _schedRunning = false;
async function runDueSchedules() {
  if (!SCHED_SECRET || _schedRunning) return;
  _schedRunning = true;
  try {
    const schedules = await readSchedules();
    const due = schedules.filter(s => s.status === 'pending' && new Date(s.scheduledFor) <= new Date());
    if (due.length) {
      console.log(`[scheduler] ${due.length} due schedule(s)`);
      await Promise.all(due.map(s => executeSchedule(s, schedules)));
    }
  } finally { _schedRunning = false; }
}

// Recover + prune run async at startup (inside app.listen callback) and daily
setInterval(() => pruneSchedules().catch(e => console.error('[scheduler] prune:', e.message)), 24 * 60 * 60 * 1000).unref();

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

app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

app.post('/api/feedback', feedbackLimiter, async (req, res) => {
  try {
    const { shop } = getSession(req);
    const message = String(req.body?.message || '').trim().slice(0, 2000);
    const email   = String(req.body?.email   || '').trim().slice(0, 200);
    if (!message) return res.status(400).json({ ok: false, error: 'Message required' });
    if (RESEND_API_KEY && CONTACT_TO) {
      const html = `<div style="font-family:sans-serif;max-width:520px">
        <h2 style="margin:0 0 16px">💬 Lederly user feedback</h2>
        <p><strong>Shop:</strong> ${shop}</p>
        ${email ? `<p><strong>Reply to:</strong> <a href="mailto:${email}">${email}</a></p>` : '<p><em>No reply email provided</em></p>'}
        <p style="margin-top:16px"><strong>Message:</strong></p>
        <p style="white-space:pre-wrap;background:#f5f5f3;padding:14px;border-radius:8px;font-size:14px;line-height:1.6">${message}</p>
        <p style="font-size:11px;color:#9ca3af;margin-top:16px">Sent from in-app feedback button · ${new Date().toISOString()}</p>
      </div>`;
      await sendEmail({ to: CONTACT_TO, subject: `💬 Feedback — ${shop}`, html });
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e) }); }
});

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    if (!RESEND_API_KEY || !CONTACT_TO) throw new Error('Contact form not available right now.');
    const name    = String(req.body?.name    || '').trim().slice(0, 100);
    const email   = String(req.body?.email   || '').trim().slice(0, 200);
    const message = String(req.body?.message || '').trim().slice(0, 2000);
    if (!name)    throw new Error('Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email is required.');
    if (!message) throw new Error('Message is required.');
    const html = `<div style="font-family:sans-serif;max-width:520px;color:#111"><h2 style="margin:0 0 16px">New message from Lederly contact form</h2><p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p style="margin-top:12px"><strong>Message:</strong></p><p style="white-space:pre-wrap;background:#f5f5f3;padding:12px;border-radius:8px;margin-top:6px">${message}</p></div>`;
    const result = await sendEmail({ to: CONTACT_TO, subject: `Lederly: message from ${name}`, html });
    if (!result.ok) throw new Error('Could not send message. Please try again later.');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e) }); }
});

// Shopify admin opens apps inside an iframe — break out immediately to standalone
app.get('/shopify-open', (req, res) => {
  const shop = req.query.shop ? `?shop=${encodeURIComponent(String(req.query.shop))}` : '';
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><script>try{window.top.location.replace('/app${shop}');}catch(e){window.location.replace('/app${shop}');}</script></head><body></body></html>`);
});

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
    track('connect', shop);
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
    const raw   = String(req.body?.query || '').trim().slice(0, 250);
    const after = req.body?.after ? String(req.body.after) : null;
    const terms = raw ? raw.split(',').map(t => t.trim().replace(/[^\w\s-]/g, '')).filter(Boolean) : [];
    const first = Math.min(Math.max(Number(req.body?.first || 50), 1), 100);
    const search = terms.length
      ? terms.map(t => `(title:*${t}* OR tag:${t} OR vendor:${t}* OR sku:${t}*)`).join(' OR ')
      : null;
    const d = await gql(s, `
      query Products($first:Int!, $query:String, $after:String) {
        products(first:$first, query:$query, after:$after, sortKey:UPDATED_AT, reverse:true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title status vendor tags descriptionHtml
            seo { title description }
            featuredImage { id url altText }
            metafields(first:50) { nodes { id namespace key type value } }
            variants(first:100) {
              nodes {
                id title sku price compareAtPrice inventoryQuantity
                inventoryItem { id }
                metafields(first:50) { nodes { id namespace key type value } }
              }
            }
          }
        }
      }`, { first, query: search, after });
    track('products_load', s.shop, { n: d.products.nodes.length, more: d.products.pageInfo.hasNextPage });
    res.json({ ok: true, products: d.products.nodes, pageInfo: d.products.pageInfo });
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

app.post('/api/locations', apiLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const d = await gql(s, `query { locations(first: 50) { nodes { id name isActive } } }`);
    const locations = (d.locations?.nodes || []).filter(l => l.isActive);
    res.json({ ok: true, locations });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/inventory-set', apiLimiter, writeLimiter, async (req, res) => {
  try {
    const s = getSession(req);
    const { quantities } = req.body || {};
    if (!Array.isArray(quantities) || !quantities.length || quantities.length > 100) throw new Error('Invalid quantities');

    // Validate and collect items
    const validated = quantities.map(q => {
      gid(q.inventoryItemId, 'InventoryItem');
      const qty = Math.floor(Number(q.quantity));
      if (!Number.isFinite(qty) || qty < 0 || qty > 999999) throw new Error('Invalid quantity');
      return { inventoryItemId: q.inventoryItemId, quantity: qty };
    });

    // Fetch locationId for each inventoryItem in a single batched query
    const aliasQuery = validated.map((item, i) =>
      `i${i}: inventoryItem(id: "${item.inventoryItemId}") { inventoryLevels(first:1) { nodes { location { id } } } }`
    ).join('\n');
    const levels = await gql(s, `query { ${aliasQuery} }`);

    const items = validated.map((item, i) => {
      const locationId = levels[`i${i}`]?.inventoryLevels?.nodes?.[0]?.location?.id;
      if (!locationId) throw new Error(`No inventory location found — make sure the product is stocked at a location in Shopify.`);
      return { inventoryItemId: item.inventoryItemId, locationId, quantity: item.quantity };
    });
    const d = await gql(s, `
      mutation InventorySet($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`, { input: { name: 'available', reason: 'correction', ignoreCompareQuantity: true, quantities: items } });
    const errs = d.inventorySetQuantities?.userErrors || [];
    if (errs.length) throw new Error(errs.map(e => e.message).join(', '));
    track('inventory_set', s.shop, { n: items.length });
    res.json({ ok: true });
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
      const seo = safeSeo(product.seo);
      if (seo) input.seo = seo;
      if (product.altText !== undefined && product.imageId) {
        input.images = [{ id: String(product.imageId), altText: String(product.altText || '').slice(0, 512) }];
      }
      if (Object.keys(input).length > 1) {
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

    track('save', s.shop, { v: variants.length, mf: metafields.length });
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
  if (PING_SECRET && req.query.secret !== PING_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. Provide ?secret=PING_SECRET' });
  }
  const before = await readSchedules();
  const pendingBefore = before.filter(s => s.status === 'pending').length;
  await runDueSchedules().catch(e => console.error('[ping]', e.message));
  const after = await readSchedules();
  const fileExists   = (() => { try { return fs.existsSync(SCHED_FILE); } catch { return false; } })();
  const dirWritable  = schedFileStatus() === 'writable';
  const now = new Date();
  const pendingList = after
    .filter(s => s.status === 'pending')
    .map(({ id, label, scheduledFor, notifyEmail }) => ({
      id, label, scheduledFor, notifyEmail: notifyEmail || '(none)',
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
    emailConfigured: !!RESEND_API_KEY,
    notifyFrom: NOTIFY_FROM || 'not set',
    totalSchedules:    after.length,
    pendingSchedules:  after.filter(s => s.status === 'pending').length,
    executedSchedules: after.filter(s => s.status === 'executed').length,
    failedSchedules:   after.filter(s => s.status === 'failed').length,
    justExecuted:      pendingBefore - after.filter(s => s.status === 'pending').length,
    pending: pendingList,
  });
});

// Test email endpoint — sends a real email so we can verify Resend config
app.post('/api/notify-test', apiLimiter, async (req, res) => {
  try {
    const { shop } = getSession(req);
    const { email } = req.body || {};
    if (!RESEND_API_KEY) return res.json({ ok: false, error: 'RESEND_API_KEY not set on server', emailConfigured: false });
    if (!NOTIFY_FROM)    return res.json({ ok: false, error: 'NOTIFY_FROM not set on server', emailConfigured: true });
    const to = (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) ? String(email).trim() : null;
    if (!to) return res.status(400).json({ ok: false, error: 'Provide a valid email address' });
    let html;
    try { html = buildEmailHtml({ shop, label: 'Email test', scheduledFor: new Date().toISOString(), executedAt: new Date().toISOString(), changes: [] }, true); }
    catch (renderErr) { return res.json({ ok: false, error: `Template error: ${renderErr.message}`, to, from: NOTIFY_FROM }); }
    const result = await sendEmail({ to, subject: '✅ Lederly — email test', html });
    if (!result.ok) return res.json({ ok: false, error: result.error, to, from: NOTIFY_FROM });
    res.json({ ok: true, sent: true, to, from: NOTIFY_FROM });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

// ── SCHEDULE API ─────────────────────────────────────────

app.post('/api/schedule/create', apiLimiter, async (req, res) => {
  try {
    if (!SCHED_SECRET) throw new Error('Scheduling not enabled. Set SCHED_SECRET in environment variables.');
    const { shop, token } = getSession(req);
    const { scheduledFor, label, changes, linkedTo, notifyEmail: providedEmail, timezone: clientTz } = req.body || {};
    if (!scheduledFor) throw new Error('Missing scheduledFor');
    const dt = new Date(scheduledFor);
    if (isNaN(dt.getTime())) throw new Error('Invalid scheduledFor');
    if (dt <= new Date()) throw new Error('Scheduled time must be in the future');
    if (!Array.isArray(changes) || !changes.length || changes.length > 500) throw new Error('Invalid changes');
    if (!label || !String(label).trim()) throw new Error('Label is required');
    let notifyEmail = '';
    if (providedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(providedEmail))) {
      notifyEmail = String(providedEmail).trim().slice(0, 200);
    } else {
      try {
        const sd = await gql({ shop, token }, `query { shop { email } }`);
        notifyEmail = sd.shop?.email || '';
      } catch {}
    }
    const id = crypto.randomBytes(12).toString('hex');
    let safeTimezone = NOTIFY_TZ;
    if (clientTz && typeof clientTz === 'string') {
      try { Intl.DateTimeFormat(undefined, { timeZone: clientTz }); safeTimezone = clientTz; } catch {}
    }
    const sched = {
      id, shop,
      createdAt: new Date().toISOString(),
      scheduledFor: dt.toISOString(),
      timezone: safeTimezone,
      label: String(label).trim().slice(0, 120),
      linkedTo: linkedTo || null,
      notifyEmail,
      changes,
      encToken: encryptToken(token),
      status: 'pending',
      executedAt: null,
      error: null,
    };
    const schedules = await readSchedules();
    schedules.push(sched);
    if (!await writeSchedules(schedules)) throw new Error('Could not save schedule. Check DATABASE_URL or mount a Volume and set SCHED_FILE=/data/schedules.json');
    track('schedule_create', shop, { products: (changes||[]).length });
    const { encToken: _, ...safe } = sched;
    res.json({ ok: true, schedule: safe });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/list', apiLimiter, async (req, res) => {
  try {
    const { shop } = getSession(req);
    const schedules = await readSchedules();
    const mine = schedules
      .filter(s => s.shop === shop)
      .map(({ encToken: _, ...rest }) => rest)
      .sort((a, b) => new Date(b.scheduledFor) - new Date(a.scheduledFor));
    const persistWarning = !process.env.DATABASE_URL && !process.env.SCHED_FILE;
    res.json({ ok: true, schedules: mine, persistWarning });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/update', apiLimiter, async (req, res) => {
  try {
    const { shop } = getSession(req);
    const { id, label, scheduledFor, notifyEmail: providedEmail, timezone: clientTz } = req.body || {};
    if (!id) throw new Error('Missing id');
    const schedules = await readSchedules();
    const sched = schedules.find(s => s.id === id && s.shop === shop);
    if (!sched) throw new Error('Schedule not found');
    if (sched.status !== 'pending') throw new Error('Only pending schedules can be edited');
    if (label !== undefined) {
      if (!String(label).trim()) throw new Error('Label is required');
      sched.label = String(label).trim().slice(0, 120);
    }
    if (scheduledFor !== undefined) {
      const dt = new Date(scheduledFor);
      if (isNaN(dt.getTime())) throw new Error('Invalid scheduledFor');
      if (dt <= new Date()) throw new Error('Scheduled time must be in the future');
      sched.scheduledFor = dt.toISOString();
    }
    if (providedEmail !== undefined) {
      sched.notifyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(providedEmail).trim())
        ? String(providedEmail).trim().slice(0, 200) : '';
    }
    if (clientTz && typeof clientTz === 'string') {
      try { Intl.DateTimeFormat(undefined, { timeZone: clientTz }); sched.timezone = clientTz; } catch {}
    }
    await writeSchedules(schedules);
    const { encToken: _, ...safe } = sched;
    res.json({ ok: true, schedule: safe });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/delete', apiLimiter, async (req, res) => {
  try {
    const { shop } = getSession(req);
    const { id } = req.body || {};
    if (!id) throw new Error('Missing id');
    const schedules = await readSchedules();
    const idx = schedules.findIndex(s => s.id === id && s.shop === shop);
    if (idx === -1) throw new Error('Schedule not found');
    if (!['failed', 'cancelled'].includes(schedules[idx].status)) throw new Error('Only failed or cancelled schedules can be deleted');
    schedules.splice(idx, 1);
    await writeSchedules(schedules);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/cancel', apiLimiter, async (req, res) => {
  try {
    const { shop } = getSession(req);
    const { id } = req.body || {};
    if (!id) throw new Error('Missing id');
    const schedules = await readSchedules();
    const sched = schedules.find(s => s.id === id && s.shop === shop);
    if (!sched) throw new Error('Schedule not found');
    if (!['pending', 'failed'].includes(sched.status)) throw new Error('Cannot cancel this schedule');
    sched.status = 'cancelled';
    sched.encToken = null;
    await writeSchedules(schedules);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: safeErr(e), requestId: req.requestId }); }
});

app.post('/api/schedule/run', apiLimiter, writeLimiter, async (req, res) => {
  try {
    if (!SCHED_SECRET) throw new Error('Scheduling not enabled.');
    const { shop } = getSession(req);
    const { id } = req.body || {};
    if (!id) throw new Error('Missing id');
    const schedules = await readSchedules();
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

app.get('/api/admin/stats', (req, res) => {
  const secret = req.headers['x-ping-secret'] || req.query.secret;
  if (PING_SECRET && secret !== PING_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const uptimeSec = Math.floor((Date.now() - analytics.start) / 1000);
  res.json({
    ok: true,
    uptime: `${Math.floor(uptimeSec/3600)}h ${Math.floor((uptimeSec%3600)/60)}m`,
    uniqueStores: analytics.stores.size,
    stores: [...analytics.stores],
    events: analytics.counts,
    since: new Date(analytics.start).toISOString(),
  });
});

app.get('/api/schedule/recap/:id', async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  if (!SCHED_SECRET || token !== schedRecapToken(id)) return res.status(403).send('Invalid or expired link.');
  const sched = (await readSchedules()).find(s => s.id === id);
  if (!sched) return res.status(404).send('Schedule not found.');
  const changes = sched.changes || [];
  const tz = sched.timezone || NOTIFY_TZ;
  const dt = new Date(sched.executedAt || sched.scheduledFor)
    .toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: tz });
  const FL2 = { status:'Status', vendor:'Vendor', title:'Title', tags:'Tags', productType:'Type', bodyHtml:'Description' };
  const rows = changes.map(c => {
    const title = c.productTitle || c.productId.split('/').pop();
    const img = c.productImage ? `<img src="${c.productImage.replace(/"/g,'&quot;')}" width="36" height="36" style="border-radius:6px;object-fit:cover;vertical-align:top;margin-right:10px;border:1px solid #f0f0ec;flex-shrink:0">` : '';
    const details = [];
    Object.entries(c.product || {}).forEach(([f, nv]) => {
      if (f === 'seo') return;
      const label = FL2[f] || f;
      const before = fmtField(f, c.before?.[f]);
      const after = fmtField(f, nv);
      details.push(`<span style="color:#9ca3af">${label}:</span> <span style="text-decoration:line-through;color:#9ca3af">${before}</span> → <strong style="color:#1a5c38">${after}</strong>`);
    });
    Object.entries(c.variants || {}).forEach(([vid, v]) => {
      const vb = c.variantsBefore?.[vid];
      const sfx = vb?.title && vb.title !== 'Default Title' ? ` (${vb.title})` : '';
      if (v.price !== undefined) details.push(`<span style="color:#9ca3af">Price${sfx}:</span> <span style="text-decoration:line-through;color:#9ca3af">${fmtPrice(vb?.price)}</span> → <strong style="color:#1a5c38">${fmtPrice(v.price)}</strong>`);
      if (v.compareAtPrice !== undefined) details.push(`<span style="color:#9ca3af">Compare at${sfx}:</span> <span style="text-decoration:line-through;color:#9ca3af">${fmtPrice(vb?.compareAtPrice)}</span> → <strong style="color:#1a5c38">${fmtPrice(v.compareAtPrice)}</strong>`);
    });
    const mfc = (c.metafields||[]).length;
    if (mfc) details.push(`<span style="color:#9ca3af">Metafields:</span> ${mfc} field${mfc!==1?'s':''} updated`);
    const detailHtml = details.length ? `<div style="font-size:11px;line-height:2;margin-top:4px;color:#374151">${details.join(' &nbsp;·&nbsp; ')}</div>` : '';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #f3f3f1;vertical-align:top"><div style="display:flex;align-items:flex-start">${img}<div><div style="font-size:13px;font-weight:600;color:#0e0e0c">${title}</div>${detailHtml}</div></div></td></tr>`;
  }).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>All changes · ${sched.label}</title><style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#eeecea;margin:0;padding:40px 20px 60px;-webkit-font-smoothing:antialiased}.card{background:#fff;border-radius:20px;max-width:580px;margin:0 auto;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.05)}.bar{background:#1a5c38;height:5px}.head{padding:28px 36px 20px;border-bottom:1px solid #f3f3f1}.logo{display:flex;align-items:center;gap:8px;margin-bottom:18px;text-decoration:none}.logo-m{background:#1a5c38;border-radius:6px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;letter-spacing:.04em}.logo-n{font-size:11px;font-weight:600;color:#4b5563;letter-spacing:.12em;text-transform:uppercase}h1{margin:0 0 6px;font-size:18px;font-weight:700;color:#0e0e0c;letter-spacing:-.02em}p.sub{margin:0;font-size:13px;color:#9ca3af}.body{padding:8px 36px 16px}table{width:100%;border-collapse:collapse}.dl{display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;text-decoration:none;font-size:12px;font-weight:600;padding:8px 16px;border-radius:8px;margin:16px 0 8px}.foot{padding:16px 36px;border-top:1px solid #f3f3f1;font-size:12px;color:#9ca3af}</style></head><body><div class="card"><div class="bar"></div><div class="head"><a href="${APP_URL}" class="logo"><div class="logo-m">L</div><span class="logo-n">Lederly</span></a><h1>${sched.label}</h1><p class="sub">${dt} &nbsp;·&nbsp; ${sched.shop} &nbsp;·&nbsp; ${changes.length} product${changes.length!==1?'s':''} updated</p></div><div class="body"><a href="/api/schedule/recap/${id}/csv?token=${token}" class="dl">↓ Download CSV</a><table>${rows}</table></div><div class="foot">Sent by <a href="${APP_URL}" style="color:#1a5c38;text-decoration:none;font-weight:500">Lederly</a> — bulk product editing for Shopify</div></div></body></html>`);
});

app.get('/api/schedule/recap/:id/csv', async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  if (!SCHED_SECRET || token !== schedRecapToken(id)) return res.status(403).send('Invalid or expired link.');
  const sched = (await readSchedules()).find(s => s.id === id);
  if (!sched) return res.status(404).send('Schedule not found.');
  const csv = buildChangesCSV(sched.changes || []);
  const label = (sched.label || id).slice(0, 40).replace(/[^a-z0-9]/gi, '-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lederly-${label}.csv"`);
  res.send(csv);
});

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.use((err, req, res, _n) => res.status(err.status || 500).json({ ok: false, error: safeErr(err), requestId: req.requestId }));

app.listen(PORT, async () => {
  console.log(`Lederly on http://localhost:${PORT}`);
  console.log(`OAuth: ${SHOPIFY_CLIENT_ID ? 'OK' : 'NOT configured'}`);
  console.log(`Storage: ${dbPool ? 'PostgreSQL' : `file (${SCHED_FILE})`}`);
  if (SCHED_SECRET) {
    const existing = await readSchedules();
    console.log(`Scheduling: ENABLED — ${existing.length} schedule(s), ${existing.filter(s=>s.status==='pending').length} pending`);
    if (!dbPool && IS_PROD && SCHED_FILE === path.join(__dirname, 'schedules.json')) {
      console.warn('[scheduler] WARNING: no DATABASE_URL and SCHED_FILE at default path. Schedules will be LOST on redeploy. Set DATABASE_URL or mount a Railway Volume.');
    }
    await recoverStuckSchedules();
    await pruneSchedules();
  } else {
    console.log(`Scheduling: DISABLED (set SCHED_SECRET)`);
  }
  console.log(`Email timezone: ${NOTIFY_TZ}`);
  if (PING_SECRET) console.log(`Ping endpoint: protected`);
  else console.log(`Ping endpoint: OPEN (set PING_SECRET to protect it)`);
});

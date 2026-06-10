# PROJECT_CONTEXT.md — Lederly

> Reference file for Claude and future sessions. Keep this updated as the product evolves.

---

## Cos'è

**Lederly** (`lederly.com`) è un tool SaaS che permette ai merchant Shopify di editare prodotti in bulk direttamente dal browser, senza installare nulla dallo Shopify App Store. Accesso via OAuth standard, nessun dato memorizzato lato server oltre alle sessioni effimere.

Pubblico target: merchant Shopify non tecnici che vogliono cambiare prezzi, tag, metafield e status su molti prodotti in una volta sola, o programmare le modifiche in anticipo.

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js (ESM) + Express |
| DB | PostgreSQL via `pg` (fallback: file JSON `schedules.json`) |
| Frontend | HTML/CSS/JS vanilla — nessun framework, nessun bundler |
| Email | Resend API |
| Security | Helmet, rate limiting custom, HMAC Shopify, one-time token store |
| Build | `build.js` (obfuscazione JS per produzione) |

---

## File principali

```
server.js          — tutto il backend (~2000 righe)
public/
  index.html       — landing page pubblica
  app.html         — app principale (dopo OAuth)
  app-tool.js      — tutta la logica frontend dell'app (versione v=XX nel tag script)
  admin.html       — dashboard admin
  styles.css       — stili globali
  driver.css/.js   — libreria tour guidato (Driver.js)
```

**Importante:** ogni volta che si modifica `app-tool.js`, incrementare il numero di versione nel tag `<script src="/app-tool.js?v=XX">` dentro `app.html` per forzare il cache-bust.

---

## Database — tabelle

```sql
schedules          (id TEXT PK, data JSONB, created_at TIMESTAMPTZ)
store_plans        (shop TEXT PK, plan TEXT DEFAULT 'free', updated_at TIMESTAMPTZ)
store_usage        (shop TEXT, month TEXT, pushes INT, PK(shop, month))
analytics_events   (id BIGSERIAL PK, event TEXT, shop TEXT, meta JSONB, ts TIMESTAMPTZ)
store_info         (shop TEXT PK, name TEXT, email TEXT, country_code TEXT, country TEXT, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ)
waitlist           (email TEXT PK, created_at TIMESTAMPTZ)
```

Se `DATABASE_URL` non è settata, `schedules` viene salvato su file JSON (`SCHED_FILE`). Tutto il resto (analytics, store_info, ecc.) non persiste senza DB.

---

## Variabili d'ambiente

```env
PORT=8787
NODE_ENV=production

# Shopify OAuth
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_SCOPES=read_products,write_products,read_inventory,write_inventory,read_locations,read_collections,write_collections
SHOPIFY_API_VERSION=2026-01
APP_URL=https://lederly.com
ALLOWED_ORIGINS=https://lederly.com

# Database
DATABASE_URL=postgres://...

# Scheduling
SCHED_SECRET=         # usato per firmare i token dei webhook di schedule
SCHED_FILE=./schedules.json  # fallback se no DB

# Email (Resend)
RESEND_API_KEY=
NOTIFY_FROM=noreply@lederly.com
CONTACT_TO=           # email admin per notifiche
NOTIFY_TZ=UTC

# Admin panel
PING_SECRET=          # /admin?secret=PING_SECRET
```

---

## OAuth flow

1. `GET /auth/start?shop=xxx.myshopify.com` → redirect a Shopify
2. Shopify → `GET /auth/callback?code=...&hmac=...&state=...` (HMAC validato lato server)
3. Server scambia il code con il token Shopify, poi emette un **one-time code** (32 char hex, TTL 30s, mai in log)
4. Redirect → `/app?shop=xxx&code=onetimecode`
5. Frontend → `GET /auth/token?code=onetimecode` → riceve token reale (il code viene consumato e cancellato)
6. Il token viene tenuto **solo in memoria nel browser** (sessionStorage/variabile JS), mai memorizzato lato server

---

## Piani

```js
const PLAN_SCHED_LIMIT = { beta: 10, free: 0, starter: 5, pro: Infinity };
const PLAN_PRO_FEATURES = new Set(['beta', 'pro']);
```

- Tutti i nuovi store vengono assegnati al piano **beta** automaticamente al primo connect (`isFirstConnect`)
- `free`: nessuno scheduling
- `beta`: 10 schedule/mese, tutte le pro features — piano attuale per tutti
- `starter`: 5 schedule/mese
- `pro`: illimitato

Il piano si legge dalla tabella `store_plans`. Se non c'è DB, ritorna sempre `'beta'`.

---

## Funzionalità principali

### Editing prodotti
- Caricamento prodotti via GraphQL Shopify (fino a 100 per pagina, paginazione cursor)
- Editing inline cella per cella (click sulla cella)
- Campi supportati: `title`, `price`, `compareAtPrice`, `status`, `vendor`, `tags`, `bodyHtml/descriptionHtml`, `seo.title`, `seo.description`, `featuredImage.altText`, metafield prodotto e variante
- Metafield: supporto completo tipi Shopify (`single_line_text_field`, `multi_line_text_field`, `number_integer`, `number_decimal`, `boolean`, `date`, `date_time`, `json`, `url`, `color`, `weight`, `volume`, `dimension`, `rating`, `money`, `list.*`)
- Auto-revert blank metafield values (se il valore viene svuotato, il metafield viene eliminato via `metafieldDelete`)

### Bulk actions
- Selezione multipla prodotti con checkbox
- Cambio prezzo/compareAt bulk, cambio status, cambio tag
- Filtri per tag, ricerca testuale, paginazione

### Scheduling
- Creazione schedule con data/ora e timezone
- Esecuzione in-process: `maybeRunSchedules()` viene chiamata su ogni API request (utile per wake-up del server dormiente)
- Auto-revert: ogni schedule può avere una versione "linkedTo" che ripristina i valori precedenti dopo un certo tempo
- Email di recap al completamento con lista cambiamenti
- Email di notifica errore se lo schedule fallisce
- Endpoint `/api/schedule/run` per trigger esterno (autenticato con `SCHED_SECRET`)

### Admin panel
- `/admin?secret=PING_SECRET`
- KPI: stores connessi, waitlist count, store attivi 7/30gg
- Funnel: page views → CTA click → connect → save → schedule
- Tabella stores con email, piano, ultimo accesso, export CSV email
- Grafici daily (90 giorni)
- Stats deep: variants salvati, save rate, schedule reliability, activation rate

### Waitlist / email capture
- Form hero nella landing (`/`) → `POST /api/waitlist` con `{ email, source }`
- Email di conferma all'utente + notifica admin
- Tabella `waitlist` nel DB
- Modale welcome in-app dopo OAuth (mostra features + survey acquisizione, una volta sola via `localStorage`)

---

## Analytics events tracciati

| Event | Trigger |
|-------|---------|
| `page_view` | Visita landing |
| `cta_click` | Click CTA connect |
| `demo_start` | Avvio demo mode |
| `connect` | OAuth completato con successo |
| `app_open` | Apertura app (token valido) |
| `products_load` | Caricamento lista prodotti |
| `save` | Salvataggio modifiche |
| `save_attempt` | Tentativo di salvataggio |
| `bulk_action` | Azione bulk applicata |
| `schedule_create` | Schedule creato |
| `schedule_run` | Schedule eseguito OK |
| `schedule_partial` | Schedule eseguito parzialmente |
| `schedule_fail` | Schedule fallito |
| `export_csv` | Export CSV |
| `csv_import` | Import CSV |
| `waitlist_signup` | Iscrizione waitlist |
| `beta_source` | Fonte acquisizione (dal welcome modal) |
| `tour_complete` / `tour_skip` | Tour guidato |
| `disconnect` | Disconnessione manuale |

---

## Sicurezza

- Rate limiting custom (token bucket in-memory) per ogni endpoint
- `helmet` con CSP strict (`'self'` only, no CDN)
- Token Shopify mai in URL o log — one-time code pattern
- HMAC validation su ogni callback OAuth Shopify
- `timingSafeEqual` per confronto HMAC
- `safeErr()`: in produzione oscura errori con info sensibili (token, secret, password)
- Origin check su tutte le API (bypassato solo per `/auth/`)
- HSTS in produzione

---

## Convenzioni codice

- ESM puro (`import/export`), niente CommonJS
- Niente TypeScript, niente framework
- Frontend: tutto in `app-tool.js` (funzioni globali), stato in oggetto `S` (session state)
- `$('id')` è shorthand per `document.getElementById`
- Modali: `openModal('m-xxx')` / `closeModal('m-xxx')`
- Toast: `toast('messaggio')`
- Versione app-tool.js nel tag script va incrementata manualmente ad ogni modifica (`?v=77`, `?v=78`, ecc.)

---

## Stato attuale (giugno 2026)

- Beta aperta: tutti gli store ottengono il piano beta gratis
- Paid plans non ancora lanciati (waitlist attiva)
- Nessuna integrazione Shopify App Store (OAuth standalone, non embedded app)
- Email transazionali via Resend operative
- Admin panel funzionante con analytics completo
- Tour guidato (Driver.js) attivo al primo accesso
- Welcome modal attivo al primo accesso post-OAuth

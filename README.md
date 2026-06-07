# Shopify Privacy Bulk Tool

A privacy-first Shopify bulk editor built as a stateless browser tool plus backend proxy.

## Security posture

This version is hardened for a no-storage model:

- no database
- no user accounts
- no token storage
- no localStorage/sessionStorage for tokens
- strict security headers
- origin allowlist
- read/write rate limits
- validated Shopify IDs and payloads
- raw GraphQL disabled in production

See `SECURITY.md` before deployment.

## Run locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:8787
```

## Production env

Copy `.env.example` and set:

```text
NODE_ENV=production
ALLOWED_ORIGINS=https://your-domain.com
ENABLE_RAW_GRAPHQL=false
```

---

A stateless browser app plus lightweight backend proxy for bulk editing Shopify products, variants, and variant metafields.

## Privacy model

- No account system
- No database
- No token storage
- No customer or order data
- The Admin API token is kept in browser memory only
- The backend receives the token per request and does not persist it
- Session scheduling only runs while the browser tab is open

## Current features

- Connect with `your-store.myshopify.com` and a Custom App Admin API token
- Load products and variants via Shopify GraphQL Admin API
- Edit product title, status, vendor, tags
- Edit variant SKU, price, compare-at price
- Edit variant metafields
- Instant search and autocomplete
- Audit preview before saving
- Session-only scheduling with optional auto-revert
- Export/import schedule JSON
- Demo mode

## Required Shopify scopes

Use minimum scopes only:

```text
read_products
write_products
read_inventory
write_inventory
```

Do not grant customer or order scopes.

## Run locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:8787
```

## Deploy

Deploy as a normal Node app on Railway, Render, Fly.io, or similar.

Use HTTPS in production. Set `ALLOWED_ORIGIN` to your frontend domain if frontend and backend are separate.

## Important limitation

Because this tool intentionally stores nothing, server-side scheduling is not supported. Scheduling works only while the browser tab is open.

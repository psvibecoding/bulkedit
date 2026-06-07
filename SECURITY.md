# Security Model

This tool is designed as a privacy-first, stateless Shopify admin utility.

## What the tool does not do

- No user accounts
- No database
- No token persistence
- No localStorage or sessionStorage for Shopify tokens
- No customer data or order data endpoints
- No raw GraphQL endpoint in production

## Token handling

The Shopify Admin API token is held only in browser memory and sent to the backend proxy per request through `X-Shopify-Token`.
The backend uses the token only to forward the current request to Shopify. It does not write the token to disk, database, logs, cookies, or cache.

## Required Shopify scopes

Use the smallest possible scope set. Recommended for MVP:

```text
read_products
write_products
read_inventory
write_inventory
```

Do not request customer, order, draft order, payment, fulfillment, or marketing scopes.

## Production checklist

1. Deploy only behind HTTPS.
2. Set `NODE_ENV=production`.
3. Set `ALLOWED_ORIGINS` to the exact production domain. Do not use `*`.
4. Keep `ENABLE_RAW_GRAPHQL=false`.
5. Put the service behind a gateway or reverse proxy with DDoS protection.
6. Never log request headers or request bodies.
7. Keep server dependencies updated.
8. Rotate any exposed Shopify token immediately from the Shopify admin.
9. Add backups/export before saving large edits.
10. Add a confirmation step for bulk price/status/inventory changes.

## Built-in defenses

- Strict Shopify shop domain validation
- Strict token format validation
- Payload size limit
- Product, variant, and metafield input allowlists
- Rate limits for read and write endpoints
- Request timeout for Shopify calls
- Helmet security headers
- Content Security Policy
- Production HSTS
- No raw GraphQL endpoint in production
- Sanitized error messages in production
- No server-side session or database

## Residual risks

No web tool is unhackable. Remaining risks include compromised hosting, malicious browser extensions, compromised merchant devices, copied tokens, dependency vulnerabilities, and user mistakes during bulk edits.

Mitigation: keep scopes minimal, do not touch customer/order data, show previews before saving, use HTTPS, and ask merchants to revoke tokens when they finish using the tool if they want maximum isolation.

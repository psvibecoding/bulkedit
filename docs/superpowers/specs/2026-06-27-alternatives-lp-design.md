# Design: Alternative Landing Pages

**Date:** 2026-06-27  
**Status:** Approved

## Obiettivo

Creare 5 pagine SEO `/alternatives/[competitor]` per catturare traffico da ricerche tipo "[competitor] alternative shopify". Approccio ibrido: comparazione onesta + CTA forte.

## URLs

- `/alternatives/matrixify`
- `/alternatives/hextom-bulk-product-editor`
- `/alternatives/ablestar-bulk-product-editor`
- `/alternatives/shopify-bulk-editor`
- `/alternatives/easyflow`

## Struttura di ogni pagina

1. **Nav** — identica alle altre pagine (logo + "Try now →")
2. **Hero** — H1 SEO-friendly + sottotitolo che inquadra il problema
3. **Cosa fa bene [competitor]** — 2-3 righe oneste
4. **Dove inizia il problema** — pain point specifico per cui cercano un'alternativa
5. **Tabella comparativa** — features chiave con checkmark/cross
6. **CTA block** — verde, stesso stile
7. **Footer** — identico alle altre pagine

## Angolo per competitor

| Competitor | Angolo |
|---|---|
| Matrixify | CSV/import potente ma complesso — Lederly è UI-first, zero CSV |
| Hextom | Bulk editor diretto — Lederly ha scheduling + auto-revert che Hextom non ha |
| Ablestar | Simile a Hextom — scheduling e auto-revert come differenziatori chiave |
| Shopify Bulk Editor | Nativo ma limitatissimo — niente % rules, niente diff preview, niente scheduling |
| EasyFlow | Automation/workflow generico — Lederly è specifico per editing catalogo |

## Features da includere nella tabella

- Inline editing (no CSV)
- Bulk % price rules
- Diff preview before saving
- Scheduling
- Auto-revert
- Free plan disponibile

## File da creare/modificare

- `public/alternatives/matrixify.html`
- `public/alternatives/hextom-bulk-product-editor.html`
- `public/alternatives/ablestar-bulk-product-editor.html`
- `public/alternatives/shopify-bulk-editor.html`
- `public/alternatives/easyflow.html`
- `server.js` — 5 nuove route GET
- `public/sitemap.xml` — 5 nuove entry

## Stile

Identico alle pagine SEO esistenti. Stesso CSS copiato, stessi font, stesso schema colori. Nessun framework.

## Schema LD+JSON

Tipo `WebPage` (non `Article` — queste sono landing page di prodotto, non guide).

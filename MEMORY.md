# Lederly — Memory

Aggiornato: 2026-07-11

## Stato
App Shopify live su App Store. Primo cliente reale nei 7 giorni di trial.

## Piani
- Basic (€4.99/mo)
- Growth / starter (€9.99/mo)
- Pro (€19.99/mo, unico con auto-revert)
- Beta (admin override, full access)

Nessun piano Free — trial 7gg Shopify-native, poi obbligatorio pagare.

## Link
- Admin: lederly.com/admin?secret=<PING_SECRET>

## Feature recenti (2026-07-11)
- Inventory adjustment multi-location: modal per variante con dettaglio per sede
  (solo se store ha 2+ location attive), dropdown Location nel bulk "Change Inventory Qty".
- Ricerca per barcode: mostra anche le varianti sorelle del prodotto (fix esteso
  anche alla ricerca SKU esistente, che aveva lo stesso limite).

## Bug prod risolti (2026-07-11)
1. `ignoreCompareQuantity` mancante — il salvataggio inventario falliva sempre.
2. Modifica inventario scartata silenziosamente se il salvataggio falliva.
3. Badge "MODIFIED" acceso su tutte le varianti di un prodotto invece che solo
   su quella modificata (bug visivo, il payload inviato restava corretto).

## Gotcha da ricordare
La pagina "Scorte" di Shopify (admin nativo) non salva sempre in modo affidabile
le modifiche inline se cambi filtro location prima di premere Salva — verificare
sempre via query diretta all'API prima di sospettare un bug in Lederly.

## Note

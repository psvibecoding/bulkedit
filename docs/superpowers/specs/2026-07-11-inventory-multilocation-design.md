# Inventory adjustment with multi-location — Design

## Problem

Lederly already lets merchants edit `inventoryQuantity` per variant (direct cell edit + bulk "Change Inventory Qty" action), and `/api/inventory-set` already writes it via Shopify's `inventorySetQuantities` mutation. But for merchants with more than one active location, the server silently picks whichever location Shopify returns first (`inventoryLevels(first:1)`) — the merchant has no visibility into which location they're editing, and no way to adjust a specific one.

Scopes needed (`read_inventory`, `write_inventory`, `read_locations`) are already declared in `shopify.app.toml`. No new Shopify permission request, no re-review trigger.

## Goals

- Merchants with 2+ active locations can see and edit stock per location, for a single variant or in bulk.
- Merchants with exactly 1 active location see no change at all — current direct-cell-edit behavior is preserved untouched.
- No paywall restriction — available on all plans (Basic/Growth/Pro).

## Non-goals

- CSV import/export stay on the aggregate total; not exploded per location.
- No new DB tables/columns — inventory stays live from Shopify, same as today.
- No change to how single-location stores experience the feature.

## UX

### Table cell (per variant, per product row)

- `S.locations` (already fetched once per session via existing `/api/locations`) determines behavior:
  - **`S.locations.length <= 1`**: cell renders exactly as today — a plain editable number input.
  - **`S.locations.length >= 2`**: cell shows the total quantity, rendered as a clickable trigger (not a raw input). Clicking opens a popover.
- **Popover** (opened lazily, one row per active location):
  - Fetches per-location breakdown for that variant's `inventoryItemId` via the new `/api/inventory-levels` endpoint, only on first open (cached client-side afterward, invalidated on save).
  - Each row: location name + editable number input, current quantity pre-filled.
  - Editing a row updates that location's pending quantity, recomputes the cell's displayed total live, and marks the row as changed using the existing "unsaved change" indicator.
- **Diff preview** (existing pre-save summary): for multi-location edits, one line per location, e.g. `Wool Sweater / S @ Warehouse NYC: 45 → 40`. Single-location stores keep today's line format (no location name, since there's nothing to disambiguate).

### Bulk action ("Change Inventory Qty")

- Modal gains a **Location** dropdown, populated from `S.locations`. Dropdown only rendered if the store has 2+ locations; hidden entirely for single-location stores (no behavior change for them).
- `set`: applies the entered value directly to the chosen location for every selected variant — no need to know prior quantity.
- `add` / `subtract`: needs the current quantity at the chosen location for each selected variant. On modal open, batch-fetch levels for all selected variants via `/api/inventory-levels` (same endpoint the popover uses), cached client-side so repeat opens/edits don't re-fetch.

## Client state

- `c.inventory` (per-product change tracker, currently keyed by `variantId → {inventoryItemId, quantity, oldQuantity}`) becomes keyed by `variantId → locationId → {inventoryItemId, locationId, quantity, oldQuantity}`.
- Single-location stores: exactly one `locationId` key per variant, populated transparently — no visible difference, but the data shape is now consistent for both cases (avoids branching in the save path).
- New client-side cache `S.inventoryLevels = { [inventoryItemId]: [{locationId, name, quantity}] }`, populated lazily by whichever UI (popover or bulk modal) fetches first; reused by the other.

## Backend changes

### New endpoint: `POST /api/inventory-levels`

- Input: `{ inventoryItemIds: string[] }` (same validation ceiling as `/api/inventory-set`: reject if empty or > 100).
- Batched alias query per item (same pattern as the existing lookup in `/api/inventory-set`):
  ```graphql
  i0: inventoryItem(id: "...") {
    inventoryLevels(first: 50) {
      nodes {
        location { id name }
        quantities(names: ["available"]) { name quantity }
      }
    }
  }
  ```
- Response: `{ ok: true, levels: { [inventoryItemId]: [{ locationId, name, quantity }] } }`.
- Read-only, so registered under `apiLimiter` only (no `writeLimiter`), consistent with `/api/locations`.

### `/api/inventory-set` (server.js:1580)

- Request shape changes: each entry in `quantities` now carries `locationId` explicitly (client always has it — either the single implicit location or the one chosen in the popover/bulk dropdown), instead of the server inferring it via an extra `inventoryLevels(first:1)` lookup query.
- Removes the auto-lookup query entirely — one fewer round trip, and no more silent "pick whichever comes first" behavior.
- Validation: `gid(q.locationId, 'Location')` added alongside the existing `inventoryItemId` / quantity checks.
- Mutation call (`inventorySetQuantities`) unchanged.

### Error handling

- `userErrors` from `inventorySetQuantities` surface today as a single joined-message failure for the whole inventory batch (app-tool.js ~1258-1274, `invFailed`). Keep this pattern; just make sure the message includes location name where available so a failure like "location deactivated mid-edit" is legible instead of a bare GID.

## Testing

- Manual pass (no automated test suite in this project — verify by hand against a dev store):
  1. Single-location dev store: confirm cell + bulk modal are pixel-identical to current behavior (no popover, no dropdown).
  2. Multi-location dev store: edit one variant's stock at 2 different locations via popover, save, confirm both `inventoryLevel`s updated correctly in Shopify admin.
  3. Bulk `set` across 3 variants at one location — confirm only that location changes, others untouched.
  4. Bulk `add`/`subtract` — confirm the delta is computed against the correct location's current quantity, not the aggregate.
  5. Trigger a `userErrors` case (e.g., deactivate a location between load and save) and confirm the error message is legible.

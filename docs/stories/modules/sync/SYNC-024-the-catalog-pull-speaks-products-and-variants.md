---
id: SYNC-024
title: The catalog pull speaks products and variants
module: sync
kind: change
rev: 1
amends: [SYNC-005]
size: M
risk: medium
depends_on: [SYNC-005, CAT-014, CAT-021, FND-013]
read_first: [src/modules/sync/adapters/catalog.adapter.ts, tests/integration/sync/pull-catalog.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, catalogue/productvariant]
constraints: [C-35, CM-42]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-024 — The catalog pull speaks products and variants

## Story
As a seller, I want my phone to hold each product with its variants, so that I can sell every size at its own price offline.

## Context
- Exists: the `products` pull (SYNC-005); variants, and `image_keys` and `paused_at` on products (CAT-012, CAT-014); a variant change that also moves its product (CAT-021); `imageUrl` (FND-013).
- `product_variants` joins `SYNC_TABLES` (15 tables) with its own adapter in `catalog.adapter.ts`. Its push refuses every line, as `products` does today (the owner's pushes: SYNC-031 to SYNC-034).
- For OWNER, MANAGER and SELLER, `products` rows become `id, organization_id, name, description, category, image_urls, paused_at, created_at, server_updated_at`; `unit`, `price`, `price_updated_at`, `min_order_quantity` and `status` leave them. `image_urls` is `imageUrl(key)` for each key.
- `product_variants` rows for the same roles: `id, product_id, organization_id, name, unit, price, price_updated_at, min_order_quantity` (decimal string), `status`, `image_urls, created_at, server_updated_at`. Every variant of the organization, any status; a deleted or merged one is listed in `deleted`.
- A paused product still arrives, with `paused_at`: the team sees what is paused. The driver and customer branches stay as they are (SYNC-025, SYNC-026); the product query keeps `unit` for the driver.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `CM-42`: Every insert or update of a `ProductVariant` also sets `server_updated_at` of its product to the database time, so that a product and its variants always travel together to the phones.

## Acceptance criteria
```gherkin
Scenario: AC-1 Product and variants
  Given a product with a variant "sac 10 kg" at 15000 and an INACTIVE variant "sac 25 kg"
  When a SELLER of the business pulls
  Then `products` holds the product with name, description, category, `image_urls` and `paused_at`, and no price, unit or status
  And `product_variants` holds both variants with unit, price, minimum, status and `image_urls`
Scenario: AC-2 A paused product
  Given a paused product
  Then it arrives with `paused_at` set, with its variants
Scenario: AC-3 A price change moves the product too
  When a variant's price changes after the last pull
  Then the variant and its product are both `updated`
Scenario: AC-4 A deletion
  When a variant is deleted or merged into another after the last pull
  Then its id is in `deleted` of `product_variants`
Scenario: AC-5 The new table
  Then the pull answer has a `product_variants` entry, and `SYNC_TABLES` has 15 names
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's catalog (horizontal)
  When a member of A pulls
  Then no product and no variant of B arrives
```

## Implementation
- Create: `tests/integration/sync/pull-variants.test.ts`
- Modify: `src/modules/sync/adapters/catalog.adapter.ts`, `src/modules/sync/sync.types.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Signatures:
  - `variantsAdapter: SyncAdapter (table 'product_variants')`
- Types:
  - `SYNC_TABLES gains 'product_variants' after 'products'`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: products and variants come from the viewer's organizations only.
- v5.0.0-15.3.1: rows are built from an explicit list of fields; a photo is sent as an address, never as a key.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| team rows | integration | AC-1 | product without price, variants with it |
| paused | integration | AC-2 | paused_at set |
| price change | integration | AC-3, CM-42 | variant and product updated |
| deletion | integration | AC-4, C-35 | id in deleted |
| new table | integration | AC-5 | entry present, 15 names |
| other business | security | AB-1, WSTG-ATHZ-04 | none of B |

Command: `npx vitest run tests/integration/sync/pull-variants.test.ts tests/integration/sync/pull-catalog.test.ts tests/integration/sync/registry-viewer.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-catalog.test.ts | the seller test expects price and min_order_quantity on the product, and the incremental test expects the product updated with a new price | the product has no price; the variant carries it, and the variant is the row updated by a price change |
| tests/integration/sync/registry-viewer.test.ts | it counts 14 tables, in two titles and an assertion | it counts 15 |

## Out of scope
- The driver and the customer: SYNC-025 and SYNC-026. Pushes: SYNC-031 to SYNC-034.

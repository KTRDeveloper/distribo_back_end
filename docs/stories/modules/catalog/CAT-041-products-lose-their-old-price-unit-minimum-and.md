---
id: CAT-041
title: Products lose their old price, unit, minimum and status
module: catalog
kind: migration
rev: 1
amends: [CAT-001, CAT-014]
size: M
risk: high
depends_on: [CAT-040, ORD-031, DLV-016, SYNC-043, CAT-039, ORD-028, DLV-014, SYNC-026, SYNC-029]
read_first: [prisma/schema.prisma, tests/integration/catalog/product-new-columns.test.ts]
design_refs: [catalogue/product, contraintes-a-poser-au-niveau-base-de]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# CAT-041 — Products lose their old price, unit, minimum and status

## Story
Technical story: drop the old price, unit, minimum and status of `products`, which the variants now carry, so that a price lives in one place only.

## Context
- Exists: every reader and writer of those columns uses the variants (CAT-017, CAT-019, CAT-039, ORD-027, ORD-028, DLV-014, SYNC-026, SYNC-029), and the tests seed products with `seedProduct` (CAT-040, ORD-031, DLV-016, SYNC-043). The two mirror triggers of CAT-014 still copy old-style writes to the variants.
- One migration, one transaction. First, between `-- guard start` and `-- guard end`, a block that raises an exception when a product not deleted has no variant not deleted: a price must not be lost.
- Then drop: the two mirror triggers and their functions (names in the `cat_014` migration), trigger `products_set_price_updated_at`, CHECKs `products_price_positive` and `products_min_order_quantity_positive`, and the columns `unit`, `price`, `price_updated_at`, `min_order_quantity`, `status`.
- Kept: trigger `products_set_server_updated_at`; functions `set_product_price_updated_at()` and `set_server_updated_at()` and enum `ProductStatus`, which the variants use.
- `catalog.repository.ts`: remove `getActiveProduct`. No other production file changes; `npm run typecheck` fails on any reader left.
- `prisma/schema.prisma`: remove the five fields of `Product`; one `//` comment in plain words replaces those of CAT-001 and CAT-014: price, unit, minimum and status live on the variants, and the database sets the server date on every change.
- `no-old-product-columns.test.ts` reads every `.ts` file of `src/` and `tests/` and lists the paths that insert into `products` with `unit` or `price`, or read or write those five fields on a `Product`.

## Acceptance criteria
```gherkin
Scenario: AC-1 The old columns are gone
  When the columns of `products` are read
  Then `unit`, `price`, `price_updated_at`, `min_order_quantity` and `status` are absent, and `name`, `image_keys`, `paused_at`, `deleted_at` are present
Scenario: AC-2 Triggers and checks
  When a product is renamed and a variant price changes
  Then the product's `server_updated_at` moves and the variant's `price_updated_at` moves; only the server-date trigger is left on `products`
Scenario: AC-3 A product without a variant stops the migration
  Given a product not deleted without a variant not deleted
  When the guard lines run
  Then they raise an exception; with a variant, or a deleted product, they pass
Scenario: AC-4 The old lookup is gone
  When the catalog repository is imported
  Then it has no `getActiveProduct`
Scenario: AC-5 No file uses the old columns
  When the scan test reads `src/` and `tests/`
  Then it lists no path
```

## Abuse cases
```gherkin
Scenario: AB-1 Stale code writes a dropped column (silent loss)
  When a raw insert into `products` sets `unit` and `price`
  Then PostgreSQL refuses it with 42703 and no row exists
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_041_drop_product_price_columns/migration.sql`, `tests/integration/catalog/product-columns-dropped.test.ts`, `tests/unit/catalog/no-old-product-columns.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the guard refuses to run on data it would lose.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| columns | integration | AC-1 | read the columns → five absent, four present |
| triggers | integration | AC-2 | rename a product, change a variant price → both dates move |
| guard | integration | AC-3 | replay the guard lines with and without a variant → error, or none |
| lookup | unit | AC-4 | import the repository → no `getActiveProduct` |
| scan | unit | AC-5 | read the sources → no path listed |
| stale write | security | AB-1, CWE-20 | raw insert with unit and price → 42703 |

Command: `npx vitest run tests/integration/catalog/product-columns-dropped.test.ts tests/unit/catalog/no-old-product-columns.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/product-table.test.ts | asserts the five old columns, their CHECKs, the status enum and the price date | those assertions go; the rest stays |
| tests/integration/catalog/reference-price.test.ts | the block `getActiveProduct (AC-3, C-15)` calls the removed function | the block is removed |
| tests/integration/catalog/product-new-columns.test.ts | expects `unit` empty and `price` 1, and old-style writes reaching a variant | the default expectations and the two old-style tests are removed |
| tests/integration/catalog/variant-per-product.test.ts | inserts old-style products to replay the backfill | the backfill tests are removed; the trigger test stays, seeded with `seedProduct` |
| tests/integration/catalog/product-variant-table.test.ts | inserts parent products with `unit` and `price` | inserts them with `seedProduct` |
| tests/integration/catalog/customer-price-variant.test.ts | inserts products with `unit` and `price` | inserts them with `seedProduct` |
| every other file under `tests/` that the scan lists | inserts products with `unit` and `price`, or updates them on `products` | `seedProduct`; updates go to the variant |

## Out of scope
- `customer_prices.product_id`: CAT-043. `order_lines.product_id`: ORD-032.

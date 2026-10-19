---
id: CAT-043
title: Negotiated prices lose their product column
module: catalog
kind: migration
rev: 1
amends: [CAT-002, CAT-015]
size: M
risk: high
depends_on: [CAT-041, CAT-042, CAT-029, CAT-030, CAT-039]
read_first: [prisma/schema.prisma, tests/integration/catalog/customer-price-variant.test.ts]
design_refs: [relations-commerciales/customerprice, contraintes-a-poser-au-niveau-base-de]
constraints: [C-11]
asvs: [v5.0.0-2.2.1, v5.0.0-8.2.2]
---

# CAT-043 — Negotiated prices lose their product column

## Story
Technical story: drop `product_id` from negotiated prices, which now name a variant, so that a price points at one thing only.

## Context
- Exists: prices are read and written by `product_variant_id` (CAT-017, CAT-029, CAT-030, CAT-039); `product_id` is still required and written as the variant's product. A trigger of CAT-015 fills the variant from the product, and one of CAT-015 refuses a variant not owned by the relationship's supplier.
- One migration, one transaction. Between `-- guard start` and `-- guard end`, a block that raises an exception when a row has no `product_variant_id`.
- Then: `product_variant_id` becomes required; drop the filling trigger (CAT-015), trigger and function `customer_prices_require_supplier_product` (CAT-002), index `customer_prices_product_id_idx`, key `customer_prices_product_id_fkey` and the column `product_id`.
- Kept: the trigger that refuses a variant of another business, and the unique index per live (relationship, variant).
- `upsertCustomerPrice` (`catalog.repository.ts`) loses `productId`; `catalog.service.ts` and `catalog.sync-writers.ts` stop passing it.
- `prisma/schema.prisma`: `CustomerPrice` loses `productId`, its relation and index, `Product` loses `customerPrices`; `productVariantId` is required. The `//` comment above `CustomerPrice` is rewritten in plain words: one live price per relationship and variant, the variant is the supplier's, and the database refuses otherwise.
- `no-price-product-id.test.ts` reads `src/` and `tests/` and lists the paths that insert into `customer_prices` with `product_id` or pass `productId` to `upsertCustomerPrice`.
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 The product column is gone
  When the columns of `customer_prices` are read
  Then `product_id` and its index and key are absent, and `product_variant_id` is required
Scenario: AC-2 The rules that stay
  When a price is inserted for a variant of another business, then twice for one live pair
  Then the first fails with 23514 and the second with 23505
Scenario: AC-3 Rows without a variant stop the migration
  Given a price with an empty `product_variant_id`
  When the guard lines run
  Then they raise an exception; without such a row they pass
Scenario: AC-4 The writer needs no product
  When `upsertCustomerPrice` sets a price for a variant
  Then the row holds that variant and the relationship
Scenario: AC-5 No file uses the product column
  When the scan test reads `src/` and `tests/`
  Then it lists no path
```

## Abuse cases
```gherkin
Scenario: AB-1 A price for another supplier's variant (broken object access)
  When a raw insert names a variant of a business that is not the supplier of the relationship
  Then PostgreSQL refuses it with 23514 and no row exists
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_043_drop_price_product_id/migration.sql`, `tests/integration/catalog/price-product-dropped.test.ts`, `tests/unit/catalog/no-price-product-id.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.sync-writers.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `upsertCustomerPrice(tx: Prisma.TransactionClient, input: { id: string; relationshipId: string; variantId: string; price: number; setById: string; now: Date }): Promise<void>`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the guard refuses to run on data it would lose.
- v5.0.0-8.2.2: the variant of a price is still checked in the database against the supplier.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| columns | integration | AC-1 | read the columns and keys → product_id absent, variant required |
| rules | integration | AC-2, C-11 | other business, duplicate pair → 23514, 23505 |
| guard | integration | AC-3 | replay the guard lines with and without an empty variant → error, or none |
| writer | integration | AC-4 | set a price → row with the variant |
| scan | unit | AC-5 | read the sources → no path listed |
| other supplier | security | AB-1, CWE-639 | raw insert for another business's variant → 23514 |

Command: `npx vitest run tests/integration/catalog/price-product-dropped.test.ts tests/unit/catalog/no-price-product-id.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/customer-price-table.test.ts | asserts `product_id`, its index and key, and the product-ownership trigger | those assertions go; the variant checks stay |
| tests/integration/catalog/customer-price-variant.test.ts | tests the copy of `product_id` and an insert with `product_id` only | those two tests are removed |
| every other file under `tests/` that the scan lists | inserts prices with `product_id` | inserts them with `product_variant_id` |

## Out of scope
- `order_lines.product_id`: ORD-032.

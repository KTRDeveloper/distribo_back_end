---
id: CAT-013
title: Every existing product gets its variant
module: catalog
kind: migration
rev: 1
amends: [CAT-001]
size: S
risk: high
depends_on: [CAT-012]
read_first: [prisma/schema.prisma, tests/integration/organization/organization-table.test.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-45, C-35]
asvs: [v5.0.0-2.2.3]
---

# CAT-013 — Every existing product gets its variant

## Story
Technical story: give every product already stored one variant that carries what it sold, so that nothing is lost when selling moves from the product to the variant.

## Context
- Exists: `products` (CAT-001), each row with its own `unit`, `price`, `price_updated_at`, `min_order_quantity` and `status`; `product_variants` (CAT-012), empty.
- One migration, one transaction, no new column. The variant takes the same `id` as its product, so that order lines and negotiated prices, which hold the product id today, find it with the id they already hold.
- Between the lines `-- copy start` and `-- copy end`: switch off the price-date trigger of `product_variants`, one `INSERT ... SELECT` of every product without a variant, switch the trigger on again. The variant has an empty name and copies `organization_id`, `unit`, `price`, `price_updated_at`, `min_order_quantity`, `status`, `created_at` and `deleted_at`.
- The server date of the variant is the migration time (the existing trigger), so phones fetch the new rows. Deleted products are copied too, deleted.
- The test replays the lines between the two markers on rows it inserts, so that the copy is proved on old-shaped data and proved safe to run twice.
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Each product gets one variant
  Given a product at 3000 XAF with minimum 2.5 whose price changed in 2024, and a deleted product
  When the copy runs
  Then each has one variant with the same id, the same business, an empty name, and the same unit, price, `price_updated_at`, minimum, status and `deleted_at`
Scenario: AC-2 Dates
  When the copy runs
  Then `price_updated_at` is still the 2024 date of the product
  And `server_updated_at` of the variant is later than that of the product
Scenario: AC-3 Running it again changes nothing
  Given a variant whose price was then set to 3500
  When the copy runs again
  Then no variant is added and the price is still 3500
Scenario: AC-4 A product that already has a variant is skipped
  Given a product with a variant under another id
  When the copy runs
  Then no second variant is created for that product
Scenario: AC-5 The price-date trigger is back on
  When the copy has run and a variant's price changes, and then only its unit changes
  Then `price_updated_at` moves with the price change and stays on the unit change
```

## Abuse cases
```gherkin
Scenario: AB-1 A copied variant lands in another business (information disclosure)
  When the copy runs for products of two businesses
  Then every variant has the business of its own product, and none has the other
```

## Implementation
- Create: `prisma/migrations/<timestamp>_cat_013_variant_per_product/migration.sql`, `tests/integration/catalog/variant-per-product.test.ts`
- Pattern: `tests/integration/organization/organization-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the copy takes the business from the product row, never from another source.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| copy | integration | AC-1, C-45 | replay the marked lines on old rows → one variant each, same values |
| dates | integration | AC-2, C-35 | price date kept; server date later |
| twice | integration | AC-3 | replay again → no row added, price unchanged |
| skip | integration | AC-4 | product with another variant → no second one |
| trigger | integration | AC-5 | price change moves the date; unit change keeps it |
| two businesses | security | AB-1, CWE-639 | each variant has its product's business |

Command: `npx vitest run tests/integration/catalog/variant-per-product.test.ts`

## Out of scope
- The new product columns and the old-style writes that must still reach the variants (CAT-014).
- Pointing negotiated prices at variants (CAT-015) and order lines (ORD).

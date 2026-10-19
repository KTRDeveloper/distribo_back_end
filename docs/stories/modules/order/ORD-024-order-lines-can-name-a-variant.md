---
id: ORD-024
title: Order lines can name a variant
module: order
kind: migration
rev: 1
amends: [ORD-004]
size: S
risk: high
depends_on: [CAT-014, ORD-004]
read_first: [prisma/schema.prisma, prisma/migrations/20261004300000_ord_004_order_lines/migration.sql]
design_refs: [commandes-et-livraisons/orderline, contraintes-a-poser-au-niveau-base-de]
constraints: ['OrderLine:fk']
asvs: [v5.0.0-2.2.3]
---

# ORD-024 — Order lines can name a variant

## Story
Technical story: let order lines name a product variant, so that orders can move from products to variants without breaking the code that still writes products.

## Context
- Exists: `order_lines.product_id` (ORD-004), a variant with the same id as every product (CAT-013) and the triggers that give each old-style product its variant (CAT-014).
- One migration adds the column `product_variant_id` (uuid, empty allowed until ORD-025), a foreign key to `product_variants(id)` (restrict) and an index on it, which also serves the per-variant sales and purchase totals read from delivered lines.
- Trigger `order_lines_a_fill_variant`, before insert: an empty `product_variant_id` becomes `product_id`, which is the variant of a legacy product. A new-style product has no variant of its id, so the key refuses the line (23503). A value that is given is kept; ORD-026 checks it.
- `prisma/schema.prisma`: `productVariantId String? @map("product_variant_id") @db.Uuid`, the relation to `ProductVariant` and `@@index([productVariantId])`. Above `OrderLine`, add a plain-words `//` comment: the database fills the variant from `product_id` when a line is saved without it; the column becomes required in ORD-025.
- Lines saved before this migration are filled by ORD-025.
- `OrderLine:fk`: references order_id → Order; product_id → Product; price_set_by_id → Person

## Acceptance criteria
```gherkin
Scenario: AC-1 Column, key and index
  When the table is read
  Then `product_variant_id` is a uuid that accepts an empty value, with a foreign key and an index
Scenario: AC-2 A line for an old-style product gets its variant
  When a line is inserted with the `product_id` of an old-style product and no variant
  Then `product_variant_id` equals `product_id`
Scenario: AC-3 A given variant is kept
  Given a variant whose id differs from its product's
  When a line is inserted with that product and that variant
  Then the line keeps the variant it was given
Scenario: AC-4 An unknown variant
  When a line is inserted with a variant id that does not exist
  Then it fails with 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 A line is saved for a product that has no variant of its id (tampering)
  Given a new-style product, whose variants have other ids
  When a line is inserted with its `product_id` and no variant
  Then it fails with 23503 and no line with a guessed variant is stored
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_024_order_line_variant/migration.sql`, `tests/integration/order/order-line-variant.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the key refuses a variant that does not exist, whatever the code does.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column and key | integration | AC-1, OrderLine:fk | read the column, the key and the index |
| old-style line | integration | AC-2 | insert with product_id only → variant equals product_id |
| given variant | integration | AC-3 | insert with both → kept as given |
| unknown variant | integration | AC-4 | insert with an unknown variant → 23503 |
| no guessed variant | security | AB-1, CWE-20 | new-style product, no variant given → 23503 |

Command: `npx vitest run tests/integration/order/order-line-variant.test.ts tests/integration/order/order-line-table.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/order/calculations-and-views.test.ts | the lines of its order() fixture are typed as the Prisma OrderLine, which gains productVariantId | add productVariantId: null to each line of the fixture |

## Out of scope
- Filling the lines that already exist and making the column required (ORD-025).
- Checking that the variant belongs to the supplier and to the line's product (ORD-026).

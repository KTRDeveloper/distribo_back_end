---
id: ORD-034
title: Order lines lose their product column
module: order
kind: migration
rev: 1
amends: [ORD-004, ORD-024, ORD-025, ORD-026, ORD-032]
size: M
risk: high
depends_on: [ORD-033, CAT-041]
read_first: [prisma/schema.prisma, tests/integration/order/order-line-table.test.ts]
design_refs: [commandes-et-livraisons/orderline, contraintes-a-poser-au-niveau-base-de]
constraints: [C-15]
asvs: [v5.0.0-2.2.1]
---

# ORD-034 — Order lines lose their product column

## Story
Technical story: drop `product_id` from order lines, which now name a variant, so that a line points at one thing only.

## Context
- Exists: no code writes `product_id` of a line (ORD-033); trigger `order_lines_a_fill_variant` (ORD-024) still fills the variant from it; `order_lines_enforce_rules()` compares it with the variant's product when set (ORD-032).
- One migration, one transaction: replace `order_lines_enforce_rules()` without that comparison; drop trigger `order_lines_a_fill_variant` and its function; drop index `order_lines_product_id_idx`, key `order_lines_product_id_fkey` and the column `product_id`.
- `prisma/schema.prisma`: `OrderLine` loses `productId`, `product` and its index, `Product` loses `orderLines`, and `productVariantId` loses `@default(dbgenerated())`: the code always gives it. Rewrite the `//` comment above `OrderLine` in plain words: a line names its variant, nothing fills it, and the database checks the variant against the supplier.
- `npm run typecheck` fails on any reader of `line.productId` left.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.

## Acceptance criteria
```gherkin
Scenario: AC-1 The product column is gone
  When the columns of `order_lines` are read
  Then `product_id` and its index and key are absent and `product_variant_id` is required
Scenario: AC-2 Nothing fills the variant
  When a line is inserted without `product_variant_id`
  Then the database rejects it with 23502
Scenario Outline: AC-3 The rules still hold
  When a line names <variant>
  Then the database <result>
  Examples:
    | variant                           | result          |
    | an ACTIVE variant of the supplier | accepts         |
    | a variant of another business     | rejects (23514) |
    | an unknown id                     | rejects (23503) |
```

## Abuse cases
```gherkin
Scenario: AB-1 An old-style insert after the drop (silent loss)
  When a raw insert still sets `product_id`
  Then PostgreSQL refuses it with 42703 and no line exists
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_034_drop_line_product_id/migration.sql`, `tests/integration/order/line-product-dropped.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: no trigger guesses a variant any more; a missing one fails closed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| columns | integration | AC-1 | read the columns → product_id absent |
| no filling | integration | AC-2 | insert without variant → 23502 |
| rules | integration | AC-3, C-15 | each Examples row → accepted, 23514 or 23503 |
| old insert | security | AB-1, CWE-20 | raw insert with product_id → 42703 |

Command: `npx vitest run tests/integration/order/line-product-dropped.test.ts tests/integration/order/order-line-table.test.ts tests/integration/order/line-rules.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/order/order-line-table.test.ts | asserts the `product_id` column, its key, its index and the filling trigger | those assertions go; the rest stays |
| tests/integration/order/line-rules.test.ts | has tests on a product that differs from the variant's, and on a line saved without a variant | the first is removed with the column; the second expects 23502 |

## Out of scope
- Anything outside `order_lines`.

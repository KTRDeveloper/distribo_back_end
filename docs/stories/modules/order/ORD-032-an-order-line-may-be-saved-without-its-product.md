---
id: ORD-032
title: An order line may be saved without its product
module: order
kind: migration
rev: 1
amends: [ORD-004, ORD-026]
size: S
risk: high
depends_on: [ORD-026, ORD-027, ORD-031]
read_first: [prisma/schema.prisma, tests/integration/order/order-line-table.test.ts]
design_refs: [commandes-et-livraisons/orderline, contraintes-a-poser-au-niveau-base-de]
constraints: [C-15]
asvs: [v5.0.0-2.2.1, v5.0.0-8.2.2]
---

# ORD-032 — An order line may be saved without its product

## Story
Technical story: let `order_lines.product_id` be empty, the first step of removing it, so that the code can stop writing it before the column goes.

## Context
- Exists: `order_lines.product_id`, required (ORD-004); `product_variant_id`, required and filled on insert from `product_id` when empty (ORD-024, ORD-025); `order_lines_enforce_rules()` as ORD-026 left it, which reads the variant by `coalesce(product_variant_id, product_id)` and refuses a variant whose `product_id` differs from the line's.
- One migration, one transaction: `product_id` may be empty. `order_lines_enforce_rules()` is replaced (`CREATE OR REPLACE`) so that it reads the variant by `product_variant_id` only, and compares the variant's product with the line's `product_id` only when the line has one. Every other refusal is unchanged (business, status, deletion, pause, minimum, price, unknown variant 23503).
- `prisma/schema.prisma`: `productId String?` and `product Product?` on `OrderLine`; update the `//` comment above it in plain words: the product of a line is optional and checked only when given, the variant decides.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.

## Acceptance criteria
```gherkin
Scenario: AC-1 No product needed
  When a line is inserted with a variant and no `product_id`
  Then it is saved and `product_id` is empty
Scenario Outline: AC-2 The rules still hold without a product
  When a line without `product_id` names <variant>
  Then the database <result>
  Examples:
    | variant                                | result          |
    | an ACTIVE variant of the supplier      | accepts         |
    | a variant of another business          | rejects (23514) |
    | an INACTIVE variant                    | rejects (23514) |
    | an unknown id                          | rejects (23503) |
Scenario: AC-3 A given product must match
  When a line names a variant and a `product_id` that is not its product
  Then the database rejects it with 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 Leaving the product out to skip the business check (broken object access)
  When a raw insert omits `product_id` and names a variant of another business
  Then PostgreSQL refuses it with 23514 and no line exists
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_032_line_product_optional/migration.sql`, `tests/integration/order/line-product-optional.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.2.2: the supplier check reads the variant, so an empty product cannot skip it.
- v5.0.0-2.2.1: a given product is still compared with the variant's.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no product | integration | AC-1 | insert without product_id → saved, empty |
| rules | integration | AC-2, C-15 | each Examples row → accepted, 23514 or 23503 |
| mismatch | integration | AC-3 | other product → 23514 |
| skipped check | security | AB-1, CWE-639 | other business's variant, no product → 23514 |

Command: `npx vitest run tests/integration/order/line-product-optional.test.ts tests/integration/order/line-rules.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/order/order-line-table.test.ts | expects `product_id` to be required (NOT NULL) | expects it to be nullable |

## Out of scope
- The code that stops writing `product_id`: ORD-033. Dropping the column: ORD-034.

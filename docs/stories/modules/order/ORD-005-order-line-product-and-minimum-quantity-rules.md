---
id: ORD-005
title: Order line product and minimum quantity rules
module: order
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ORD-004, ORD-003]
read_first: [prisma/schema.prisma, tests/integration/order/order-line-table.test.ts]
design_refs: [commandes-et-livraisons/order/autres-regles, catalogue/product]
constraints: [C-15, C-20, CM-16]
asvs: [v5.0.0-2.2.3, v5.0.0-8.2.2]
---

# ORD-005 — Order line product and minimum quantity rules

## Story
Technical story: refuse a line for a product that is not an active product of the relationship's supplier, and a customer order below the minimum quantity.

## Context
- Exists: `order_lines`, `orders`, `products`, `customer_relationships`.
- Adds: a BEFORE INSERT OR UPDATE trigger on `order_lines`. On insert: the product must belong to the supplier organization of the order's relationship and have `status = 'ACTIVE'` and no `deleted_at`; when the order was placed by the CUSTOMER and the product has `min_order_quantity`, `quantity` must be at least that value. On an order placed by the CUSTOMER, `unit_price_applied` must equal `reference_price` on insert and may never exceed it on update. Otherwise SQLSTATE 23514. Product and quantity are not re-checked on update, so a later product change never blocks an old order.
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward; `price_set_by_id` and `price_set_at` are set if and only if `unit_price_applied` differs from `reference_price`.
- `CM-16`: Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order).

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Product rule
  When a line is inserted for <product>
  Then the insert <result>
  Examples:
    | product                                       | result          |
    | an ACTIVE product of the supplier             | accepts         |
    | an INACTIVE product of the supplier           | rejects (23514) |
    | a product of another organization             | rejects (23514) |
    | a deleted product                             | rejects (23514) |
Scenario Outline: AC-2 Minimum quantity
  Given a product with min_order_quantity 5
  When a line for an order placed by <party> has quantity <q>
  Then the insert <result>
  Examples:
    | party    | q     | result          |
    | CUSTOMER | 4.999 | rejects (23514) |
    | CUSTOMER | 5     | accepts         |
    | SUPPLIER | 1     | accepts         |
Scenario: AC-3 Later changes do not block
  When the product becomes INACTIVE after the line exists
  Then updating the line's `delivered_quantity` still works
Scenario: AC-4 Customer orders never above the reference
  Given an order placed by the CUSTOMER
  Then a line inserted with unit_price_applied different from reference_price is refused with 23514
  And an update that raises unit_price_applied above reference_price is refused, and one that lowers it is accepted
```

## Abuse cases
```gherkin
Scenario: AB-1 Line for a foreign product by a crafted write (tampering)
  When code inserts a line for another business's product
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_005_line_rules/migration.sql`, `tests/integration/order/line-rules.test.ts`
- Pattern: `tests/integration/order/creation-guard.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: product ownership and status are checked in the database.
- v5.0.0-8.2.2: a line cannot point outside the supplier's own catalog.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| product rule | integration | AC-1, C-15 | each Examples row → accepted or 23514 |
| minimum quantity | integration | AC-2, C-15 | each Examples row → accepted or 23514 |
| later changes | integration | AC-3 | update works |
| customer order prices | integration | AC-4, C-20, CM-16 | equal on insert, never above on update |
| foreign product | security | AB-1, CWE-639 | 23514 |

Command: `npx vitest run tests/integration/order/line-rules.test.ts`

## Out of scope
- Totals (ORD-006).

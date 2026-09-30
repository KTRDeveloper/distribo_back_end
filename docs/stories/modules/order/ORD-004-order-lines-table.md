---
id: ORD-004
title: Order lines table
module: order
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-001, CAT-001, PER-008, FND-003, ORD-002]
read_first: [prisma/schema.prisma, tests/integration/order/order-table.test.ts]
design_refs: [commandes-et-livraisons/orderline, contraintes-a-poser-au-niveau-base-de]
constraints: ['OrderLine:required', 'OrderLine:fk', C-20, CM-14, C-04, C-01, C-35]
asvs: [v5.0.0-2.2.1, v5.0.0-2.2.3]
---

# ORD-004 — Order lines table

## Story
Technical story: create the order lines table with the amount and price-gap rules in the database, so that an amount is always the rounded product of quantity and applied price.

## Context
- Exists: `orders` (ORD-001), `products` (CAT-001); `lineAmount` (FND-003).
- Adds: table `order_lines` (`quantity` and `delivered_quantity` numeric(12,3), `server_updated_at`, `deleted_at`, indexes on `order_id` and `product_id`), triggers `require_registered_person('price_set_by_id')` and `set_server_updated_at()`.
- CHECKs: `quantity > 0`; `delivered_quantity` null or between 0 and `quantity`; `reference_price >= 0`; `unit_price_applied >= 0`; `amount = (((coalesce(delivered_quantity, quantity) * 1000)::bigint * unit_price_applied) + 500) / 1000` (integer arithmetic, half up); `price_set_by_id` and `price_set_at` both set exactly when `unit_price_applied <> reference_price`.
- `OrderLine` fields: `order_id` FK → Order; `product_id` FK → Product; `label_applied` string; `quantity` decimal (3 décimales); `delivered_quantity` decimal (3 décimales), nullable; `reference_price` bigint; `unit_price_applied` bigint; `amount` bigint; `price_set_by_id` FK → Person, nullable; `price_set_at` datetime, nullable
- `OrderLine:required`: NOT NULL: `order_id`, `product_id`, `label_applied`, `quantity`, `reference_price`, `unit_price_applied`, `amount`
- `OrderLine:fk`: references order_id → Order; product_id → Product; price_set_by_id → Person
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward; `price_set_by_id` and `price_set_at` are set if and only if `unit_price_applied` differs from `reference_price`.
- `CM-14`: Line amount = quantity in thousandths times applied price, divided by 1000, rounded to the nearest franc with 0.5 rounded up, integer arithmetic only; 2.5 x 333 gives 833.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Amount rule
  When a line has quantity <q>, delivered_quantity <d>, unit_price_applied <p> and amount <a>
  Then the insert <result>
  Examples:
    | q   | d     | p    | a     | result          |
    | 2.5 | empty | 333  | 833   | accepts         |
    | 2.5 | empty | 333  | 832   | rejects (23514) |
    | 10  | 8     | 3000 | 24000 | accepts         |
    | 10  | 8     | 3000 | 30000 | rejects (23514) |
    | 0.001 | empty | 500 | 1    | accepts         |
    | 0.001 | empty | 499 | 0    | accepts         |
Scenario Outline: AC-2 Quantities
  When a line has quantity <q> and delivered_quantity <d>
  Then the insert <result>
  Examples:
    | q  | d   | result          |
    | 0  | empty | rejects (23514) |
    | 10 | 11  | rejects (23514) |
    | 10 | 0   | accepts         |
Scenario Outline: AC-3 Price gap
  When a line has unit_price_applied <applied>, reference_price <ref> and <author>
  Then the insert <result>
  Examples:
    | applied | ref  | author                        | result          |
    | 2800    | 3000 | price_set_by_id and price_set_at set | accepts  |
    | 2800    | 3000 | no author                     | rejects (23514) |
    | 3000    | 3000 | an author set                 | rejects (23514) |
    | 3000    | 3000 | no author                     | accepts         |
Scenario: AC-4 Keys and required
  When the order or the product is unknown, or `label_applied` is null
  Then the insert fails with 23503 or 23502
```

## Abuse cases
```gherkin
Scenario: AB-1 A price gap without an author (repudiation)
  When code inserts a line whose applied price differs from the reference and no author
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_004_order_lines/migration.sql`, `tests/integration/order/order-line-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/order/status-rules.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: amounts and quantities are validated in the database.
- v5.0.0-2.2.3: price, quantity, amount and author are checked together.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| amount rule | integration | AC-1, C-20, CM-14, C-01, C-35 | each Examples row → accepted or 23514; column types |
| quantities | integration | AC-2 | each Examples row → accepted or 23514 |
| price gap | integration | AC-3, C-20, C-04 | each Examples row → accepted or 23514 |
| customer orders | integration | AC-4, C-20 | above → 23514; insert equal only |
| keys and required | integration | AC-4, OrderLine:required, OrderLine:fk | rejected |
| gap without author | security | AB-1, CWE-778 | 23514 |

Command: `npx vitest run tests/integration/order/order-line-table.test.ts`

## Out of scope
- Product and quantity rules (ORD-005) and totals (ORD-006).

---
id: ORD-006
title: Order total equals the sum of its lines
module: order
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ORD-005]
read_first: [prisma/schema.prisma, tests/integration/order/line-rules.test.ts]
design_refs: [commandes-et-livraisons/order, contraintes-a-poser-au-niveau-base-de]
constraints: [C-19]
asvs: [v5.0.0-2.2.3, v5.0.0-2.3.3]
---

# ORD-006 — Order total equals the sum of its lines

## Story
Technical story: make the database check, at the end of each transaction, that an order's total is the sum of its line amounts plus its delivery cost, and that a delivered order's lines all carry a delivered quantity.

## Context
- Exists: `orders.total_amount`, `orders.delivery_cost`, `order_lines.amount`, `order_lines.delivered_quantity`.
- Adds: deferred constraint triggers (initially deferred) on `orders` and `order_lines`: at commit, for every touched order, `total_amount = sum(amount of its non-deleted lines) + delivery_cost`; an order with no lines is allowed only when `total_amount = delivery_cost`; when `status = 'DELIVERED'` every non-deleted line has `delivered_quantity` set. Violation: SQLSTATE 23514 at commit.
- `C-19`: `delivered_at` and `delivered_by_id` are set if and only if `status` is DELIVERED; every line then has `delivered_quantity`; `total_amount` equals the sum of line amounts plus `delivery_cost`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Consistent order
  When one transaction inserts an order with total 33000 and lines of 15000 and 15000 with delivery_cost 3000
  Then the commit succeeds
Scenario Outline: AC-2 Inconsistent totals
  When the transaction commits an order with <case>
  Then the commit <result>
  Examples:
    | case                                                     | result          |
    | total 30000 for lines summing to 33000 with cost 0       | rejects (23514) |
    | total changed without changing a line                    | rejects (23514) |
    | a line amount changed without changing the total         | rejects (23514) |
    | an order with no lines and total_amount = delivery_cost  | accepts         |
Scenario: AC-3 Delivered needs delivered quantities
  When an order is set DELIVERED while a line has no delivered_quantity
  Then the commit fails with 23514
Scenario: AC-4 Same transaction
  When the lines and the total change together in one transaction
  Then the commit succeeds
```

## Abuse cases
```gherkin
Scenario: AB-1 A total that hides a discount (tampering)
  When code lowers `total_amount` below the sum of the lines
  Then PostgreSQL refuses the commit
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_006_total_check/migration.sql`, `tests/integration/order/total-check.test.ts`
- Pattern: `tests/integration/order/line-rules.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the total is a database invariant.
- v5.0.0-2.3.3: the check runs when the transaction ends, so lines and total may be written in any order.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| consistent | integration | AC-1 | commit passes |
| inconsistent | integration | AC-2, C-19 | each Examples row → accepted or 23514 |
| delivered quantities | integration | AC-3, C-19 | 23514 at commit |
| same transaction | integration | AC-4 | commit passes |
| hidden discount | security | AB-1, CWE-345 | commit refused |

Command: `npx vitest run tests/integration/order/total-check.test.ts`

## Out of scope
- Computing totals in code (ORD-007).

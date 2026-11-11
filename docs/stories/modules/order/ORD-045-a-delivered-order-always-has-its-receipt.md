---
id: ORD-045
title: A delivered order always has its receipt
module: order
kind: migration
rev: 1
amends: [ORD-001]
size: S
risk: high
depends_on: [ORD-042, ORD-043]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9/contraintes-de-base-de-donnees-complete]
constraints: [C-61]
asvs: [v5.0.0-2.2.1]
---

# ORD-045 — A delivered order always has its receipt

## Story
Technical story: the database refuses a delivered order without its receipt fields, and receipt fields on an order that is not delivered.

## Context
- Exists: deliveries write the four fields with DELIVERED (DLV-019); delivered orders are backfilled (ORD-042); test fixtures give the receipt (ORD-043).
- One migration: an audit that raises an exception listing the ids of orders breaking the rule, then a CHECK: `supplier_name_applied`, `collected_applied` and `balance_after_applied` are all set when `status` is DELIVERED, and all four fields are empty otherwise.
- `prisma/schema.prisma`: add the rule to the `//` comment above `Order` in plain words, with this migration's name.
- `C-61`: `supplier_name_applied`, `collected_applied` and `balance_after_applied` are set exactly when the order is DELIVERED; `customer_name_applied` may stay empty. Enforced after the backfill of the orders already delivered.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The receipt goes with the delivered status
  When an order is saved with status <status> and <fields>
  Then the database <result>
  Examples:
    | status    | fields                                        | result          |
    | DELIVERED | the three fields set, customer name empty     | accepts         |
    | DELIVERED | no `supplier_name_applied`                    | rejects (23514) |
    | PENDING   | `collected_applied` 0, the other fields empty | rejects (23514) |
    | CANCELLED | the four fields empty                         | accepts         |
Scenario: AC-2 The audit
  When an order breaks the rule before the check is added
  Then the migration fails with a message listing its id and nothing is applied
```

## Abuse cases
```gherkin
Scenario: AB-1 A delivered status written around the delivery code
  When a raw update sets `status` DELIVERED on an order without its receipt
  Then the database rejects it with 23514
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_045_delivered_needs_receipt/migration.sql`, `tests/integration/order/receipt-required.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`, `pg`

## Security
- v5.0.0-2.2.1: no order is delivered without the receipt the server wrote.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rule | integration | AC-1, C-61 | each Examples row → accepted or 23514 |
| audit | integration | AC-2 | error naming the order, nothing applied |
| bypass | security | AB-1, CWE-471 | raw DELIVERED without receipt → 23514 |

Command: `npx vitest run tests/integration/order/receipt-required.test.ts`

## Out of scope
- Production code: every delivery path already writes the receipt (DLV-019).

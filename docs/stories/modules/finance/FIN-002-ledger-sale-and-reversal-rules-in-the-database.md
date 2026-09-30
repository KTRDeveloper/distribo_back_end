---
id: FIN-002
title: Ledger sale and reversal rules in the database
module: finance
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [FIN-001, ORD-006, ORD-003]
read_first: [prisma/schema.prisma, tests/integration/finance/ledger-table.test.ts]
design_refs: [finances/ledgerentry, contraintes-a-poser-au-niveau-base-de]
constraints: [C-24, C-25]
asvs: [v5.0.0-2.3.3, v5.0.0-2.2.3]
---

# FIN-002 — Ledger sale and reversal rules in the database

## Story
Technical story: enforce in the database that a sale equals its order's total and is unique, and that a reversal mirrors exactly one earlier entry.

## Context
- Exists: `ledger_entries` (FIN-001), `orders.total_amount`.
- Adds: one migration. A BEFORE INSERT trigger: a SALE that is not a reversal needs `order_id`, its `amount` must equal the order's `total_amount`, and the order must have no other SALE without a reversal pointing to it; otherwise 23514.
- A unique index on `reverses_entry_id` (where not null). A BEFORE INSERT trigger for a reversal: the target has the same `customer_relationship_id`, the same `kind` and the same `amount`, and the target is not itself a reversal; otherwise 23514.
- `C-24`: A SALE entry has `order_id` set and `amount` equal to `Order.total_amount` (server-fixed), and there is at most one non-reversed sale per order; the payment born of 'Commande livrée' also carries `order_id`.
- `C-25`: A ledger entry is never updated or deleted; `reverses_entry_id` is unique, on the same relationship, the same kind and amount, and points to an entry that is not itself a reversal.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Sale rules
  When a SALE is inserted with <values>
  Then the insert <result>
  Examples:
    | values                                                        | result          |
    | order_id and amount equal to the order total                  | accepts         |
    | no order_id                                                   | rejects (23514) |
    | amount different from the order total                         | rejects (23514) |
    | a second SALE for an order that has a live SALE               | rejects (23514) |
    | a new SALE for an order whose first SALE was reversed         | accepts         |
Scenario Outline: AC-2 Reversal rules
  When a reversal targets <target>
  Then the insert <result>
  Examples:
    | target                                                | result          |
    | an entry of the same relationship, kind and amount    | accepts         |
    | the same entry a second time                          | rejects (23505) |
    | an entry of another relationship                      | rejects (23514) |
    | an entry of another kind                              | rejects (23514) |
    | an entry with another amount                          | rejects (23514) |
    | a reversal entry                                      | rejects (23514) |
```

## Abuse cases
```gherkin
Scenario: AB-1 A sale that does not match its order (tampering)
  When code inserts a SALE of 3000 for an order of 30000
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_fin_002_ledger_rules/migration.sql`, `tests/integration/finance/ledger-rules.test.ts`
- Pattern: `tests/integration/order/creation-guard.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.3.3: sale uniqueness and reversal rules hold for every insert path.
- v5.0.0-2.2.3: related rows are checked in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sale rules | integration | AC-1, C-24 | each Examples row → accepted or 23514 |
| reversal rules | integration | AC-2, C-25 | each Examples row → accepted or SQLSTATE |
| mismatched sale | security | AB-1, CWE-345 | 23514 |

Command: `npx vitest run tests/integration/finance/ledger-rules.test.ts`

## Out of scope
- Counter sales paid in full (C-26 in DLV-011).

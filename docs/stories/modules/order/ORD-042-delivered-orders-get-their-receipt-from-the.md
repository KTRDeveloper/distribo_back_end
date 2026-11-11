---
id: ORD-042
title: Delivered orders get their receipt from the server's history, then it is frozen
module: order
kind: migration
rev: 1
amends: [ORD-001]
size: S
risk: high
depends_on: [ORD-040, DLV-019]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9/mise-en-service, a8-le-recu-ne-change-plus-point-9/contraintes-de-base-de-donnees-complete, a8-le-recu-ne-change-plus-point-9/apres-la-suppression-d-un-compte]
constraints: [C-62]
asvs: [v5.0.0-2.2.1]
---

# ORD-042 — Delivered orders get their receipt from the server's history, then it is frozen

## Story
Technical story: fill the receipt fields of the orders already delivered from the server's history, then make the database keep every receipt frozen.

## Context
- Exists: four empty columns (ORD-040); since DLV-019 every delivery writes them in the statement that sets DELIVERED.
- One migration, in order. Audit: when a DELIVERED order has no SALE ledger entry, raise an exception listing those order ids; nothing is applied.
- Backfill each DELIVERED order with an empty `supplier_name_applied`: the supplier organization's `name`; the customer organization's `name`, else the customer person's `full_name` (empty for an anonymized person or a customer without an account), never `customer_label`.
- `collected_applied`: the sum of the order's PAYMENT entries whose `server_updated_at` equals its SALE's (one transaction stamps them alike), 0 when none. `balance_after_applied`: the sum of `balance_effect` of the entries of the order's relationship with `server_updated_at` up to its SALE's. Several SALE entries: take the earliest.
- Freeze: a trigger before update on `orders` raises 23514 when `OLD.supplier_name_applied` is set and any of the four fields changes.
- `prisma/schema.prisma`: add the freeze to the `//` comment above `Order` in plain words, with this migration's name; the receipt is an accounting record kept after account deletion.
- Test: on one `pg` connection, BEGIN, drop this trigger, insert the fixture, run this migration's SQL file, assert, ROLLBACK.
- `C-62`: Once set, the database refuses any change to `supplier_name_applied`, `customer_name_applied`, `collected_applied` and `balance_after_applied`.

## Acceptance criteria
```gherkin
Scenario: AC-1 A delivered order gets its receipt
  Given a DELIVERED order of supplier "Dépôt Test" to customer organization "Boutique Test", a balance of 3000 before it, its SALE of 12500 and a PAYMENT of 5000 in the same transaction
  When the migration runs
  Then its receipt is "Dépôt Test", "Boutique Test", collected 5000 and balance after 10500
Scenario Outline: AC-2 The customer's public name
  When the customer is <customer>
  Then `customer_name_applied` is <name>
  Examples:
    | customer                                         | name           |
    | organization "Boutique Test"                     | "Boutique Test" |
    | person with full_name "Awa Test" and label "Tata" | "Awa Test"     |
    | anonymized person with label "Tata"              | empty          |
Scenario: AC-3 Later entries do not count
  Given a PAYMENT of 2000 recorded after the delivery
  When the migration runs
  Then collected stays 5000 and balance after stays 10500
Scenario: AC-4 A delivered order without a sale stops the migration
  When a DELIVERED order has no SALE entry
  Then the migration fails with a message listing its id and no order is changed
Scenario: AC-5 The receipt is frozen
  When an update changes any of the four fields of an order whose receipt is set
  Then the database rejects it with 23514, while an update of `supplier_note` succeeds
```

## Abuse cases
```gherkin
Scenario: AB-1 Rewriting an accounting record
  When a raw update lowers `collected_applied` of a delivered order
  Then the database rejects it with 23514 and the receipt is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_042_backfill_and_freeze_receipt/migration.sql`, `tests/integration/order/receipt-backfill.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`, `pg`

## Security
- v5.0.0-2.2.1: a written receipt cannot be rewritten, even by code that bypasses the application.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| backfill | integration | AC-1 | names, collected 5000, balance after 10500 |
| public name | integration | AC-2 | each Examples row → name or empty, never the label |
| later entries | integration | AC-3 | later payment changes neither field |
| audit | integration | AC-4 | error naming the order, nothing changed |
| frozen | integration | AC-5, C-62 | each field → 23514; supplier_note → accepted |
| rewrite | security | AB-1, CWE-471 | lowered collected_applied → 23514 |

Command: `npx vitest run tests/integration/order/receipt-backfill.test.ts`

## Out of scope
- The rule tying the fields to DELIVERED (ORD-045).

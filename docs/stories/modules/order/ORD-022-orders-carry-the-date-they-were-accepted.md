---
id: ORD-022
title: Orders carry the date they were accepted
module: order
kind: migration
rev: 1
amends: [ORD-001, ORD-002]
size: S
risk: high
depends_on: [ORD-002]
read_first: [prisma/schema.prisma, prisma/migrations/20261004280000_ord_002_status_rules/migration.sql]
design_refs: [commandes-et-livraisons/order, contraintes-a-poser-au-niveau-base-de]
constraints: [C-51]
asvs: [v5.0.0-2.2.3]
---

# ORD-022 — Orders carry the date they were accepted

## Story
Technical story: add the acceptance date to orders, with its rules, so that a refused order and an order cancelled after acceptance can be told apart.

## Context
- Exists: table `orders` with the check `orders_pending_placed_by_customer_check` and the trigger `orders_enforce_status_rules` (ORD-002).
- Adds: column `accepted_at` (`timestamptz`, empty allowed, no default). The accept gesture fills it (ORD-023); an order a supplier enters is born CONFIRMED and keeps it empty.
- Two new checks state C-51: a set `accepted_at` requires `placed_by_party` CUSTOMER, and `status` PENDING requires `accepted_at` empty. The old PENDING check stays, because a merged migration is never edited.
- Existing orders keep an empty date: nothing recorded when an old order was accepted, so there is nothing to backfill.
- `prisma/schema.prisma`: add `acceptedAt DateTime? @map("accepted_at") @db.Timestamptz` to `Order`. Above the model, extend the existing `//` comment in plain words: a pending order has no acceptance date, and only an order the customer placed can have one; name this migration as the place that enforces it.
- `Order` fields: `accepted_at` datetime, nullable
- `C-51`: `status` PENDING requires `placed_by_party` CUSTOMER and an empty `accepted_at`; a set `accepted_at` requires `placed_by_party` CUSTOMER.

## Acceptance criteria
```gherkin
Scenario: AC-1 The column
  When an order is inserted without an acceptance date
  Then `accepted_at` is empty, and the column is `timestamptz` with no default
Scenario Outline: AC-2 The two checks
  When a row has placed_by_party <party>, status <status> and accepted_at <date>
  Then the insert <result>
  Examples:
    | party    | status    | date  | result          |
    | CUSTOMER | CONFIRMED | set   | accepts         |
    | CUSTOMER | PENDING   | empty | accepts         |
    | CUSTOMER | PENDING   | set   | rejects (23514) |
    | SUPPLIER | CONFIRMED | set   | rejects (23514) |
    | SUPPLIER | CONFIRMED | empty | accepts         |
Scenario: AC-3 Acceptance and later cancellation
  Given a PENDING order placed by the customer
  When one update sets status CONFIRMED and accepted_at
  Then it is accepted
  And a later update to CANCELLED by the supplier, with a reason, leaves accepted_at unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 A supplier-entered order is made to look accepted (tampering)
  Given a CONFIRMED order placed by the SUPPLIER
  When an update sets accepted_at
  Then it fails with 23514 and the date stays empty
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_022_accepted_at/migration.sql`, `tests/integration/order/order-accepted-at.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: the rules are CHECK constraints, so no code path can skip them.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column | integration | AC-1 | insert without the date → empty; read the column type and default |
| checks | integration | AC-2, C-51 | each Examples row → accepted or 23514 |
| acceptance step | integration | AC-3 | PENDING to CONFIRMED with the date, then to CANCELLED → date kept |
| supplier order | security | AB-1, CWE-345 | set the date on a supplier-entered order → 23514 |

Command: `npx vitest run tests/integration/order/order-accepted-at.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/order/calculations-and-views.test.ts | its order() fixture is typed as the Prisma Order, which gains acceptedAt | add acceptedAt: null to the fixture |

## Out of scope
- Writing the date (ORD-023).
- Showing 'Refusée' or 'Annulée': the apps derive it from placed_by_party, cancelled_by_party and accepted_at.

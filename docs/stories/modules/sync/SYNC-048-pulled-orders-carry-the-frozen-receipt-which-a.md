---
id: SYNC-048
title: Pulled orders carry the frozen receipt, which a phone never writes
module: sync
kind: change
rev: 1
amends: [SYNC-006]
size: S
risk: medium
depends_on: [SYNC-006, ORD-041]
read_first: [src/modules/sync/adapters/order.adapter.ts, src/modules/sync/sync.changes.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9/champs-figes-champs-ajoutes-a-order]
constraints: []
asvs: [v5.0.0-15.3.1, v5.0.0-15.3.3]
---

# SYNC-048 — Pulled orders carry the frozen receipt, which a phone never writes

## Story
As a seller, I want the receipt on my phone to be the one the server wrote, so that every copy of a receipt is the same.

## Context
- `orderRow` (order.adapter.ts) builds rows from the order views, which carry the four receipt fields since ORD-041; the DRIVER view has no `balance_after_applied`. Amounts travel as numbers, like `total_amount`.
- Add the four fields to the `orders` computed list in `sync.judge.ts`: a pushed value is dropped and never stored, even in a conflict.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Who receives what
  Given a DELIVERED order with its receipt
  When <viewer> pulls orders
  Then the row has <fields>
  Examples:
    | viewer                   | fields                                           |
    | an OWNER of the supplier | the four receipt fields                          |
    | the customer person      | the four receipt fields                          |
    | a DRIVER of the supplier | the receipt fields without balance_after_applied |
Scenario: AC-2 Before delivery
  When an order not yet delivered is pulled
  Then its receipt fields are null
```

## Abuse cases
```gherkin
Scenario: AB-1 A phone rewrites the receipt
  When a phone pushes an update of that order with collected_applied 0 and supplier_name_applied "Faux"
  Then the stored receipt is unchanged and the next pull returns it
```

## Implementation
- Create: `tests/integration/sync/pull-receipt.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/adapters/order.adapter.ts`
- Pattern: `src/modules/sync/sync.changes.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.1: a driver never receives the customer's debt.
- v5.0.0-15.3.3: the receipt is server-only in the push.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| viewers | integration | AC-1 | each Examples row |
| before delivery | integration | AC-2 | null fields |
| rewrite | security | AB-1, WSTG-BUSL-01 | stored receipt unchanged |

Command: `npx vitest run tests/integration/sync/pull-receipt.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-orders.test.ts | receipt fields are added to order rows | unchanged: passes without edits |

## Out of scope
- Writing the receipt at delivery (DLV-019).

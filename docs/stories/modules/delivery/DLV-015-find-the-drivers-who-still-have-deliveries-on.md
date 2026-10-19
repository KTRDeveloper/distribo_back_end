---
id: DLV-015
title: Find the drivers who still have deliveries on the road
module: delivery
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [DLV-005, DLV-012]
read_first: [src/modules/delivery/delivery.repository.ts]
design_refs: [commandes-et-livraisons/delivery]
constraints: []
asvs: [v5.0.0-8.2.2]
---

# DLV-015 — Find the drivers who still have deliveries on the road

## Story
Technical story: give the delivery module one function that says which drivers still have a delivery on the road for a business, so that billing never pauses a driver in the middle of a round.

## Context
- Exists: a delivery is assigned to a driver, gets `departed_at` when the driver leaves, then `arrived_at` or `failed_at` (DLV-005, DLV-006). `findAbandonedRests` in `delivery.repository.ts` already reads deliveries together with their orders for one business.
- New in `delivery.repository.ts`: `findDriversWithOpenDeliveries(tx, organizationId, personIds)` returns the set of those people who are `assigned_to_id` of a delivery with `departed_at` set, `arrived_at` and `failed_at` empty and `deleted_at` empty, whose order is not deleted and belongs to the business as supplier (through the order's relationship).
- An empty list of people returns an empty set without a query. First usage: billing (BIL-019).

## Acceptance criteria
```gherkin
Scenario: AC-1 A driver on the road
  Given a delivery of the business that left and has neither arrived nor failed, assigned to driver A
  When the function runs with A and driver B, who has no delivery
  Then the set holds A only
Scenario Outline: AC-2 Not on the road
  When the function runs for a driver whose only delivery is <case>
  Then the set is empty
  Examples:
    | case                                  |
    | assigned but not departed             |
    | arrived                               |
    | failed                                |
    | deleted                               |
    | of another business's order           |
Scenario: AC-3 Nobody given
  When the function runs with an empty list
  Then it returns an empty set
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/delivery/open-deliveries.test.ts`
- Modify: `src/modules/delivery/delivery.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `findDriversWithOpenDeliveries(tx: Prisma.TransactionClient, organizationId: string, personIds: string[]): Promise<Set<string>>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.2: the business id comes from server code, and deliveries of another business never count.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| on the road | integration | AC-1 | A in the set, B not |
| not on the road | integration | AC-2 | each Examples row → empty |
| nobody | integration | AC-3 | empty list → empty set |

Command: `npx vitest run tests/integration/delivery/open-deliveries.test.ts`

## Out of scope
- Pausing the driver: billing (BIL-019).

---
id: DLV-012
title: Abandoned rests join the owner's money exceptions
module: delivery
kind: change
rev: 2
amends: [FIN-019]
size: S
risk: medium
depends_on: [DLV-008, FIN-019]
read_first: [src/modules/finance/finance.service.ts, src/modules/finance/finance.repository.ts, src/modules/delivery/delivery.repository.ts, docs/stories/modules/delivery/contracts.md]
design_refs: [commandes-et-livraisons/order/le-reste-d-une-livraison-partielle, synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: [CM-22]
asvs: [v5.0.0-8.2.3]
---

# DLV-012 — Abandoned rests join the owner's money exceptions

## Story
Technical story: add the goods abandoned in partial deliveries to the owner's exceptions, so that goods leaving without a claim are visible.

## Context
- Exists: `GET .../exceptions/money` (FIN-019); partial deliveries (DLV-008).
- Changes: each item also has `abandoned_rests: { count, amount }`. An abandoned rest is a line of a DELIVERED order with `delivered_quantity` below `quantity` whose order has no child order (`parent_order_id`); the person is the order's `delivered_by_id`, the owner excluded; the amount is (`quantity` − `delivered_quantity`) × `unit_price_applied`, rounded like a line; the date is `delivered_at`.
- Every item has `abandoned_rests`, `{ count: 0, amount: 0 }` when the person abandoned nothing. A person whose only exception in the period is an abandoned rest gets an item; the abandoned amount counts in the total used to sort the items.
- Module boundary: delivery provides `findAbandonedRests(tx, organizationId: string, period: { from: Date; toExclusive: Date }, excludePersonId: string): Promise<Map<string, { count: number; amount: bigint }>>` in `delivery.repository.ts`, listed under Provides in `docs/stories/modules/delivery/contracts.md` (used by `finance`; `finance` lists it under Consumes in its own contracts.md). `findMoneyExceptions` calls it inside its repeatable-read transaction so every total comes from one snapshot.
- `CM-22`: Partial delivery: 'later' creates a CONFIRMED order for the remainder at the original order's prices, linked by parent_order_id; 'abandon' closes the order on what was delivered; abandon by a non-owner joins the owner's exceptions.

## Acceptance criteria
```gherkin
Scenario: AC-1 Abandoned rest counted
  Given Paul delivered 8 of 10 sacks at 3000 and abandoned the rest
  When the owner reads the exceptions
  Then Paul's item has abandoned_rests count 1 and amount 6000
Scenario: AC-2 Rest later is not abandoned
  When the rest became a child order
  Then it is not counted
Scenario: AC-3 Owner excluded and period respected
  Then the owner's own abandoned rests, and those delivered outside the period, are not counted
```

## Abuse cases
```gherkin
Scenario: AB-1 Goods leaving without a claim (repudiation)
  When a driver abandons rests repeatedly
  Then the owner sees the count and value under the driver's name
```

## Implementation
- Create: `tests/integration/delivery/abandoned-rests.test.ts`
- Modify: `src/modules/finance/finance.service.ts`, `src/modules/finance/finance.repository.ts`, `src/modules/delivery/delivery.repository.ts`, `docs/stories/modules/delivery/contracts.md`, `docs/stories/modules/finance/contracts.md`, `src/modules/finance/finance.openapi.ts` (the item schema gains `abandoned_rests`)
- Pattern: `src/modules/finance/finance.service.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-8.2.3: still owner only and person ids with totals.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| abandoned | integration | AC-1, CM-22 | 1 and 6000 |
| later | integration | AC-2 | not counted |
| owner and period | integration | AC-3 | excluded |
| repeated abandon | security | AB-1, CWE-778 | listed |

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/finance/money-exceptions.test.ts › "groups the gestures by person, largest total first (AC-1)" | exact-object `toEqual` on whole items, which now carry `abandoned_rests` | each of the two expected items gains `abandoned_rests: { count: 0, amount: 0 }`; nothing else changes |
| tests/integration/finance/money-exceptions.test.ts › "exposes only person ids and totals (v5.0.0-8.2.3)" | exact list of item keys | the expected key list gains `abandoned_rests`; still person id and totals only |

Command: `npx vitest run tests/integration/delivery/abandoned-rests.test.ts tests/integration/finance/money-exceptions.test.ts`

## Out of scope
- Any change to the delivery gesture.

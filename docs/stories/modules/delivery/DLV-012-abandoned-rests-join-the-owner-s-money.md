---
id: DLV-012
title: Abandoned rests join the owner's money exceptions
module: delivery
kind: change
rev: 1
amends: [FIN-019]
size: S
risk: medium
depends_on: [DLV-008, FIN-019]
read_first: [src/modules/finance/finance.service.ts, src/modules/delivery/delivery.repository.ts]
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
- Modify: `src/modules/finance/finance.service.ts`, `src/modules/delivery/delivery.repository.ts`
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

Command: `npx vitest run tests/integration/delivery/abandoned-rests.test.ts tests/integration/finance/money-exceptions.test.ts`

## Out of scope
- Any change to the delivery gesture.

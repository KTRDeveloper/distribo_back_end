---
id: SYNC-049
title: Orders entered offline carry their reception mode
module: sync
kind: change
rev: 1
amends: [SYNC-012]
size: S
risk: medium
depends_on: [SYNC-012, ORD-036]
read_first: [src/modules/sync/adapters/order.push.ts, src/modules/sync/sync.push.ts]
design_refs: [a4-livraison-ou-retrait-reception-mode/champ-ajoute-a-order, a4-livraison-ou-retrait-reception-mode/contraintes-de-base-de-donnees-complete]
constraints: [C-60]
asvs: [v5.0.0-2.2.1]
---

# SYNC-049 — Orders entered offline carry their reception mode

## Story
As a seller, I want an order I enter offline to keep whether it is delivered or picked up, so that nobody delivers an order the customer comes to fetch.

## Context
- A created `orders` row (order.push.ts, the branch that reads `delivery_address_applied`) also reads `reception_mode`: `DELIVERY` or `PICKUP`; absent or null (older apps) is stored empty.
- Any other value, or `PICKUP` with a non-empty `delivery_address_applied`, is refused through `invalidOrder` and nothing is stored.
- An update never changes `reception_mode`: only `supplier_note` and a cancellation apply, as today.
- Pulled rows already carry `reception_mode` through the order views (ORD-037).
- `C-60`: A `PICKUP` order has no delivery address.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Creating an order offline
  When a phone pushes a new order with reception_mode <mode> and delivery_address_applied <address>
  Then <result>
  Examples:
    | mode     | address | result                             |
    | DELIVERY | "Rue 1" | it is stored DELIVERY with Rue 1   |
    | PICKUP   | absent  | it is stored PICKUP with no address |
    | absent   | "Rue 1" | it is stored empty with Rue 1      |
    | PICKUP   | "Rue 1" | it is refused and nothing stored   |
Scenario: AC-2 An update keeps the mode
  When a phone pushes an update of a DELIVERY order with reception_mode PICKUP
  Then the order stays DELIVERY
```

## Abuse cases
```gherkin
Scenario: AB-1 An unknown mode
  When a phone pushes a new order with reception_mode "COURIER"
  Then it is refused and nothing is stored
```

## Implementation
- Create: `tests/integration/sync/push-reception-mode.test.ts`
- Modify: `src/modules/sync/adapters/order.push.ts`
- Pattern: `src/modules/sync/sync.push.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: the mode is checked against its two values and the address rule before anything is stored.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| create | integration | AC-1, C-60 | each Examples row |
| update | integration | AC-2 | mode unchanged |
| unknown mode | security | AB-1, WSTG-INPV-20 | refused, nothing stored |

Command: `npx vitest run tests/integration/sync/push-reception-mode.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/push-orders.test.ts | its rows send no reception_mode, which is stored empty | unchanged: passes without edits |

## Out of scope
- Orders placed online (ORD-037).

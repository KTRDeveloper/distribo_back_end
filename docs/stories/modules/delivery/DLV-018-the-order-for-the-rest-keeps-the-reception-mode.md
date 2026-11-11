---
id: DLV-018
title: The order for the rest keeps the reception mode of the first order
module: delivery
kind: change
rev: 1
amends: [DLV-008]
size: XS
risk: low
depends_on: [DLV-008, ORD-036]
read_first: [src/modules/delivery/delivery.repository.ts, tests/integration/delivery/open-deliveries.test.ts]
design_refs: [a4-livraison-ou-retrait-reception-mode]
constraints: [C-60]
asvs: [v5.0.0-2.3.1]
---

# DLV-018 — The order for the rest keeps the reception mode of the first order

## Story
As a driver, I want the order for the rest to keep the reception mode of the first one, so that the rest is delivered or picked up like the order was.

## Context
- `deliverOrder` with `rest: 'LATER'` creates the order for the rest through `insertRestOrder` (delivery.repository.ts), copying the address of the first order.
- It now also copies `reception_mode` from the first order; an empty mode stays empty.
- A `PICKUP` order has no address, so its rest has none either.
- `C-60`: A `PICKUP` order has no delivery address.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The rest keeps the mode
  Given a CONFIRMED order with reception_mode <mode> and 10 units ordered
  When the driver delivers 8 with rest LATER
  Then the order for the rest has reception_mode <mode> and the address <address>
  Examples:
    | mode     | address              |
    | DELIVERY | of the first order   |
    | PICKUP   | empty                |
    | empty    | of the first order   |
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/delivery/rest-reception-mode.test.ts`
- Modify: `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `tests/integration/delivery/open-deliveries.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: the mode comes from the stored first order, never from the request.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rest mode | integration | AC-1, C-60 | each Examples row → the rest's mode and address |

Command: `npx vitest run tests/integration/delivery/rest-reception-mode.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/partial-delivery.test.ts | its orders are DELIVERY orders, whose rest keeps DELIVERY | unchanged: passes without edits |

## Out of scope
- Rest orders made through sync, which call the same `deliverOrder`.

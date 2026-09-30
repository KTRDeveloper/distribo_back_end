---
id: DLV-010
title: Cancelled or shop-delivered orders drop their unstarted deliveries
module: delivery
kind: change
rev: 1
amends: [ORD-016, ORD-017, DLV-007]
size: S
risk: medium
depends_on: [DLV-007, ORD-017]
read_first: [src/modules/delivery/delivery.repository.ts, src/modules/order/order.service.ts]
design_refs: [commandes-et-livraisons/delivery]
constraints: [C-22]
asvs: [v5.0.0-2.3.3]
---

# DLV-010 — Cancelled or shop-delivered orders drop their unstarted deliveries

## Story
Technical story: remove a delivery that was assigned but not yet departed when its order is cancelled or delivered in the shop, so that nothing lingers.

## Context
- Exists: `cancelOrderAsSupplier` (ORD-016), `cancelOrderAsCustomer` (ORD-017), the shop path of `deliverOrder` (DLV-007), assignments (DLV-004).
- Adds `deleteUnstartedDeliveries(tx, orderId)` in `delivery.repository.ts`: sets `deleted_at` on every delivery of the order with `departed_at` empty, not arrived and not failed; returns the count. Each of the three paths calls it in its own transaction after the status change.
- `C-22`: A delivery not yet departed is removed when its order is cancelled or delivered without it; with crossed departures the server keeps the first and stores the other closed.

## Acceptance criteria
```gherkin
Scenario: AC-1 Cancel removes the assignment
  Given a CONFIRMED order assigned to a driver who has not left
  When the supplier or the customer cancels the order
  Then the delivery has deleted_at set
Scenario: AC-2 Shop delivery removes it
  When a SELLER delivers the order in the shop
  Then the unstarted delivery has deleted_at set
Scenario: AC-3 Departed deliveries are kept
  When the order has a delivery that departed
  Then it is not deleted by any of these paths
Scenario: AC-4 Atomic
  When the status change fails
  Then the delivery is not deleted
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/delivery/unstarted-cleanup.test.ts`
- Modify: `src/modules/delivery/delivery.repository.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/order/order.service.ts`
- Pattern: `src/modules/delivery/delivery.repository.ts`
- Signatures:
  - `deleteUnstartedDeliveries(tx: Prisma.TransactionClient, orderId: string): Promise<number>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the cleanup shares the transaction of the status change.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cancel | integration | AC-1, C-22 | deleted_at set |
| shop delivery | integration | AC-2 | deleted_at set |
| departed kept | integration | AC-3 | unchanged |
| atomic | integration | AC-4, CWE-362 | unchanged |

Command: `npx vitest run tests/integration/delivery/unstarted-cleanup.test.ts tests/integration/order/cancel-order-supplier.test.ts tests/integration/order/cancel-order-customer.test.ts`

## Out of scope
- Crossed departures (SYNC module).

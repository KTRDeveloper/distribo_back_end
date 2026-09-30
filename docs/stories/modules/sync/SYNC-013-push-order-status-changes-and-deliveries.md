---
id: SYNC-013
title: Push order status changes and deliveries
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-012, ORD-008, DLV-005, DLV-006]
read_first: [src/modules/order/order.state.ts, src/modules/delivery/delivery.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, commandes-et-livraisons/delivery]
constraints: [CM-12, CM-23, C-36]
asvs: [v5.0.0-2.3.1, v5.0.0-2.3.4, v5.0.0-8.2.1]
---

# SYNC-013 — Push order status changes and deliveries

## Story
As a driver, I want departures, failures and cancellations I made offline to be applied only when they are allowed so that the order status follows what really happened.

## Context
- Exists: `transitionOrder` with `viaSync` (ORD-008), delivery routes' logic (DLV-005, DLV-006), judge pipeline.
- Adds: `adapters/delivery.push.ts` registering `deliveries` and the status side of `orders`.
- Order updates: `status` to CANCELLED (SELLER; `cancellation_reason` required for the supplier), `supplier_note` (SELLER, any status); other status changes come through deliveries (below) or delivery closing (SYNC-015). Each change goes through `transitionOrder` with `viaSync`: a step not allowed from the current status is a business problem: the order keeps its status and its `sync_issue` gets the message ("Annulation impossible : commande livrée par <name> à <time>"), never a refusal of the batch.
- Deliveries: create (DRIVER) with `id`, `order_id`, `departed_at`: the server sets `assigned_to_id` the viewer and moves the order to IN_DELIVERY; crossed departures: when a delivery in progress already exists for the order, the pushed one is stored closed (`failed_at` = now, `failure_reason` "Livraison déjà prise par <name>") and its `sync_issue` says so; if the pushed delivery is the one that delivered (SYNC-015), delivery wins and the other is the one closed. Update: `failed_at` and `failure_reason` (order back to CONFIRMED).
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED; DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.
- `CM-23`: Crossed departures: the server keeps the first delivery and stores the other closed with sync_issue 'Livraison déjà prise par <name>'; if the second one delivered, the delivery wins and the other is closed.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.

## Acceptance criteria
```gherkin
Scenario: AC-1 Departure
  When a DRIVER pushes a new delivery for a CONFIRMED order
  Then the delivery is stored for them and the order is IN_DELIVERY
Scenario: AC-2 Crossed departures
  Given another driver already left with the order
  When this driver's departure arrives
  Then their delivery is stored closed with "Livraison déjà prise par <name>" and the order still belongs to the first
Scenario: AC-3 Failure
  When a driver pushes failed_at and a reason
  Then the order is CONFIRMED again
Scenario: AC-4 Cancel after delivery
  Given the order was delivered
  When a cancellation arrives
  Then the order stays DELIVERED and its sync_issue names who delivered and when
Scenario: AC-5 Cancel allowed
  When a SELLER cancels a CONFIRMED order with a reason
  Then it is CANCELLED with the fields set
Scenario: AC-6 Repeat
  When the same departure is pushed twice
  Then one delivery exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Skipping the state machine (tampering)
  When a phone pushes status DELIVERED directly on an order
  Then the change is refused as a business problem and the status is unchanged
Scenario: AB-2 Driver cancels (vertical)
  When a DRIVER pushes status CANCELLED
  Then the line is forbidden
```

## Implementation
- Create: `src/modules/sync/adapters/delivery.push.ts`, `tests/integration/sync/push-deliveries.test.ts`
- Modify: `src/modules/sync/sync.judge.ts`, `src/modules/sync/adapters/order.push.ts`
- Pattern: `src/modules/sync/adapters/order.push.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.1: every status change goes through the state machine.
- v5.0.0-2.3.4: the unique in-progress index settles crossed departures.
- v5.0.0-8.2.1: field and action rights from the rules table.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| departure | integration | AC-1, CM-12 | IN_DELIVERY |
| crossed | integration | AC-2, CM-23, C-36 | closed second |
| failure | integration | AC-3 | CONFIRMED |
| cancel after delivery | integration | AC-4 | DELIVERED, issue |
| cancel allowed | integration | AC-5 | CANCELLED |
| repeat | integration | AC-6 | one delivery |
| skipped step | security | AB-1, WSTG-BUSL-06 | unchanged |
| driver cancels | security | AB-2, WSTG-ATHZ-03 | forbidden |

Command: `npx vitest run tests/integration/sync/push-deliveries.test.ts`

## Out of scope
- Closing an order with sale and payment (SYNC-014).

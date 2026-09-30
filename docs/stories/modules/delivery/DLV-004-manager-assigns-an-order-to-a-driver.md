---
id: DLV-004
title: Manager assigns an order to a driver
module: delivery
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [DLV-003, ACC-003, ACC-007, NTF-002]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/delivery/delivery.routes.ts]
design_refs: [commandes-et-livraisons/delivery]
constraints: [C-21]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1]
---

# DLV-004 — Manager assigns an order to a driver

## Story
As a manager, I want to assign an order to a driver so that they know it is theirs to deliver.

## Context
- Exists: rule `assign` on Delivery for MANAGER online (ACC-003); `deliveries` (DLV-001, DLV-002); `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/orders/{orderId}/assign` with `{ id, driver_person_id }`; response 201 with the delivery `{ id, order_id, assigned_to_id, departed_at }`.
- The order must be CONFIRMED with a delivery address; the driver an ACTIVE collaborator. A not-yet-departed delivery of the order is reassigned (same row, new driver); a delivery already departed answers 409 `DELIVERY_IN_PROGRESS`. The driver is notified `delivery.assigned`.
- `C-21`: A delivery's `assigned_to_id` is an ACTIVE collaborator of the supplier, driver or above; `arrived_at` and `failed_at` are never both set; `failure_reason` is set if and only if `failed_at` is set; at most one delivery in progress (neither arrived nor failed) per order.

## Acceptance criteria
```gherkin
Scenario: AC-1 Assign
  When a MANAGER assigns a CONFIRMED order with an address to a driver
  Then a delivery exists for that driver with departed_at empty and the driver is notified
Scenario: AC-2 Reassign
  When the manager assigns the same order to another driver before departure
  Then the same delivery row belongs to the new driver
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                   | status                     |
    | a delivery already departed               | 409 DELIVERY_IN_PROGRESS   |
    | an order without a delivery address       | 400 VALIDATION_ERROR       |
    | an order not CONFIRMED                    | 409 INVALID_TRANSITION     |
    | a driver who is not an ACTIVE collaborator| 404 NOT_FOUND              |
    | a SELLER or DRIVER caller                 | 403 FORBIDDEN              |
Scenario: AC-4 Repeat
  When the same id is posted twice
  Then one delivery exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Driver assigns orders to themselves (vertical)
  When a DRIVER posts an assignment
  Then the response is 403 and nothing is stored
```

## Implementation
- Create: `src/modules/delivery/delivery.schemas.ts`, `tests/integration/delivery/assign.test.ts`
- Modify: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `src/modules/delivery/delivery.routes.ts`
- Signatures:
  - `assignDelivery(actor: Actor, orderId: string, input: { id: string; driver_person_id: string }): Promise<DeliveryView>`
- Errors: `DELIVERY_IN_PROGRESS` 409, `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online.
- v5.0.0-2.3.1: departed deliveries are never reassigned.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| assign | integration | AC-1, C-21 | delivery and notification |
| reassign | integration | AC-2 | same row |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | one delivery |
| driver assigns | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/delivery/assign.test.ts`

## Out of scope
- Departure (DLV-005).

---
id: DLV-005
title: Driver departs with an order
module: delivery
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [DLV-004, ORD-008]
read_first: [src/modules/order/order.state.ts, src/modules/delivery/delivery.service.ts]
design_refs: [commandes-et-livraisons/delivery]
constraints: [C-21, CM-12]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1, v5.0.0-2.3.4]
---

# DLV-005 — Driver departs with an order

## Story
As a driver, I want to leave with an order so that it is marked in delivery and nobody else takes it.

## Context
- Exists: `transitionOrder` (ORD-008); rule `depart` on Order for DRIVER with status CONFIRMED (ACC-003); `assignDelivery`; `notify`; `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/orders/{orderId}/depart` with `{ id }`; response 200 `{ delivery, order_status: 'IN_DELIVERY' }`.
- One transaction: the order must be CONFIRMED with a delivery address; if a not-yet-departed delivery exists it must be assigned to the caller or the caller must be a MANAGER or OWNER (else 409 `ASSIGNED_TO_OTHER`); otherwise a delivery is created for the caller; `departed_at` = now; the order becomes IN_DELIVERY; the customer is notified `order.status_changed`.
- A live delivery in progress of another driver answers 409 `DELIVERY_IN_PROGRESS`.
- `C-21`: A delivery's `assigned_to_id` is an ACTIVE collaborator of the supplier, driver or above; `arrived_at` and `failed_at` are never both set; `failure_reason` is set if and only if `failed_at` is set; at most one delivery in progress (neither arrived nor failed) per order.
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.

## Acceptance criteria
```gherkin
Scenario: AC-1 Depart with an unassigned order
  When a DRIVER departs with a CONFIRMED order with an address
  Then a delivery for them with departed_at exists and the order is IN_DELIVERY
Scenario: AC-2 Depart with an assigned order
  Given the order was assigned to the caller
  Then the same delivery row gets departed_at
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                        | status                     |
    | an order assigned to another driver            | 409 ASSIGNED_TO_OTHER      |
    | an order already IN_DELIVERY                   | 409 DELIVERY_IN_PROGRESS   |
    | a PENDING, DELIVERED or CANCELLED order        | 409 INVALID_TRANSITION     |
    | an order without an address                    | 400 VALIDATION_ERROR       |
Scenario: AC-4 Two drivers at once
  When two drivers depart with the same order simultaneously
  Then exactly one succeeds
Scenario: AC-5 Repeat
  When the same id is posted twice
  Then one delivery exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Double departure (tampering)
  When a second driver departs with an order already on the road
  Then the response is 409 and the first delivery is unchanged
Scenario: AB-2 Another business's order (horizontal)
  When a member of A departs with an order of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/delivery/depart.test.ts`
- Modify: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.schemas.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `src/modules/delivery/delivery.routes.ts`
- Signatures:
  - `departWithOrder(actor: Actor, orderId: string, input: { id: string }): Promise<{ delivery: DeliveryView; order_status: 'IN_DELIVERY' }>`
- Errors: `ASSIGNED_TO_OTHER` 409, `DELIVERY_IN_PROGRESS` 409, `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: driver and above, with the status condition.
- v5.0.0-2.3.4: the unique in-progress index and the conditional order update settle races.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| unassigned | integration | AC-1, CM-12 | delivery and IN_DELIVERY |
| assigned | integration | AC-2 | same row |
| refusals | integration | AC-3 | each Examples row → status |
| simultaneous | integration | AC-4, C-21, CWE-362 | one success |
| repeat | integration | AC-5 | one delivery |
| double departure | security | AB-1, WSTG-BUSL-06 | 409 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/delivery/depart.test.ts`

## Out of scope
- Crossed departures made offline (SYNC module).

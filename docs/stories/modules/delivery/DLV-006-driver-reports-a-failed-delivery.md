---
id: DLV-006
title: Driver reports a failed delivery
module: delivery
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [DLV-005]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/order/order.state.ts]
design_refs: [commandes-et-livraisons/delivery]
constraints: [C-21, CM-12]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.1]
---

# DLV-006 — Driver reports a failed delivery

## Story
As a driver, I want to report a failed delivery with a reason so that the order goes back to the orders to deliver.

## Context
- Exists: departed deliveries (DLV-005); rule `fail_delivery` for DRIVER (ACC-003).
- Adds: `POST /api/v1/organizations/{organizationId}/deliveries/{deliveryId}/fail` with `{ id, reason }` (1 to 2000 characters, required); response 200 `{ delivery, order_status: 'CONFIRMED' }`.
- One transaction: the delivery (in progress, assigned to the caller, or any caller MANAGER or OWNER) gets `failed_at` = now and `failure_reason`; the order returns from IN_DELIVERY to CONFIRMED. The owner and managers are notified `delivery.failed`.
- `C-21`: A delivery's `assigned_to_id` is an ACTIVE collaborator of the supplier, driver or above; `arrived_at` and `failed_at` are never both set; `failure_reason` is set if and only if `failed_at` is set; at most one delivery in progress (neither arrived nor failed) per order.
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.

## Acceptance criteria
```gherkin
Scenario: AC-1 Fail
  When the assigned driver reports "client absent"
  Then the delivery has failed_at and the reason, and the order is CONFIRMED again and in the to-deliver list
Scenario: AC-2 New attempt
  Then another driver can depart with it and a second delivery row exists
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                      | status                   |
    | no reason                                    | 400 VALIDATION_ERROR     |
    | a delivery of another driver                 | 404 NOT_FOUND            |
    | a delivery already arrived or failed         | 409 INVALID_TRANSITION   |
Scenario: AC-4 Repeat
  When the same id is posted twice
  Then the answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Failing another driver's delivery (horizontal)
  When a DRIVER posts a failure for a delivery assigned to someone else
  Then the response is 404 and it is unchanged
```

## Implementation
- Create: `tests/integration/delivery/fail.test.ts`
- Modify: `src/modules/delivery/delivery.routes.ts`, `src/modules/delivery/delivery.schemas.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `src/modules/delivery/delivery.routes.ts`
- Signatures:
  - `failDelivery(actor: Actor, deliveryId: string, input: { id: string; reason: string }): Promise<{ delivery: DeliveryView; order_status: 'CONFIRMED' }>`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `INVALID_TRANSITION` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the delivery is selected by id and assignee, or by role.
- v5.0.0-2.3.1: delivery and order change together conditionally.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| fail | integration | AC-1, C-21, CM-12 | fields and status |
| new attempt | integration | AC-2 | second row |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | equal answers |
| other driver | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/delivery/fail.test.ts`

## Out of scope
- Delivering (DLV-007).

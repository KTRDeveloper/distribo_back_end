---
id: ORD-016
title: Supplier cancels an order before departure
module: order
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORD-008, ACC-003, ACC-007, NTF-002, ORD-009]
read_first: [src/modules/order/order.state.ts, src/modules/order/order.service.ts]
design_refs: [commandes-et-livraisons/order/refus-et-annulation]
constraints: [C-16]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1]
---

# ORD-016 — Supplier cancels an order before departure

## Story
As a seller, I want to cancel a confirmed order with a reason so that the customer knows it will not come.

## Context
- Exists: `transitionOrder`; rule `cancel` on Order for SELLER with status PENDING or CONFIRMED (ACC-003).
- Adds: `POST /api/v1/organizations/{organizationId}/orders/{orderId}/cancel` with `{ id, reason }` (1 to 2000, required); response 200 `projectOrderForSupplier`. The order becomes CANCELLED with SUPPLIER, the caller, now, the reason; the customer is notified `order.status_changed`.
- An order that has left (IN_DELIVERY) or is finished answers 409 `INVALID_TRANSITION`. Unstarted deliveries of the order are removed by DLV-010.
- `C-16`: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are set if and only if `status` is CANCELLED; `cancellation_reason` only when CANCELLED and required when the supplier cancelled.

## Acceptance criteria
```gherkin
Scenario: AC-1 Cancel
  When a SELLER cancels a CONFIRMED order with reason "article plus disponible"
  Then it is CANCELLED with the four cancellation fields and the customer is notified
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                              | status                  |
    | an order IN_DELIVERY                 | 409 INVALID_TRANSITION  |
    | a DELIVERED or CANCELLED order       | 409 INVALID_TRANSITION  |
    | no reason                            | 400 VALIDATION_ERROR    |
    | a DRIVER caller                      | 403 FORBIDDEN           |
Scenario: AC-3 Note kept
  Given the order has a supplier_note
  Then the note and the cancellation reason both remain
```

## Abuse cases
```gherkin
Scenario: AB-1 Driver cancels (vertical)
  When a DRIVER posts cancel
  Then the response is 403 and the status is unchanged
Scenario: AB-2 Another business's order (horizontal)
  When a member of A cancels an order of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/order/cancel-order-supplier.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `cancelOrderAsSupplier(actor: Actor, orderId: string, input: { id: string; reason: string }): Promise<SupplierOrderView>`
- Errors: `INVALID_TRANSITION` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: seller and above.
- v5.0.0-2.3.1: conditional status update.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cancel | integration | AC-1, C-16 | fields and notification |
| refusals | integration | AC-2 | each Examples row → status |
| note kept | integration | AC-3 | both texts present |
| driver | security | AB-1, WSTG-ATHZ-03 | 403 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/cancel-order-supplier.test.ts`

## Out of scope
- Removing unstarted deliveries (DLV-010).

---
id: ORD-012
title: Supplier refuses an order
module: order
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORD-008, ACC-003, ACC-007, NTF-002, ORD-009]
read_first: [src/modules/order/order.service.ts, src/modules/order/order.routes.ts]
design_refs: [commandes-et-livraisons/order/refus-et-annulation]
constraints: [C-16, CM-12]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1]
---

# ORD-012 — Supplier refuses an order

## Story
As a seller, I want to refuse a customer's order with a reason so that the customer knows why.

## Context
- Exists: `transitionOrder`; rule `refuse` on Order for SELLER with status PENDING (ACC-003).
- Adds: `POST /api/v1/organizations/{organizationId}/orders/{orderId}/refuse` with `{ id, reason }`; `reason` 1 to 2000 characters, required; response 200 `projectOrderForSupplier`.
- The order becomes CANCELLED with `cancelled_by_party` SUPPLIER, `cancelled_by_id` the caller, `cancelled_at` now and the reason; the customer is notified `order.status_changed`. Only a PENDING order can be refused.
- `C-16`: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are set if and only if `status` is CANCELLED; `cancellation_reason` only when CANCELLED and required when the supplier cancelled.
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.

## Acceptance criteria
```gherkin
Scenario: AC-1 Refuse
  When a SELLER refuses a PENDING order with reason "rupture de stock"
  Then it is CANCELLED with SUPPLIER, the caller, a time and the reason, and the customer is notified
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                            | status                  |
    | no reason or an empty reason       | 400 VALIDATION_ERROR    |
    | a reason of 2001 characters        | 400 VALIDATION_ERROR    |
    | an order not PENDING               | 409 INVALID_TRANSITION  |
    | a DRIVER caller                    | 403 FORBIDDEN           |
Scenario: AC-3 Repeat
  When the same id is sent twice
  Then the answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Refusing another business's order (horizontal)
  When a member of A refuses an order of B
  Then the response is 404 and it stays PENDING
```

## Implementation
- Create: `tests/integration/order/refuse-order.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `refuseOrder(actor: Actor, orderId: string, input: { id: string; reason: string }): Promise<SupplierOrderView>`
- Errors: `VALIDATION_ERROR` 400, `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: seller and above.
- v5.0.0-2.3.1: refusal is a conditional status update from PENDING.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| refuse | integration | AC-1, C-16, CM-12 | CANCELLED with fields, notification |
| refusals | integration | AC-2 | each Examples row → status |
| repeat | integration | AC-3 | equal answers |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/refuse-order.test.ts`

## Out of scope
- Cancelling a confirmed order (ORD-016).

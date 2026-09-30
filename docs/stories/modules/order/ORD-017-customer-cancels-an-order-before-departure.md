---
id: ORD-017
title: Customer cancels an order before departure
module: order
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [ORD-009, ORD-010, ORD-016]
read_first: [src/modules/order/order.service.ts, src/modules/order/order.routes.ts]
design_refs: [commandes-et-livraisons/order/refus-et-annulation, commandes-et-livraisons/order]
constraints: [C-16]
asvs: [v5.0.0-8.2.2, v5.0.0-2.3.1]
---

# ORD-017 — Customer cancels an order before departure

## Story
As a customer, I want to cancel an order that has not left so that I can change my mind at no cost.

## Context
- Exists: `transitionOrder`; orders placed by persons (ORD-009) and organizations (ORD-010).
- Adds: `POST /api/v1/orders/{orderId}/cancel` for the person who is the customer, and `POST /api/v1/organizations/{organizationId}/purchases/{orderId}/cancel` (MANAGER or OWNER, network), both with `{ id, reason? }` (up to 2000); response 200 `projectOrderForCustomer`.
- Allowed from PENDING or CONFIRMED (any order the customer's relationship owns, whoever entered it); the order becomes CANCELLED with `cancelled_by_party` CUSTOMER and the caller. The supplier's OWNER, MANAGERs and SELLERs are notified `order.status_changed`. IN_DELIVERY, DELIVERED or CANCELLED orders answer 409 `INVALID_TRANSITION`.
- `C-16`: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are set if and only if `status` is CANCELLED; `cancellation_reason` only when CANCELLED and required when the supplier cancelled.

## Acceptance criteria
```gherkin
Scenario: AC-1 Person cancels
  When a customer cancels their PENDING order
  Then it is CANCELLED with party CUSTOMER and the supplier team is notified
Scenario: AC-2 Confirmed order
  When the customer cancels a CONFIRMED order that has not left
  Then it is CANCELLED and any reason is stored
Scenario: AC-3 Organization cancels
  When a MANAGER cancels through the purchases route
  Then the same happens; a SELLER answers 403
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                          | status                 |
    | an order IN_DELIVERY             | 409 INVALID_TRANSITION |
    | a DELIVERED order                | 409 INVALID_TRANSITION |
    | an order of another customer     | 404 NOT_FOUND          |
```

## Abuse cases
```gherkin
Scenario: AB-1 Cancelling someone else's order (horizontal)
  When person A cancels an order of person B
  Then the response is 404 and B's order is unchanged
Scenario: AB-2 Cancelling after the goods left (business logic)
  When the order is IN_DELIVERY
  Then the response is 409 and the delivery continues
```

## Implementation
- Create: `tests/integration/order/cancel-order-customer.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `cancelOrderAsCustomer(customer: { personId: string; organizationId?: string; role?: Role }, orderId: string, input: { id: string; reason?: string }): Promise<CustomerOrderView>`
- Errors: `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the order is selected through the caller's own customer relationship.
- v5.0.0-2.3.1: conditional status update.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| person cancels | integration | AC-1, C-16 | CANCELLED CUSTOMER, notified |
| confirmed | integration | AC-2 | CANCELLED with reason |
| organization cancels | integration | AC-3 | manager ok, seller 403 |
| refusals | integration | AC-4 | each Examples row → status |
| other customer | security | AB-1, WSTG-ATHZ-04 | 404 |
| after departure | security | AB-2, WSTG-BUSL-06 | 409 |

Command: `npx vitest run tests/integration/order/cancel-order-customer.test.ts`

## Out of scope
- Cancellation fees (v2).

---
id: ORD-011
title: Supplier accepts an order, lowering prices if needed
module: order
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-008, ACC-003, ACC-007, NTF-002, ORD-009]
read_first: [src/modules/order/order.state.ts, src/modules/order/order.service.ts]
design_refs: [commandes-et-livraisons/order, commandes-et-livraisons/orderline]
constraints: [C-20, CM-16, CM-12]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1, v5.0.0-15.3.3]
---

# ORD-011 — Supplier accepts an order, lowering prices if needed

## Story
As a seller, I want to accept a customer's order, and lower a price if we agreed, so that a negotiation ends in the order.

## Context
- Exists: `transitionOrder`, `lineAmountOf`, `orderTotal`; rule `accept` on Order for SELLER with status PENDING (ACC-003); `loadActor`; `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/orders/{orderId}/accept` with `{ id, line_prices?: [{ line_id, unit_price_applied }] }`; response 200 `projectOrderForSupplier`.
- One transaction: the order (supplier side, PENDING) is locked; each listed price must be an integer between 0 and the line's current `unit_price_applied` (a higher price answers 400 `PRICE_INCREASE_REFUSED`); lowered lines get `price_set_by_id` = the caller and `price_set_at` = now; amounts and `total_amount` are recomputed; the order becomes CONFIRMED; the customer is notified `order.status_changed`. Prices are frozen from here.
- A non-PENDING order answers 409 `INVALID_TRANSITION`.
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward; `price_set_by_id` and `price_set_at` are set if and only if `unit_price_applied` differs from `reference_price`.
- `CM-16`: Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order).
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.

## Acceptance criteria
```gherkin
Scenario: AC-1 Accept as is
  When a SELLER accepts a PENDING order with no line_prices
  Then it is CONFIRMED with the same prices and total, and the customer is notified
Scenario: AC-2 Lower a price
  When line_prices lowers a line from 2800 to 2500 for quantity 10
  Then the line's applied price is 2500, its amount 25000, price_set_by_id is the caller, the total is recomputed, and reference_price stays 2800
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and the order stays PENDING
  Examples:
    | problem                                  | status                    |
    | a price above the current one            | 400 PRICE_INCREASE_REFUSED |
    | a negative price or 1.5                  | 400 VALIDATION_ERROR      |
    | a line of another order                  | 404 NOT_FOUND             |
    | an order not PENDING                     | 409 INVALID_TRANSITION    |
    | a DRIVER caller                          | 403 FORBIDDEN             |
Scenario: AC-4 Repeat
  When the same id is sent twice
  Then the second answer equals the first
```

## Abuse cases
```gherkin
Scenario: AB-1 Raising a price after the customer ordered (tampering)
  When line_prices contains a higher price
  Then the response is 400 and no price changed
Scenario: AB-2 Accepting another business's order (horizontal)
  When a member of A accepts an order of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/order/accept-order.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `acceptOrder(actor: Actor, orderId: string, input: AcceptInput): Promise<SupplierOrderView>`
- Types:
  - `AcceptInput = { id: string; line_prices?: Array<{ line_id: string; unit_price_applied: number }> }`
- Errors: `PRICE_INCREASE_REFUSED` 400, `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: seller and above, checked with the order status as condition.
- v5.0.0-2.3.1: acceptance is a conditional status update.
- v5.0.0-15.3.3: only line ids and prices are writable.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| accept | integration | AC-1, CM-12 | CONFIRMED, notification |
| lower price | integration | AC-2, C-20, CM-16 | applied, amount, total, author |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | equal answers |
| price increase | security | AB-1, WSTG-BUSL-02, CWE-345 | 400, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/accept-order.test.ts`

## Out of scope
- Refusing (ORD-012).

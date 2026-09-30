---
id: ORD-013
title: Seller enters an order for a customer
module: order
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-008, ORD-005, REL-009, CAT-003, ACC-003, ACC-007, ORD-009]
read_first: [src/modules/order/order.service.ts, docs/stories/modules/catalog/contracts.md]
design_refs: [commandes-et-livraisons/order, commandes-et-livraisons/orderline]
constraints: [C-14, C-15, C-17]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# ORD-013 — Seller enters an order for a customer

## Story
As a seller, I want to enter an order for a customer so that it is ready to be delivered without waiting for anyone.

## Context
- Exists: `getActiveProduct`, `getReferencePrice`, `lineAmountOf`, `orderTotal`, `projectOrderForSupplier`; rule `create` on Order (SELLER; ACC-003) and `update` on OrderLine field `unit_price_applied`; `assertOrganizationActive`; `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/orders` with `{ id, customer_relationship_id, delivery_address?, delivery_cost?, desired_delivery_date?, customer_note?, lines: [{ id, product_id, quantity, unit_price_applied? }] }` (1 to 100 lines); response 201 `projectOrderForSupplier`.
- The order is CONFIRMED at once, `placed_by_party` SUPPLIER, `entered_by_id` the caller. `reference_price` comes from `getReferencePrice`; `unit_price_applied` defaults to it; a different price is a gap: `price_set_by_id` = the caller and `price_set_at` = now (any price of at least 0; the minimum quantity does not apply).
- The relationship must belong to the organization as supplier, be ACTIVE and not a counter (a counter answers 409 `USE_COUNTER_SALE`; counter sales are made by DLV-009). `delivery_cost` is an integer of at least 0 (default 0).
- `C-14`: An order is created only on an ACTIVE relationship whose supplier is an ACTIVE organization (not suspended, not closed).
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.
- `C-17`: `status` PENDING requires `placed_by_party` CUSTOMER.

## Acceptance criteria
```gherkin
Scenario: AC-1 Enter at the reference price
  When a SELLER enters 10 units of an article priced 3000 for a customer without a negotiated price
  Then the order is CONFIRMED, placed by SUPPLIER, the line's applied price is 3000 and equals reference_price, total 30000
Scenario: AC-2 Price gap has an author
  When a line is entered at 2800 while the reference is 3000
  Then price_set_by_id is the caller, price_set_at is set, reference_price stays 3000, and the amount uses 2800
Scenario: AC-3 Delivery cost
  When delivery_cost 2000 is given
  Then total_amount is the sum of lines plus 2000
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                        | status                      |
    | a counter relationship                         | 409 USE_COUNTER_SALE        |
    | an ENDED or PENDING relationship               | 409 RELATIONSHIP_NOT_ACTIVE |
    | an INACTIVE product                            | 404 NOT_FOUND               |
    | a relationship of another business             | 404 NOT_FOUND               |
    | a DRIVER caller                                | 403 FORBIDDEN               |
    | zero lines or more than 100                    | 400 VALIDATION_ERROR        |
    | total_amount or status in the body             | 400 VALIDATION_ERROR        |
Scenario: AC-5 Repeat
  When the same body is posted twice
  Then one order exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Entering an order for another business's customer (horizontal)
  When the relationship belongs to business B
  Then the response is 404
Scenario: AB-2 Client-chosen totals (tampering)
  When the body carries amount, reference_price or total_amount
  Then the response is 400
```

## Implementation
- Create: `tests/integration/order/enter-order.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `enterOrder(actor: Actor, input: EnterOrderInput): Promise<SupplierOrderView>`
- Types:
  - `EnterOrderInput = { id: string; customer_relationship_id: string; delivery_address?: string; delivery_cost?: number; desired_delivery_date?: string; customer_note?: string; lines: Array<{ id: string; product_id: string; quantity: string | number; unit_price_applied?: number }> }`
- Errors: `USE_COUNTER_SALE` 409, `RELATIONSHIP_NOT_ACTIVE` 409, `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: seller and above.
- v5.0.0-2.3.3: order and lines are one transaction.
- v5.0.0-15.3.3: amounts, totals and reference prices are never accepted from the client.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| reference price | integration | AC-1, C-17 | CONFIRMED, equal prices, total |
| price gap | integration | AC-2 | author and time, amount at 2800 |
| delivery cost | integration | AC-3, C-14 | total includes 2000 |
| refusals | integration | AC-4, C-15 | each Examples row → status |
| repeat | integration | AC-5 | one order |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |
| client totals | security | AB-2, CWE-915 | 400 |

Command: `npx vitest run tests/integration/order/enter-order.test.ts`

## Out of scope
- Counter sales (DLV-009). Editing (ORD-014).

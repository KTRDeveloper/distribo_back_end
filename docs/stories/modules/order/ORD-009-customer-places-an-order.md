---
id: ORD-009
title: Customer places an order
module: order
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-008, ORD-005, ORD-006, REL-007, CAT-003, ACC-007, NTF-002]
read_first: [docs/stories/modules/catalog/contracts.md, docs/stories/modules/relationship/contracts.md]
design_refs: [commandes-et-livraisons/order, relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme]
constraints: [C-14, C-15, C-17]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3, v5.0.0-8.2.2]
---

# ORD-009 — Customer places an order

## Story
As a customer, I want to order articles from a business so that it can prepare them for me.

## Context
- Exists: `getActiveProduct`, `getReferencePrice`, `ensureCustomerRelationship`, `lineAmountOf`, `orderTotal`, `projectOrderForCustomer`, `assertOrganizationActive`, `notify`, `idempotent()`.
- Adds: `POST /api/v1/orders` with `{ id, supplier_organization_id, delivery_address?, desired_delivery_date?, customer_note?, lines: [{ id, product_id, quantity }] }` (1 to 100 lines). Response 201 `projectOrderForCustomer`.
- One transaction: the supplier organization must be ACTIVE; the relationship is found or created for the caller as customer person (ACTIVE, credit limit 0); it must be ACTIVE (else 409 `RELATIONSHIP_NOT_ACTIVE`); each line takes the ACTIVE product, applies `quantity` (at least `min_order_quantity`), freezes `label_applied` = "<name> (<unit>)", `reference_price` from `getReferencePrice`, `unit_price_applied` equal to it, and the rounded `amount`; the order is PENDING, `placed_by_party` CUSTOMER, `entered_by_id` the caller, `delivery_address_applied` = the body value or the relationship's default, `delivery_cost` 0, `total_amount` the sum.
- The supplier's OWNER, MANAGERs and SELLERs get a notification `order.placed`. The customer never sends a price.
- `C-14`: An order is created only on an ACTIVE relationship whose supplier is an ACTIVE organization (not suspended, not closed).
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.
- `C-17`: `status` PENDING requires `placed_by_party` CUSTOMER.

## Acceptance criteria
```gherkin
Scenario: AC-1 Order with negotiated and default prices
  Given article A priced 3000 (customer price 2800) and article B priced 500
  When the customer orders 10 of A and 2.5 of B
  Then the order is PENDING with lines at 2800 and 500, amounts 28000 and 1250, total 29250, unit_price_applied equal to reference_price
Scenario: AC-2 First order creates the relationship
  When the caller has no relationship with the business
  Then an ACTIVE relationship with credit_limit 0 is created in the same transaction
Scenario: AC-3 Team notified
  Then the owner, managers and sellers each have one unread `order.placed`
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                              | status                      |
    | a quantity below min_order_quantity                  | 400 VALIDATION_ERROR        |
    | an INACTIVE or foreign product                       | 404 NOT_FOUND               |
    | a CLOSED or SUSPENDED business                       | 409 ORGANIZATION_NOT_ACTIVE |
    | a relationship ENDED by either party                 | 409 RELATIONSHIP_NOT_ACTIVE |
    | more than 100 lines, or zero lines                   | 400 VALIDATION_ERROR        |
    | quantity 0 or with 4 decimals                        | 400 VALIDATION_ERROR        |
Scenario: AC-5 Repeat
  When the same body is posted twice
  Then one order exists and both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 A price chosen by the client (tampering)
  When a line carries unit_price_applied, reference_price or amount, or the body carries total_amount or status
  Then the response is 400 and nothing is stored
Scenario: AB-2 Ordering for another person (horizontal)
  When the body carries a customer id or relationship id
  Then the response is 400 and the customer is always the caller
```

## Implementation
- Create: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `tests/integration/order/place-order.test.ts`
- Modify: `src/modules/order/order.repository.ts`, `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `placeOrder(customer: { personId: string; organizationId?: string }, input: PlaceOrderInput): Promise<CustomerOrderView>`
- Types:
  - `PlaceOrderInput = { id: string; supplier_organization_id: string; delivery_address?: string; desired_delivery_date?: string; customer_note?: string; lines: Array<{ id: string; product_id: string; quantity: string | number }> }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409, `RELATIONSHIP_NOT_ACTIVE` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-2.2.1: prices, amounts and totals are computed on the server; the request carries only ids and quantities.
- v5.0.0-2.3.3: relationship, order, lines and notifications are one transaction.
- v5.0.0-15.3.3: strict schemas.
- v5.0.0-8.2.2: the customer is the caller.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| prices and totals | integration | AC-1, C-17 | lines, amounts, total, PENDING |
| first order | integration | AC-2, C-14 | relationship created |
| team notified | integration | AC-3 | notifications |
| refusals | integration | AC-4, C-15 | each Examples row → status |
| repeat | integration | AC-5 | one order |
| client price | security | AB-1, CWE-915, WSTG-BUSL-02 | 400 |
| other customer | security | AB-2, WSTG-ATHZ-04 | 400 |

Command: `npx vitest run tests/integration/order/place-order.test.ts`

## Out of scope
- An organization as customer (ORD-010). OpenAPI registration (ORD-019).

---
id: ORD-021
title: Customer lists and opens their orders
module: order
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORD-017, ORD-019, FND-009]
read_first: [src/modules/order/order.routes.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [commandes-et-livraisons/order]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# ORD-021 — Customer lists and opens their orders

## Story
As a customer, I want to list and open my orders so that I follow what I bought.

## Context
- Exists: customer projection (ORD-007); `visibleRelationsWhere`.
- Adds: `GET /api/v1/orders?limit&cursor&status&supplier_relationship_id` and `GET /api/v1/orders/{orderId}` for a signed-in person (orders on relationships where they are `customer_person_id`), and `GET /api/v1/organizations/{organizationId}/purchases` and `GET /api/v1/organizations/{organizationId}/purchases/{orderId}` (MANAGER and above) for an organization as customer. All return `projectOrderForCustomer`, newest first.

## Acceptance criteria
```gherkin
Scenario: AC-1 Person's orders
  Given a person with 3 orders at two suppliers
  When they list
  Then 3 orders are returned in the customer view with lines and reference and applied prices
Scenario: AC-2 Opening one
  Then opening their own order returns 200 and another person's order id returns 404
Scenario: AC-3 Organization purchases
  When a MANAGER lists the purchases of their business
  Then only that business's orders as customer are returned; a SELLER answers 403
Scenario: AC-4 Filters and pages
  Then status and supplier_relationship_id filter, and limit 2 with the cursor pages 2 and 1
```

## Abuse cases
```gherkin
Scenario: AB-1 Another customer's orders (horizontal)
  When person A lists or opens orders of person B
  Then nothing of B appears
Scenario: AB-2 Supplier-side data (information disclosure)
  When an order is read by its customer
  Then no entered_by_id, delivered_by_id, sync_issue or price author appears
```

## Implementation
- Create: `tests/integration/order/customer-orders.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `listOrdersAsCustomer(customer: { personId: string; organizationId?: string }, query: ListOrdersQuery): Promise<{ items: CustomerOrderView[]; next_cursor: string | null }>`
  - `getOrderAsCustomer(customer: { personId: string; organizationId?: string }, orderId: string): Promise<CustomerOrderView>`
- Errors: `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: every query starts from the visibility predicate for the caller as customer.
- v5.0.0-15.3.1: customer projection only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| person orders | integration | AC-1 | 3 orders, customer view |
| open | integration | AC-2 | own 200, foreign 404 |
| organization purchases | integration | AC-3 | manager ok, seller 403 |
| filters and pages | integration | AC-4 | counts |
| other customer | security | AB-1, WSTG-ATHZ-04 | nothing of B |
| supplier data | security | AB-2, CWE-200 | fields absent |

Command: `npx vitest run tests/integration/order/customer-orders.test.ts`

## Out of scope
- Receipts: generated on the phone.

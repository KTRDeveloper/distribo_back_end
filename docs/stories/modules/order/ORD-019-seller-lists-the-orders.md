---
id: ORD-019
title: Seller lists the orders
module: order
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORD-013, FND-009, ORD-009]
read_first: [src/modules/order/order.routes.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [commandes-et-livraisons/order]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-8.4.1, v5.0.0-15.3.1]
---

# ORD-019 — Seller lists the orders

## Story
As a seller, I want to list my organization's orders so that I find the ones to handle.

## Context
- Exists: orders (ORD-009 onward); `visibleRelationsWhere`; `projectOrderForSupplier`.
- Adds: `GET /api/v1/organizations/{organizationId}/orders?limit&cursor&status&customer_relationship_id` (SELLER and above; DRIVER gets 403): the orders of relationships where the organization is supplier, newest first, with lines. `status` filters one status; `customer_relationship_id` one customer.
- Adds `order.openapi.ts` documenting this route and the order routes of ORD-009 to ORD-017; `order.routes.ts` imports it for its side effect.

## Acceptance criteria
```gherkin
Scenario: AC-1 List orders
  Given 5 orders across two customers
  When a SELLER lists
  Then 5 orders are returned newest first, each with its lines
Scenario Outline: AC-2 Filters
  When the query has <query>
  Then <count> orders are returned
  Examples:
    | query                                   | count |
    | status=PENDING                          | 2     |
    | customer_relationship_id of customer 1  | 3     |
    | status=DELIVERED                        | 0     |
Scenario: AC-3 Pagination
  When limit 2 is used with the returned cursor
  Then the pages hold 2, 2 and 1 orders
Scenario: AC-4 Driver refused
  Then a DRIVER answers 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's orders (horizontal)
  When a member of A lists the orders of B
  Then the response is 404
Scenario: AB-2 Filtering by a foreign customer (horizontal)
  When customer_relationship_id belongs to another business
  Then the list is empty
```

## Implementation
- Create: `src/modules/order/order.openapi.ts`, `tests/integration/order/list-orders.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`, `src/modules/order/order.schemas.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `listOrders(actor: Actor, query: ListOrdersQuery): Promise<{ items: SupplierOrderView[]; next_cursor: string | null }>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the query starts from the visibility predicate for the actor's organization.
- v5.0.0-15.3.1: supplier projection only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | 5 orders with lines |
| filters | integration | AC-2 | each Examples row → count |
| paging | integration | AC-3 | 2, 2, 1 |
| driver | integration | AC-4 | 403 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |
| foreign customer filter | security | AB-2, WSTG-ATHZ-02 | empty |

Command: `npx vitest run tests/integration/order/list-orders.test.ts`

## Out of scope
- Orders to deliver for drivers (DLV-003).

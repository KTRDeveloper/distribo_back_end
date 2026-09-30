---
id: ORD-020
title: Seller opens one order
module: order
kind: feature
rev: 1
amends: []
size: XS
risk: medium
depends_on: [ORD-019, ORD-009]
read_first: [src/modules/order/order.routes.ts, src/modules/order/order.service.ts]
design_refs: [commandes-et-livraisons/order]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# ORD-020 — Seller opens one order

## Story
As a seller, I want to open an order so that I see its lines, prices and status.

## Context
- Exists: `GET .../orders` (ORD-019).
- Adds: `GET /api/v1/organizations/{organizationId}/orders/{orderId}` (SELLER and above) returning `projectOrderForSupplier` with the caller's role; a missing, foreign or malformed id answers 404 or 400.

## Acceptance criteria
```gherkin
Scenario: AC-1 Open
  When a SELLER opens an order of their organization
  Then the response is 200 with lines, totals, notes and status
Scenario: AC-2 Price author by role
  Then an OWNER sees price_set_by_id on gap lines and a SELLER does not
Scenario Outline: AC-3 Not found
  When the id is <case>
  Then the response is <status>
  Examples:
    | case                              | status |
    | an order of another business      | 404    |
    | not a UUID                        | 400    |
Scenario: AC-4 Driver refused
  Then a DRIVER answers 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading an order by id from another business (horizontal)
  When a member of A requests an order id of B under A's path
  Then the response is 404
```

## Implementation
- Create: `tests/integration/order/get-order.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `getOrder(actor: Actor, orderId: string): Promise<SupplierOrderView>`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the order is selected by id and the visibility predicate.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| open | integration | AC-1 | full view |
| author by role | integration | AC-2 | owner sees, seller does not |
| not found | integration | AC-3 | each Examples row → status |
| driver | integration | AC-4 | 403 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/get-order.test.ts`

## Out of scope
- The receipt: generated on the phone.

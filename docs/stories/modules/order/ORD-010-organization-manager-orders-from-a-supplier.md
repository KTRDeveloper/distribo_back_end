---
id: ORD-010
title: Organization manager orders from a supplier
module: order
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORD-009, ACC-005]
read_first: [src/modules/order/order.service.ts, src/modules/order/order.routes.ts]
design_refs: [commandes-et-livraisons/order, relations-commerciales/customerrelationship/organisation-cliente]
constraints: [C-14, C-17]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3]
---

# ORD-010 — Organization manager orders from a supplier

## Story
As a manager, I want to order from a supplier on behalf of my business so that it buys with its own account.

## Context
- Exists: `placeOrder` (ORD-009); rule `order_from_supplier` on CustomerRelationship (MANAGER, network; ACC-005); `loadActor`.
- Adds: `POST /api/v1/organizations/{organizationId}/purchases` with the body of ORD-009; response 201 `projectOrderForCustomer`.
- The customer of the relationship is the calling organization, which must be ACTIVE; the supplier must be a different organization (400 `VALIDATION_ERROR`). The organization's own relationship is used, never the manager's personal one. A SELLER or DRIVER answers 403.
- `C-14`: An order is created only on an ACTIVE relationship whose supplier is an ACTIVE organization (not suspended, not closed).
- `C-17`: `status` PENDING requires `placed_by_party` CUSTOMER.

## Acceptance criteria
```gherkin
Scenario: AC-1 Order as an organization
  When a MANAGER posts an order for their business
  Then the order's relationship has the business as customer_organization_id and the manager's personal relationship is unchanged
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                   | status                      |
    | a SELLER or DRIVER caller                 | 403 FORBIDDEN               |
    | the same organization as supplier         | 400 VALIDATION_ERROR        |
    | a CLOSED calling organization             | 409 ORGANIZATION_NOT_ACTIVE |
Scenario: AC-3 Same rules as a person
  Then prices, minimum quantities and notifications behave as in ORD-009
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller commits the business's debt (vertical)
  When a SELLER posts
  Then the response is 403 and nothing is stored
Scenario: AB-2 Another business (horizontal)
  When a member of A posts under B's path
  Then the response is 404
```

## Implementation
- Create: `tests/integration/order/place-purchase.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.schemas.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Errors: `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `ORGANIZATION_NOT_ACTIVE` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager and above, online (network).

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| organization order | integration | AC-1, C-14 | customer organization set |
| refusals | integration | AC-2 | each Examples row → status |
| same rules | integration | AC-3, C-17 | as ORD-009 |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/place-purchase.test.ts`

## Out of scope
- Inviting a supplier (REL-020).

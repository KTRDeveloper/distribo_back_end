---
id: ORD-044
title: A business changes a pending purchase
module: order
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORD-039]
read_first: [src/modules/order/order.routes.ts, tests/integration/order/order-line-variant-required.test.ts]
design_refs: [a1-modifier-remplacer-une-commande-en/le-geste]
constraints: [C-58]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2]
---

# ORD-044 — A business changes a pending purchase

## Story
As a manager, I want to change a pending purchase of my business, so that the supplier gets the right order without a cancellation and a new order.

## Context
- New route POST /api/v1/organizations/{organizationId}/purchases/{orderId}/replace, built like the purchase cancel route: `requireAbility('order_from_supplier', 'CustomerRelationship')`, strict validation, then `idempotent()`.
- Same body and answer as POST /api/v1/orders/{orderId}/replace (ORD-039); it calls `replaceOrder` with the path's organization, so the order is found through the business's own relationship.
- Register the path in `order.openapi.ts`, `catalog.test.ts` and `per-001.test.ts`.
- `C-58`: `replaced_by_order_id` is unique among set values, never the order's own id, set only on an order placed by the CUSTOMER, and names an order of the same relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 A manager changes a purchase
  Given a PENDING purchase P1 of business B
  When a MANAGER of B replaces P1 with id P2 and its server total as expected_total
  Then the response is 201 with order.id P2 and replaced_order_id P1, and P1 is CANCELLED by the CUSTOMER, deleted and linked to P2
Scenario: AC-2 A repeat changes nothing
  When the same request is sent again with the same id
  Then the response is the first 201 and one new version exists
```

## Abuse cases
```gherkin
Scenario: AB-1 A member without the ordering ability
  When a member of B without that ability replaces P1
  Then the response is 403 FORBIDDEN and nothing changes
Scenario: AB-2 Another business's purchase
  When a MANAGER of B replaces a purchase of business C through B's path
  Then the response is 404 NOT_FOUND and nothing changes
```

## Implementation
- Create: `tests/integration/order/replace-purchase.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.openapi.ts`, `tests/integration/api-docs/catalog.test.ts`, `tests/integration/per-001.test.ts`
- Pattern: `tests/integration/order/order-line-variant-required.test.ts`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`

## Security
- v5.0.0-8.2.1: the ordering ability is checked on the server before any change.
- v5.0.0-8.2.2: the purchase is found through the path organization's relationship; any other id answers 404.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| replace | integration | AC-1, C-58 | P1 replaced by P2 |
| repeat | integration | AC-2 | same 201, one P2 |
| no ability | security | AB-1, WSTG-ATHZ-02 | 403, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404, unchanged |

Command: `npx vitest run tests/integration/order/replace-purchase.test.ts tests/integration/api-docs/catalog.test.ts tests/integration/per-001.test.ts`

## Out of scope
- Rules shared with ORD-039 (pricing, notifications, refusals), tested there.

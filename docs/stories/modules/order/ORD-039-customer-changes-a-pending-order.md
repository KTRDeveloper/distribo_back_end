---
id: ORD-039
title: Customer changes a pending order
module: order
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-035, ORD-037, ORD-038, NTF-005]
read_first: [docs/stories/modules/order/contracts.md]
design_refs: [a1-modifier-remplacer-une-commande-en/le-geste, a1-modifier-remplacer-une-commande-en/le-lien-et-la-suppression-champ-ajoute]
constraints: [C-58, CM-16]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# ORD-039 — Customer changes a pending order

## Story
As a customer, I want to change my order while it is pending, so that the supplier gets the right order without a cancellation and a new order.

## Context
- New route POST /api/v1/orders/{orderId}/replace, `idempotent()` on the body `id` (the new order); strict body of POST /api/v1/orders without `supplier_organization_id`, `expected_total` required.
- One transaction: `lockCustomerOrder` (null → 404); not PENDING → 409 INVALID_TRANSITION; the checks and pricing of placing (extract them from `placeOrderFor` into one function both use); `assertExpectedTotal`.
- New version: PENDING, placed by the CUSTOMER, same relationship, `entered_by_id` the caller, reception by `resolveReception`; only `supplier_note` is copied.
- Old version: `transitionOrder` to CANCELLED, party CUSTOMER, then `markOrderReplaced` sets `deleted_at` and `replaced_by_order_id`; its lines stay.
- Then `retargetNotifications(tx, { type: 'order', fromId: old, toId: new })` and one `order.replaced` per person of `listOrderTeamIds`, about the new order, FR "Commande modifiée par le client.", EN "Order changed by the customer."; no `order.placed` nor `order.status_changed`.
- 201 `{ order: <customer view>, replaced_order_id }`; lists and detail already skip deleted orders.
- Add the path to `order.openapi.ts`, `catalog.test.ts`, `per-001.test.ts`.
- `C-58`: `replaced_by_order_id` is unique among set values, never the order's own id, set only on an order placed by the CUSTOMER, and names an order of the same relationship.
- `CM-16`: Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order).

## Acceptance criteria
```gherkin
Scenario: AC-1 The customer changes a pending order
  Given a PENDING order O1 of the customer with supplier_note "Livrer après 10 h"
  When the customer replaces O1 with id O2, new lines and their server total as expected_total
  Then the response is 201: O2 PENDING at today's prices with that supplier_note, replaced_order_id O1
  And O1 is CANCELLED by the CUSTOMER, deleted and linked to O2, its lines unchanged, absent from both sides' lists and counts, and answers 404
Scenario: AC-2 The supplier team is told once
  Given the team got an order.placed about O1
  When O1 is replaced by O2
  Then each OWNER, MANAGER and SELLER gets one order.replaced about O2, the order.placed now names O2, and nothing else is added
Scenario Outline: AC-3 Refused, nothing changes
  When the customer replaces O1 while <state>
  Then the response is <response> and nothing changes
  Examples:
    | state                  | response               |
    | O1 is CONFIRMED        | 409 INVALID_TRANSITION |
    | expected_total differs | 409 TOTAL_CHANGED      |
Scenario: AC-4 A repeat changes nothing
  When the same request is sent again with the same id
  Then the response is the first 201 and one new version exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Another customer's order (horizontal)
  When a customer replaces an order of another customer
  Then the response is 404 NOT_FOUND and nothing changes
Scenario: AB-2 A version already replaced
  When the customer replaces O1 again
  Then the response is 404 NOT_FOUND and no third version exists
Scenario: AB-3 Fields the customer may not choose
  When the body adds status or unit_price_applied
  Then the response is 400 VALIDATION_ERROR and nothing changes
```

## Implementation
- Create: `tests/integration/order/replace-order.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`, `src/modules/order/order.openapi.ts`, `tests/integration/api-docs/catalog.test.ts`, `tests/integration/per-001.test.ts`
- Pattern: `tests/integration/order/order-line-variant-required.test.ts`
- Signatures:
  - `replaceOrder(customer: { personId: string; organizationId?: string }, orderId: string, input: ReplaceOrderInput): Promise<ReplacedOrderView>`
  - `markOrderReplaced(tx: Prisma.TransactionClient, orderId: string, replacedById: string): Promise<void>`
- Types:
  - `ReplaceOrderInput = Omit<PlaceOrderInput, 'supplier_organization_id' | 'expected_total'> & { expected_total: number }`
  - `ReplacedOrderView = { order: CustomerOrderView; replaced_order_id: string }`
- Errors: `NOT_FOUND` 404, `INVALID_TRANSITION` 409, `TOTAL_CHANGED` 409, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.2: the old version is found through the caller's own relationship; any other id answers 404.
- v5.0.0-15.3.3: strict body; the supplier, status and prices never come from the client.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| replace | integration | AC-1, C-58, CM-16 | O1 cancelled, deleted, linked, hidden; O2 priced, note copied |
| notifications | integration | AC-2 | one order.replaced each; the old one names O2 |
| refusals | integration | AC-3 | each Examples row, nothing changed |
| repeat | integration | AC-4 | same 201, one O2 |
| other customer | security | AB-1, WSTG-ATHZ-04 | 404, unchanged |
| replaced twice | security | AB-2, WSTG-BUSL-06 | 404 |
| extra fields | security | AB-3, WSTG-INPV-20 | 400, unchanged |

Command: `npx vitest run tests/integration/order/replace-order.test.ts`

## Out of scope
- ORD-044, SYNC-045, SYNC-046.

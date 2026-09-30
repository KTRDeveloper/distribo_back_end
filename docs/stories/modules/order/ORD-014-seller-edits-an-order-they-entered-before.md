---
id: ORD-014
title: Seller edits an order they entered, before departure
module: order
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORD-013, ORD-009]
read_first: [src/modules/order/order.service.ts, src/modules/order/order.repository.ts]
design_refs: [commandes-et-livraisons/order, commandes-et-livraisons/orderline]
constraints: [C-18]
asvs: [v5.0.0-2.3.1, v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# ORD-014 — Seller edits an order they entered, before departure

## Story
As a seller, I want to correct an order I entered until it leaves for delivery so that mistakes are fixed before the customer is served.

## Context
- Exists: `enterOrder` (ORD-013); the DB status rules freeze orders that are IN_DELIVERY, DELIVERED or CANCELLED.
- Adds: `PATCH /api/v1/organizations/{organizationId}/orders/{orderId}` with any of `delivery_address`, `delivery_cost`, `desired_delivery_date`, `customer_note` (each nullable to clear) and `lines` (the full new list, same shape as ORD-013); response 200 `projectOrderForSupplier`.
- Only an order with `placed_by_party` SUPPLIER and status CONFIRMED can be edited; otherwise 409 `ORDER_FROZEN`. A `lines` list replaces the old lines (old ones get `deleted_at`), with the same price, product and gap rules as ORD-013, and the total is recomputed in the same transaction.
- Customer-placed orders never change after sending (409 `ORDER_FROZEN`). At least one field is required.
- `C-18`: Status changes follow the permitted steps; delivery wins; a delivered or cancelled order is frozen except `supplier_note`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Edit fields
  When a SELLER changes delivery_cost to 1500 and delivery_address on their CONFIRMED order
  Then the response is 200 and total_amount is lines plus 1500
Scenario: AC-2 Replace lines
  When lines are replaced with two new lines
  Then the old lines are deleted, the new lines carry reference and applied prices, and the total matches
Scenario Outline: AC-3 Frozen
  When the order is <case>
  Then the response is 409 `ORDER_FROZEN` and nothing changes
  Examples:
    | case                                  |
    | IN_DELIVERY                           |
    | DELIVERED                             |
    | CANCELLED                             |
    | placed by the customer                |
Scenario: AC-4 Validation
  When the body is empty, has a status or total_amount, or an INACTIVE product
  Then the response is 400 or 404 and nothing changes
```

## Abuse cases
```gherkin
Scenario: AB-1 Changing a delivered order (tampering)
  When a seller patches a DELIVERED order
  Then the response is 409 and the order is unchanged
Scenario: AB-2 Another business's order (horizontal)
  When a member of A patches an order of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/order/edit-order.test.ts`
- Modify: `src/modules/order/order.routes.ts`, `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`
- Pattern: `src/modules/order/order.routes.ts`
- Signatures:
  - `editOrder(actor: Actor, orderId: string, input: EditOrderInput): Promise<SupplierOrderView>`
- Errors: `ORDER_FROZEN` 409, `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-2.3.1: the order is locked and its status and origin checked before any change.
- v5.0.0-15.3.3: strict schema; totals and amounts are recomputed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| edit fields | integration | AC-1, C-18 | total with new cost |
| replace lines | integration | AC-2 | old deleted, new priced |
| frozen | integration | AC-3 | each Examples row → 409 |
| validation | integration | AC-4 | 400 or 404 |
| delivered order | security | AB-1, CWE-841 | 409, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/order/edit-order.test.ts`

## Out of scope
- The supplier's note, editable at any time (ORD-015).

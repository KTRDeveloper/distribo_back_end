---
id: ORD-007
title: Order calculations and party views
module: order
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORD-004, FND-003]
read_first: [src/shared/money.ts, docs/stories/modules/foundation/contracts.md]
design_refs: [commandes-et-livraisons/orderline, commandes-et-livraisons/order]
constraints: [CM-14, C-19]
asvs: [v5.0.0-2.2.1, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# ORD-007 — Order calculations and party views

## Story
Technical story: provide the pure functions that compute line amounts and totals and the two views of an order, so that every route computes and shows orders the same way.

## Context
- Exists: `lineAmount`, `parseQuantity` (FND-003); order tables (ORD-001, ORD-004).
- Adds: `src/modules/order/order.calculations.ts` (`lineAmountOf`, `orderTotal`) and `src/modules/order/order.views.ts` (`projectOrderForSupplier`, `projectOrderForCustomer`); no database access.
- `lineAmountOf` uses the delivered quantity when set, else the ordered one. `orderTotal` is the sum plus the delivery cost.
- Supplier view: all order fields and lines including `price_set_by_id` and `price_set_at` only for the roles OWNER and MANAGER (the caller passes the role), and `sync_issue`. Customer view: no `entered_by_id`, `delivered_by_id`, `cancelled_by_id`, `sync_issue`, `price_set_by_id`; `placed_by_party` and `cancelled_by_party` stay. Both show each line's `reference_price` and `unit_price_applied` so a gap is visible.
- `CM-14`: Line amount = quantity in thousandths times applied price, divided by 1000, rounded to the nearest franc with 0.5 rounded up, integer arithmetic only; 2.5 x 333 gives 833.
- `C-19`: `delivered_at` and `delivered_by_id` are set if and only if `status` is DELIVERED; every line then has `delivered_quantity`; `total_amount` equals the sum of line amounts plus `delivery_cost`.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Line amount
  When lineAmountOf receives quantity <q>, delivered <d> and price <p>
  Then the result is <amount>
  Examples:
    | q      | d      | p    | amount |
    | 2500   | none   | 333  | 833    |
    | 10000  | 8000   | 3000 | 24000  |
    | 1      | none   | 500  | 1      |
Scenario: AC-2 Total
  When orderTotal receives amounts 15000, 15000 and delivery cost 3000
  Then the result is 33000
Scenario: AC-3 Supplier view by role
  When an order with a price gap is projected for a SELLER, then for an OWNER
  Then price_set_by_id and price_set_at are absent for the SELLER and present for the OWNER
Scenario: AC-4 Customer view
  Then the customer view has none of entered_by_id, delivered_by_id, cancelled_by_id, sync_issue or price_set_by_id and shows reference and applied prices
```

## Abuse cases
```gherkin
Scenario: AB-1 Private fields reach the customer (information disclosure)
  When the customer view of a fully populated order is serialized
  Then no supplier-team person id and no sync issue appears
```

## Implementation
- Create: `src/modules/order/order.calculations.ts`, `src/modules/order/order.views.ts`, `tests/unit/order/calculations-and-views.test.ts`
- Pattern: `src/shared/money.ts`
- Signatures:
  - `lineAmountOf(line: { quantityMilli: bigint; deliveredQuantityMilli?: bigint | null; unitPriceApplied: bigint }): bigint`
  - `orderTotal(amounts: bigint[], deliveryCost: bigint): bigint`
  - `projectOrderForSupplier(order: OrderWithLines, role: Role): SupplierOrderView`
  - `projectOrderForCustomer(order: OrderWithLines): CustomerOrderView`
- Dependencies: none added

## Security
- v5.0.0-8.2.3: views are built from explicit field lists; the price author is role-restricted.
- v5.0.0-15.3.1: no whole-row serialization.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| line amount | unit | AC-1, CM-14 | each Examples row → amount |
| total | unit | AC-2, C-19 | 33000 |
| supplier view | unit | AC-3 | author fields by role |
| customer view | unit | AC-4 | key list |
| private fields | security | AB-1, CWE-200 | serialized view lacks them |

Command: `npx vitest run tests/unit/order/calculations-and-views.test.ts`

## Out of scope
- Routes (ORD-009 onward).

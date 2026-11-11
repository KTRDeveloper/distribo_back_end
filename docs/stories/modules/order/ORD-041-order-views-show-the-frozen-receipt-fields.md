---
id: ORD-041
title: Order views show the frozen receipt fields
module: order
kind: change
rev: 1
amends: [ORD-007]
size: XS
risk: medium
depends_on: [ORD-040]
read_first: [src/modules/order/order.views.ts, tests/unit/sync/controls-words.test.ts]
design_refs: [a8-le-recu-ne-change-plus-point-9/champs-figes-champs-ajoutes-a-order]
constraints: []
asvs: [v5.0.0-15.3.1]
---

# ORD-041 — Order views show the frozen receipt fields

## Story
As a customer, I want an order to show its receipt as it was written at delivery, so that every copy of the receipt is the same.

## Context
- Exists: the four columns (ORD-040); `projectOrderForSupplier(order, role)` and `projectOrderForCustomer(order)` in `order.views.ts` (ORD-007).
- Both views add `supplier_name_applied`, `customer_name_applied`, `collected_applied` and `balance_after_applied`, amounts as numbers like the other amounts, null until delivery.
- In the supplier view, `balance_after_applied` is present for OWNER, MANAGER and SELLER only; for DRIVER and any other or unknown role the key is absent (deny by default).
- `order.openapi.ts`: both view schemas list the four fields as read-only.

## Acceptance criteria
```gherkin
Scenario: AC-1 A delivered order shows its receipt
  Given a DELIVERED order with supplier "Dépôt Test", customer "Boutique Test", collected 5000 and balance after 10500
  When the customer view is built
  Then it carries these four values
Scenario Outline: AC-2 The debt after delivery by role
  When the supplier view is built for <role>
  Then `balance_after_applied` is <shown>
  Examples:
    | role    | shown   |
    | OWNER   | 10500   |
    | MANAGER | 10500   |
    | SELLER  | 10500   |
    | DRIVER  | absent  |
Scenario: AC-3 Not delivered yet
  When a PENDING order's views are built
  Then the four fields are null
Scenario: AC-4 Documented
  When the OpenAPI document is generated
  Then both order view schemas list the four fields
```

## Abuse cases
```gherkin
Scenario: AB-1 An unexpected role
  When the supplier view is built for a role that is not OWNER, MANAGER or SELLER
  Then `balance_after_applied` is absent
```

## Implementation
- Create: `tests/unit/order/receipt-views.test.ts`
- Modify: `src/modules/order/order.views.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `tests/unit/sync/controls-words.test.ts`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: views list their fields explicitly; the driver never receives the customer's debt.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| customer view | unit | AC-1 | four values present |
| roles | unit | AC-2 | each Examples row → value or absent key |
| not delivered | unit | AC-3 | four nulls |
| documented | unit | AC-4 | generated document lists the four fields in both view schemas |
| unexpected role | security | AB-1, WSTG-ATHZ-02 | key absent |

Command: `npx vitest run tests/unit/order/receipt-views.test.ts tests/unit/order/calculations-and-views.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/order/calculations-and-views.test.ts | asserts the exact keys of the order views | the keys also include the four receipt fields; a DRIVER view has no `balance_after_applied` |

## Out of scope
- Sync rows (SYNC-048) and writing the fields (DLV-019).

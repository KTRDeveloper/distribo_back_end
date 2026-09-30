---
id: ORD-002
title: Order status, cancellation and delivery rules in the database
module: order
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ORD-001]
read_first: [prisma/schema.prisma, tests/integration/order/order-table.test.ts]
design_refs: [commandes-et-livraisons/order, contraintes-a-poser-au-niveau-base-de]
constraints: [C-16, C-17, C-18, C-19, CM-12]
asvs: [v5.0.0-2.3.1, v5.0.0-2.2.3]
---

# ORD-002 — Order status, cancellation and delivery rules in the database

## Story
Technical story: enforce the order status rules with CHECKs and a transition trigger, so that no code path can skip a step or change a frozen order.

## Context
- Exists: `orders` (ORD-001).
- Adds: one migration. CHECKs: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are all set exactly when `status = 'CANCELLED'`; `cancellation_reason` is null unless CANCELLED and not null when `cancelled_by_party = 'SUPPLIER'`; `status = 'PENDING'` requires `placed_by_party = 'CUSTOMER'`; `delivered_at` and `delivered_by_id` are both set exactly when `status = 'DELIVERED'`.
- A BEFORE UPDATE trigger allows only these status steps: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED; CANCELLED to DELIVERED is allowed only when `sync_issue` is set in the same update (delivery wins over an earlier cancellation, and the cancellation columns are cleared); DELIVERED to CANCELLED is refused; a row that is DELIVERED or CANCELLED may otherwise change only `supplier_note`, `sync_issue` and `server_updated_at`. Anything else raises SQLSTATE 23514.
- `C-16`: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are set if and only if `status` is CANCELLED; `cancellation_reason` only when CANCELLED and required when the supplier cancelled.
- `C-17`: `status` PENDING requires `placed_by_party` CUSTOMER.
- `C-18`: Status changes follow the permitted steps; delivery wins; a delivered or cancelled order is frozen except `supplier_note`.
- `C-19`: `delivered_at` and `delivered_by_id` are set if and only if `status` is DELIVERED; every line then has `delivered_quantity`; `total_amount` equals the sum of line amounts plus `delivery_cost`.
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Cancellation columns
  When a row has status <status> and <cancel>
  Then the statement <result>
  Examples:
    | status    | cancel                                                | result          |
    | CANCELLED | party, person and time set, reason set                | accepts         |
    | CANCELLED | party SUPPLIER, reason empty                          | rejects (23514) |
    | CANCELLED | party CUSTOMER, reason empty                          | accepts         |
    | CANCELLED | time empty                                            | rejects (23514) |
    | CONFIRMED | cancelled_by_party set                                | rejects (23514) |
    | CONFIRMED | cancellation_reason set                               | rejects (23514) |
Scenario: AC-2 PENDING is the customer's
  When a row has status PENDING and placed_by_party SUPPLIER
  Then the insert fails with 23514
Scenario: AC-3 Delivery columns
  Then `delivered_at` and `delivered_by_id` are required for DELIVERED and refused for every other status
Scenario Outline: AC-4 Steps
  When an order goes from <from> to <to>
  Then the update <result>
  Examples:
    | from        | to          | result          |
    | PENDING     | CONFIRMED   | accepts         |
    | PENDING     | CANCELLED   | accepts         |
    | PENDING     | DELIVERED   | rejects (23514) |
    | CONFIRMED   | IN_DELIVERY | accepts         |
    | CONFIRMED   | DELIVERED   | accepts         |
    | IN_DELIVERY | CONFIRMED   | accepts         |
    | IN_DELIVERY | CANCELLED   | rejects (23514) |
    | DELIVERED   | CANCELLED   | rejects (23514) |
    | CANCELLED   | CONFIRMED   | rejects (23514) |
    | CANCELLED   | DELIVERED, sync_issue set    | accepts         |
    | CANCELLED   | DELIVERED, sync_issue empty  | rejects (23514) |
Scenario: AC-5 Frozen orders
  When a DELIVERED order gets a new `delivery_cost`, and then a new `supplier_note`
  Then the first update fails with 23514 and the second succeeds
```

## Abuse cases
```gherkin
Scenario: AB-1 Reviving or altering a finished order (tampering)
  When code moves a CANCELLED order back to CONFIRMED or edits a DELIVERED order's cost
  Then PostgreSQL refuses it, even though no validation ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_002_status_rules/migration.sql`, `tests/integration/order/status-rules.test.ts`
- Pattern: `tests/integration/relationship/party-rules.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.3.1: the permitted steps live in the database, so every path obeys them.
- v5.0.0-2.2.3: related columns are checked together.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| cancellation columns | integration | AC-1, C-16 | each Examples row → accepted or 23514 |
| pending is customer's | integration | AC-2, C-17 | 23514 |
| delivery columns | integration | AC-3, C-19 | required for DELIVERED, refused otherwise |
| steps | integration | AC-4, C-18, CM-12 | each Examples row → accepted or 23514 |
| frozen | integration | AC-5, C-18 | cost refused, note accepted |
| crafted update | security | AB-1, CWE-841 | revive and edit both refused |

Command: `npx vitest run tests/integration/order/status-rules.test.ts`

## Out of scope
- Applying the steps from routes (ORD-008).

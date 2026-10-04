---
id: DLV-002
title: Delivery state rules in the database
module: delivery
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [DLV-001, ORG-003, ORD-003]
read_first: [prisma/schema.prisma, tests/integration/delivery/delivery-table.test.ts]
design_refs: [commandes-et-livraisons/delivery, contraintes-a-poser-au-niveau-base-de]
constraints: [C-21]
asvs: [v5.0.0-2.3.1, v5.0.0-2.2.3]
---

# DLV-002 — Delivery state rules in the database

## Story
Technical story: enforce the delivery states, the driver's membership and one delivery in progress per order in the database.

## Context
- Exists: `deliveries` (DLV-001), `collaborations`.
- Adds: one migration. CHECKs: `arrived_at` and `failed_at` are not both set; `failure_reason` is set exactly when `failed_at` is set. Partial unique index on `order_id` where `arrived_at` and `failed_at` are null and `deleted_at` is null. A BEFORE INSERT trigger requires an ACTIVE collaboration of `assigned_to_id` in the supplier organization of the order's relationship (any role is driver or above).
- `C-21`: A delivery's `assigned_to_id` is an ACTIVE collaborator of the supplier, driver or above; `arrived_at` and `failed_at` are never both set; `failure_reason` is set if and only if `failed_at` is set; at most one delivery in progress (neither arrived nor failed) per order.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 State rules
  When a delivery row has <values>
  Then the statement <result>
  Examples:
    | values                                                  | result          |
    | arrived_at and failed_at both set                       | rejects (23514) |
    | failed_at set, failure_reason "client absent"           | accepts         |
    | failed_at set, failure_reason empty                     | rejects (23514) |
    | failure_reason set, failed_at empty                     | rejects (23514) |
    | arrived_at set only                                     | accepts         |
Scenario Outline: AC-2 One in progress
  When a second delivery is inserted for an order whose first delivery is <first>
  Then the insert <result>
  Examples:
    | first                        | result          |
    | in progress                  | rejects (23505) |
    | failed                       | accepts         |
    | arrived                      | accepts         |
    | deleted                      | accepts         |
Scenario Outline: AC-3 Driver membership
  When the assigned person is <person>
  Then the insert <result>
  Examples:
    | person                                        | result          |
    | an ACTIVE DRIVER of the supplier              | accepts         |
    | an ACTIVE SELLER of the supplier              | accepts         |
    | a REVOKED or INVITED collaborator             | rejects (23514) |
    | an ACTIVE collaborator of another business    | rejects (23514) |
```

## Abuse cases
```gherkin
Scenario: AB-1 Two drivers on one order by a crafted write (tampering)
  When code inserts a second in-progress delivery
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_dlv_002_delivery_rules/migration.sql`, `tests/integration/delivery/delivery-rules.test.ts`
- Pattern: `tests/integration/order/creation-guard.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.3.1: one delivery in progress is a unique index.
- v5.0.0-2.2.3: membership is checked in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| state rules | integration | AC-1, C-21 | each Examples row → accepted or 23514 |
| one in progress | integration | AC-2, C-21 | each Examples row → accepted or 23505 |
| membership | integration | AC-3, C-21 | each Examples row → accepted or 23514 |
| second delivery | security | AB-1, CWE-362 | 23505 |

Command: `npx vitest run tests/integration/delivery/delivery-rules.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/delivery-table.test.ts › `beforeEach` | its drivers (`OWNER_ID`, `CUSTOMER_ID`) have no collaboration with `SUPPLIER_ORG_ID`, so the membership trigger answers 23514 | after the organization insert, one INSERT adds two ACTIVE collaborations in `SUPPLIER_ORG_ID`: `OWNER_ID` as OWNER and `CUSTOMER_ID` as DRIVER (one statement, so the organization has exactly one active owner when the transaction is saved) |
| tests/integration/delivery/delivery-table.test.ts › "stores a delivery with empty attempt columns and a server time" | fails only through the fixture above | unchanged; passes with the new `beforeEach` |
| tests/integration/delivery/delivery-table.test.ts › "moves server_updated_at forward on update" | fails only through the fixture above | unchanged; passes with the new `beforeEach` |
| tests/integration/delivery/delivery-table.test.ts › "accepts a registered driver" | fails only through the fixture above | unchanged; passes with the new `beforeEach` |
| tests/integration/delivery/delivery-table.test.ts › "allows several attempts for the same order" | inserts two deliveries in progress for the same order, so the one-in-progress index answers 23505 | before the second insert, the first delivery is updated with `failed_at = now()` and a non-blank `failure_reason`; the second insert still resolves to 1 |

## Out of scope
- Routes (DLV-003 onward).

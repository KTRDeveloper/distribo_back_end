---
id: ORD-003
title: Orders only on live relationships of active organizations
module: order
kind: technical
rev: 1
amends: []
size: XS
risk: high
depends_on: [ORD-001, ORG-001, ORD-002]
read_first: [prisma/schema.prisma, tests/integration/order/order-table.test.ts]
design_refs: [commandes-et-livraisons/order/autres-regles, contraintes-a-poser-au-niveau-base-de]
constraints: [C-14]
asvs: [v5.0.0-2.3.1, v5.0.0-2.2.3]
---

# ORD-003 — Orders only on live relationships of active organizations

## Story
Technical story: refuse in the database an order on a relationship that is not ACTIVE or whose supplier is not an active organization.

## Context
- Exists: `orders`, `customer_relationships` (status), `organizations` (status).
- Adds: a BEFORE INSERT trigger on `orders`: the relationship must have `status = 'ACTIVE'`, no `deleted_at`, `supplier_organization_id` not null, and that organization `ACTIVE`; otherwise SQLSTATE 23514. It applies to inserts only, so old orders of a closed business stay valid.
- Counters (relationships without a customer) are allowed.
- `C-14`: An order is created only on an ACTIVE relationship whose supplier is an ACTIVE organization (not suspended, not closed).

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Relationship and supplier state
  When an order is inserted on a relationship <case>
  Then the insert <result>
  Examples:
    | case                                             | result          |
    | ACTIVE, supplier organization ACTIVE             | accepts         |
    | PENDING                                          | rejects (23514) |
    | ENDED                                            | rejects (23514) |
    | ACTIVE with the supplier organization SUSPENDED  | rejects (23514) |
    | ACTIVE with the supplier organization CLOSED     | rejects (23514) |
    | deleted                                          | rejects (23514) |
    | a counter of an ACTIVE organization              | accepts         |
Scenario: AC-2 Old orders stay
  When an organization is closed after it received orders
  Then updating a `supplier_note` on an old order still works
```

## Abuse cases
```gherkin
Scenario: AB-1 Order on a blocked relationship by a crafted write (tampering)
  When code inserts an order on an ENDED relationship
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_ord_003_creation_guard/migration.sql`, `tests/integration/order/creation-guard.test.ts`
- Pattern: `tests/integration/order/status-rules.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.3.1: the business rule holds for every insert path, including sync.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| creation states | integration | AC-1, C-14 | each Examples row → accepted or 23514 |
| old orders | integration | AC-2 | note update works |
| crafted insert | security | AB-1, CWE-841 | 23514 |

Command: `npx vitest run tests/integration/order/creation-guard.test.ts`

## Out of scope
- Refusing pending orders when a business closes (ORD-018).

---
id: DLV-001
title: Deliveries table
module: delivery
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORD-001, PER-008, FND-002]
read_first: [prisma/schema.prisma, tests/integration/order/order-table.test.ts]
design_refs: [commandes-et-livraisons/delivery, contraintes-a-poser-au-niveau-base-de]
constraints: ['Delivery:required', 'Delivery:fk', C-01, C-35, C-04]
asvs: [v5.0.0-2.2.3]
---

# DLV-001 — Deliveries table

## Story
Technical story: create the deliveries table, one row per attempt, so that transport of goods can be recorded.

## Context
- Exists: `orders`, `require_registered_person()`, `set_server_updated_at()`.
- Adds: table `deliveries` with `server_updated_at` and `deleted_at`, foreign keys, indexes on `order_id` and (`assigned_to_id`, `departed_at`), triggers `require_registered_person('assigned_to_id')` and `set_server_updated_at()`.
- Rules follow in DLV-002.
- `Delivery` fields: `order_id` FK → Order; `assigned_to_id` FK → Person; `departed_at` datetime, nullable; `arrived_at` datetime, nullable; `failed_at` datetime, nullable; `failure_reason` string, nullable; `sync_issue` string, nullable
- `Delivery:required`: NOT NULL: `order_id`, `assigned_to_id`
- `Delivery:fk`: references order_id → Order; assigned_to_id → Person
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario: AC-1 Row
  When a delivery is inserted for an order and a registered driver
  Then the row is stored with `departed_at`, `arrived_at` and `failed_at` empty and `server_updated_at` set
Scenario Outline: AC-2 Keys and author
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                           | result          |
    | an unknown order                 | rejects (23503) |
    | assigned_to_id of a guest        | rejects (23514) |
    | assigned_to_id null              | rejects (23502) |
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_dlv_001_deliveries/migration.sql`, `tests/integration/delivery/delivery-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/order/order-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: keys and author are checked by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| row | integration | AC-1, C-01, C-35 | stored; column types; server time |
| keys and author | integration | AC-2, Delivery:required, Delivery:fk, C-04 | each Examples row → rejected |

Command: `npx vitest run tests/integration/delivery/delivery-table.test.ts`

## Out of scope
- State rules (DLV-002).

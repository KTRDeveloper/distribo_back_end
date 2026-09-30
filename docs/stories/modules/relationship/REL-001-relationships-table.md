---
id: REL-001
title: Relationships table
module: relationship
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-001, PER-008, FND-005, ORG-003]
read_first: [prisma/schema.prisma, tests/integration/organization/collaboration-table.test.ts]
design_refs: [relations-commerciales/customerrelationship, contraintes-a-poser-au-niveau-base-de]
constraints: ['CustomerRelationship:required', 'CustomerRelationship.status:enum', 'CustomerRelationship.ended_by_party:enum', 'CustomerRelationship:fk', C-01, C-35]
asvs: [v5.0.0-2.2.3]
---

# REL-001 — Relationships table

## Story
Technical story: create the relationships table with its columns, keys and indexes so that suppliers and customers can be linked.

## Context
- Exists: `people`, `organizations`, `require_registered_person()`, `set_server_updated_at()`.
- Adds: table `customer_relationships` with `balance` bigint default 0, `status` default ACTIVE, `server_updated_at` and `deleted_at`, foreign keys (including `merged_into_id` to itself), indexes on each party column, and the triggers `require_registered_person('created_by_id', 'credit_limit_set_by_id')` and `set_server_updated_at()`.
- Party, pair, status and credit rules follow in REL-002 and REL-004.
- `CustomerRelationship` fields: `supplier_organization_id` FK → Organization, nullable; `supplier_person_id` FK → Person, nullable; `customer_person_id` FK → Person, nullable; `customer_organization_id` FK → Organization, nullable; `customer_phone_number` string, nullable; `customer_label` string, nullable; `supplier_label` string, nullable; `delivery_address` string, nullable; `credit_limit` bigint, nullable; `credit_limit_set_by_id` FK → Person, nullable; `credit_limit_set_at` datetime, nullable; `balance` bigint; `status` enum [PENDING / ACTIVE / ENDED]; `ended_by_party` enum [CUSTOMER / SUPPLIER], nullable; `supplier_notes` text, nullable; `created_by_id` FK → Person; `created_at` datetime; `merged_into_id` FK → CustomerRelationship, nullable
- `CustomerRelationship:required`: NOT NULL: `balance`, `status`, `created_by_id`, `created_at`
- `CustomerRelationship.status:enum`: one of PENDING, ACTIVE, ENDED
- `CustomerRelationship.ended_by_party:enum`: one of CUSTOMER, SUPPLIER
- `CustomerRelationship:fk`: references supplier_organization_id → Organization; supplier_person_id → Person; customer_person_id → Person; customer_organization_id → Organization; credit_limit_set_by_id → Person; created_by_id → Person; merged_into_id → CustomerRelationship
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Defaults
  When a relationship is inserted with a supplier organization and a customer person
  Then `status` is ACTIVE, `balance` is 0, `created_at` and `server_updated_at` are set
Scenario Outline: AC-2 Enums and keys
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                               | result  |
    | status ENDED                         | accepts |
    | status "BLOCKED"                     | rejects |
    | ended_by_party "PLATFORM"            | rejects |
    | an unknown supplier organization     | rejects (23503) |
    | created_by_id of a guest             | rejects (23514) |
Scenario: AC-3 Required
  When `created_by_id` is null
  Then the insert fails with 23502
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_001_relationships/migration.sql`, `tests/integration/relationship/relationship-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/collaboration-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: enums, keys and author checks are enforced by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, C-01, C-35 | insert → defaults; column types; server time |
| enums and keys | integration | AC-2, CustomerRelationship.status:enum, CustomerRelationship.ended_by_party:enum, CustomerRelationship:fk | each Examples row → accepted or rejected |
| required | integration | AC-3, CustomerRelationship:required | null created_by_id → 23502 |

Command: `npx vitest run tests/integration/relationship/relationship-table.test.ts`

## Out of scope
- Party, pair, status and credit rules (REL-002, REL-004).

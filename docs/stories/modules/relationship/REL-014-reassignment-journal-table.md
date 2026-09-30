---
id: REL-014
title: Reassignment journal table
module: relationship
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [REL-002, FND-002, PER-008, REL-003]
read_first: [prisma/schema.prisma, tests/integration/relationship/credit-limit-changes-table.test.ts]
design_refs: [relations-commerciales/customerrelationshipreassignment]
constraints: ['CustomerRelationshipReassignment:required', 'CustomerRelationshipReassignment:fk', C-12, C-04, C-35, C-32, C-39]
asvs: [v5.0.0-8.3.1, v5.0.0-16.3.3]
---

# REL-014 — Reassignment journal table

## Story
Technical story: create the immutable journal of customer changes on a relationship so that every correction and contestation is traceable.

## Context
- Exists: `customer_relationships` (REL-001), role `distribo_app`, `require_registered_person()`.
- Adds: table `customer_relationship_reassignments` with `server_updated_at`, triggers `require_registered_person('reassigned_by_id')` and `set_server_updated_at()`, `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`.
- A contestation is a row whose `reassigned_by_id` equals `previous_person_id`. A partial unique index on (`customer_relationship_id`, `previous_person_id`) where `reassigned_by_id = previous_person_id` allows one contestation per relationship and person.
- `CustomerRelationshipReassignment` fields: `customer_relationship_id` FK → CustomerRelationship; `previous_person_id` FK → Person; `new_person_id` FK → Person; `reassigned_by_id` FK → Person; `reason` text, nullable; `reassigned_at` datetime
- `CustomerRelationshipReassignment:required`: NOT NULL: `customer_relationship_id`, `previous_person_id`, `new_person_id`, `reassigned_by_id`, `reassigned_at`
- `CustomerRelationshipReassignment:fk`: references customer_relationship_id → CustomerRelationship; previous_person_id → Person; new_person_id → Person; reassigned_by_id → Person
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; one contestation per relationship and person; the journal is never modified.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `C-32`: Immutable journals are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rows can be added and read
  When the application account inserts a row and selects it
  Then both succeed and `server_updated_at` is set
Scenario: AC-2 Rows cannot change
  When the application account runs UPDATE or DELETE
  Then PostgreSQL answers permission denied (42501)
Scenario Outline: AC-3 Contestation rule
  When a second row for the same relationship and previous person has <values>
  Then the insert <result>
  Examples:
    | values                                                  | result          |
    | reassigned_by_id equal to previous_person_id (both)     | rejects (23505) |
    | reassigned_by_id another person (a correction)          | accepts         |
Scenario: AC-4 Required and keys
  When `new_person_id` is null, the relationship is unknown, or `reassigned_by_id` is a guest
  Then the insert fails with 23502, 23503 or 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 Erasing a contestation (repudiation)
  When code running as the application account deletes a row
  Then the delete is refused and the row remains
```

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_014_reassignments/migration.sql`, `tests/integration/relationship/reassignment-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/relationship/credit-limit-changes-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.3.1: only INSERT and SELECT are granted to `distribo_app`.
- v5.0.0-16.3.3: the journal keeps who moved a relationship and why.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and read | integration | AC-1, C-35 | as `distribo_app` → row with server time |
| immutable | security | AC-2, AB-1, C-32, C-39, WSTG-ATHZ-03 | UPDATE, DELETE → 42501 |
| contestation rule | integration | AC-3, C-12 | each Examples row → accepted or 23505 |
| required and keys | integration | AC-4, CustomerRelationshipReassignment:required, CustomerRelationshipReassignment:fk, C-04 | rejected |

Command: `npx vitest run tests/integration/relationship/reassignment-table.test.ts`

## Out of scope
- Writing rows (REL-023, REL-024).

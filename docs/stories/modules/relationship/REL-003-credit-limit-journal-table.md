---
id: REL-003
title: Credit limit journal table
module: relationship
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [REL-001, FND-002, PER-008, PER-004]
read_first: [prisma/schema.prisma, tests/integration/person/phone-change-log.test.ts]
design_refs: [relations-commerciales/creditlimitchange]
constraints: ['CreditLimitChange:required', 'CreditLimitChange:fk', C-32, C-39, C-04, C-35]
asvs: [v5.0.0-8.3.1, v5.0.0-16.3.3]
---

# REL-003 — Credit limit journal table

## Story
Technical story: create the immutable journal of credit limits so that every change of the riskiest setting can be traced.

## Context
- Exists: `customer_relationships` (REL-001), role `distribo_app`, `getAppRolePrisma()`.
- Adds: table `credit_limit_changes` with `previous_limit` and `new_limit` nullable (empty means no ceiling), `server_updated_at`, triggers `require_registered_person('set_by_id')` and `set_server_updated_at()`, and `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`.
- `CreditLimitChange` fields: `customer_relationship_id` FK → CustomerRelationship; `previous_limit` bigint, nullable; `new_limit` bigint, nullable; `set_by_id` FK → Person; `set_at` datetime
- `CreditLimitChange:required`: NOT NULL: `customer_relationship_id`, `set_by_id`, `set_at`
- `CreditLimitChange:fk`: references customer_relationship_id → CustomerRelationship; set_by_id → Person
- `C-32`: Immutable journals are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rows can be added and read
  When the application account inserts a row and selects it
  Then both succeed and `server_updated_at` is set
Scenario: AC-2 Rows cannot change
  When the application account runs UPDATE or DELETE on a row
  Then PostgreSQL answers permission denied (42501)
Scenario Outline: AC-3 Limits may be empty
  When a row has previous_limit <previous> and new_limit <new>
  Then the insert <result>
  Examples:
    | previous | new    | result  |
    | 0        | 50000  | accepts |
    | 50000    | empty  | accepts |
    | empty    | 100000 | accepts |
Scenario: AC-4 Author and relationship
  When `set_by_id` is a guest, or the relationship id is unknown
  Then the insert fails with 23514 or 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 Rewriting a credit decision (repudiation)
  When code running as the application account edits `new_limit`
  Then the change is refused and the row is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_rel_003_credit_limit_changes/migration.sql`, `tests/integration/relationship/credit-limit-changes-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/person/phone-change-log.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.3.1: only INSERT and SELECT are granted to `distribo_app`.
- v5.0.0-16.3.3: each credit decision has an author and a server time.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and read | integration | AC-1, CreditLimitChange:required, C-35 | as `distribo_app` → row with server time |
| immutable | security | AC-2, AB-1, C-32, C-39, WSTG-ATHZ-03 | UPDATE, DELETE → 42501 |
| empty limits | integration | AC-3 | each Examples row → accepted |
| author and key | integration | AC-4, C-04, CreditLimitChange:fk | guest → 23514; unknown relationship → 23503 |

Command: `npx vitest run tests/integration/relationship/credit-limit-changes-table.test.ts`

## Out of scope
- Writing rows: the trigger in REL-004 and the route in REL-012.

---
id: FIN-011
title: Expenses table
module: finance
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-003, PER-008, FND-002]
read_first: [prisma/schema.prisma, tests/integration/organization/collaboration-table.test.ts]
design_refs: [finances/expense, contraintes-a-poser-au-niveau-base-de]
constraints: ['Expense:required', 'Expense:fk', C-27, C-04]
asvs: [v5.0.0-2.2.3, v5.0.0-8.3.1]
---

# FIN-011 — Expenses table

## Story
Technical story: create the expenses table that is never edited and can only be cancelled once, so that money leaving the business stays traceable.

## Context
- Exists: `organizations`, `collaborations`, `require_registered_person()`, `set_server_updated_at()`.
- Adds: table `expenses` with `server_updated_at` and `deleted_at`, triggers `require_registered_person('paid_by_id', 'recorded_by_id', 'cancelled_by_id')` and `set_server_updated_at()`.
- CHECKs: `amount > 0`; `cancelled_at` and `cancelled_by_id` both set or both null. A trigger requires that `paid_by_id` has a collaboration row (any status) in the organization. A BEFORE UPDATE trigger allows only setting `cancelled_at` and `cancelled_by_id` once (from null); every other change raises 23514.
- `Expense` fields: `organization_id` FK → Organization; `paid_by_id` FK → Person; `amount` bigint; `category` string, nullable; `description` text, nullable; `recorded_by_id` FK → Person; `occurred_at` datetime; `cancelled_at` datetime, nullable; `cancelled_by_id` FK → Person, nullable
- `Expense:required`: NOT NULL: `organization_id`, `paid_by_id`, `amount`, `recorded_by_id`, `occurred_at`
- `Expense:fk`: references organization_id → Organization; paid_by_id → Person; recorded_by_id → Person; cancelled_by_id → Person
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Insert rules
  When an expense is inserted with <values>
  Then the insert <result>
  Examples:
    | values                                          | result          |
    | amount 5000, paid by an ACTIVE collaborator     | accepts         |
    | paid by a REVOKED collaborator                  | accepts         |
    | paid by a person who never collaborated         | rejects (23514) |
    | amount 0                                        | rejects (23514) |
    | cancelled_at set without cancelled_by_id        | rejects (23514) |
    | recorded_by_id of a guest                       | rejects (23514) |
Scenario: AC-2 Cancel once
  When cancelled_at and cancelled_by_id are set, and then set again
  Then the first update succeeds and the second fails with 23514
Scenario: AC-3 Never edited
  When the amount, the payer or the category of an expense changes
  Then the update fails with 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 Changing an expense after the fact (tampering)
  When code lowers the amount of an existing expense
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_fin_011_expenses/migration.sql`, `tests/integration/finance/expense-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/collaboration-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: payer, amount and cancellation are checked together.
- v5.0.0-8.3.1: edits are refused by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert rules | integration | AC-1, C-27, C-04, Expense:required, Expense:fk | each Examples row → accepted or 23514 |
| cancel once | integration | AC-2 | 23514 second time |
| never edited | integration | AC-3 | 23514 |
| tampering | security | AB-1, CWE-345 | refused |

Command: `npx vitest run tests/integration/finance/expense-table.test.ts`

## Out of scope
- Routes (FIN-012, FIN-013).

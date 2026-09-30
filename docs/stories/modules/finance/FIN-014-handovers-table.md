---
id: FIN-014
title: Handovers table
module: finance
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [FIN-011]
read_first: [prisma/schema.prisma, tests/integration/finance/expense-table.test.ts]
design_refs: [finances/handover, contraintes-a-poser-au-niveau-base-de]
constraints: ['Handover:required', 'Handover:fk', C-27, C-04]
asvs: [v5.0.0-2.2.3, v5.0.0-8.3.1]
---

# FIN-014 — Handovers table

## Story
Technical story: create the handovers table so that money passing between collaborators is recorded and can only be cancelled once.

## Context
- Exists: `expenses` and its triggers (FIN-011).
- Adds: table `handovers` with `server_updated_at` and `deleted_at`, triggers `require_registered_person('to_person_id', 'cancelled_by_id', 'from_person_id')` and `set_server_updated_at()`. CHECK `amount > 0`; cancellation pair; `from_person_id` must have a collaboration row (any status) in the organization; `to_person_id` must have an ACTIVE OWNER or MANAGER collaboration; the same one-time-cancel trigger as expenses. `from_person_id` may equal `to_person_id` (the automatic handover of FIN-017); the routes refuse it.
- `Handover` fields: `organization_id` FK → Organization; `from_person_id` FK → Person; `to_person_id` FK → Person; `amount` bigint; `occurred_at` datetime; `cancelled_at` datetime, nullable; `cancelled_by_id` FK → Person, nullable
- `Handover:required`: NOT NULL: `organization_id`, `from_person_id`, `to_person_id`, `amount`, `occurred_at`
- `Handover:fk`: references organization_id → Organization; from_person_id → Person; to_person_id → Person; cancelled_by_id → Person
- `C-27`: `Expense.amount` > 0 and `paid_by_id` is a collaborator of the organization, active or gone; `Handover.amount` > 0, `from_person_id` a collaborator active or gone, `from_person_id` differs from `to_person_id` except the former owner's automatic handover, `to_person_id` an ACTIVE OWNER or MANAGER; expenses and handovers are never modified, only cancelled once with `cancelled_at` and `cancelled_by_id` set together.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Insert rules
  When a handover is inserted with <values>
  Then the insert <result>
  Examples:
    | values                                            | result          |
    | from a SELLER to the OWNER                        | accepts         |
    | from a REVOKED driver to a MANAGER                | accepts         |
    | to a SELLER                                       | rejects (23514) |
    | to an INVITED or REVOKED manager                  | rejects (23514) |
    | from a person who never collaborated              | rejects (23514) |
    | amount 0                                          | rejects (23514) |
    | from equal to to (an owner to themselves)         | accepts         |
Scenario: AC-2 Cancel once and never edit
  Then cancelling works once and any other change fails with 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 Handing money to someone who cannot receive it (tampering)
  When code inserts a handover to a driver
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_fin_014_handovers/migration.sql`, `tests/integration/finance/handover-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/finance/expense-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: sender and receiver roles are checked in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert rules | integration | AC-1, C-27, C-04, Handover:required, Handover:fk | each Examples row → accepted or 23514 |
| cancel once | integration | AC-2 | as described |
| wrong receiver | security | AB-1, CWE-284 | refused |

Command: `npx vitest run tests/integration/finance/handover-table.test.ts`

## Out of scope
- Routes (FIN-015, FIN-016).

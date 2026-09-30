---
id: ORG-003
title: Collaborations table
module: organization
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-001, PER-008, FND-005]
read_first: [prisma/schema.prisma, tests/integration/person/registered-guard.test.ts]
design_refs: [identite-et-organisation/collaboration, contraintes-a-poser-au-niveau-base-de]
constraints: ['Collaboration:required', 'Collaboration.role:enum', 'Collaboration.status:enum', 'Collaboration:fk', C-05, CM-09, C-01, C-35]
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.3]
---

# ORG-003 — Collaborations table

## Story
Technical story: create the collaborations table with the ownership and public-contact rules in the database, so that roles cannot be corrupted by any code path.

## Context
- Exists: `people`, `organizations`, `require_registered_person()`.
- Adds: table `collaborations` (`is_public_contact` default false, `amount_held` bigint default 0, `invited_at` default now) with `server_updated_at` and `deleted_at`, unique (`person_id`, `organization_id`), partial unique index on (`organization_id`) where `role = 'OWNER'` and `status = 'ACTIVE'`.
- A trigger refuses `status = ACTIVE` for a person with empty `registered_at`, and `is_public_contact = true` unless the collaboration is ACTIVE and the person's `phone_number` is not null.
- A deferred constraint trigger checks that an organization with any collaboration has exactly one ACTIVE OWNER when the transaction ends.
- A trigger on `people` clears `is_public_contact` on the person's collaborations when their `phone_number` becomes null.
- `Collaboration` fields: `person_id` FK → Person; `organization_id` FK → Organization; `role` enum [OWNER / MANAGER / SELLER / DRIVER]; `status` enum [INVITED / ACTIVE / REVOKED]; `is_public_contact` boolean; `invited_at` datetime; `accepted_at` datetime, nullable; `amount_held` bigint
- `Collaboration:required`: NOT NULL: `person_id`, `organization_id`, `role`, `status`, `is_public_contact`, `invited_at`, `amount_held`
- `Collaboration.role:enum`: one of OWNER, MANAGER, SELLER, DRIVER
- `Collaboration.status:enum`: one of INVITED, ACTIVE, REVOKED
- `Collaboration:fk`: references person_id → Person; organization_id → Organization
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.
- `CM-09`: The OWNER can be neither demoted nor revoked; an ownership transfer makes the chosen ACTIVE collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Table rules
  When a collaboration is inserted with <values>
  Then the database <result>
  Examples:
    | values                                                        | result          |
    | a second row for the same person and organization             | rejects (23505) |
    | status ACTIVE for a guest                                     | rejects (23514) |
    | status INVITED for a guest                                    | accepts         |
    | is_public_contact true, INVITED                               | rejects (23514) |
    | is_public_contact true, ACTIVE, person with an active number  | accepts         |
    | role "BOSS"                                                   | rejects         |
Scenario: AC-2 Exactly one owner
  When an organization gets a second ACTIVE OWNER, or its only OWNER row is set to MANAGER, then the transaction commits
  Then the commit fails
Scenario: AC-3 Ownership swap
  When one transaction makes the OWNER a MANAGER and another ACTIVE collaborator the OWNER
  Then the commit succeeds
Scenario: AC-4 Number released
  When a person's `phone_number` becomes null
  Then their collaborations have `is_public_contact` false
```

## Abuse cases
```gherkin
Scenario: AB-1 Owner removed by a crafted write (elevation)
  When code sets the only OWNER's status to REVOKED and commits
  Then PostgreSQL refuses the commit
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_003_collaborations/migration.sql`, `tests/integration/organization/collaboration-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/person/person-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.2.1: role and status rules live in the database, not only in routes.
- v5.0.0-2.2.3: related columns are checked together by triggers.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| table rules | integration | AC-1, C-05, Collaboration:required, Collaboration.role:enum, Collaboration.status:enum, Collaboration:fk | each Examples row → accepted or rejected |
| one owner | integration | AC-2, C-05, CM-09 | second owner or owner demotion → commit error |
| swap | integration | AC-3, CM-09 | one transaction swap → commit succeeds |
| number released | integration | AC-4, C-05 | update people.phone_number to null → flag false |
| column types and defaults | integration | AC-1, C-01, C-35 | `expectColumnType` on ids and `amount_held`; `amount_held` defaults to 0; `server_updated_at` set |
| crafted owner removal | security | AB-1, CWE-269 | REVOKED only owner → commit refused |

Command: `npx vitest run tests/integration/organization/collaboration-table.test.ts`

## Out of scope
- Routes that write collaborations (ORG-004 onward).

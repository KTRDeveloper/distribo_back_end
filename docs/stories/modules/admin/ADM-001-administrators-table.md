---
id: ADM-001
title: Administrators table
module: admin
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [PER-008, FND-005, ORG-003]
read_first: [prisma/schema.prisma, tests/integration/person/registered-guard.test.ts]
design_refs: [gouvernance-de-la-plateforme/administrator, contraintes-a-poser-au-niveau-base-de]
constraints: ['Administrator:required', 'Administrator.role:enum', 'Administrator:fk', C-29, C-04]
asvs: [v5.0.0-6.3.3, v5.0.0-2.2.3]
---

# ADM-001 — Administrators table

## Story
Technical story: create the administrators table so that platform staff exist with a mandatory two-factor secret.

## Context
- Exists: `people`, `require_registered_person()`.
- Adds: table `administrators` (`role` SUPER_ADMIN or MODERATOR, `totp_secret` text not null, `appointed_at` default now, `removed_at` null), a partial unique index on `person_id` where `removed_at` is null, trigger `require_registered_person('person_id')`, and a trigger refusing a `recovery_email` equal (case-insensitive) to the person's `email`.
- The application stores `totp_secret` encrypted (ADM-004); the table cannot check that.
- `Administrator` fields: `person_id` FK → Person; `role` enum [SUPER_ADMIN / MODERATOR]; `totp_secret` string; `recovery_email` string, nullable; `appointed_at` datetime
- `Administrator:required`: NOT NULL: `person_id`, `role`, `totp_secret`, `appointed_at`
- `Administrator.role:enum`: one of SUPER_ADMIN, MODERATOR
- `Administrator:fk`: references person_id → Person
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Insert rules
  When an administrator is inserted with <values>
  Then the insert <result>
  Examples:
    | values                                            | result          |
    | a registered person, role MODERATOR, a secret     | accepts         |
    | a guest                                           | rejects (23514) |
    | no totp_secret                                    | rejects (23502) |
    | role "ROOT"                                       | rejects         |
    | a second live row for the same person             | rejects (23505) |
    | a new row for a person whose first was removed    | accepts         |
    | recovery_email equal to the person's email        | rejects (23514) |
    | recovery_email different from the person's email  | accepts         |
Scenario: AC-2 Person key
  When the person id is unknown
  Then the insert fails with 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 Administrator without two-factor (elevation)
  When code inserts an administrator with an empty secret
  Then PostgreSQL refuses it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_adm_001_administrators/migration.sql`, `tests/integration/admin/administrator-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/organization/collaboration-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-6.3.3: the second factor is a required column.
- v5.0.0-2.2.3: the recovery address rule is checked by the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert rules | integration | AC-1, C-29, C-04, Administrator:required, Administrator.role:enum | each Examples row → accepted or rejected |
| person key | integration | AC-2, Administrator:fk | 23503 |
| no second factor | security | AB-1, CWE-308 | refused |

Command: `npx vitest run tests/integration/admin/administrator-table.test.ts`

## Out of scope
- Encrypting the secret and using it (ADM-004, ADM-006).

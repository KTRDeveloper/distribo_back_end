---
id: PER-003
title: Person integrity checks in the database
module: person
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [PER-002]
read_first: [prisma/schema.prisma, tests/integration/person/person-table.test.ts]
design_refs: [identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: [C-02, C-03]
asvs: [v5.0.0-2.2.3, v5.0.0-11.4.2]
---

# PER-003 — Person integrity checks in the database

## Story
Technical story: enforce the phone number, registration and email rules with CHECK constraints and a partial unique index, so that PostgreSQL rejects an inconsistent person even when validation is bypassed.

## Context
- Exists: `people` (PER-002).
- Adds: one migration with the CHECKs and the index; no application code. E.164 pattern `^\+[1-9][0-9]{7,14}$` on `phone_number` and on `released_phone_number`.
- A partial unique index on `lower(email)` where `email_verified_at` is not null (Q-026).
- `C-02`: `phone_number` is unique, E.164 (`^\+[1-9][0-9]{7,14}$`); exactly one of `phone_number` and `released_phone_number` is set; status ANONYMIZED means `phone_number` is empty.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Phone number rules
  When a row is inserted directly with <values>
  Then the database <result>
  Examples:
    | values                                                   | result          |
    | phone_number +237677123456, released number empty       | accepts         |
    | phone_number empty, released number +237677123456       | accepts         |
    | both numbers set                                         | rejects (23514) |
    | both numbers empty                                       | rejects (23514) |
    | phone_number 0677123456                                  | rejects (23514) |
    | status ANONYMIZED with an active number                  | rejects (23514) |
Scenario Outline: AC-2 Registered person is complete
  When a person with `registered_at` set is inserted with <values>
  Then the database <result>
  Examples:
    | values                                                    | result          |
    | full_name, password_hash and phone_verified_at set        | accepts         |
    | full_name empty                                           | rejects (23514) |
    | password_hash empty                                       | rejects (23514) |
    | phone_verified_at empty with an active number             | rejects (23514) |
    | status ANONYMIZED, no name, no hash, released number set  | accepts         |
    | released number only and `phone_verified_at` set          | rejects (23514) |
Scenario: AC-3 Email dates
  When `email` is empty and `email_verified_at` is set
  Then the database rejects the row with 23514
  And two people cannot both hold the same verified email (23505), in any letter case
```

## Abuse cases
```gherkin
Scenario: AB-1 Bypassing validation (tampering)
  When code inserts a registered person without a password hash straight into the database
  Then PostgreSQL rejects it, even though no validation ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_per_003_person_checks/migration.sql`, `tests/integration/person/person-checks.test.ts`
- Pattern: `tests/integration/person/person-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: related columns are checked together in the database, not only in code.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| phone rules | integration | AC-1, C-02 | each Examples row → accepted or SQLSTATE |
| completeness | integration | AC-2, C-03 | each Examples row → accepted or 23514 |
| email dates | integration | AC-3, C-03 | empty email with verified date → 23514; second verified holder in another case → 23505 |
| no validation bypass | security | AB-1, CWE-20 | raw insert of a registered person with no hash → 23514 |

Command: `npx vitest run tests/integration/person/person-checks.test.ts`

## Out of scope
- Application-level validation of these fields (AUTH and PER-007).

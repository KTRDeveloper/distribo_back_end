---
id: PER-004
title: Phone number change journal
module: person
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [PER-002]
read_first: [prisma/schema.prisma, tests/helpers/app-role.ts]
design_refs: [identite-et-organisation/phonenumberchangelog]
constraints: ['PhoneNumberChangeLog:required', 'PhoneNumberChangeLog:fk', C-32, C-39, C-35]
asvs: [v5.0.0-16.3.3, v5.0.0-8.3.1]
---

# PER-004 — Phone number change journal

## Story
Technical story: create the immutable journal of phone number changes so that every change is traceable and cannot be rewritten.

## Context
- Exists: `people` (PER-002), role `distribo_app`, `set_server_updated_at()` and `getAppRolePrisma()` (FND-002).
- Adds: table `phone_number_change_logs` with E.164 CHECKs on both numbers, `server_updated_at` trigger, and `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`.
- `PhoneNumberChangeLog` fields: `person_id` FK → Person; `old_phone_number` string; `new_phone_number` string; `verified_at` datetime; `changed_at` datetime
- `PhoneNumberChangeLog:required`: NOT NULL: `person_id`, `old_phone_number`, `new_phone_number`, `verified_at`, `changed_at`
- `PhoneNumberChangeLog:fk`: references person_id → Person
- `C-32`: `PhoneNumberChangeLog` rows are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on `PhoneNumberChangeLog`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rows can be added and read
  When the application account inserts a row for an existing person and selects it
  Then both succeed and `server_updated_at` is set
Scenario: AC-2 Rows cannot change
  When the application account runs UPDATE or DELETE on a row
  Then PostgreSQL answers permission denied (42501)
Scenario Outline: AC-3 Number format
  When a row has old number <old> and new number <new>
  Then the insert <result>
  Examples:
    | old           | new           | result  |
    | +237677123456 | +237699000111 | accepts |
    | 677123456     | +237699000111 | rejects |
    | +237677123456 | 0699000111    | rejects |
Scenario: AC-4 Person must exist
  When a row references a missing person id
  Then the insert fails with 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 Rewriting history (repudiation)
  When code running as the application account edits `new_phone_number` of an existing row
  Then the change is refused and the row is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_per_003_phone_change_log/migration.sql`, `tests/integration/person/phone-change-log.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/foundation/database-roles.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.3.1: only INSERT and SELECT are granted to `distribo_app`.
- v5.0.0-16.3.3: the journal keeps who changed which number and when.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert and read | integration | AC-1, PhoneNumberChangeLog:required, C-35 | as `distribo_app` insert then select → row with server_updated_at |
| immutable | security | AC-2, AB-1, C-32, C-39, WSTG-ATHZ-03 | as `distribo_app` UPDATE and DELETE → 42501 |
| number format | integration | AC-3 | each Examples row → accepted or 23514 |
| foreign key | integration | AC-4, PhoneNumberChangeLog:fk | unknown person id → 23503 |

Command: `npx vitest run tests/integration/person/phone-change-log.test.ts`

## Out of scope
- Writing rows: phone change flow (AUTH module).
- The 10-year retention purge (PRIV module).

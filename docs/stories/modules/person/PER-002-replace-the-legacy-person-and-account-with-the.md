---
id: PER-002
title: Replace the legacy Person and Account with the v10 Person table
module: person
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [PER-001, FND-002, FND-005]
read_first: [prisma/schema.prisma, src/modules/user/user.repository.ts]
design_refs: [identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: ['Person:required', 'Person.phone_number:unique', 'Person.preferred_language:enum', 'Person.status:enum', C-01, C-35]
asvs: [v5.0.0-14.2.4, v5.0.0-11.4.2]
---

# PER-002 — Replace the legacy Person and Account with the v10 Person table

## Story
Technical story: create the single v10 `Person` table and drop the old account and verification tables, so that every module points to one identity record.

## Context
- Exists: models `Person`, `Account`, `OtpChallenge`, `EmailVerificationRequest`, `RefreshToken` (FND-001); no code uses the last three after PER-001; `Task.accountId` points to `Account`; `user.repository.ts` reads `prisma.account`.
- Adds: migration that drops `accounts`, `otp_challenges`, `email_verification_requests`, `refresh_tokens`, recreates `people` with the design columns plus `scope_version` (int, default 0) and `server_updated_at` (trigger `set_server_updated_at()` from FND-002), and repoints `tasks.account_id` to `people(id)` (the Prisma field keeps the name `accountId`; it holds a person id).
- Person id is `uuid` with no default; server code sets it with `newId()`. Phone, completeness and email CHECKs come in PER-003.
- `user.repository.ts` reads `prisma.person` and returns `{ id, email, name, emailVerifiedAt, createdAt }` as before.
- `seedAccount` in `tests/helpers/database.ts` creates a registered Person (name, phone, `registered_at`, `phone_verified_at`, a hash-shaped placeholder) and returns `{ id, email, name, phoneNumber }`.
- `Person` fields: `full_name` string, nullable; `phone_number` string, nullable, unique; `released_phone_number` string, nullable; `phone_verified_at` datetime, nullable; `email` string, nullable; `email_verified_at` datetime, nullable; `password_hash` string, nullable; `registered_at` datetime, nullable; `preferred_language` enum [FR / EN], nullable; `created_at` datetime; `status` enum [ACTIVE / SUSPENDED / ANONYMIZED]; `anonymized_at` datetime, nullable; `scope_version` int
- `Person:required`: NOT NULL: `created_at`, `status`, `scope_version`
- `Person.phone_number:unique`: unique
- `Person.preferred_language:enum`: one of FR, EN
- `Person.status:enum`: one of ACTIVE, SUSPENDED, ANONYMIZED
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Tables and columns
  When the migration ran
  Then table `people` has the design columns with types uuid, timestamptz and int
  And the tables `accounts`, `otp_challenges`, `email_verification_requests`, `refresh_tokens` do not exist
Scenario: AC-2 Number uniqueness
  When two people are inserted with the same active number
  Then the second insert fails with 23505
Scenario: AC-3 Enums and required columns
  When a row has status "DELETED" or language "ES", or omits `created_at`
  Then the database rejects the status and language; `created_at` defaults to now
Scenario: AC-4 Server time and defaults
  When a guest is inserted without `scope_version` and `server_updated_at`
  Then `scope_version` is 0 and `server_updated_at` is set by the database
Scenario: AC-5 Existing behavior keeps working
  When `npx vitest run tests/integration/user.test.ts tests/integration/remote-config.test.ts` runs
  Then every test that passed before this story passes
```

## Abuse cases
```gherkin
Scenario: AB-1 Two identities for one number (spoofing)
  When code inserts a second person with a number that is already active
  Then PostgreSQL rejects it, even though no validation ran
```

## Implementation
- Create: `prisma/migrations/<timestamp>_per_002_person_v10/migration.sql`, `tests/integration/person/person-table.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/user/user.repository.ts`, `tests/helpers/database.ts`
- Pattern: `prisma/migrations/20260914130000_add_refresh_tokens/migration.sql`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-14.2.4: `password_hash` is never selected by `user.repository.ts`.
- v5.0.0-11.4.2: the seed helper stores only a hash-shaped placeholder, never a real password.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| table shape | integration | AC-1, C-01, Person:required | `expectColumnType` on id, phone_number, scope_version, created_at, server_updated_at; old tables absent |
| unique number | integration | AC-2, Person.phone_number:unique | same number twice → 23505 |
| enums | integration | AC-3, Person.status:enum, Person.preferred_language:enum | status 'DELETED', language 'ES' → rejected |
| defaults and trigger | integration | AC-4, C-35 | guest insert → scope_version 0, server_updated_at near now() |
| existing suites | integration | AC-5 | user and remote-config suites pass |
| one identity per number | security | AB-1, CWE-289 | raw second insert with an active number → 23505 |

Command: `npx vitest run tests/integration/person/person-table.test.ts tests/integration/user.test.ts`

## Out of scope
- Phone, completeness and email CHECKs (PER-003).
- Person lookup and projection (PER-005, PER-006); profile fields (PER-007).
- Renaming `Task.accountId` to `personId`.

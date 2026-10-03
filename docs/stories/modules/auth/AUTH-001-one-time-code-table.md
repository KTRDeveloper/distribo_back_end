---
id: AUTH-001
title: One-time code table
module: auth
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [PER-003, FND-005]
read_first: [prisma/schema.prisma, tests/integration/person/person-table.test.ts]
design_refs: [acces-et-securite/otpchallenge, contraintes-a-poser-au-niveau-base-de]
constraints: ['OtpChallenge:required', 'OtpChallenge:fk', 'OtpChallenge.purpose:enum', 'OtpChallenge.channel:enum', C-33, C-01]
asvs: [v5.0.0-6.5.1, v5.0.0-6.5.3]
---

# AUTH-001 — One-time code table

## Story
Technical story: create the table that holds one-time codes as hashes, with the limits the database can enforce.

## Context
- Exists: `people` (PER-002); the old `otp_challenges` table was dropped there.
- Adds: table `otp_challenges` (`person_id` nullable, `channel` default SMS, `attempts` default 0), CHECK `attempts <= 5`, CHECK that a SMS `target` starts with `+237`, and an index on (`target`, `purpose`, `created_at` desc).
- Enums: the baseline migration created types `OtpPurpose` (REGISTRATION, PASSWORD_RESET) and `OtpChannel` (SMS, EMAIL), still declared in `prisma/schema.prisma`. In the migration, give `OtpPurpose` the six values with `ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS ...` (or drop and recreate it if the type no longer exists in the database); keep `OtpChannel` as is. Update the Prisma enum to match.
- Enforced later in code: a consumed or expired code is refused (AUTH-003); an EMAIL code goes to a verified email (AUTH-023, ADM).
- `OtpChallenge` fields: `person_id` FK → Person, nullable; `target` string; `purpose` enum [REGISTRATION / LOGIN / PASSWORD_RESET / PHONE_CHANGE / EMAIL_VERIFICATION / TOTP_RECOVERY]; `channel` enum [SMS / EMAIL]; `code_hash` string; `expires_at` datetime; `attempts` int; `consumed_at` datetime, nullable; `created_at` datetime
- `OtpChallenge:required`: NOT NULL: `target`, `purpose`, `channel`, `code_hash`, `expires_at`, `attempts`, `created_at`
- `OtpChallenge:fk`: references person_id → Person
- `OtpChallenge.purpose:enum`: one of REGISTRATION, LOGIN, PASSWORD_RESET, PHONE_CHANGE, EMAIL_VERIFICATION, TOTP_RECOVERY
- `OtpChallenge.channel:enum`: one of SMS, EMAIL
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Row with defaults
  When a code row is inserted for a person, target +237677123456, purpose LOGIN, a hash and an expiry
  Then `channel` is SMS, `attempts` is 0, `consumed_at` is empty and `created_at` is set
Scenario Outline: AC-2 Database limits
  When a row has <values>
  Then the insert <result>
  Examples:
    | values                                   | result          |
    | attempts 5                               | accepts         |
    | attempts 6                               | rejects (23514) |
    | person_id empty, purpose REGISTRATION    | accepts         |
    | channel SMS, target +33612345678         | rejects (23514) |
    | channel SMS, target +237677123456        | accepts         |
    | channel EMAIL, target a@example.test     | accepts         |
Scenario: AC-3 Enums and foreign key
  When purpose is "NEW_DEVICE", channel is "PUSH" or the person id is unknown
  Then the insert fails
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `prisma/migrations/<timestamp>_auth_001_otp_challenges/migration.sql`, `tests/integration/auth/otp-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/person/person-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-6.5.1: only a hash of the code is stored; there is no plain-code column.
- v5.0.0-6.5.3: the attempts limit is a CHECK, so code paths cannot exceed it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| defaults | integration | AC-1, OtpChallenge:required, C-01 | insert → defaults; `expectColumnType` on id, expires_at |
| limits | integration | AC-2, C-33 | each Examples row → accepted or 23514 |
| enums and fk | integration | AC-3, OtpChallenge.purpose:enum, OtpChallenge.channel:enum, OtpChallenge:fk | bad enum values and unknown person → rejected |

Command: `npx vitest run tests/integration/auth/otp-table.test.ts`

## Tests to update
- `tests/integration/person/person-table.test.ts`, test "old tables accounts, otp_challenges, email_verification_requests, refresh_tokens do not exist": remove `otp_challenges` from the list of absent tables (this story creates it again) and rename the test to match. Change nothing else in that file.

## Out of scope
- Issuing and verifying codes (AUTH-002, AUTH-003).

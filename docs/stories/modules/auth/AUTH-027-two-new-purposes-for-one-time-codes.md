---
id: AUTH-027
title: Two new purposes for one-time codes
module: auth
kind: migration
rev: 1
amends: [AUTH-001]
size: XS
risk: high
depends_on: [AUTH-001]
read_first: [prisma/schema.prisma, tests/integration/auth/otp-table.test.ts]
design_refs: [acces-et-securite/otpchallenge]
constraints: ['OtpChallenge.purpose:enum']
asvs: [v5.0.0-6.5.1]
---

# AUTH-027 — Two new purposes for one-time codes

## Story
Technical story: add the two code purposes the new design introduces, so that later stories can issue a code for a shop contact and for the support giving an account back.

## Context
- Exists: the enum `OtpPurpose` in `prisma/schema.prisma` holds REGISTRATION, LOGIN, PASSWORD_RESET, PHONE_CHANGE, EMAIL_VERIFICATION and TOTP_RECOVERY.
- Adds one migration with two `ALTER TYPE "OtpPurpose" ADD VALUE` statements: `ORG_CONTACT_VERIFICATION` (a shop's public contact, ORG-023) and `ACCESS_RESTORE` (the support gives an account back, ADM). The Prisma enum gets both values.
- Existing rows keep their purpose; nothing is rewritten.
- Nothing issues these codes yet: each one ships with the first story that uses it. The link from a code to a shop contact and its CHECK come with ORG-023, once the contacts table exists.
- `OtpChallenge` fields: `purpose` enum [REGISTRATION / LOGIN / PASSWORD_RESET / PHONE_CHANGE / EMAIL_VERIFICATION / TOTP_RECOVERY / ORG_CONTACT_VERIFICATION / ACCESS_RESTORE]
- `OtpChallenge.purpose:enum`: one of REGISTRATION, LOGIN, PASSWORD_RESET, PHONE_CHANGE, EMAIL_VERIFICATION, TOTP_RECOVERY

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Purposes accepted
  When a challenge row is inserted with purpose <purpose>
  Then the insert <result>
  Examples:
    | purpose                  | result  |
    | ORG_CONTACT_VERIFICATION | accepts |
    | ACCESS_RESTORE           | accepts |
    | LOGIN                    | accepts |
    | TOTP_RECOVERY            | accepts |
Scenario: AC-2 Generated client
  When the Prisma `OtpPurpose` object is read
  Then it holds exactly the eight values of the design
```

## Abuse cases
```gherkin
Scenario: AB-1 An unlisted purpose is stored (tampering)
  When a row is inserted with purpose "ADMIN_OVERRIDE" or "NEW_DEVICE"
  Then the database rejects it
```

## Implementation
- Create: `prisma/migrations/<timestamp>_auth_027_otp_purposes/migration.sql`, `tests/integration/auth/otp-purposes.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/auth/otp-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-6.5.1: a code stays bound to one purpose from a closed list, so a code made for one use never serves another.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| purposes | integration | AC-1, OtpChallenge.purpose:enum | each Examples row → accepted |
| client enum | integration | AC-2 | Object.keys(OtpPurpose) → the eight values |
| unlisted purpose | security | AB-1, CWE-20 | ADMIN_OVERRIDE and NEW_DEVICE → rejected (22P02) |

Command: `npx vitest run tests/integration/auth/otp-purposes.test.ts tests/integration/auth/otp-table.test.ts`

## Out of scope
- Issuing or checking these two codes (ORG-023 for a shop contact, ADM for restoring access).
- The column `organization_contact_id` and its CHECK (ORG-023).

---
id: ORG-023
title: A one-time code can be tied to a business contact
module: organization
kind: migration
rev: 1
amends: [AUTH-001]
size: XS
risk: high
depends_on: [ORG-021, AUTH-027]
read_first: [prisma/schema.prisma, tests/integration/auth/otp-table.test.ts]
design_refs: [acces-et-securite/otpchallenge]
constraints: [C-33]
asvs: [v5.0.0-2.2.3]
---

# ORG-023 — A one-time code can be tied to a business contact

## Story
Technical story: add to one-time codes the contact of a business they confirm, with the database rule that ties it to the purpose, so that a code for one contact cannot confirm another.

## Context
- Exists: `otp_challenges` (AUTH-001) and the purpose ORG_CONTACT_VERIFICATION (AUTH-027); `organization_contacts` (ORG-021).
- Adds one migration, run in one transaction: `organization_contact_id` (uuid, empty by default, FK to `organization_contacts`) and a CHECK (C-33): it is set exactly when `purpose = 'ORG_CONTACT_VERIFICATION'`.
- Existing rows have no contact and none uses this purpose yet, so the CHECK already holds: no audit is needed.
- That `target` equals the value of the contact is not a database rule (it spans two tables): the callers check it (ORG-024, ORG-026).
- `prisma/schema.prisma`: add the field to `model OtpChallenge`, and to the `//` comment above it, in plain words: a code for a business contact belongs to that one contact, because two businesses may show the same number; migration `org_023_otp_contact_link`.
- `OtpChallenge` fields: `organization_contact_id` FK → OrganizationContact, nullable
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, to the administrator's recovery address, or, for ORG_CONTACT_VERIFICATION, to the email of the contact being verified, except for EMAIL_VERIFICATION; `organization_contact_id` is set if and only if `purpose = ORG_CONTACT_VERIFICATION`, and then `target` equals the contact's value.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The id goes with the purpose
  When a challenge is inserted with purpose <purpose> and <contact>
  Then the database <result>
  Examples:
    | purpose                  | contact       | result          |
    | ORG_CONTACT_VERIFICATION | a contact id  | accepts         |
    | ORG_CONTACT_VERIFICATION | no contact id | rejects (23514) |
    | LOGIN                    | a contact id  | rejects (23514) |
    | LOGIN                    | no contact id | accepts         |
Scenario: AC-2 The contact must exist
  When a challenge is inserted with an unknown contact id
  Then the database rejects it with 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 A login code is reused for a contact (spoofing)
  When code inserts a LOGIN challenge that carries a contact id, straight in the database
  Then PostgreSQL rejects it with 23514
```

## Implementation
- Create: `prisma/migrations/<timestamp>_org_023_otp_contact_link/migration.sql`, `tests/integration/auth/otp-contact-link.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/auth/otp-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.3: purpose and contact id are checked together in the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| id and purpose | integration | AC-1, C-33 | each Examples row → accepted or 23514 |
| known contact | integration | AC-2, C-33 | unknown contact id → 23503 |
| login code with a contact | security | AB-1, CWE-345 | raw insert → 23514 |

Command: `npx vitest run tests/integration/auth/otp-contact-link.test.ts tests/integration/auth/otp-table.test.ts`

## Out of scope
- Issuing and verifying such codes (ORG-041).

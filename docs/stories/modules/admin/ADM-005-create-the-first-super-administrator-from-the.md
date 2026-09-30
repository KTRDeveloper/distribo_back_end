---
id: ADM-005
title: Create the first super administrator from the command line
module: admin
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ADM-004, AUTH-005]
read_first: [src/lib/totp.ts, src/lib/password.ts]
design_refs: [gouvernance-de-la-plateforme/administrator]
constraints: []
asvs: [v5.0.0-6.3.2, v5.0.0-13.3.2]
---

# ADM-005 — Create the first super administrator from the command line

## Story
Technical story: provide the one script that creates the first SUPER_ADMIN, so that the platform team can be started without a default account.

## Context
- Exists: `createTotpSecret`, `encryptSecret` (ADM-004); `administrators` (ADM-001); `findOrCreateByPhone`.
- Adds: `scripts/create-super-admin.ts` and npm script `admin:create-super`. Usage: `npm run admin:create-super -- <phone_number>`. It refuses when the person is not registered, or when a live SUPER_ADMIN already exists (the first one only), creates the administrator with an encrypted secret, writes an `APPOINT_ADMIN` journal row (reason "bootstrap") with the new administrator as author, and prints the `otpauth://` URI once. No password or secret is passed on the command line or logged.
- The script exports `createFirstSuperAdmin(phone)` for tests.

## Acceptance criteria
```gherkin
Scenario: AC-1 First super administrator
  Given a registered person and no administrator
  When createFirstSuperAdmin runs
  Then a SUPER_ADMIN exists with an encrypted secret, an APPOINT_ADMIN journal row exists, and the URI is returned
Scenario Outline: AC-2 Refusals
  When it runs for <case>
  Then it throws and creates nothing
  Examples:
    | case                                         |
    | a guest or unknown number                    |
    | a platform that already has a live SUPER_ADMIN |
    | an invalid number                            |
Scenario: AC-3 No secret at rest in clear
  Then the stored totp_secret is not the printed secret
```

## Abuse cases
```gherkin
Scenario: AB-1 Second bootstrap (elevation)
  When someone runs the script again after the first administrator exists
  Then it refuses and no administrator is added
```

## Implementation
- Create: `scripts/create-super-admin.ts`, `tests/integration/admin/create-super-admin.test.ts`
- Modify: `package.json`
- Pattern: `src/lib/crypto.ts`
- Signatures:
  - `createFirstSuperAdmin(phoneNumber: string): Promise<{ administratorId: string; otpauthUri: string }>`
- Dependencies: `otplib`, `@prisma/client`, `tsx`

## Security
- v5.0.0-6.3.2: there is no default administrator; the first one is explicit.
- v5.0.0-13.3.2: the secret is printed once and stored encrypted.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| first | integration | AC-1 | rows and URI |
| refusals | integration | AC-2 | each Examples row → error, nothing created |
| encrypted | integration | AC-3 | stored value differs |
| second bootstrap | security | AB-1, CWE-269 | refused |

Command: `npx vitest run tests/integration/admin/create-super-admin.test.ts`

## Out of scope
- Appointing further administrators (ADM-009).

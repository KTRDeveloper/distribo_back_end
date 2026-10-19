---
id: AUTH-035
title: Remove the verified-email lookup
module: auth
kind: removal
rev: 1
amends: [AUTH-015]
size: XS
risk: medium
depends_on: [AUTH-036]
read_first: [src/modules/person/person.repository.ts, src/modules/auth/auth.service.ts]
design_refs: [identite-et-organisation/person]
constraints: []
asvs: [v5.0.0-6.4.3]
---

# AUTH-035 — Remove the verified-email lookup

## Story
Technical story: remove the function that finds a person by verified email, so that no code path can sign anyone in with an email.

## Context
- Exists: `findByVerifiedEmail(email)` in `src/modules/person/person.repository.ts`, listed in the person contracts as added by AUTH-015. AUTH-036 removed its two callers; no other file imports it.
- Removes the function and its contract entry. The partial unique index on verified emails (PER-003) and the email verification flow stay: an email still proves who a person is to the support.
- A source scan finds no remaining reference to the name under `src/`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Function removed
  When the person repository module is imported
  Then it has no export named `findByVerifiedEmail`
Scenario: AC-2 No caller left
  When the files under `src/` are scanned for the name
  Then no file mentions it
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/person/removed-email-lookup.test.ts`
- Modify: `src/modules/person/person.repository.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-6.4.3: with no lookup by email, the email cannot be used as a way to sign in.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| export gone | unit | AC-1 | module namespace has no findByVerifiedEmail |
| no reference | unit | AC-2 | scan of src/ files → zero matches |

Command: `npx vitest run tests/unit/person/removed-email-lookup.test.ts tests/integration/auth`

## Out of scope
- Email verification, the unique index on verified emails and the email in the profile: unchanged.

---
id: AUTH-038
title: A verified email is unique whatever the letter case
module: auth
kind: test
rev: 1
amends: []
size: XS
risk: medium
depends_on: [AUTH-023, PER-003]
read_first: [src/modules/auth/auth.service.ts, tests/integration/auth/email-verify-confirm.test.ts]
design_refs: [identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: [C-40]
asvs: [v5.0.0-2.2.3]
---

# AUTH-038 — A verified email is unique whatever the letter case

## Story
As a customer, I want an email that someone else has already verified to be refused whatever its capital letters, so that two people can never hold the same address as their recovery key.

## Context
- Exists: the confirmation route (AUTH-023) and the partial unique index on `lower(email)` for verified emails (PER-003).
- Characterization test only, no production code. `confirmEmail` first looks for a verified holder with the exact same text; an address that differs only by letter case passes that look-up and is stopped by the index, and the unique violation is mapped to 409 `EMAIL_TAKEN`.
- A failing case goes back to AUTH-023 or PER-003.
- `C-40`: A verified `Person.email` is unique whatever the letter case (partial unique index on `lower(email)` where `email_verified_at` is set), checked when the code is confirmed.

## Acceptance criteria
```gherkin
Scenario: AC-1 Same address, other letter case
  Given person one has verified `Shop.Owner@example.com`
  When person two, whose saved email is `shop.owner@example.com`, posts the right code
  Then the response is 409 `EMAIL_TAKEN` and person two's email stays unverified
Scenario: AC-2 Another address
  Given person one has verified `shop.owner@example.com`
  When person two, whose saved email is `other.owner@example.com`, posts the right code
  Then the response is 204 and person two's email is verified
```

## Abuse cases
```gherkin
Scenario: AB-1 Taking over an address by changing its capitals (spoofing)
  Given person one has verified `shop.owner@example.com`
  When person two saves `SHOP.OWNER@EXAMPLE.COM`, asks for a code and confirms it
  Then at most one person holds that address as verified
```

## Implementation
- Create: `tests/integration/auth/email-verify-case.test.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.3: the rule is checked on the data as stored, in any letter case, so a changed capital cannot bypass it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| other case | integration | AC-1, C-40 | 409 EMAIL_TAKEN, email not verified |
| other address | integration | AC-2 | 204, email verified |
| capitals trick | security | AB-1, CWE-289 | one verified holder in the table |

Command: `npx vitest run tests/integration/auth/email-verify-case.test.ts tests/integration/auth/email-verify-confirm.test.ts`

## Out of scope
- Changing the confirmation route: AUTH-023. The unique index: PER-003.

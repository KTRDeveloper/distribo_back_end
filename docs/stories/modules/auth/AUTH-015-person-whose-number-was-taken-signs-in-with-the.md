---
id: AUTH-015
title: Person whose number was taken signs in with the verified email
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-014, AUTH-011]
read_first: [src/modules/auth/auth.service.ts, src/modules/person/person.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [C-33, CM-04]
asvs: [v5.0.0-6.4.3, v5.0.0-6.3.8, v5.0.0-6.5.1]
---

# AUTH-015 — Person whose number was taken signs in with the verified email

## Story
As a customer, I want to sign in with my verified email when my number now belongs to someone else so that I keep my account and can add my new number.

## Context
- Exists: sign-in in two steps (AUTH-013, AUTH-014); persons with a released number (AUTH-011).
- Adds: both login bodies accept `email` instead of `phone_number` (exactly one of them). `findByVerifiedEmail(email)` in `src/modules/person/person.repository.ts` (case-insensitive, verified emails only).
- Allowed only when the person has no active number. Otherwise the answer is the generic 401 `INVALID_CREDENTIALS`. The code goes by EMAIL to the verified email.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `CM-04`: Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number.

## Acceptance criteria
```gherkin
Scenario: AC-1 Sign in by email
  Given a person with a released number and a verified email
  When they post email and password, then email and the code
  Then they get a session
Scenario Outline: AC-2 Not allowed
  When the email login uses <case>
  Then the response is 401 `INVALID_CREDENTIALS`
  Examples:
    | case                                               |
    | an email that is not verified                      |
    | a person who still has an active number            |
    | an unknown email                                   |
    | a wrong password                                   |
Scenario: AC-3 Both or neither identifier
  When the body has both `email` and `phone_number`, or neither
  Then the response is 400 `VALIDATION_ERROR`
Scenario: AC-4 Case
  When the email is typed in upper case
  Then the person is found
```

## Abuse cases
```gherkin
Scenario: AB-1 Email login as a bypass of the SIM (spoofing)
  When someone with an active number and a verified email uses the email route
  Then the answer is the generic failure and no code is sent
```

## Implementation
- Create: `tests/integration/auth/login-by-email.test.ts`
- Modify: `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/person/person.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `findByVerifiedEmail(email: string): Promise<Person | null>`
- Types:
  - `LoginInput = { phone_number: string } | { email: string } plus password and use_email`
- Errors: `INVALID_CREDENTIALS` 401, `VALIDATION_ERROR` 400
- Dependencies: `zod`, `@prisma/client`

## Security
- v5.0.0-6.4.3: the email route works only for people with no active number.
- v5.0.0-6.3.8: the same generic failure as the number route.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| email sign-in | integration | AC-1, CM-04, C-33 | released-number person → session; the code went by EMAIL to the verified address |
| not allowed | integration | AC-2 | each Examples row → 401 |
| one identifier | integration | AC-3 | both or neither → 400 |
| case | integration | AC-4 | upper-case email → found |
| bypass | security | AB-1, CWE-288 | active-number person → 401, no code queued |

Command: `npx vitest run tests/integration/auth/login-by-email.test.ts`

## Out of scope
- Adding the new number (AUTH-024, AUTH-025).

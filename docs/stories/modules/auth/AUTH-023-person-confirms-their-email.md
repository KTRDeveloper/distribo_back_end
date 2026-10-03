---
id: AUTH-023
title: Person confirms their email
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [AUTH-022, AUTH-009, AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [identite-et-organisation/person]
constraints: [C-03, C-33]
asvs: [v5.0.0-6.5.1, v5.0.0-16.3.1]
---

# AUTH-023 — Person confirms their email

## Story
As a customer, I want to confirm the code sent to my email so that my address becomes my recovery key.

## Context
- Exists: EMAIL_VERIFICATION codes (AUTH-022); the partial unique index on verified emails (PER-003).
- Adds: `POST /api/v1/auth/email/verify/confirm` (authenticated) with `{ code }`; response 204. The code is checked against the saved email; success sets `email_verified_at` = now.
- If another person already has this verified email: 409 `EMAIL_TAKEN`, the code is not lost for a second try with a different address.
- A code sent to an address that was changed since the request is refused with 400 `OTP_INVALID`.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.

## Acceptance criteria
```gherkin
Scenario: AC-1 Confirm
  When the right code is posted
  Then the response is 204 and `email_verified_at` is set
Scenario: AC-2 Wrong or expired code
  When the code is wrong or expired
  Then the response is 400 `OTP_INVALID` or `OTP_EXPIRED` and the email stays unverified
Scenario: AC-3 Address changed after the request
  When the person changes the email with PATCH after asking for a code and then posts the old code
  Then the response is 400 `OTP_INVALID`
Scenario: AC-4 Address already verified by someone else
  When another person holds the same verified email
  Then the response is 409 `EMAIL_TAKEN` and nothing changes
```

## Abuse cases
```gherkin
Scenario: AB-1 Verifying someone else's address (spoofing)
  When a person posts a code that was sent to another person
  Then the response is 400 `OTP_INVALID`
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `tests/integration/auth/email-verify-confirm.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `confirmEmail(personId: string, code: string): Promise<void>`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `EMAIL_TAKEN` 409, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.5.1: the code is bound to the saved address and the purpose.
- v5.0.0-16.3.1: log event `email_verified` with the person id.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| confirm | integration | AC-1, C-03 | 204, email_verified_at set |
| bad code | integration | AC-2, C-33 | errors, unverified |
| changed address | integration | AC-3 | old code → OTP_INVALID |
| taken | integration | AC-4 | 409, unchanged |
| other person's code | security | AB-1, CWE-345 | OTP_INVALID |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/auth/email-verify-confirm.test.ts`

## Out of scope
- Recovery address of administrators (ADM module).

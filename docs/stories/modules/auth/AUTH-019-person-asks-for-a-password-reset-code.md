---
id: AUTH-019
title: Person asks for a password reset code
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-013]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/otp.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [C-33, CM-07]
asvs: [v5.0.0-6.4.3, v5.0.0-6.3.8, v5.0.0-2.4.1]
---

# AUTH-019 — Person asks for a password reset code

## Story
As a customer, I want a code sent to my phone or verified email so that I can choose a new password when I forgot mine.

## Context
- Exists: `issueCode` (AUTH-004), `maskName` (AUTH-009), `findByActivePhone`.
- Adds: `POST /api/v1/auth/password-reset/request` with `{ phone_number, use_email? }`. The answer is always 202 `{ sent: true, expires_in: 600, existing_account: null | { masked_name } }`, whatever the number.
- A code (purpose PASSWORD_RESET) is sent only when the holder is registered: by SMS, or by email when `use_email` is true and the email is verified. Otherwise nothing is sent and the answer is the same. `masked_name` is set only for a registered holder (the design's disclosure).
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario: AC-1 Registered holder by SMS
  When the holder's number is posted
  Then the response is 202 with masked_name and one PASSWORD_RESET code is queued to the number
Scenario: AC-2 By verified email
  When use_email is true and the email is verified
  Then the code is queued to the email and not to the number
Scenario Outline: AC-3 Nothing is sent
  When the request is for <case>
  Then the response is 202 with the same keys, existing_account null, and nothing is queued
  Examples:
    | case                                       |
    | an unknown number                          |
    | a guest's number                           |
    | use_email true with an unverified email    |
Scenario: AC-4 Limits
  When a fourth code is requested for one number within an hour
  Then the response is 429 `OTP_RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Enumeration of registered numbers (information disclosure)
  When unknown, guest and registered numbers are posted
  Then only the registered one carries masked_name and every status is 202
Scenario: AB-2 SMS pumping (denial of service)
  When 50 foreign numbers are posted from one IP
  Then nothing is queued
```

## Implementation
- Create: `tests/integration/auth/password-reset-request.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `requestPasswordReset(input: { phone_number: string; use_email?: boolean }, clientKeys: { ip?: string }): Promise<{ sent: true; expires_in: number; existing_account: { masked_name: string } | null }>`
- Errors: `VALIDATION_ERROR` 400, `OTP_RATE_LIMITED` 429
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.4.3: the reset code goes only to the holder's own channels.
- v5.0.0-6.3.8: identical status and keys for every case; only `masked_name` differs, as the design requires.
- v5.0.0-2.4.1: caps by number, device and IP.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sms | integration | AC-1, C-33 | masked_name, code queued to number |
| email | integration | AC-2 | code to email only |
| nothing sent | integration | AC-3 | each Examples row → 202, no job |
| limits | integration | AC-4, CM-07 | 4th → 429 |
| enumeration | security | AB-1, WSTG-IDNT-04, CWE-204 | identical shape except masked_name |
| pumping | security | AB-2, CWE-770 | foreign numbers → 0 jobs |

Command: `npx vitest run tests/integration/auth/password-reset-request.test.ts`

## Out of scope
- Choosing the new password (AUTH-020).

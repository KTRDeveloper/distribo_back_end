---
id: AUTH-033
title: The reset code comes by SMS only
module: auth
kind: change
rev: 1
amends: [AUTH-019]
size: XS
risk: high
depends_on: [AUTH-028, AUTH-019]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/number-check-limit.ts]
design_refs: [identite-et-organisation/person, acces-et-securite/otpchallenge]
constraints: [C-33, CM-07]
asvs: [v5.0.0-6.4.3, v5.0.0-2.4.1]
---

# AUTH-033 — The reset code comes by SMS only

## Story
As a customer, I want the reset code to come by SMS only so that nobody who reads my email can take my account.

## Context
- Exists: `requestPasswordReset(input, clientKeys)` takes `{ phone_number, use_email? }`, always answers 202 `{ sent: true, expires_in, existing_account }` and sends a code to a registered holder only.
- The body becomes `{ phone_number }`: `use_email` is refused with 400 and the code always goes by SMS to the number. `checkNumberQuota` runs first (AUTH-028).
- Unknown number or guest: nothing is sent and the 202 keeps the same keys with `existing_account` null, as today. A registered holder gets the code and `masked_name` (the phone asks "Is this your account?").
- The email no longer resets a password: only the support gives an account back (ADM).
- `C-33`: an EMAIL code is never used for PASSWORD_RESET. `CM-07`: sending limits stay.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, to the administrator's recovery address, or, for ORG_CONTACT_VERIFICATION, to the email of the contact being verified, except for EMAIL_VERIFICATION; `organization_contact_id` is set if and only if `purpose = ORG_CONTACT_VERIFICATION`, and then `target` equals the contact's value.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario: AC-1 Registered holder
  When the holder's number is posted
  Then the response is 202 with masked_name and one PASSWORD_RESET code is queued by SMS to the number
Scenario: AC-2 The email is refused
  When the body has `use_email` true
  Then the response is 400 `VALIDATION_ERROR` and nothing is queued
Scenario Outline: AC-3 Nothing sent
  When the request is for <case>
  Then the response is 202 with existing_account null and nothing is queued
  Examples:
    | case              |
    | an unknown number |
    | a guest's number  |
Scenario: AC-4 Number checks are counted
  Given the limit is 2 per hour and per IP
  When one IP posts 3 numbers
  Then the third answers 429 `RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 A reset code sent to an email (spoofing)
  Given a person with a verified email
  When `use_email` is true
  Then no email job is queued
```

## Implementation
- Create: `tests/integration/auth/password-reset-sms-only.test.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `requestPasswordReset(input: { phone_number: string }, clientKeys: ClientKeys): Promise<{ sent: true; expires_in: number; existing_account: { masked_name: string } | null }>`
- Errors: `VALIDATION_ERROR` 400, `OTP_RATE_LIMITED` 429, `RATE_LIMITED` 429
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.4.3: the reset code goes only to the SIM of the number.
- v5.0.0-2.4.1: number checks and sends are limited by IP.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| registered holder | integration | AC-1, C-33, CM-07 | 202; job to the number |
| email refused | integration | AC-2 | use_email → 400; no job |
| nothing sent | integration | AC-3 | each Examples row → 202, no job |
| number checks | integration | AC-4 | limit 2 → third 429 |
| no email reset | security | AB-1, CWE-640 | verified email and use_email → no email job |

Command: `npx vitest run tests/integration/auth/password-reset-sms-only.test.ts tests/integration/auth/password-reset-request.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/password-reset-request.test.ts | the 'email' case expects a code queued to the verified email, and the 'unverified email' case sends `use_email` | `use_email` answers 400 VALIDATION_ERROR and nothing is queued |

## Out of scope
- Choosing the new password with the code (AUTH-034).

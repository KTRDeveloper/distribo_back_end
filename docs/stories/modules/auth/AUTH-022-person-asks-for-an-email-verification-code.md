---
id: AUTH-022
title: Person asks for an email verification code
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [AUTH-004, PER-007, AUTH-009, AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/otp.service.ts]
design_refs: [identite-et-organisation/person, acces-et-securite/otpchallenge]
constraints: [C-33, CM-07]
asvs: [v5.0.0-6.5.1, v5.0.0-2.4.1]
---

# AUTH-022 — Person asks for an email verification code

## Story
As a customer, I want a code sent to my email so that I can prove the address is mine and use it to recover my account.

## Context
- Exists: the email saved by `PATCH /users/me` with `email_verified_at` empty (PER-007); `issueCode`.
- Adds: `POST /api/v1/auth/email/verify/request` (authenticated, no body). It sends an EMAIL_VERIFICATION code to the person's saved email; response 202 `{ sent: true, expires_in: 600 }`.
- No saved email: 400 `EMAIL_MISSING`. Already verified: 204 and nothing sent.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `CM-07`: Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles.

## Acceptance criteria
```gherkin
Scenario: AC-1 Code sent
  Given a person with a saved unverified email
  When they post to the route
  Then the response is 202 and one EMAIL_VERIFICATION code is queued by email to that address
Scenario: AC-2 No email
  When the person has no saved email
  Then the response is 400 `EMAIL_MISSING` and nothing is queued
Scenario: AC-3 Already verified
  Then the response is 204 and nothing is queued
Scenario: AC-4 Limits
  When a fourth request comes within an hour
  Then the response is 429 `OTP_RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 Sending codes to arbitrary addresses (tampering)
  When the body contains an `email`
  Then the body is ignored and the code goes only to the saved address
Scenario: AB-2 No token (unauthenticated)
  When the request has no valid token
  Then the response is 401
```

## Implementation
- Create: `tests/integration/auth/email-verify-request.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `requestEmailVerification(personId: string): Promise<{ sent: true; expires_in: number } | null>`
- Errors: `EMAIL_MISSING` 400, `OTP_RATE_LIMITED` 429, `UNAUTHORIZED` 401
- Dependencies: `express`

## Security
- v5.0.0-6.5.1: the target is read from the database, never from the request.
- v5.0.0-2.4.1: the per-target limits apply to email codes too.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| code sent | integration | AC-1, C-33 | queued by email to the saved address |
| no email | integration | AC-2 | 400 |
| already verified | integration | AC-3 | 204, no job |
| limits | integration | AC-4, CM-07 | 4th → 429 |
| body ignored | security | AB-1, CWE-915 | email in body → not used |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/auth/email-verify-request.test.ts`

## Out of scope
- Confirming the code (AUTH-023).

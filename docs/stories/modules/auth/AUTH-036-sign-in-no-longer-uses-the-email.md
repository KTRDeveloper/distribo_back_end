---
id: AUTH-036
title: Sign-in no longer uses the email
module: auth
kind: change
rev: 1
amends: [AUTH-013, AUTH-014, AUTH-015]
size: S
risk: high
depends_on: [AUTH-028, AUTH-014, AUTH-015]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/auth.schemas.ts]
design_refs: [acces-et-securite/otpchallenge, identite-et-organisation/person]
constraints: [C-33]
asvs: [v5.0.0-6.4.3, v5.0.0-6.3.3]
---

# AUTH-036 — Sign-in no longer uses the email

## Story
As a customer, I want sign-in to use my phone number only so that someone who reads my email cannot get into my account.

## Context
- Exists: both login bodies accept `use_email` (the code goes by email) or `email` (sign in by email); `requestLoginByEmail` sends the code to the verified email and `completeLogin` finds the person with `findByVerifiedEmail`.
- Removes `email` and `use_email` from `POST /api/v1/auth/login` and `/auth/login/verify`. The bodies are strict, so the old fields answer 400 `VALIDATION_ERROR`. The code always goes by SMS and the response keeps `channel: 'SMS'`.
- Deletes `requestLoginByEmail` and the email branch of `completeLogin`; `findByVerifiedEmail` keeps no caller (AUTH-035 removes it).
- `C-33`: an EMAIL code only proves an email address; it never opens or gives back an account.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, to the administrator's recovery address, or, for ORG_CONTACT_VERIFICATION, to the email of the contact being verified, except for EMAIL_VERIFICATION; `organization_contact_id` is set if and only if `purpose = ORG_CONTACT_VERIFICATION`, and then `target` equals the contact's value.

## Acceptance criteria
```gherkin
Scenario: AC-1 Code by email refused
  When the login body has `use_email` true
  Then the response is 400 `VALIDATION_ERROR` and nothing is queued
Scenario: AC-2 Sign-in by email refused
  When the login body has `email` and no phone_number
  Then the response is 400 `VALIDATION_ERROR` and nothing is queued
Scenario: AC-3 Verify with the email refused
  When the verify body has `email` or `use_email`
  Then the response is 400 `VALIDATION_ERROR` and no session is issued
Scenario: AC-4 Sign-in by SMS still works
  When a person posts the number and password, then the SMS code with device info
  Then the first answer is 202 with channel SMS and the second is 200 with tokens
```

## Abuse cases
```gherkin
Scenario: AB-1 The email as a way around the SIM (spoofing)
  Given a person with an active number and a verified email
  When someone posts that email and the password
  Then the response is 400 and no code is sent
```

## Implementation
- Create: `tests/integration/auth/login-sms-only.test.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `requestLogin(input: LoginInput, clientKeys: ClientKeys): Promise<{ sent: true; channel: 'SMS'; expires_in: number }>`
- Types:
  - `LoginInput = { phone_number: string; password: string }`
  - `LoginVerifyInput = { phone_number: string; code: string; device: DeviceInfo }`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.4.3: a sign-in code goes only to the SIM of the number.
- v5.0.0-6.3.3: the password alone never opens a session; the SMS code follows.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| email code refused | integration | AC-1, C-33 | use_email → 400; no job |
| email sign-in refused | integration | AC-2 | email without phone_number → 400 |
| verify refused | integration | AC-3 | email or use_email → 400; no session |
| sms still works | integration | AC-4 | 202 SMS then 200 tokens |
| email bypass | security | AB-1, CWE-288 | email with active number → 400; no job |

Command: `npx vitest run tests/integration/auth/login-sms-only.test.ts tests/integration/auth/login-request.test.ts tests/integration/auth/login-verify.test.ts tests/integration/auth/login-by-email.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/login-request.test.ts | 'email code' expects a code queued to the verified email, and 'email unverified' expects 400 EMAIL_NOT_VERIFIED | both post `use_email` and expect 400 VALIDATION_ERROR with nothing queued |
| tests/integration/auth/login-verify.test.ts | 'email channel' signs in with an EMAIL code | `use_email` answers 400 VALIDATION_ERROR |
| tests/integration/auth/login-by-email.test.ts | the email sign-in it tests no longer exists | every case posts `email` and expects 400 VALIDATION_ERROR; the success case is removed |

## Out of scope
- The lookup `findByVerifiedEmail`: AUTH-035.
- The answers about the account and the number-check limit (AUTH-028).

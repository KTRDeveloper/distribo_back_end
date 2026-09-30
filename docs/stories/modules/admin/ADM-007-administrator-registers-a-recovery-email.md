---
id: ADM-007
title: Administrator registers a recovery email
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-006, AUTH-004]
read_first: [src/modules/admin/admin.service.ts, src/modules/auth/otp.service.ts]
design_refs: [gouvernance-de-la-plateforme/administrator, acces-et-securite/otpchallenge]
constraints: [C-29, C-33]
asvs: [v5.0.0-6.4.3, v5.0.0-6.5.1]
---

# ADM-007 — Administrator registers a recovery email

## Story
As a moderator, I want to register and verify a recovery email so that I can reinstall my authenticator if I lose it.

## Context
- Exists: `issueCode` and `verifyCode` with purpose EMAIL_VERIFICATION and channel EMAIL; `adminAuthMiddleware`.
- Adds: `POST /api/v1/admin/recovery-email/request` with `{ email }` (sends a code to that address; the address must differ from the person's own email, else 400 `VALIDATION_ERROR`) and `POST /api/v1/admin/recovery-email/confirm` with `{ email, code }` (stores `recovery_email` only after a right code). Both 204 and admin-token only.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.

## Acceptance criteria
```gherkin
Scenario: AC-1 Register
  When an administrator requests a code for "secours@example.test" and confirms it
  Then recovery_email is stored
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and recovery_email is unchanged
  Examples:
    | problem                                    | status                |
    | the person's own email                     | 400 VALIDATION_ERROR  |
    | a wrong or expired code                    | 400 OTP_INVALID       |
    | a code sent to another address             | 400 OTP_INVALID       |
    | a normal access token                      | 401                   |
Scenario: AC-3 Not saved before confirmation
  When only the request was made
  Then recovery_email is still empty
```

## Abuse cases
```gherkin
Scenario: AB-1 Planting an attacker's address (tampering)
  When a stolen session tries to save an address without the code
  Then nothing is stored
```

## Implementation
- Create: `tests/integration/admin/recovery-email.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`
- Pattern: `src/modules/admin/admin.routes.ts`
- Signatures:
  - `requestRecoveryEmail(admin: AdminContext, email: string): Promise<void>`
  - `confirmRecoveryEmail(admin: AdminContext, email: string, code: string): Promise<void>`
- Errors: `VALIDATION_ERROR` 400, `OTP_INVALID` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.4.3: the address is saved only after a code received at it.
- v5.0.0-6.5.1: the code is bound to the address and purpose.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| register | integration | AC-1, C-33 | stored |
| refusals | integration | AC-2, C-29 | each Examples row → status |
| not saved early | integration | AC-3 | empty |
| planting | security | AB-1, CWE-345 | nothing stored |

Command: `npx vitest run tests/integration/admin/recovery-email.test.ts`

## Out of scope
- Using the address (ADM-008).

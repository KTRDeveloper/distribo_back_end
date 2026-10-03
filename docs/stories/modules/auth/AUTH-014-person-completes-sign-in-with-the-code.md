---
id: AUTH-014
title: Person completes sign-in with the code
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-013, AUTH-008, NTF-002, AUTH-009, AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/session.service.ts]
design_refs: [identite-et-organisation/person, acces-et-securite/device]
constraints: [C-33, CM-08]
asvs: [v5.0.0-6.5.1, v5.0.0-7.2.4, v5.0.0-16.3.1]
---

# AUTH-014 — Person completes sign-in with the code

## Story
As a customer, I want to enter the code I received so that I am signed in on this phone.

## Context
- Exists: LOGIN code sent (AUTH-013); `verifyCode`; `issueSession`; `notify`.
- Adds: `POST /api/v1/auth/login/verify` with `{ phone_number, code, device, use_email? }`; target is the number, or the person's email when `use_email` is true. Response 200 as `SessionResponse` (AUTH-010).
- A suspended person answers 403 `ACCOUNT_SUSPENDED` and the code is not spent. A new device is opened at every sign-in.
- When the person has other live devices, each gets one notification `device.new_login`: "Nouvelle connexion sur <model or un nouvel appareil>. Ce n'était pas vous ? Déconnectez-le." (English when the language is EN).
- Logs `info` event `login_succeeded` with person id and device id.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.
- `CM-08`: Access token (JWT) lives 15 minutes and is not stored; refresh token lives 90 days, extended at each use, replaced at each use; a reused token revokes only its own device session (REUSE_DETECTED).

## Acceptance criteria
```gherkin
Scenario: AC-1 Sign in
  Given a LOGIN code was sent
  When the person posts the right code and device info
  Then the response is 200 with access and refresh tokens and a new device exists
Scenario: AC-2 Wrong or expired code
  When the code is wrong, expired or already used
  Then the response is 400 `OTP_INVALID` or `OTP_EXPIRED` and no device is created
Scenario: AC-3 Alert to other phones
  Given the person has two live devices
  When a third signs in
  Then each of the two gets one unread notification `device.new_login` naming the new model, and the new device gets none
Scenario: AC-4 First device gets no alert
  When the person has no other live device
  Then no notification is created
Scenario: AC-5 Email channel
  When the code was sent by email and use_email is true
  Then the same code signs in
Scenario: AC-6 Suspended
  When the person is suspended
  Then the response is 403 `ACCOUNT_SUSPENDED` and no session is opened
```

## Abuse cases
```gherkin
Scenario: AB-1 Code from another purpose (tampering)
  When a REGISTRATION or PASSWORD_RESET code is submitted here
  Then the response is 400 `OTP_INVALID`
Scenario: AB-2 Sign-ins leave a trace (repudiation)
  When a sign-in succeeds
  Then a `login_succeeded` log exists and other devices were notified
```

## Implementation
- Create: `tests/integration/auth/login-verify.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `completeLogin(input: LoginVerifyInput): Promise<SessionResponse>`
- Types:
  - `LoginVerifyInput = { phone_number: string; code: string; device: DeviceInfo; use_email?: boolean }`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `OTP_LOCKED` 429, `ACCOUNT_SUSPENDED` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-6.5.1: the code is bound to purpose LOGIN and to the target.
- v5.0.0-7.2.4: a new device and tokens per sign-in.
- v5.0.0-16.3.1: sign-in success is logged.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sign in | integration | AC-1, CM-08 | right code → tokens and device |
| bad codes | integration | AC-2 | wrong, expired, used → errors, no device |
| alert | integration | AC-3 | two devices → two notifications |
| first device | integration | AC-4 | no notification |
| email channel | integration | AC-5, C-33 | EMAIL code accepted |
| suspended | integration | AC-6 | 403, no device |
| wrong purpose | security | AB-1, CWE-345 | REGISTRATION code → OTP_INVALID |
| trace | security | AB-2, CWE-778 | log event and notifications exist |

Command: `npx vitest run tests/integration/auth/login-verify.test.ts`

## Out of scope
- Email as the identifier (AUTH-015).

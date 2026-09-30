---
id: AUTH-020
title: Person chooses a new password with the code
module: auth
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-019, AUTH-008]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/session.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05, C-03]
asvs: [v5.0.0-6.4.3, v5.0.0-6.2.1, v5.0.0-7.4.3, v5.0.0-16.3.1]
---

# AUTH-020 — Person chooses a new password with the code

## Story
As a customer, I want to set a new password with the code so that I get back into my account and a stolen phone is signed out.

## Context
- Exists: `verifyCode`, `validatePasswordRules`, `hashPassword`, `revokeSessions`; the reset request (AUTH-019).
- Adds: `POST /api/v1/auth/password-reset/confirm` with `{ phone_number, code, new_password, use_email? }`; response 204. The code must be a PASSWORD_RESET code whose target is the number, or the verified email when `use_email` is true.
- On success: the new hash is stored, every device of the person is revoked with reason `PASSWORD_RESET`, the failed-attempt counter for that number is cleared, `info` event `password_reset` is logged.
- A weak password answers 400 `WEAK_PASSWORD` and the code is not spent.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the blocklist, hashed with Argon2id; 5 failed attempts force a wait.
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Reset
  When the right code and a valid new password are posted
  Then the response is 204, the stored hash verifies the new password and no longer the old one
Scenario: AC-2 Sessions end
  Given the person has two signed-in devices
  Then both devices are revoked with reason PASSWORD_RESET and their refresh tokens fail
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and the password is unchanged
  Examples:
    | problem                               | status                 |
    | a wrong code                          | 400 OTP_INVALID        |
    | an expired code                       | 400 OTP_EXPIRED        |
    | a REGISTRATION code                   | 400 OTP_INVALID        |
    | new_password "1234567"                | 400 WEAK_PASSWORD      |
    | an unregistered number                | 400 OTP_INVALID        |
Scenario: AC-4 Weak password keeps the code
  When a weak password is posted and then a valid one with the same code
  Then the second request succeeds
Scenario: AC-5 Lock cleared
  Given the number had 5 failed sign-in attempts
  When the reset succeeds
  Then the next sign-in attempt is not locked
```

## Abuse cases
```gherkin
Scenario: AB-1 Reset without the SIM (spoofing)
  When someone posts a reset without a code, or with guesses
  Then the password is unchanged and at most 5 guesses are counted
Scenario: AB-2 Password in logs (information disclosure)
  When a reset succeeds or fails
  Then no log line contains the password or the code
```

## Implementation
- Create: `tests/integration/auth/password-reset-confirm.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `confirmPasswordReset(input: PasswordResetConfirmInput): Promise<void>`
- Types:
  - `PasswordResetConfirmInput = { phone_number: string; code: string; new_password: string; use_email?: boolean }`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `WEAK_PASSWORD` 400, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `argon2`

## Security
- v5.0.0-6.4.3: the code proves the SIM or the verified email.
- v5.0.0-7.4.3: a reset ends every session.
- v5.0.0-6.2.1: the new password follows the same rules as registration.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| reset | integration | AC-1, CM-05, C-03 | 204, new hash verifies |
| sessions end | integration | AC-2 | both devices revoked, reason PASSWORD_RESET |
| refusals | integration | AC-3 | each Examples row → status, hash unchanged |
| weak keeps code | integration | AC-4 | weak then valid with the same code → success |
| lock cleared | integration | AC-5 | counter reset |
| no code | security | AB-1, WSTG-ATHN-09, CWE-640 | guesses → hash unchanged |
| no secrets in logs | security | AB-2, CWE-532 | logger output clean |

Command: `npx vitest run tests/integration/auth/password-reset-confirm.test.ts`

## Out of scope
- Changing the password while signed in (AUTH-021).

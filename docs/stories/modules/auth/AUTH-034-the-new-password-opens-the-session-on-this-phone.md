---
id: AUTH-034
title: The new password opens the session on this phone
module: auth
kind: change
rev: 1
amends: [AUTH-020]
size: S
risk: high
depends_on: [AUTH-033, AUTH-020, AUTH-008]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/session.service.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05, C-03]
asvs: [v5.0.0-6.4.3, v5.0.0-7.4.3, v5.0.0-16.3.1]
---

# AUTH-034 — The new password opens the session on this phone

## Story
As a customer, I want to set a new password with the code and be signed in on this phone so that I do not have to sign in again with a second code.

## Context
- Exists: `confirmPasswordReset` stores the new hash and revokes every device (reason `PASSWORD_RESET`) in one transaction, answers 204; `issueSession(personId, device, tx)`; `DeviceInfo` and `SessionResponse` (AUTH-010).
- `POST /api/v1/auth/password-reset/confirm` takes `{ phone_number, code, new_password, device }`; `use_email` is refused with 400. Success is 200 `SessionResponse`: in one transaction the hash changes, every existing device is revoked, then a new device and tokens are issued for this phone. The failure counter of the number is cleared. Logs `info` event `password_reset` with person and device ids.
- A suspended account learns it only after the code: the code is checked and spent, then 403 `ACCOUNT_SUSPENDED`, with the password and the sessions untouched.
- Other refusals are as before. `CM-05`: password rules. `C-03`: a registered person keeps a hash.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the common or leaked password blocklist; hashed with Argon2id; 5 failed attempts force a wait (design lines 63, 108-111)
- `C-03`: A registered person (`registered_at` set) who is not ANONYMIZED has `full_name` and `password_hash`, and `phone_verified_at` when `phone_number` is set; empty `phone_number` means empty `phone_verified_at`; empty `email` means empty `email_verified_at`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Reset opens a session
  Given the person has two signed-in devices
  When the right code, a valid password and device info are posted
  Then the response is 200 with access and refresh tokens and the new password verifies
  And both old devices are revoked with reason PASSWORD_RESET and only the new device is live
Scenario: AC-2 Suspended account
  When a suspended person posts the right code
  Then the response is 403 `ACCOUNT_SUSPENDED`, the password and the devices are unchanged
  And posting the same code again answers 400 `OTP_INVALID`
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status>, the password is unchanged and no device is created
  Examples:
    | problem                | status               |
    | a wrong code           | 400 OTP_INVALID      |
    | an expired code        | 400 OTP_EXPIRED      |
    | new_password "1234567" | 400 WEAK_PASSWORD    |
    | an unregistered number | 400 OTP_INVALID      |
    | no device              | 400 VALIDATION_ERROR |
    | use_email true         | 400 VALIDATION_ERROR |
Scenario: AC-4 All or nothing
  Given the session cannot be issued
  When the reset is posted
  Then the password is unchanged and the old devices are still live
```

## Abuse cases
```gherkin
Scenario: AB-1 A code from another number (spoofing)
  When the code sent to person A's number is posted with person B's number
  Then the response is 400 `OTP_INVALID` and B's password is unchanged
Scenario: AB-2 A suspended account is revealed before the code (information disclosure)
  When a wrong code is posted for a suspended account
  Then the answer is 400 `OTP_INVALID`, like any wrong code
```

## Implementation
- Create: `tests/integration/auth/password-reset-session.test.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/session.service.ts`
- Signatures:
  - `confirmPasswordReset(input: PasswordResetConfirmInput): Promise<SessionResponse>`
- Types:
  - `PasswordResetConfirmInput = { phone_number: string; code: string; new_password: string; device: DeviceInfo }`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `WEAK_PASSWORD` 400, `VALIDATION_ERROR` 400, `ACCOUNT_SUSPENDED` 403
- Dependencies: `express`, `zod`, `argon2`

## Security
- v5.0.0-6.4.3: the code proves the SIM; a code made for another number is refused.
- v5.0.0-7.4.3: a reset ends every other session and starts a new one.
- v5.0.0-16.3.1: the reset is logged with ids, never the password or the code.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| session opened | integration | AC-1, CM-05, C-03 | 200 tokens; new hash; old devices revoked; one live device |
| suspended | integration | AC-2 | 403; hash unchanged; code spent |
| refusals | integration | AC-3 | each Examples row → status; hash unchanged |
| all or nothing | integration | AC-4 | forced session failure → old hash, old devices live |
| other number | security | AB-1, CWE-287 | code of A with B's number → 400 |
| suspension hidden | security | AB-2, CWE-204 | wrong code on suspended → 400 OTP_INVALID |

Command: `npx vitest run tests/integration/auth/password-reset-session.test.ts tests/integration/auth/password-reset-confirm.test.ts tests/integration/auth/password-reset-atomic.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/password-reset-confirm.test.ts | posts without `device` and expects 204; has email cases | posts a `device`, expects 200 with tokens; the email cases expect 400 |
| tests/integration/auth/password-reset-atomic.test.ts | posts without `device` | posts a `device` and still expects the password and the live devices unchanged after the forced failure |

## Out of scope
- Asking for the code (AUTH-033).

---
id: ADM-008
title: Administrator reinstalls the authenticator through the recovery email
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-007, NTF-002]
read_first: [src/modules/admin/admin.service.ts, src/lib/totp.ts]
design_refs: [gouvernance-de-la-plateforme/administrator]
constraints: [CM-34, C-33]
asvs: [v5.0.0-6.4.4, v5.0.0-6.3.3, v5.0.0-16.3.1]
---

# ADM-008 — Administrator reinstalls the authenticator through the recovery email

## Story
As a moderator, I want to install a new authenticator key with a code sent to my recovery email so that losing my phone does not lock me out.

## Context
- Exists: recovery email (ADM-007), `createTotpSecret`, `issueCode`/`verifyCode` with purpose TOTP_RECOVERY, `recordAdminAction`, `notify`.
- Adds: `POST /api/v1/admin/auth/totp-recovery/request` with `{ phone_number, password }` and `POST /api/v1/admin/auth/totp-recovery/confirm` with `{ phone_number, password, code }`; both public (no token). Request: password checked (same counter and generic errors as ADM-006), a TOTP_RECOVERY code goes by EMAIL to the verified `recovery_email` of a live administrator; the answer is always 202. Confirm: with the right password and code, a new secret replaces the old one (encrypted) and the response is 200 `{ otpauth_uri }`; nothing else is changed and no session is issued.
- Each use writes `RECOVER_2FA` (reason "totp recovery", target the administrator's person), notifies the administrator's other devices `admin.2fa_recovered` and every other live SUPER_ADMIN, with the text "Ce n'était pas vous ? Bloquer".
- `CM-34`: A TOTP_RECOVERY code sent to the recovery email only allows installing a new TOTP key; each use is logged as RECOVER_2FA and notified to the administrator's phones and to the other super administrators.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.

## Acceptance criteria
```gherkin
Scenario: AC-1 Recovery
  Given an administrator with a verified recovery email
  When they request, then confirm with the right password and code
  Then the secret is replaced, the URI is returned, and the old secret no longer verifies
Scenario: AC-2 Trace and alerts
  Then a RECOVER_2FA journal row exists and the other super administrators and the administrator's devices have one notification
Scenario Outline: AC-3 Nothing happens
  When the request is for <case>
  Then the answer is 202 or 401 as for a wrong password and no code is sent
  Examples:
    | case                                              |
    | an administrator without a recovery email         |
    | a person who is not an administrator              |
    | a wrong password                                  |
Scenario: AC-4 Recovery gives no session
  Then the confirm response has no access token
Scenario: AC-5 Wrong or reused code
  Then the confirm answers 400 `OTP_INVALID` and the secret is unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Recovery as a back door (elevation)
  When someone with only the password calls the confirm route
  Then the secret is unchanged and an alert is not needed because nothing happened
Scenario: AB-2 Silent takeover (repudiation)
  When a recovery succeeds
  Then it is journaled and other super administrators are alerted
```

## Implementation
- Create: `tests/integration/admin/totp-recovery.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`
- Pattern: `src/modules/admin/admin.routes.ts`
- Signatures:
  - `requestTotpRecovery(input: { phone_number: string; password: string }): Promise<void>`
  - `confirmTotpRecovery(input: { phone_number: string; password: string; code: string }): Promise<{ otpauth_uri: string }>`
- Errors: `OTP_INVALID` 400, `INVALID_CREDENTIALS` 401, `LOGIN_LOCKED` 429
- Dependencies: `express`, `zod`, `otplib`

## Security
- v5.0.0-6.4.4: recovery needs the password and the verified recovery address.
- v5.0.0-16.3.1: every use is journaled and alerted.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| recovery | integration | AC-1, CM-34 | new secret works, old fails |
| trace and alerts | integration | AC-2 | journal and notifications |
| nothing happens | integration | AC-3, C-33 | each Examples row → no code |
| no session | integration | AC-4 | no token |
| bad code | integration | AC-5 | 400 |
| back door | security | AB-1, CWE-288 | unchanged |
| silent takeover | security | AB-2, CWE-778 | journaled |

Command: `npx vitest run tests/integration/admin/totp-recovery.test.ts`

## Out of scope
- Recovering when there is no recovery email: another super administrator appoints a new administrator.

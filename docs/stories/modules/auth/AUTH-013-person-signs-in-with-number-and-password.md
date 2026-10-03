---
id: AUTH-013
title: Person signs in with number and password
module: auth
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [AUTH-012, AUTH-004, PER-005, AUTH-009, AUTH-010]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [identite-et-organisation/person, acces-et-securite/connexion-verrouillage-et-telephone]
constraints: [CM-05, C-33]
asvs: [v5.0.0-6.3.1, v5.0.0-6.3.3, v5.0.0-6.3.8, v5.0.0-6.5.1, v5.0.0-16.3.1]
---

# AUTH-013 — Person signs in with number and password

## Story
As a customer, I want to enter my number and password and receive a code so that signing in needs both my password and my SIM.

## Context
- Exists: `verifyPassword` (AUTH-005); attempt counter (AUTH-012); `issueCode` (AUTH-004); `findByActivePhone`; `register` route file (AUTH-010).
- Adds: `POST /api/v1/auth/login` with `{ phone_number, password, use_email? }`. Success: 202 `{ sent: true, channel: 'SMS' | 'EMAIL', expires_in: 600 }` and a LOGIN code.
- Order: normalize the number; if the counter for that number is 5 or more answer 429 `LOGIN_LOCKED`; find the holder; verify the password (for an unknown number, a guest or a person without hash, verify against a fixed dummy Argon2id hash so timing matches); a failure adds 1 to the counter (window = `loginLockMinutes`) and answers 401 `INVALID_CREDENTIALS`; success resets the counter.
- A suspended person answers 403 `ACCOUNT_SUSPENDED` after a right password. `use_email: true` sends the code to the verified email, else 400 `EMAIL_NOT_VERIFIED`.
- Logs `warn` event `login_failed` (person id if known, no number) and `info` event `login_code_sent`.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the blocklist, hashed with Argon2id; 5 failed attempts force a wait.
- `C-33`: `OtpChallenge` allows 5 attempts at most; a consumed or expired code is never accepted; SMS goes only to +237 mobile numbers; an EMAIL code goes to the person's verified email, or to the administrator's recovery address, except for EMAIL_VERIFICATION.

## Acceptance criteria
```gherkin
Scenario: AC-1 Right password
  Given a registered person with a verified number
  When they post the number and password
  Then the response is 202 with channel SMS and one LOGIN code is queued to the number
Scenario: AC-2 Email channel
  Given a verified email
  When they post with use_email true
  Then the code is queued by email and the response says channel EMAIL
Scenario: AC-3 Email not verified
  When use_email is true and the email is unverified or empty
  Then the response is 400 `EMAIL_NOT_VERIFIED` and nothing is queued
Scenario Outline: AC-4 Failures look alike
  When the login uses <case>
  Then the response is 401 `INVALID_CREDENTIALS` with the same body
  Examples:
    | case                     |
    | an unknown number        |
    | a guest's number         |
    | a wrong password         |
    | a released number        |
Scenario: AC-5 Lock after 5 failures
  When 5 wrong passwords are sent for one number, then the right one
  Then the sixth attempt answers 429 `LOGIN_LOCKED` and no code is queued
  And after the lock window the right password works and clears the counter
Scenario: AC-6 Suspended
  When a suspended person sends the right password
  Then the response is 403 `ACCOUNT_SUSPENDED` and no code is queued
```

## Abuse cases
```gherkin
Scenario: AB-1 Credential stuffing (spoofing)
  When 100 wrong passwords are sent for one number
  Then at most 5 are checked and the rest answer 429
Scenario: AB-2 Account enumeration (information disclosure)
  When known and unknown numbers are tried with a wrong password
  Then bodies and status codes are identical and timings do not separate them by more than one Argon2 verification
```

## Implementation
- Create: `tests/integration/auth/login-request.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/auth.service.ts`
- Signatures:
  - `requestLogin(input: LoginInput, clientKeys: { ip?: string }): Promise<{ sent: true; channel: 'SMS' | 'EMAIL'; expires_in: number }>`
- Types:
  - `LoginInput = { phone_number: string; password: string; use_email?: boolean }`
- Errors: `INVALID_CREDENTIALS` 401, `LOGIN_LOCKED` 429, `ACCOUNT_SUSPENDED` 403, `EMAIL_NOT_VERIFIED` 400, `OTP_RATE_LIMITED` 429
- Dependencies: `express`, `zod`, `argon2`

## Security
- v5.0.0-6.3.1: lock after 5 failures per number.
- v5.0.0-6.3.3: the password alone never opens a session; a code follows.
- v5.0.0-6.3.8: same status, body and work for every failing case.
- v5.0.0-16.3.1: failures and code sends are logged with fixed event names.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sms code | integration | AC-1, C-33 | 202, queued to number |
| email code | integration | AC-2 | 202 EMAIL, queued to email |
| email unverified | integration | AC-3 | 400 |
| failures alike | integration | AC-4 | four cases → equal 401 bodies |
| lock | integration | AC-5, CM-05 | 5 wrong → 429; after window → 202 |
| suspended | integration | AC-6 | 403 |
| stuffing | security | AB-1, WSTG-ATHN-03, CWE-307 | 100 wrong → 5 verified, 95 429 |
| enumeration | security | AB-2, WSTG-IDNT-04, CWE-204 | equal bodies; dummy verify called for unknown number |

Command: `npx vitest run tests/integration/auth/login-request.test.ts`

## Out of scope
- Checking the code and opening the session (AUTH-014). Email as identifier (AUTH-015).

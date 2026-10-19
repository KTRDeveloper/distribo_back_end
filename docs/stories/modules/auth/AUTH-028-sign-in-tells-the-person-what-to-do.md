---
id: AUTH-028
title: Sign-in tells the person what to do
module: auth
kind: change
rev: 1
amends: [AUTH-013]
size: S
risk: high
depends_on: [AUTH-013]
read_first: [src/modules/auth/auth.service.ts, src/modules/auth/otp.service.ts]
design_refs: [identite-et-organisation/person, acces-et-securite/connexion-verrouillage-et-telephone]
constraints: [CM-05]
asvs: [v5.0.0-6.3.1, v5.0.0-2.4.1, v5.0.0-16.3.1]
---

# AUTH-028 — Sign-in tells the person what to do

## Story
As a customer, I want sign-in to tell me whether my number has an account so that I know to create one or to retype my password.

## Context
- Exists: `requestLogin` counts failures under `login:fail:<phone>` (5 lock the number, 429 `LOGIN_LOCKED`) and answers one 401 for an unknown, guest, released or wrong-password case, with a dummy-hash check; `ClientKeys` carries `ip`; `configService.get(category, key)` returns null when unset.
- `POST /api/v1/auth/login` now answers: no registered holder with a password (unknown number, guest, released number) 404 `ACCOUNT_NOT_FOUND`; wrong password 401 `INVALID_CREDENTIALS`; right password on a suspended account 403 `ACCOUNT_SUSPENDED`, with no code. A wrong password on a suspended account is the plain 401. The dummy hash is dropped: existence is no longer hidden. The lock is unchanged.
- Adds `src/modules/auth/number-check-limit.ts` with `checkNumberQuota(ip)`: one count per call under `numcheck:ip:<ip>` for 3600 s against `configService.get<number>('auth', 'max_number_checks_per_ip_per_hour')`; unset = off. Over the limit: 429 `RATE_LIMITED` and a `warn` log, event `number_check_limited`, without the number. `requestLogin` calls it first; AUTH-029, AUTH-031 and AUTH-033 call it too. No device id exists before sign-in, so the IP is the only key.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the common or leaked password blocklist; hashed with Argon2id; 5 failed attempts force a wait (design lines 63, 108-111)

## Acceptance criteria
```gherkin
Scenario: AC-1 Right password
  Given a registered person with a verified number
  When they post the number and password
  Then the response is 202 with channel SMS and one LOGIN code is queued to the number
Scenario Outline: AC-2 No account
  When the login uses <case>
  Then the response is 404 `ACCOUNT_NOT_FOUND` and nothing is queued
  Examples:
    | case              |
    | an unknown number |
    | a guest's number  |
    | a released number |
Scenario: AC-3 Wrong password
  When a registered holder's number is posted with a wrong password
  Then the response is 401 `INVALID_CREDENTIALS` and the failure counter rises by 1
Scenario: AC-4 Suspended account
  When a suspended person sends the right password
  Then the response is 403 `ACCOUNT_SUSPENDED` and no code is queued
  And a wrong password for that person answers 401 `INVALID_CREDENTIALS`
Scenario: AC-5 Number checks are counted
  Given the limit is 2 per hour and per IP
  When one IP checks 3 different numbers
  Then the third answers 429 `RATE_LIMITED`
  And with the limit unset 50 checks are all answered
```

## Abuse cases
```gherkin
Scenario: AB-1 Scanning numbers to list accounts (information disclosure)
  Given the limit is 5 per hour
  When one IP posts 20 different numbers
  Then at most 5 are answered about existence and the rest answer 429
Scenario: AB-2 Suspension shown to a guesser (information disclosure)
  When a wrong password is sent for a suspended account
  Then the answer is the same 401 as for any wrong password
```

## Implementation
- Create: `src/modules/auth/number-check-limit.ts`, `tests/integration/auth/login-answers.test.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.openapi.ts`
- Pattern: `src/modules/auth/otp.service.ts`
- Signatures:
  - `checkNumberQuota(ip: string | undefined): Promise<void>`
- Errors: `ACCOUNT_NOT_FOUND` 404, `INVALID_CREDENTIALS` 401, `ACCOUNT_SUSPENDED` 403, `LOGIN_LOCKED` 429, `RATE_LIMITED` 429
- Dependencies: `express`, `zod`, `argon2`

## Security
- v5.0.0-6.3.1: 5 failures lock a number, and a per-IP limit counts every number check, because the answers now say whether an account exists.
- v5.0.0-2.4.1: the number-check limit stops automated scans of numbers.
- v5.0.0-16.3.1: failures and limit hits are logged with fixed event names and ids, never numbers.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| right password | integration | AC-1, CM-05 | 202 SMS; job queued to the number |
| no account | integration | AC-2 | each Examples row → 404 ACCOUNT_NOT_FOUND, nothing queued |
| wrong password | integration | AC-3 | 401; counter 1 |
| suspended | integration | AC-4 | right password 403; wrong password 401 |
| number checks | integration | AC-5 | limit 2 → third is 429; unset → 50 answered |
| scan | security | AB-1, WSTG-IDNT-04, CWE-204 | 20 numbers, limit 5 → 15 answer 429 |
| suspension hidden | security | AB-2, CWE-204 | wrong password on suspended → same 401 body |

Command: `npx vitest run tests/integration/auth/login-answers.test.ts tests/integration/auth/login-request.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/auth/login-request.test.ts | 'failures alike' expects one 401 INVALID_CREDENTIALS for unknown, guest, released and wrong-password cases, and 'enumeration' expects the same status and code, and one password check, for a known and an unknown number | unknown, guest and released numbers answer 404 ACCOUNT_NOT_FOUND, the wrong password 401 INVALID_CREDENTIALS, and an unknown number runs no password check |
| tests/integration/privacy/anonymize.test.ts | 'AC-5: login with the old number and password answers the generic 401' expects 401 INVALID_CREDENTIALS after the account is anonymized; the number is then released, so it is an unknown number (PRIV-002 AC-5 reworded to match) | the login answers 404 ACCOUNT_NOT_FOUND |

## Out of scope
- The email as a way to sign in: AUTH-036. The lock, the code and the session steps keep their behaviour.
- The number-check limit value: the design gives none for this step (open question); unset means off.
- Play Integrity on code requests.

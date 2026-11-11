---
id: AUTH-044
title: A password lock lasts one minute and says when it ends
module: auth
kind: change
rev: 1
amends: [AUTH-012]
size: M
risk: high
depends_on: [AUTH-043]
read_first: [src/modules/auth/auth.service.ts, tests/integration/auth/attempt-lock-concurrency.test.ts]
design_refs: [a7-blocage-apres-5-erreurs-de-mot-de]
constraints: []
asvs: [v5.0.0-6.3.1]
---

# AUTH-044 — A password lock lasts one minute and says when it ends

## Story
As a customer, I want a password lock to last one minute and tell me the time left, so that I can wait for exactly that long.

## Context
- `LOGIN_LOCK_MINUTES` defaults to 1 (`src/config/env.ts`; drop "provisional Q-005" from its comment) and `.env.example` sets 1. The duration is fixed and one for every password lock.
- Every 429 `LOGIN_LOCKED` carries `Retry-After` = `secondsLeft(key, loginLockMinutes * 60)` on the counter key that refused: `takeAttempt` (`auth.service.ts`, login and password change), `deleteAccount` (`privacy.service.ts`), and both lock checks in `admin.service.ts`.
- Unchanged rules: the right password is refused during the lock; a refused try does not extend it; after it the right password passes and resets the counter; the SMS reset stays possible and lifts it.
- Tests may shorten a lock by setting the key's remaining time in Redis instead of waiting.

## Acceptance criteria
```gherkin
Scenario: AC-1 Retry-After on the lock
  Given 5 wrong passwords in a row for phone N
  When a 6th login is tried
  Then the answer is 429 LOGIN_LOCKED with Retry-After between 1 and 60
Scenario: AC-2 The right password is refused, the time keeps falling
  Given N is locked with Retry-After R
  When the right password is tried after 2 seconds
  Then it gets 429 with Retry-After lower than R
Scenario: AC-3 After the lock
  Given N's lock has ended
  When the right password is tried
  Then it passes and the counter is back to zero
Scenario: AC-4 The SMS reset lifts the lock
  Given N is locked
  When the password is reset with the SMS code
  Then the reset succeeds and the new password passes at once
Scenario Outline: AC-5 Every lock carries the header
  When <gesture> is locked
  Then the 429 LOGIN_LOCKED carries Retry-After
  Examples:
    | gesture             |
    | a password change   |
    | an account deletion |
    | an admin login      |
```

## Abuse cases
```gherkin
Scenario: AB-1 Extending a lock by hammering
  Given N is locked
  When 20 more passwords are tried
  Then the lock still ends within 60 seconds of the 5th failure
```

## Implementation
- Create: `tests/integration/auth/lock-retry-after.test.ts`
- Modify: `src/config/env.ts`, `src/modules/auth/auth.service.ts`, `src/modules/privacy/privacy.service.ts`, `src/modules/admin/admin.service.ts`, `.env.example`
- Pattern: `tests/integration/auth/attempt-lock-concurrency.test.ts`
- Dependencies: none added

## Security
- v5.0.0-6.3.1: 5 failures lock the password for a fixed minute that refused tries cannot extend; the code asked at every login stays the main protection.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| header | integration | AC-1 | 429, Retry-After 1..60 |
| falling | integration | AC-2 | lower Retry-After |
| after lock | integration | AC-3 | 200, counter reset |
| sms reset | integration | AC-4 | reset 200, login passes |
| other locks | integration | AC-5 | each Examples row → Retry-After |
| hammering | security | AB-1, WSTG-ATHN-03 | Retry-After never above the first |

Command: `npx vitest run tests/integration/auth/lock-retry-after.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/auth/attempt-counter.test.ts | the default lock is now 1 minute (A7) | 'defaults to 5' becomes 'defaults to 1' and expects 1 |

## Out of scope
- Documenting the header in OpenAPI.

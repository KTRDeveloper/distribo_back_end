---
id: AUTH-012
title: Failed-attempt counter and lock duration
module: auth
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [AUTH-005]
read_first: [src/lib/rate-limit.ts, src/config/env.ts]
design_refs: [identite-et-organisation/person]
constraints: [CM-05]
asvs: [v5.0.0-6.3.1, v5.0.0-2.4.1]
---

# AUTH-012 — Failed-attempt counter and lock duration

## Story
Technical story: count failed password attempts per key and read the wait time from the environment, so that login can lock after 5 failures.

## Context
- Exists: `checkAndConsume`, `RateLimitClient` in `src/lib/rate-limit.ts`; env parsed in `src/config/env.ts`, exposed by `src/config/index.ts`.
- Adds: `getCount(key, client?)` and `resetKey(key, client?)` in `rate-limit.ts` (a missing key counts 0); env `LOGIN_LOCK_MINUTES` (positive integer, default 5, provisional, Q-005) exposed as `config.auth.loginLockMinutes`.
- `CM-05`: Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the blocklist, hashed with Argon2id; 5 failed attempts force a wait.

## Acceptance criteria
```gherkin
Scenario: AC-1 Counting
  When consume is called 3 times on one key, then getCount is read
  Then getCount returns 3 and a different key returns 0
Scenario: AC-2 Reset
  When resetKey is called on a key with count 3
  Then getCount returns 0
Scenario Outline: AC-3 Environment
  When `LOGIN_LOCK_MINUTES` is <value>
  Then config.auth.loginLockMinutes is <result>
  Examples:
    | value    | result                  |
    | missing  | 5                       |
    | 10       | 10                      |
    | 0        | startup fails           |
    | abc      | startup fails           |
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/auth/attempt-counter.test.ts`
- Modify: `src/lib/rate-limit.ts`, `src/config/env.ts`, `src/config/index.ts`
- Pattern: `src/lib/rate-limit.ts`
- Signatures:
  - `getCount(key: string, client?: RateLimitClient): Promise<number>`
  - `resetKey(key: string, client?: RateLimitClient): Promise<void>`
- Dependencies: `ioredis`, `zod`

## Security
- v5.0.0-6.3.1: the lock duration is configuration, validated at startup.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| counting | unit | AC-1 | fake client → 3 and 0 |
| reset | unit | AC-2 | reset → 0 |
| environment | unit | AC-3, CM-05 | each Examples row → value or startup error |

Command: `npx vitest run tests/unit/auth/attempt-counter.test.ts tests/unit/lib/rate-limit.test.ts`

## Out of scope
- Using the counter (AUTH-013).

---
id: AUTH-043
title: A lock refusal can tell the time left
module: auth
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [AUTH-012]
read_first: [src/lib/rate-limit.ts, src/lib/http-error.ts]
design_refs: [a7-blocage-apres-5-erreurs-de-mot-de]
constraints: []
asvs: [v5.0.0-6.3.1]
---

# AUTH-043 — A lock refusal can tell the time left

## Story
Technical story: read the time left on a counter and send headers with an application error, so that a lock refusal can carry `Retry-After`.

## Context
- `checkAndConsume` keeps its result; a refusal does not touch the key's expiry.
- New `secondsLeft(key, windowSeconds, client = redis)` in `src/lib/rate-limit.ts`: the key's remaining time from PTTL, in whole seconds rounded up, at least 1. `RateLimitClient` gets an optional `pttl`; a client without it gives `windowSeconds`.
- `httpError(status, code, message, details?, headers?)`: the optional `headers` (a string map) is kept on the error; `src/middleware/error-handler.ts` sets them on the response before the JSON body.
- Existing calls and tests do not change.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Time left
  Given a counter key whose remaining time is <pttl> ms
  When secondsLeft reads it
  Then it returns <seconds>
  Examples:
    | pttl  | seconds |
    | 60000 | 60      |
    | 1200  | 2       |
    | 1     | 1       |
    | -2    | 1       |
Scenario: AC-2 Headers on an error
  When a route throws httpError(429, "LOGIN_LOCKED", "Too many failed attempts", undefined, {"Retry-After": "42"})
  Then the response is 429 with header Retry-After 42 and the usual error body
Scenario: AC-3 No headers
  When a route throws httpError without headers
  Then the response is as before
```

## Abuse cases
```gherkin
Scenario: AB-1 A header carrying data
  When an error carries headers
  Then the error body has no headers field and the log entry holds no header value
```

## Implementation
- Create: `tests/unit/lib/seconds-left.test.ts`, `tests/unit/middleware/error-headers.test.ts`
- Modify: `src/lib/rate-limit.ts`, `src/lib/http-error.ts`, `src/middleware/error-handler.ts`
- Pattern: `tests/unit/lib/http-error.test.ts`
- Signatures:
  - `secondsLeft(key: string, windowSeconds: number, client?: RateLimitClient): Promise<number>`
  - `httpError(status: number, code: string, message: string, details?: Record<string, unknown>, headers?: Record<string, string>): HttpError`
- Dependencies: `ioredis`

## Security
- v5.0.0-6.3.1: the lock keeps its fixed duration; reading the time left never extends it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| time left | unit | AC-1 | each Examples row → seconds |
| headers | unit | AC-2 | 429, Retry-After 42, body unchanged |
| no headers | unit | AC-3 | as before |
| no leak | security | AB-1, CWE-209 | no headers field in body |

Command: `npx vitest run tests/unit/lib/seconds-left.test.ts tests/unit/middleware/error-headers.test.ts`

## Out of scope
- Using it on the lock refusals (AUTH-044).

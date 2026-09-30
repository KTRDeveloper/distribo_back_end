---
id: FND-008
title: Default JSON body limit of 100 kb
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [FND-006]
read_first: [src/app.ts, src/middleware/error-handler.ts]
design_refs: [synchronisation-hors-ligne/principes-la-synchronisation-classique]
constraints: []
asvs: [v5.0.0-2.2.1, v5.0.0-15.2.2]
---

# FND-008 — Default JSON body limit of 100 kb

## Story
Technical story: replace the 10 MB body limit with a 100 kb default and a per-route override, so that no route accepts an oversized body except the ones that need it.

## Context
- Exists: `src/app.ts` uses `express.json({ limit: '10mb' })` and `express.urlencoded({ ..., limit: '10mb' })`.
- Adds: `src/middleware/body-parser.ts` exporting `jsonBodyParser` and `BODY_LIMITS` (`{ '/api/v1/sync/push': '5mb' }`, the route SYNC creates later); default `100kb`. `src/app.ts` uses it and the urlencoded limit becomes `100kb`.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Body size
  When a POST with a JSON body of <size> is sent to `/api/v1/auth/login`
  Then the status is <status>
  Examples:
    | size   | status |
    | 90 kb  | 401 or 400 (the route's own answer, not 413) |
    | 101 kb | 413    |
Scenario: AC-2 Error shape
  When the body is too large
  Then the body is `{ error: { code: "PAYLOAD_TOO_LARGE", message, requestId } }`
Scenario: AC-3 Override
  Then `BODY_LIMITS['/api/v1/sync/push']` is `5mb` and every other path uses `100kb`
```

## Abuse cases
```gherkin
Scenario: AB-1 Memory exhaustion (denial of service)
  When a client sends a 2 MB JSON body to any route except the override
  Then the response is 413 and the body is not parsed
```

## Implementation
- Create: `src/middleware/body-parser.ts`, `tests/integration/foundation/body-limit.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/middleware/request-id.ts`
- Signatures:
  - `jsonBodyParser: express.RequestHandler`
- Types:
  - `BODY_LIMITS: Record<string, string>`
- Errors: `PAYLOAD_TOO_LARGE` 413
- Dependencies: `express`, `supertest`

## Security
- v5.0.0-2.2.1: explicit maximum on every request body.
- v5.0.0-15.2.2: the limit is checked before parsing.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| sizes | integration | AC-1 | 90 kb → not 413; 101 kb → 413 |
| error shape | integration | AC-2 | 101 kb → code PAYLOAD_TOO_LARGE with requestId |
| override table | unit | AC-3 | read BODY_LIMITS → sync push 5mb, default 100kb |
| large body | security | AB-1, CWE-770 | 2 MB body to `/api/v1/auth/login` → 413 |

Command: `npx vitest run tests/integration/foundation/body-limit.test.ts`

## Out of scope
- The sync push route itself (SYNC module).

---
id: FND-006
title: Shared HTTP error helper
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [FND-000]
read_first: [src/middleware/error-handler.ts, docs/stories/CONVENTIONS.md]
design_refs: [notes-de-conception]
constraints: []
asvs: [v5.0.0-16.5.1]
---

# FND-006 — Shared HTTP error helper

## Story
Technical story: provide `httpError` with the shape the global handler already reads, so that services stop building errors by hand.

## Context
- Exists: `src/middleware/error-handler.ts` maps any error with a numeric `statusCode` to that status and returns `{ error: { message, code, requestId } }`; services build errors with `Object.assign(new Error(msg), { statusCode, code })`.
- Adds: `src/lib/http-error.ts`. No existing service is rewritten.

## Acceptance criteria
```gherkin
Scenario: AC-1 Shape
  When httpError(409, "PHONE_EXISTS", "Already registered") is thrown in a route
  Then the response is 409 with body `{ error: { message: "Already registered", code: "PHONE_EXISTS", requestId } }`
Scenario: AC-2 Unexpected errors stay generic
  When a route throws a plain Error("db password is x")
  Then the response is 500 `INTERNAL_ERROR` with message "Internal server error"
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/lib/http-error.ts`, `tests/unit/lib/http-error.test.ts`
- Pattern: `src/middleware/error-handler.ts`
- Signatures:
  - `httpError(status: number, code: string, message: string): Error & { statusCode: number; code: string }`
- Dependencies: `express`, `supertest`

## Security
- v5.0.0-16.5.1: a plain error never leaks its message; only httpError messages are returned.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| shape | unit | AC-1 | mini express app with the global handler and a route throwing httpError → 409 and the body above |
| generic | unit | AC-2, CWE-209 | route throws Error with a secret-like text → 500 and the text is absent from the body |

Command: `npx vitest run tests/unit/lib/http-error.test.ts`

## Out of scope
- Changing the Zod 400 mapping.

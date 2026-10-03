---
id: FND-012
title: Validation errors without input values
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [FND-008]
read_first: [src/middleware/error-handler.ts, tests/integration/foundation/body-limit.test.ts]
design_refs: []
constraints: []
asvs: [v5.0.0-15.3.1, v5.0.0-16.2.5, v5.0.0-16.5.1]
---

# FND-012 — Validation errors without input values

## Story
Technical story: validation errors keep only each issue's field path and rule code so that no input value or key name reaches a response or a log.

## Context
- Exists: `errorHandler` (`src/middleware/error-handler.ts`) answers a `ZodError` with 400 `VALIDATION_ERROR` and `details: err.errors`, and logs `errors: err.errors` under `Validation error`.
- Routes reach it through `schema.parse()`: `notification.routes.ts`, `person.routes.ts`, the remote-config controller.
- Zod 3 issues carry input: `received` (enum, literal), `keys` (unknown keys), `unionErrors`, and messages quoting them.
- Adds: every issue becomes `{ path, code }`, in the response and in the log entry.

## Acceptance criteria
```gherkin
Scenario: AC-1 Details keep the path and the rule code
  Given a route that parses its body with `z.object({ status: z.enum(['OPEN', 'CLOSED']) }).strict()`
  When the body is {"status": "LEAK-enum"}
  Then the response is 400 with `error.code` VALIDATION_ERROR, `error.message` "Validation failed" and `error.requestId` set
  And `error.details` is [{"path": ["status"], "code": "invalid_enum_value"}]
Scenario Outline: AC-2 No input value or key name is returned
  When the body is <body>
  Then every `error.details` item has exactly the keys `path` and `code`, with code <code>
  And the response body does not contain <marker>
  Examples:
    | body | code | marker |
    | {"status": "LEAK-enum"} | invalid_enum_value | LEAK-enum |
    | {"status": "OPEN", "LEAK-key": 1} | unrecognized_keys | LEAK-key |
    | {"status": "OPEN", "kind": "LEAK-lit"} | invalid_literal | LEAK-lit |
    | {"status": "OPEN", "ref": "LEAK-union"} | invalid_union | LEAK-union |
Scenario: AC-3 The log entry holds the same details
  When the body is {"status": "LEAK-enum"}
  Then `logger.warn` is called with "Validation error" and an object whose `details` equal the response's `details`
  And that object has no `errors` key and does not contain LEAK-enum
```

## Abuse cases
```gherkin
Scenario: AB-1 Personal data sent in a wrong field (information disclosure)
  When the body is {"status": "+10000000000"}
  Then neither the response nor the `Validation error` log entry contains +10000000000
```

## Implementation
- Create: `tests/integration/foundation/validation-details.test.ts`
- Modify: `src/middleware/error-handler.ts`
- Pattern: `tests/integration/foundation/body-limit.test.ts`
- Types:
  - `ValidationDetail = { path: (string | number)[]; code: string }, the type of `details` in `ErrorResponse``
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `zod`, `express`, `supertest`

## Security
- v5.0.0-16.5.1: the 400 response names the field and the failed rule only, never a received value, a key name or a Zod message.
- v5.0.0-16.2.5: the `Validation error` entry logs the sanitized `details`, never the Zod issues.
- v5.0.0-15.3.1: build each item from `path` and `code` explicitly; never spread a Zod issue.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| details shape | integration | AC-1 | enum value → 400, details [{path: ["status"], code: "invalid_enum_value"}], message and requestId kept |
| no reflected input | security | AC-2, WSTG-ERRH-01, CWE-209 | each Examples body → items with path and code only; marker absent |
| sanitized log | security | AC-3, AB-1, CWE-532 | spy on `logger.warn` → details equal the response's; no `errors`, marker or fake phone |

Command: `npx vitest run tests/integration/foundation/validation-details.test.ts`

## Out of scope
- The `Application error` and `Unhandled error` branches, including the 500 log's `error` and `stack`.
- Documenting `details` in the OpenAPI `Error` schema (`src/lib/openapi/registry.ts`).

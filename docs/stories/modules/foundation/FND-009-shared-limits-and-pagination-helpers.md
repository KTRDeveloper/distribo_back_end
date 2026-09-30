---
id: FND-009
title: Shared limits and pagination helpers
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [FND-006]
read_first: [docs/stories/CONVENTIONS.md, src/lib/http-error.ts]
design_refs: [notes-de-conception]
constraints: []
asvs: [v5.0.0-2.2.1, v5.0.0-15.2.2]
---

# FND-009 — Shared limits and pagination helpers

## Story
Technical story: provide the text limits and the cursor pagination every list route uses, so that lists are bounded and validated the same way.

## Context
- Adds: `src/shared/limits.ts` (`NAME_MAX` 100, `TEXT_MAX` 2000, `LABEL_MAX` 100, `PAGE_DEFAULT` 50, `PAGE_MAX` 100; provisional, Q-027) and `src/shared/pagination.ts`.
- A cursor is base64url JSON `{ createdAt: ISO string, id: uuid }`; lists sort by `created_at` descending then `id` descending.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Page size
  When paginationQuerySchema parses limit <limit>
  Then the result is <result>
  Examples:
    | limit   | result     |
    | missing | 50         |
    | 1       | 1          |
    | 100     | 100        |
    | 0       | ZodError   |
    | 101     | ZodError   |
    | abc     | ZodError   |
Scenario: AC-2 Cursor round trip
  When a cursor is encoded and decoded
  Then the decoded `createdAt` and `id` equal the originals
Scenario: AC-3 Malformed cursor
  When decodeCursor receives text that is not base64url JSON or lacks a UUID id
  Then it throws `httpError(400, 'VALIDATION_ERROR', ...)`
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/shared/limits.ts`, `src/shared/pagination.ts`, `tests/unit/shared/pagination.test.ts`
- Pattern: `tests/unit/crypto.test.ts`
- Signatures:
  - `encodeCursor(cursor: { createdAt: Date; id: string }): string`
  - `decodeCursor(text: string): { createdAt: Date; id: string }`
- Types:
  - `paginationQuerySchema: z.ZodObject<{ limit: number; cursor?: string }>`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `zod`

## Security
- v5.0.0-2.2.1: the page size has a maximum of 100 on every list.
- v5.0.0-15.2.2: a cursor is validated before it reaches a query.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| page size | unit | AC-1 | each Examples row → value or ZodError |
| round trip | unit | AC-2 | encode then decode → same values |
| malformed | unit | AC-3 | garbage, valid base64 of non-JSON, missing id → 400 error |

Command: `npx vitest run tests/unit/shared/pagination.test.ts`

## Out of scope
- Applying pagination to a route (each list story).

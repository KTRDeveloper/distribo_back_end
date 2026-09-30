---
id: FND-005
title: Shared identifiers and column type helper
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: low
depends_on: [FND-001]
read_first: [docs/stories/CONVENTIONS.md, tests/setup.ts]
design_refs: [legende, contraintes-a-poser-au-niveau-base-de]
constraints: [C-01]
asvs: [v5.0.0-2.2.1]
---

# FND-005 — Shared identifiers and column type helper

## Story
Technical story: generate and validate UUIDv7 identifiers and check column types in tests, so that every table follows the same identifier and type rules.

## Context
- Adds: `src/shared/ids.ts` (`newId`, `uuidV7Schema`) and `tests/helpers/db-schema.ts` (`expectColumnType`).
- New tables declare `id String @id @db.Uuid` without a default; code sets the id with `newId()` or takes a client-created UUIDv7.
- `C-01`: Identifiers use `uuid` columns (UUIDv7), amounts `bigint`, quantities `numeric(12,3)`, timestamps `timestamptz`.

## Acceptance criteria
```gherkin
Scenario: AC-1 newId
  When newId is called 1000 times
  Then every value is a UUIDv7 (version nibble 7, variant 8 to b) and all are distinct
Scenario Outline: AC-2 uuidV7Schema
  When uuidV7Schema parses <value>
  Then it <result>
  Examples:
    | value                                  | result  |
    | a valid UUIDv7                         | accepts |
    | a UUIDv4                               | fails   |
    | 123                                    | fails   |
    | a UUIDv7 in upper case                 | accepts |
Scenario: AC-3 expectColumnType
  Given a scratch table with columns `id uuid`, `amount bigint`, `quantity numeric(12,3)`, `at timestamptz`
  When expectColumnType is called with the right and with a wrong type
  Then it passes for the right type and throws for the wrong one
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/shared/ids.ts`, `tests/helpers/db-schema.ts`, `tests/unit/shared/ids.test.ts`
- Pattern: `tests/unit/crypto.test.ts`
- Signatures:
  - `newId(): string`
  - `expectColumnType(table: string, column: string, dataType: string, numericPrecision?: [number, number]): Promise<void>`
- Types:
  - `uuidV7Schema: z.ZodString`
- Dependencies: `uuid`, `zod`

## Security
- v5.0.0-2.2.1: a client-created id is accepted only if it is a UUIDv7.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| newId | unit | AC-1 | 1000 calls → all match the UUIDv7 pattern, no duplicate |
| schema | unit | AC-2 | each Examples row → result |
| column helper | integration | AC-3, C-01 | scratch table checked with right and wrong types → pass and throw |

Command: `npx vitest run tests/unit/shared/ids.test.ts`

## Out of scope
- Applying column checks to real tables (each table's story).

---
id: PER-008
title: Registered-person guard for author columns
module: person
kind: technical
rev: 1
amends: []
size: XS
risk: high
depends_on: [PER-003, FND-002]
read_first: [tests/integration/foundation/database-roles.test.ts, prisma/schema.prisma]
design_refs: [identite-et-organisation/person, contraintes-a-poser-au-niveau-base-de]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-2.2.3]
---

# PER-008 — Registered-person guard for author columns

## Story
Technical story: create one SQL trigger function that refuses a guest in any author column, so that each table story can attach it and a guest can never act.

## Context
- Exists: `people` with `registered_at` (PER-002).
- Adds: SQL function `require_registered_person()` used as `CREATE TRIGGER ... BEFORE INSERT OR UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION require_registered_person('col_a', 'col_b')`. It reads the column names from `TG_ARGV`, skips a null value, and on UPDATE skips a column whose value did not change. A person counts as registered when `registered_at` is set, even if later anonymized.
- Each table story attaches the trigger to its own author columns and tests it (constraint C-04).

## Acceptance criteria
```gherkin
Scenario: AC-1 Registered author accepted
  Given a scratch table with column `by_id` and the trigger on it
  When a row references a registered person
  Then the insert succeeds
Scenario: AC-2 Guest refused
  When a row references a guest (empty `registered_at`)
  Then the insert fails with SQLSTATE 23514 and a message naming the column
Scenario: AC-3 Null skipped
  When the author column is null
  Then the insert succeeds
Scenario: AC-4 Unchanged column skipped on update
  Given a row whose author was registered when inserted and was anonymized later
  When another column of that row is updated
  Then the update succeeds
  And changing the author column to a guest fails with 23514
```

## Abuse cases
```gherkin
Scenario: AB-1 Guest acts through a crafted request (elevation)
  When code inserts an action row whose author is a guest, bypassing every check in the application
  Then PostgreSQL refuses the row
```

## Implementation
- Create: `prisma/migrations/<timestamp>_per_008_registered_person_guard/migration.sql`, `tests/integration/person/registered-guard.test.ts`
- Pattern: `tests/integration/foundation/database-roles.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.2.1: the check lives in the database, so it holds for every code path.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| registered accepted | integration | AC-1 | scratch table and trigger → insert with a registered person passes |
| guest refused | integration | AC-2 | insert with a guest → 23514 |
| null skipped | integration | AC-3 | null author → passes |
| unchanged skipped | integration | AC-4 | anonymized author row updated elsewhere → passes; author set to a guest → 23514 |
| crafted request | security | AB-1, CWE-862 | raw insert with a guest author → 23514 |

Command: `npx vitest run tests/integration/person/registered-guard.test.ts`

## Out of scope
- Attaching the trigger to real tables (each table's story).

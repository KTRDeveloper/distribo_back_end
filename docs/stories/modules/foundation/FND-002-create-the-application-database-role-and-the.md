---
id: FND-002
title: Create the application database role and the server-time trigger
module: foundation
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [FND-001]
read_first: [prisma.config.ts, tests/setup.ts]
design_refs: [acces-et-securite/la-base-de-donnees-dernier-rempart, contraintes-a-poser-au-niveau-base-de]
constraints: [C-39, C-35]
asvs: [v5.0.0-8.3.1, v5.0.0-13.3.2]
---

# FND-002 — Create the application database role and the server-time trigger

## Story
Technical story: give the application its own least-privilege PostgreSQL role and a trigger function that sets `server_updated_at`, so that immutable tables can be enforced by the database and every synchronized table gets server time.

## Context
- Exists: the baseline migration (FND-001); `prisma.config.ts` reads `DATABASE_URL` for migrations.
- Adds: a raw SQL migration creating the role `distribo_app` (NOLOGIN, so no password lives in code), default privileges, and the function `set_server_updated_at()`; `MIGRATION_DATABASE_URL` support in `prisma.config.ts`; `tests/helpers/app-role.ts`.
- Production sets the login and password of `distribo_app` outside the code and points `DATABASE_URL` at it; `MIGRATION_DATABASE_URL` keeps the owner account.
- `C-39`: Immutable tables give the application account only INSERT and SELECT; PostgreSQL itself refuses any UPDATE or DELETE.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 Role exists with default privileges
  When the migration ran
  Then role `distribo_app` exists with NOLOGIN
  And a table created later by the migration account gives `distribo_app` SELECT, INSERT, UPDATE and DELETE
Scenario: AC-2 Immutable table pattern
  Given a scratch table `fnd_scratch_journal` with `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`
  When a client running as `distribo_app` inserts and selects a row
  Then both succeed
  And an UPDATE, a DELETE and a TRUNCATE each fail with SQLSTATE 42501
Scenario: AC-3 Server time
  Given a scratch table with column `server_updated_at` and the trigger `set_server_updated_at`
  When a row is inserted with `server_updated_at` set to the year 2001
  Then the stored value is within 5 seconds of the database clock
  And an UPDATE moves it forward again
Scenario: AC-4 CHECK constraints are enforced
  Given a scratch table with `CHECK (amount > 0)`
  When a row with amount 0 is inserted directly
  Then PostgreSQL rejects it with SQLSTATE 23514
Scenario: AC-5 Migration URL
  When `MIGRATION_DATABASE_URL` is set
  Then `prisma.config.ts` uses it for the datasource, else `DATABASE_URL`
```

## Abuse cases
```gherkin
Scenario: AB-1 Application account rewrites a journal (elevation)
  When code running as `distribo_app` updates or deletes a row of an immutable table
  Then PostgreSQL answers permission denied and the row is unchanged
```

## Implementation
- Create: `prisma/migrations/<timestamp>_app_role_and_server_time/migration.sql`, `tests/helpers/app-role.ts`, `tests/integration/foundation/database-roles.test.ts`
- Modify: `prisma.config.ts`
- Pattern: `prisma/migrations/20260930210000_baseline/migration.sql`
- Signatures:
  - `getAppRolePrisma(): PrismaClient — connects with the test database URL plus option `-c role=distribo_app``
- Dependencies: `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`

## Security
- v5.0.0-13.3.2: the role has no password in the migration and no SUPERUSER, CREATEDB or CREATEROLE.
- v5.0.0-8.3.1: the scratch tables are created and dropped inside the test, never in a migration.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| role and defaults | integration | AC-1 | `pg_roles` row with `rolcanlogin` false; new table grants → 4 privileges |
| immutable pattern | security | AC-2, AB-1, C-39, WSTG-ATHZ-03 | as `distribo_app`: insert and select pass; update, delete, truncate → code 42501 |
| server time | integration | AC-3, C-35 | insert with year 2001 → value near now(); update → later value |
| check constraint | integration | AC-4 | insert amount 0 → code 23514 |
| migration url | unit | AC-5 | import the config with each variable set → datasource url matches |

Command: `npx vitest run tests/integration/foundation/database-roles.test.ts`

## Out of scope
- Per-table REVOKE and trigger creation: each table's own story.
- Creating the login and password of `distribo_app` in production (deployment task).

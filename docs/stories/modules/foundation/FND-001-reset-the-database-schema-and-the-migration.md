---
id: FND-001
title: Reset the database schema and the migration history
module: foundation
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [FND-000]
read_first: [prisma/schema.prisma, tests/setup.ts]
design_refs: [contraintes-a-poser-au-niveau-base-de]
constraints: []
asvs: [v5.0.0-14.2.4]
---

# FND-001 — Reset the database schema and the migration history

## Story
Technical story: drop the old delivery tables and replace the migration history with one fresh baseline, so that the v10 model starts from a clean database (no real data exists, Q-001).

## Context
- Exists: 9 migration folders in `prisma/migrations/`; `prisma/schema.prisma` with the models of the older delivery design; `tests/setup.ts` that empties tables with one `deleteMany` per model; `tests/integration/data-model/identity.test.ts` that tests the old model.
- Keeps: `Task`, `TaskResult`, `SystemConfig`, `ConfigHistory`, and `Person`, `Account`, `OtpChallenge`, `EmailVerificationRequest`, `RefreshToken` (the running auth code uses them until PER and AUTH replace them).
- Removes every other model and enum, with the relation fields that point to them.
- Adds: one baseline migration; a cleanup that empties every table generically.

## Acceptance criteria
```gherkin
Scenario: AC-1 One baseline migration
  Given the old `prisma/migrations/*` folders are deleted and `migration_lock.toml` is kept
  When `npx prisma migrate reset --force` runs on the test database and `npx prisma migrate deploy` runs after
  Then exactly one migration folder named `<timestamp>_baseline` exists
  And the database contains only the tables `tasks`, `task_results`, `system_config`, `config_history`, `people`, `accounts`, `otp_challenges`, `email_verification_requests`, `refresh_tokens` and `_prisma_migrations`
Scenario: AC-2 The running auth code still works
  When `npx vitest run tests/integration/auth.test.ts tests/integration/user.test.ts` runs
  Then every test that passed before this story still passes
Scenario: AC-3 Generic cleanup
  Given rows exist in every remaining table
  When the `beforeEach` in `tests/setup.ts` runs
  Then every table except `_prisma_migrations` is empty
  And adding a new table later needs no edit of `tests/setup.ts`
```

## Abuse cases
```gherkin
Scenario: AB-1 Cleanup pointed at a real database (tampering)
  When the cleanup runs with `DATABASE_URL` not containing `test_db`
  Then it throws before emptying any table
```

## Implementation
- Create: `prisma/migrations/<timestamp>_baseline/migration.sql`
- Modify: `prisma/schema.prisma`, `tests/setup.ts`, `tests/helpers/database.ts`
- Pattern: `prisma/migrations/20260930210000_baseline/migration.sql`
- Dependencies: `prisma`

## Security
- v5.0.0-14.2.4: the cleanup runs only when `NODE_ENV` is `test` and the database URL contains `test_db`; otherwise it throws before any TRUNCATE.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| one baseline | integration | AC-1 | list `prisma/migrations` → one baseline folder; `information_schema.tables` in schema public → the 10 expected names only |
| auth still works | integration | AC-2 | existing `auth.test.ts` and `user.test.ts` → same pass count as before the story |
| generic cleanup | integration | AC-3 | insert a Person and a Task, run the cleanup → `count(*)` is 0 in each table |
| cleanup guard | security | AB-1, CWE-284 | run the cleanup with `DATABASE_URL` pointing at `postgres` → throws, no table emptied |

Command: `npx vitest run tests/integration/auth.test.ts tests/integration/user.test.ts tests/integration/data-model`

## Out of scope
- Person and Account merge (PER-002); OTP, device and refresh-token rework (AUTH stories).
- Roles and grants (FND-002).

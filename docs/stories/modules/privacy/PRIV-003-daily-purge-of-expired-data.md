---
id: PRIV-003
title: Daily purge of expired data
module: privacy
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-002, AUTH-007, ACC-007, NTF-001, FND-002, FIN-018]
read_first: [package.json, prisma.config.ts]
design_refs: [donnees-personnelles-et-conservation/durees-de-conservation, acces-et-securite/la-base-de-donnees-dernier-rempart]
constraints: [CM-35]
asvs: [v5.0.0-14.2.4, v5.0.0-16.3.3, v5.0.0-13.3.2]
---

# PRIV-003 — Daily purge of expired data

## Story
Technical story: delete data that reached its retention period, under the migration account, so that personal data is not kept longer than the design says.

## Context
- Exists: tables of notifications, sync archives, one-time codes, refresh tokens, idempotency keys; `MIGRATION_DATABASE_URL` (FND-002).
- Adds: `src/jobs/purge.ts`, `src/modules/privacy/purge.service.ts` and npm script `job:purge` (`tsx src/jobs/purge.ts`). It connects with `MIGRATION_DATABASE_URL` (the application account cannot delete immutable tables) and refuses to start without it.
- Deletes in batches of 1000 rows until none is left: notifications older than 24 months by `created_at`; sync archives older than 90 days by `received_at`; one-time codes whose `expires_at` or `consumed_at` is more than 30 days old; refresh tokens whose `expires_at` or `revoked_at` is more than 30 days old; idempotency keys older than 30 days. Nothing else is touched: commercial data and journals are kept at least 10 years.
- Logs `info` event `purge_done` with the count per table (no row content); exits 0 on success, 1 on error. The function `purge(now: Date)` returns the counts and takes the date as input for tests.
- `CM-35`: Retention: commercial data and journals at least 10 years; notifications 24 months; SyncArchive 90 days; expired or revoked verification codes and tokens 30 days; the daily purge runs under the migration account.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Retention periods
  Given a row <age> old in <table>
  When the purge runs
  Then the row is <result>
  Examples:
    | table                | age            | result  |
    | notifications        | 25 months      | deleted |
    | notifications        | 23 months      | kept    |
    | sync_archives        | 91 days        | deleted |
    | sync_archives        | 89 days        | kept    |
    | otp_challenges       | 31 days after expiry | deleted |
    | otp_challenges       | 29 days after expiry | kept    |
    | refresh_tokens       | 31 days after revocation | deleted |
    | refresh_tokens       | live and not expired | kept  |
    | idempotency_keys     | 31 days        | deleted |
Scenario: AC-2 Commercial data is never purged
  Then old orders, ledger entries, expenses, handovers and journals are unchanged
Scenario: AC-3 Migration account
  When MIGRATION_DATABASE_URL is missing
  Then the job exits 1 without deleting anything
Scenario: AC-4 Batches and counts
  When 2500 rows are due
  Then all are deleted in batches and the log shows the total
Scenario: AC-5 Repeat
  When the purge runs twice
  Then the second run deletes nothing
```

## Abuse cases
```gherkin
Scenario: AB-1 Purging commercial history (tampering)
  When the purge runs on a database with 11-year-old ledger entries
  Then they are untouched
Scenario: AB-2 Personal data in the purge log (information disclosure)
  Then the log has table names and counts only
```

## Implementation
- Create: `src/jobs/purge.ts`, `src/modules/privacy/purge.service.ts`, `tests/integration/privacy/purge.test.ts`
- Modify: `package.json`
- Pattern: `src/jobs/reconcile.ts`
- Signatures:
  - `purge(now: Date): Promise<Record<string, number>>`
- Dependencies: `pino`, `@prisma/client`, `@prisma/adapter-pg`, `tsx`

## Security
- v5.0.0-13.3.2: only the migration account may delete immutable rows.
- v5.0.0-14.2.4: expired personal data is removed.
- v5.0.0-16.3.3: the purge result is logged.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| retention periods | integration | AC-1, CM-35 | each Examples row → deleted or kept |
| commercial kept | integration | AC-2 | unchanged |
| migration account | integration | AC-3 | exit 1 |
| batches | integration | AC-4 | 2500 deleted |
| repeat | integration | AC-5 | 0 |
| history kept | security | AB-1, CWE-284 | untouched |
| log content | security | AB-2, CWE-532 | counts only |

Command: `npx vitest run tests/integration/privacy/purge.test.ts`

## Out of scope
- Scheduling (Q-010). Purging commercial data after 10 years (not in v1).

---
id: SYNC-002
title: Sync archive table
module: sync
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [AUTH-007, ADM-002, FND-002]
read_first: [prisma/schema.prisma, tests/integration/admin/admin-action-table.test.ts]
design_refs: [synchronisation-hors-ligne/syncarchive, contraintes-a-poser-au-niveau-base-de]
constraints: ['SyncArchive:required', 'SyncArchive:fk', C-32, C-39, C-35, CM-35, C-29]
asvs: [v5.0.0-8.3.1, v5.0.0-16.3.1]
---

# SYNC-002 — Sync archive table

## Story
Technical story: create the immutable archive of received batches and link the administration journal to it, so that a batch can be examined and replayed later.

## Context
- Exists: `people`, `devices`, `admin_actions` with a plain `sync_archive_id` column (ADM-002), role `distribo_app`.
- Adds: table `sync_archives` (`received_at` default now, `changes` jsonb not null, `server_updated_at`), foreign keys, an index on (`person_id`, `received_at` desc), trigger `set_server_updated_at()`, and `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`. A migration adds the foreign key `admin_actions.sync_archive_id` to `sync_archives(id)`.
- `SyncArchive` fields: `person_id` FK → Person; `device_id` FK → Device; `received_at` datetime; `changes` JSON
- `SyncArchive:required`: NOT NULL: `person_id`, `device_id`, `received_at`, `changes`
- `SyncArchive:fk`: references person_id → Person; device_id → Device
- `C-32`: Immutable journals are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `CM-35`: Retention: commercial data and journals at least 10 years; notifications 24 months; SyncArchive 90 days; expired or revoked verification codes and tokens 30 days.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.

## Acceptance criteria
```gherkin
Scenario: AC-1 Rows can be added and read
  When the application account inserts an archive row and reads it back
  Then `changes` is returned unchanged and `received_at` and `server_updated_at` are set
Scenario: AC-2 Rows cannot change
  When the application account updates or deletes a row
  Then PostgreSQL answers permission denied (42501)
Scenario: AC-3 Required and keys
  When `changes` is null, or the person or device is unknown
  Then the insert fails with 23502 or 23503
Scenario: AC-4 Journal link
  When a REPLAY_SYNC journal row points to an unknown archive id
  Then the insert fails with 23503
```

## Abuse cases
```gherkin
Scenario: AB-1 Erasing evidence of a batch (repudiation)
  When code running as the application account deletes an archive row
  Then the delete is refused
```

## Implementation
- Create: `prisma/migrations/<timestamp>_sync_002_sync_archives/migration.sql`, `tests/integration/sync/archive-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `tests/integration/admin/admin-action-table.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.3.1: only INSERT and SELECT are granted to `distribo_app`.
- v5.0.0-16.3.1: every received batch is kept for 90 days.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and read | integration | AC-1, C-35 | jsonb round trip |
| immutable | security | AC-2, AB-1, C-32, C-39, CM-35, WSTG-ATHZ-03 | 42501 |
| required and keys | integration | AC-3, SyncArchive:required, SyncArchive:fk | rejected |
| journal link | integration | AC-4, C-29 | 23503 |

Command: `npx vitest run tests/integration/sync/archive-table.test.ts`

## Out of scope
- Writing archives (SYNC-009). The 90-day purge (PRIV module).

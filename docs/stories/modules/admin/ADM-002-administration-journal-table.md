---
id: ADM-002
title: Administration journal table
module: admin
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-001, FND-002, ORG-001, REL-014]
read_first: [prisma/schema.prisma, tests/integration/relationship/reassignment-table.test.ts]
design_refs: [gouvernance-de-la-plateforme/adminaction, contraintes-a-poser-au-niveau-base-de]
constraints: ['AdminAction:required', 'AdminAction.action:enum', 'AdminAction:fk', C-29, C-32, C-39]
asvs: [v5.0.0-8.3.1, v5.0.0-16.3.1]
---

# ADM-002 — Administration journal table

## Story
Technical story: create the immutable journal of administrator actions so that every suspension, reactivation, replay and recovery is traceable.

## Context
- Exists: `administrators` (ADM-001), `organizations`, role `distribo_app`.
- Adds: table `admin_actions` (`occurred_at` default now, `server_updated_at`), `REVOKE UPDATE, DELETE, TRUNCATE ... FROM distribo_app`, trigger `set_server_updated_at()`. `report_id` and `sync_archive_id` are plain uuid columns for now: the foreign keys to reports and sync archives are added by ADM-003 and SYNC-002.
- CHECKs: exactly one of `target_person_id` and `target_organization_id`; `reason` not empty; `sync_archive_id` set exactly when `action = 'REPLAY_SYNC'`. A trigger allows REPLAY_SYNC only for an administrator whose role is SUPER_ADMIN.
- `recordAdminAction(tx, input)` in `src/modules/admin/admin.repository.ts` inserts a row with a new id.
- `AdminAction` fields: `administrator_id` FK → Administrator; `action` enum [SUSPEND / REACTIVATE / DISMISS_REPORT / APPOINT_ADMIN / REMOVE_ADMIN / REPLAY_SYNC / RECOVER_2FA]; `target_person_id` FK → Person, nullable; `target_organization_id` FK → Organization, nullable; `report_id` FK → Report, nullable; `sync_archive_id` FK → SyncArchive, nullable; `reason` text; `occurred_at` datetime
- `AdminAction:required`: NOT NULL: `administrator_id`, `action`, `reason`, `occurred_at`
- `AdminAction.action:enum`: one of SUSPEND, REACTIVATE, DISMISS_REPORT, APPOINT_ADMIN, REMOVE_ADMIN, REPLAY_SYNC, RECOVER_2FA
- `AdminAction:fk`: references administrator_id → Administrator; target_person_id → Person; target_organization_id → Organization; report_id → Report; sync_archive_id → SyncArchive
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.
- `C-32`: Immutable journals are never updated or deleted by the application; only the retention purge removes them.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Insert rules
  When an action is inserted with <values>
  Then the insert <result>
  Examples:
    | values                                                        | result          |
    | SUSPEND, a person target, reason "abus"                       | accepts         |
    | SUSPEND with both targets                                     | rejects (23514) |
    | SUSPEND with no target                                        | rejects (23514) |
    | reason empty                                                  | rejects (23514) |
    | REPLAY_SYNC by a SUPER_ADMIN with sync_archive_id             | accepts         |
    | REPLAY_SYNC by a MODERATOR                                    | rejects (23514) |
    | REPLAY_SYNC without sync_archive_id                           | rejects (23514) |
    | SUSPEND with a sync_archive_id                                | rejects (23514) |
    | action "DELETE_USER"                                          | rejects         |
Scenario: AC-2 Immutable
  When the application account updates or deletes a row
  Then PostgreSQL answers permission denied (42501)
Scenario: AC-3 Helper
  When recordAdminAction is called with valid input
  Then one row exists with a server time
```

## Abuse cases
```gherkin
Scenario: AB-1 Rewriting the journal (repudiation)
  When code running as the application account edits a reason
  Then the update is refused and the row is unchanged
```

## Implementation
- Create: `src/modules/admin/admin.repository.ts`, `prisma/migrations/<timestamp>_adm_002_admin_actions/migration.sql`, `tests/integration/admin/admin-action-table.test.ts`
- Modify: `prisma/schema.prisma`
- Pattern: `src/modules/tasks/tasks.repository.ts`
- Signatures:
  - `recordAdminAction(tx: Prisma.TransactionClient, input: AdminActionInput): Promise<AdminAction>`
- Types:
  - `AdminActionType = 'SUSPEND' | 'REACTIVATE' | 'DISMISS_REPORT' | 'APPOINT_ADMIN' | 'REMOVE_ADMIN' | 'REPLAY_SYNC' | 'RECOVER_2FA'`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-8.3.1: only INSERT and SELECT are granted to `distribo_app`.
- v5.0.0-16.3.1: every action has an author, a reason and a server time.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| insert rules | integration | AC-1, C-29, AdminAction:required, AdminAction.action:enum, AdminAction:fk | each Examples row → accepted or rejected |
| immutable | security | AC-2, AB-1, C-32, C-39, WSTG-ATHZ-03 | UPDATE, DELETE → 42501 |
| helper | integration | AC-3 | row created |

Command: `npx vitest run tests/integration/admin/admin-action-table.test.ts`

## Out of scope
- The sync archive foreign key (SYNC-002).

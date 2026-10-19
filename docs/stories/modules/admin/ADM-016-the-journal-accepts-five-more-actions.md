---
id: ADM-016
title: The journal accepts five more actions
module: admin
kind: migration
rev: 1
amends: [ADM-002]
size: S
risk: high
depends_on: [ADM-002]
read_first: [prisma/schema.prisma, prisma/migrations/20261004180000_adm_002_admin_actions/migration.sql]
design_refs: [gouvernance-de-la-plateforme/adminaction, contraintes-a-poser-au-niveau-base-de]
constraints: ['AdminAction.action:enum', C-29]
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.1]
---

# ADM-016 — The journal accepts five more actions

## Story
Technical story: let the administration journal hold the five new actions, with the database refusing a reserved action from a moderator and a target of the wrong kind, so that no route can bypass these rules.

## Context
- Exists: the enum `AdminActionType` (seven values), the table `admin_actions` and the trigger `admin_actions_check_replay_role`, which refuses a REPLAY_SYNC row from a non-SUPER_ADMIN author with 23514 (ADM-002).
- One migration adds GIFT_DAYS, RECORD_PAYMENT, REFUND_PAYMENT, RELEASE_PHONE and RESTORE_ACCESS (`ALTER TYPE ... ADD VALUE`). A new value cannot be used in the same transaction, so every rule compares `action::text` with text.
- It replaces the trigger by `admin_actions_check_super_admin_role`: the same 23514 refusal for REPLAY_SYNC and the five new values when the author is not a SUPER_ADMIN.
- Constraint `admin_actions_target_kind`: the first three new actions need `target_organization_id`, the last two `target_person_id`. No existing row holds a new value: nothing to audit or fill.
- `prisma/schema.prisma`: the five values, and the `//` comment above `AdminAction` rewritten in plain words (who may record which action, which target each needs, the migration that holds it). `admin.repository.ts`, `admin.schemas.ts` (the filter of `GET /api/v1/admin/actions`) and `admin.openapi.ts` list the twelve values.
- `AdminAction.action:enum`: one of SUSPEND, REACTIVATE, DISMISS_REPORT, APPOINT_ADMIN, REMOVE_ADMIN, REPLAY_SYNC, RECOVER_2FA
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC, and is immutable. REPLAY_SYNC, GIFT_DAYS, RECORD_PAYMENT, REFUND_PAYMENT, RELEASE_PHONE and RESTORE_ACCESS are for super administrators only; GIFT_DAYS, RECORD_PAYMENT and REFUND_PAYMENT target a business, RELEASE_PHONE and RESTORE_ACCESS a person.

## Acceptance criteria
```gherkin
Scenario: AC-1 The five actions are accepted
  When a SUPER_ADMIN inserts GIFT_DAYS, RECORD_PAYMENT and REFUND_PAYMENT with a business, and RELEASE_PHONE and RESTORE_ACCESS with a person
  Then each insert succeeds
Scenario: AC-2 Only a SUPER_ADMIN
  When a MODERATOR inserts REPLAY_SYNC, GIFT_DAYS, RECORD_PAYMENT, REFUND_PAYMENT, RELEASE_PHONE or RESTORE_ACCESS, each with the right kind of target
  Then each fails with 23514 and no row is stored
Scenario: AC-3 The right kind of target
  When a SUPER_ADMIN inserts GIFT_DAYS, RECORD_PAYMENT or REFUND_PAYMENT with a person, or RELEASE_PHONE or RESTORE_ACCESS with a business
  Then each fails with 23514
Scenario: AC-4 Earlier actions and rows are unchanged
  When a MODERATOR inserts SUSPEND, a SUPER_ADMIN inserts REPLAY_SYNC with an archive, and "DELETE_USER" is inserted
  Then the first two succeed, the third fails, and rows saved before the migration can still be read
Scenario: AC-5 The code lists the twelve actions
  When an administrator calls GET /api/v1/admin/actions?action=RESTORE_ACCESS and reads /api/v1/docs/openapi.json
  Then the answer is 200 and the document lists twelve values for the filter and for the answer
```

## Abuse cases
```gherkin
Scenario: AB-1 A moderator frees a number or hands out an account (elevation)
  Given the route guard is bypassed
  When a MODERATOR author inserts RELEASE_PHONE or RESTORE_ACCESS with SQL
  Then the database refuses with 23514 and no row is stored
Scenario: AB-2 The journal stays append-only (tampering)
  When the application account updates or deletes a row of a new action
  Then the database refuses with 42501
```

## Implementation
- Create: `prisma/migrations/<timestamp>_adm_016_admin_actions_five_more/migration.sql`, `tests/integration/admin/admin-action-more-actions.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/admin/admin.repository.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Types:
  - `AdminActionType gains GIFT_DAYS | RECORD_PAYMENT | REFUND_PAYMENT | RELEASE_PHONE | RESTORE_ACCESS`
- Dependencies: `prisma`, `@prisma/client`, `zod`

## Security
- v5.0.0-8.2.1: the database checks the author's role for the six reserved actions, whatever the route does.
- v5.0.0-16.3.1: the new trigger and constraint leave the journal insert-only for the application account.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| five actions | integration | AC-1, AdminAction.action:enum | SUPER_ADMIN inserts the five with the right target → five rows |
| reserved | integration | AC-2, C-29 | MODERATOR inserts each of the six → 23514 |
| targets | integration | AC-3 | each wrong pairing → 23514 |
| earlier actions | integration | AC-4 | SUSPEND, REPLAY_SYNC, an old row and "DELETE_USER" |
| lists | integration | AC-5 | filter RESTORE_ACCESS → 200; openapi.json lists twelve values |
| moderator bypass | security | AB-1, CWE-269 | direct insert of RELEASE_PHONE by a MODERATOR → 23514 |
| append only | security | AB-2, CWE-284 | UPDATE and DELETE as the application role → 42501 |

Command: `npx vitest run tests/integration/admin/admin-action-more-actions.test.ts tests/integration/admin/admin-action-table.test.ts tests/integration/admin/action-journal.test.ts`

## Out of scope
- The routes that record these actions: ADM-017 to ADM-020 here, and the subscription stories.

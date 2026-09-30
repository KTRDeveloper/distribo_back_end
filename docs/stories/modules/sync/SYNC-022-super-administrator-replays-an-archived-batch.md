---
id: SYNC-022
title: Super administrator replays an archived batch
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-018, ADM-009, ADM-002, SYNC-006]
read_first: [src/modules/sync/sync.judge.ts, src/modules/admin/admin.repository.ts]
design_refs: [synchronisation-hors-ligne/syncarchive, gouvernance-de-la-plateforme/adminaction]
constraints: [CM-32, C-29]
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.1, v5.0.0-2.3.3]
---

# SYNC-022 — Super administrator replays an archived batch

## Story
As a super-admin, I want to replay an archived batch after the cause of a refusal is fixed so that lost operations are reintegrated safely.

## Context
- Exists: archives (SYNC-002, SYNC-009), `judgeBatch` with `options.replay`, `recordAdminAction`, `adminAuthMiddleware`, `requireAdminRole`.
- Adds: `POST /api/v1/admin/sync-archives/{archiveId}/replay` with `{ reason }` (1 to 2000, required); SUPER_ADMIN only; response 200 `PushResult`.
- The batch's author is loaded as a `Viewer` with their current rights (never the administrator's). `judgeBatch(viewer, batch, { replay: true })` runs through the normal path and skips only the version, clock and conflict checks. A `REPLAY_SYNC` journal row (author the administrator, target the batch's author person, `sync_archive_id`, reason) is written in the same transaction. The batch's author and the organizations' OWNERs get a notification `sync.replayed`: "Des opérations envoyées le <date> depuis votre téléphone ont été réintégrées par l'équipe de la plateforme."
- A batch can be replayed more than once; repeated lines are idempotent by record id.
- `CM-32`: Only a SUPER_ADMIN replays an archived batch, with a mandatory reason, logged as REPLAY_SYNC; it is judged as if sent by its author with their current rights, never the administrator's; the author and the owner are notified.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.

## Acceptance criteria
```gherkin
Scenario: AC-1 Replay
  Given an archived batch whose sale was set aside
  When a SUPER_ADMIN replays it after the cause is fixed
  Then the sale is stored, a REPLAY_SYNC journal row exists with the archive id and reason, and the author and owner are notified
Scenario: AC-2 Author's rights
  When the author has since been demoted
  Then the batch is judged with their current rights, not the administrator's
Scenario: AC-3 Idempotent
  When the batch is replayed twice
  Then nothing is written twice
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                      | status                  |
    | a MODERATOR                  | 403 FORBIDDEN           |
    | an empty reason              | 400 VALIDATION_ERROR    |
    | an unknown archive           | 404 NOT_FOUND           |
    | a normal access token        | 401 UNAUTHORIZED        |
Scenario: AC-5 Atomic
  When the journal insert fails
  Then no line of the batch is applied
```

## Abuse cases
```gherkin
Scenario: AB-1 Replay with administrator power (elevation)
  When a batch containing a manager-only operation is replayed by a SUPER_ADMIN for a seller
  Then that line is refused, because the seller's rights apply
Scenario: AB-2 Untraced replay (repudiation)
  When any replay runs
  Then a journal row exists
```

## Implementation
- Create: `tests/integration/sync/replay.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.judge.ts`, `src/modules/sync/sync.schemas.ts`, `src/modules/sync/sync.openapi.ts`
- Pattern: `src/modules/sync/sync.routes.ts`
- Signatures:
  - `replayArchive(admin: AdminContext, archiveId: string, input: { reason: string }): Promise<PushResult>`
- Errors: `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: super administrators only.
- v5.0.0-2.3.3: journal row and applied lines are one transaction.
- v5.0.0-16.3.1: the replay is journaled with a reason.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| replay | integration | AC-1, CM-32, C-29 | stored, journal, notices |
| author's rights | integration | AC-2 | current rights |
| idempotent | integration | AC-3 | once |
| refusals | integration | AC-4 | each Examples row → status |
| atomic | integration | AC-5, CWE-362 | nothing applied |
| admin power | security | AB-1, CWE-269 | refused line |
| traced | security | AB-2, CWE-778 | journal row |

Command: `npx vitest run tests/integration/sync/replay.test.ts`

## Out of scope
- Choosing which archive to replay (SYNC-023).

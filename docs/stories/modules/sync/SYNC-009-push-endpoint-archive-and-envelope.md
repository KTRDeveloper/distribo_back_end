---
id: SYNC-009
title: Push endpoint, archive and envelope
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-008, SYNC-002, SYNC-006]
read_first: [src/modules/sync/sync.routes.ts, src/modules/sync/sync.registry.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne, synchronisation-hors-ligne/syncarchive]
constraints: [C-36, CM-28, CM-31]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# SYNC-009 — Push endpoint, archive and envelope

## Story
As a seller, I want my phone to send what I did offline so that the server records it and tells me what it could not.

## Context
- Exists: registry (SYNC-001), archive table (SYNC-002), device tracking (SYNC-008).
- Adds: `POST /api/v1/sync/push?last_pulled_at=<epoch ms>` with body `{ changes: { <table>: { created: [], updated: [], deleted: [] } } }` (at most 2000 rows in total, 400 `VALIDATION_ERROR` above) and `src/modules/sync/sync.push.ts`; the body limit for this path is 5 MB (FND-008).
- Order of work: (1) archive the batch as received in its own committed transaction; (2) refuse an app version below the platform minimum, read from remote-config `sync` / `min_app_version` and header `X-App-Version` compared as dotted numbers: 426 `APP_UPDATE_REQUIRED` (nothing is lost, the batch stays archived); (3) set `clock_skew: true` in the response when header `X-Client-Time` differs from server time by more than 5 minutes; (4) conflict check: if any `updated` row exists on the server with `server_updated_at` later than `last_pulled_at`, answer 409 `SYNC_CONFLICT` and apply nothing; (5) hand the batch to `judgeBatch` (SYNC-010) in one transaction; (6) set the device's `last_synced_at`.
- A table name the registry does not know is set aside: it is counted in `aside` and the rest of the batch passes. A known table that the phone may not write yields a `forbidden` outcome (SYNC-018).
- Response 200 `{ accepted, rejected: [{ table, id, code, message }], aside, clock_skew, resync_required }`.
- `C-36`: No uniqueness rule makes a sync fail; every possible duplicate has a written behavior, and a line no rule can write is set aside.
- `CM-28`: Sync outcomes: a business problem is stored with sync_issue; a conflict is refused until the phone pulls and resends; a forbidden send is refused, recorded, and triggers a full resync plus a notification to its author; a line no rule can write is set aside while the rest passes.
- `CM-31`: The server refuses a sync from an app version below the platform minimum; a phone clock more than 5 minutes off makes the app ask for automatic time; operations dated in the future or more than 3 days after the phone's last sync are reported to the owner, never refused.

## Acceptance criteria
```gherkin
Scenario: AC-1 Batch archived first
  When a phone pushes any batch
  Then one archive row holds the changes exactly as received, whatever the outcome
Scenario Outline: AC-2 Version and time
  When the request has <case>
  Then the result is <result>
  Examples:
    | case                                              | result                               |
    | X-App-Version below the minimum                   | 426 APP_UPDATE_REQUIRED, archived    |
    | X-App-Version at the minimum                      | processed                            |
    | no minimum configured                             | processed                            |
    | X-Client-Time 6 minutes off                       | 200 with clock_skew true             |
    | X-Client-Time 4 minutes off                       | 200 with clock_skew false            |
Scenario: AC-3 Conflict
  Given a row updated on the server after last_pulled_at
  When the phone pushes an update of that row
  Then the response is 409 `SYNC_CONFLICT` and no row of the batch is applied
Scenario: AC-4 Unknown table set aside
  When the batch has a table named "widgets" and a valid line
  Then `aside` is 1 and the valid line is processed
Scenario: AC-5 Size
  When the batch has 2001 rows
  Then the response is 400 `VALIDATION_ERROR` and nothing is archived as applied
Scenario: AC-6 Last sync
  Then the device's last_synced_at is set to server time after a processed push
```

## Abuse cases
```gherkin
Scenario: AB-1 One bad row blocks a phone forever (denial of service)
  When a batch holds an unknown table and a row that breaks a uniqueness rule
  Then the response is still 200 and the other lines are processed
```

## Implementation
- Create: `src/modules/sync/sync.push.ts`, `tests/integration/sync/push-envelope.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.schemas.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.openapi.ts`
- Pattern: `src/modules/sync/sync.service.ts`
- Signatures:
  - `pushChanges(viewer: Viewer, input: { lastPulledAt: number; changes: PushBatch; appVersion: string; clientTime?: string }): Promise<PushResponse>`
- Errors: `APP_UPDATE_REQUIRED` 426, `SYNC_CONFLICT` 409, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-2.2.1: size and shape limits on the batch.
- v5.0.0-16.3.1: every batch is archived; version refusals are logged.
- v5.0.0-2.3.3: the judged batch is applied in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| archived first | integration | AC-1, CM-28 | one row, exact changes |
| version and time | integration | AC-2, CM-31 | each Examples row → result |
| conflict | integration | AC-3 | 409, nothing applied |
| unknown table | integration | AC-4, C-36 | aside 1 |
| size | integration | AC-5 | 400 |
| last sync | integration | AC-6 | set |
| never blocked | security | AB-1, CWE-400 | 200 |

Command: `npx vitest run tests/integration/sync/push-envelope.test.ts`

## Out of scope
- Judging lines (SYNC-010 onward).

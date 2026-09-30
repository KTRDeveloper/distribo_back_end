---
id: SYNC-023
title: Administrators list and open archived batches
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-022, FND-009, SYNC-006]
read_first: [src/modules/sync/sync.routes.ts, src/modules/admin/admin.routes.ts]
design_refs: [synchronisation-hors-ligne/syncarchive]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1, v5.0.0-14.2.4]
---

# SYNC-023 — Administrators list and open archived batches

## Story
As a moderator, I want to find an archived batch by person and date so that I can see what a phone sent.

## Context
- Exists: archives (SYNC-002), admin auth (ADM-006).
- Adds: `GET /api/v1/admin/sync-archives?limit&cursor&person_id&from&to` (any administrator; `{ id, person_id, device_id, received_at, row_counts }` where `row_counts` is the number of created, updated and deleted rows per table) and `GET /api/v1/admin/sync-archives/{archiveId}` (SUPER_ADMIN only; adds `changes`).

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given 3 archives of two people
  When a MODERATOR lists with person_id of one
  Then only that person's archives are returned newest first with row counts and no `changes`
Scenario: AC-2 Open
  When a SUPER_ADMIN opens one
  Then `changes` is returned; a MODERATOR gets 403
Scenario: AC-3 Period and paging
  Then from and to filter and limit 1 pages without repeats
Scenario: AC-4 Access
  Then a normal token or none answers 401
```

## Abuse cases
```gherkin
Scenario: AB-1 A customer reads batches (elevation)
  When a customer's token is used
  Then the response is 401 and nothing is returned
```

## Implementation
- Create: `tests/integration/sync/archive-read.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.schemas.ts`, `src/modules/sync/sync.openapi.ts`
- Pattern: `src/modules/sync/sync.routes.ts`
- Signatures:
  - `listArchives(query: ListArchivesQuery): Promise<{ items: ArchiveSummary[]; next_cursor: string | null }>`
  - `getArchive(archiveId: string): Promise<ArchiveDetail>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: admin token; content only for super administrators.
- v5.0.0-14.2.4: full batches are sensitive and limited to SUPER_ADMIN.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | filtered summaries |
| open | integration | AC-2 | changes and 403 |
| period and paging | integration | AC-3 | as described |
| access | integration | AC-4 | 401 |
| customer token | security | AB-1, WSTG-ATHZ-03 | 401 |

Command: `npx vitest run tests/integration/sync/archive-read.test.ts`

## Out of scope
- Editing an archive: never.

---
id: SYNC-021
title: Owner reads the synchronization exceptions grouped by cause
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-020, SYNC-006]
read_first: [src/modules/sync/sync.service.ts, src/modules/finance/finance.service.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1]
---

# SYNC-021 — Owner reads the synchronization exceptions grouped by cause

## Story
As an owner, I want the flagged operations grouped by cause with their amounts so that I review two lines instead of a hundred.

## Context
- Exists: issues (SYNC-016, SYNC-017).
- Adds: `GET /api/v1/organizations/{organizationId}/exceptions/sync?from&to` (OWNER only; same period rules as FIN-019): `{ items: [{ code, count, amount, persons: [person_id] }] }`. The amount per code: `PRICE_CHANGED` sum of (applied − current reference) × quantity on affected lines when negative; `CREDIT_EXCEEDED` the sum of amounts over the limit; other codes 0.

## Acceptance criteria
```gherkin
Scenario: AC-1 Grouped by cause
  Given 7 lines sold at the old price for 1400 in total and one credit overrun of 15000
  When the owner reads the week
  Then two items are returned: PRICE_CHANGED (count 1 order, amount 1400) and CREDIT_EXCEEDED (15000)
Scenario Outline: AC-2 Validation and roles
  When the request has <case>
  Then the response is <status>
  Examples:
    | case                        | status |
    | a MANAGER caller            | 403    |
    | a period of 93 days         | 400    |
Scenario: AC-3 Period
  Then issues older than `from` are not counted
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business (horizontal)
  When a member of A reads the exceptions of B
  Then the response is 404
```

## Implementation
- Create: `tests/integration/sync/exceptions.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.schemas.ts`, `src/modules/sync/sync.openapi.ts`
- Pattern: `src/modules/sync/sync.routes.ts`
- Signatures:
  - `syncExceptions(actor: Actor, query: { from?: string; to?: string }): Promise<{ items: SyncExceptionItem[] }>`
- Errors: `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| grouped | integration | AC-1 | two items |
| validation and roles | integration | AC-2 | each Examples row → status |
| period | integration | AC-3 | old ignored |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/sync/exceptions.test.ts`

## Out of scope
- A dedicated table: these are reads.

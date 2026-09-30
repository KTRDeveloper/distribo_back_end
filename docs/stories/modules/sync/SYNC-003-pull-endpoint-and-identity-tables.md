---
id: SYNC-003
title: Pull endpoint and identity tables
module: sync
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [SYNC-001, FND-008]
read_first: [src/modules/sync/sync.registry.ts, src/modules/organization/organization.repository.ts]
design_refs: [synchronisation-hors-ligne/principes-la-synchronisation-classique, synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone]
constraints: [C-35, CM-30]
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1, v5.0.0-2.2.1]
---

# SYNC-003 — Pull endpoint and identity tables

## Story
As a seller, I want my phone to receive what changed since its last synchronization so that it works offline with current data.

## Context
- Exists: registry and viewer (SYNC-001); `server_updated_at` and `deleted_at` on synchronized tables; `authMiddleware`.
- Adds: `GET /api/v1/sync/pull?last_pulled_at=<epoch ms | empty>` returning 200 `{ changes: { <table>: { created, updated, deleted } }, timestamp }` for every registered adapter, and the adapters for `organizations`, `collaborations` and `people`. Files: `sync.routes.ts`, `sync.schemas.ts`, `sync.service.ts`, `sync.openapi.ts`, `adapters/identity.adapter.ts`.
- `timestamp` is the server time read before the queries (epoch ms). With `last_pulled_at` empty every visible row is `created` and nothing is `deleted`. With a value, a row is `created` when its `created_at` is later, else `updated`; a row with `deleted_at` and `server_updated_at` later is listed by id in `deleted`. Rows use snake_case columns, timestamps as epoch ms, bigint as numbers, quantities as numbers.
- Identity adapters: `organizations` (the viewer's ACTIVE organizations, all columns), `collaborations` (rows of those organizations; `amount_held` only for the viewer's own row and for an OWNER viewer), `people` (only the public fields `id, full_name, phone_number` of people appearing in the viewer's collaborations and relationships; nothing else).
- `C-35`: Synchronized tables carry `server_updated_at`, set by the server on every write, and `deleted_at` for deletion; unique constraints ignore deleted rows.
- `CM-30`: Sync pull returns only what the user may see; a driver receives, per customer, only the available credit instead of balance and limit; the phone keeps all customers, the catalog, open orders and the last 90 days of the rest.

## Acceptance criteria
```gherkin
Scenario: AC-1 First pull
  Given a SELLER of organization A
  When the phone pulls with last_pulled_at empty
  Then organizations holds A, collaborations hold A's team, people hold their public fields, all as `created`
Scenario: AC-2 Incremental pull
  When a collaborator's role changes after the last pull
  Then that collaboration is `updated` and unchanged rows are absent
Scenario: AC-3 Amount held
  Then a SELLER sees `amount_held` only on their own row and an OWNER sees all
Scenario: AC-4 Other organizations
  Then rows of organizations the viewer does not belong to never appear
Scenario Outline: AC-5 Bad parameter
  When last_pulled_at is <value>
  Then the response is 400 `VALIDATION_ERROR`
  Examples:
    | value        |
    | abc          |
    | -5           |
    | a future time |
```

## Abuse cases
```gherkin
Scenario: AB-1 Pulling another business (horizontal)
  When a member of A pulls
  Then no row of B appears in any table
Scenario: AB-2 Private person fields (information disclosure)
  When people are pulled
  Then no email, language, password hash or dates appear
```

## Implementation
- Create: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.schemas.ts`, `src/modules/sync/adapters/identity.adapter.ts`, `tests/integration/sync/pull-identity.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `pullChanges(viewer: Viewer, lastPulledAt: number | null): Promise<{ changes: Record<string, TableChanges>; timestamp: number }>`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: every adapter starts from the viewer's memberships.
- v5.0.0-15.3.1: explicit column lists per table.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| first pull | integration | AC-1, C-35 | created rows |
| incremental | integration | AC-2 | updated only |
| amount held | integration | AC-3, CM-30 | per role |
| other organizations | integration | AC-4 | none |
| bad parameter | integration | AC-5 | each Examples row → 400 |
| other business | security | AB-1, WSTG-ATHZ-04 | none of B |
| private fields | security | AB-2, CWE-200 | absent |

Command: `npx vitest run tests/integration/sync/pull-identity.test.ts`

## Out of scope
- Schema and migration parameters of WatermelonDB: not used.
- OpenAPI registration (SYNC-006).

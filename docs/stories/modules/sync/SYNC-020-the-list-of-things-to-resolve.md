---
id: SYNC-020
title: The list of things to resolve
module: sync
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [SYNC-017, FND-009, SYNC-006]
read_first: [src/modules/sync/sync.routes.ts, src/modules/order/order.repository.ts]
design_refs: [synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne]
constraints: []
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# SYNC-020 — The list of things to resolve

## Story
As a seller, I want the list of my orders and deliveries flagged by the server so that I can fix them.

## Context
- Exists: `sync_issue` on orders and deliveries.
- Adds: `GET /api/v1/sync/issues?limit&cursor` returning, for the caller, orders and deliveries with a non-empty `sync_issue` that they entered, delivered or are assigned to (an OWNER sees all of the organization's): `{ table, id, order_id, code, message, created_at }` where `code` is the prefix before the first colon. Newest first, paginated. An issue disappears when the record is corrected (the field becomes empty).

## Acceptance criteria
```gherkin
Scenario: AC-1 Own issues
  Given two flagged orders entered by Jean and one by Paul
  When Jean lists
  Then Jean's two are returned
Scenario: AC-2 Owner sees all
  Then the OWNER sees all three
Scenario: AC-3 Corrected
  When an issue text is emptied
  Then it no longer appears
Scenario: AC-4 Pagination and code
  Then pages follow without repeats and each item has its code and message
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's issues (horizontal)
  When a member of A lists
  Then nothing of B appears
```

## Implementation
- Create: `tests/integration/sync/issues.test.ts`
- Modify: `src/modules/sync/sync.routes.ts`, `src/modules/sync/sync.service.ts`, `src/modules/sync/sync.schemas.ts`, `src/modules/sync/sync.openapi.ts`
- Pattern: `src/modules/sync/sync.routes.ts`
- Signatures:
  - `listIssues(viewer: Viewer, query: { limit: number; cursor?: string }): Promise<{ items: IssueView[]; next_cursor: string | null }>`
- Errors: `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: scope by organization and author.
- v5.0.0-15.3.1: explicit fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| own | integration | AC-1 | two items |
| owner | integration | AC-2 | three items |
| corrected | integration | AC-3 | gone |
| paging | integration | AC-4 | no repeats |
| other business | security | AB-1, WSTG-ATHZ-04 | none |

Command: `npx vitest run tests/integration/sync/issues.test.ts`

## Out of scope
- Fixing the record: normal order routes.

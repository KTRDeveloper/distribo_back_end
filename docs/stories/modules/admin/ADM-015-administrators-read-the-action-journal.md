---
id: ADM-015
title: Administrators read the action journal
module: admin
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ADM-014, FND-009, ADM-006]
read_first: [src/modules/admin/admin.routes.ts, src/modules/admin/admin.repository.ts]
design_refs: [gouvernance-de-la-plateforme/adminaction]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.3]
---

# ADM-015 — Administrators read the action journal

## Story
As a super-admin, I want to read the journal of administration actions so that I can audit what the team did.

## Context
- Exists: journal rows (ADM-002 onward).
- Adds: `GET /api/v1/admin/actions?limit&cursor&action&administrator_id&target_person_id&target_organization_id` (any administrator; paginated, newest first): `{ id, administrator_id, action, target_person_id, target_organization_id, report_id, sync_archive_id, reason, occurred_at }`.
- Adds `admin.openapi.ts` documenting the admin routes of ADM-006 to ADM-015 (with `bearerAuth`); `admin.routes.ts` imports it for its side effect.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given 5 journal rows
  When an administrator lists
  Then 5 items are returned newest first
Scenario Outline: AC-2 Filters
  When the query has <query>
  Then only the matching rows are returned
  Examples:
    | query                          |
    | action=SUSPEND                 |
    | administrator_id of one admin  |
    | target_person_id of one person |
Scenario: AC-3 Pagination
  When limit 2 is used with the cursor
  Then pages of 2, 2 and 1 items follow
Scenario: AC-4 Access
  Then a normal token or no token answers 401
```

## Abuse cases
```gherkin
Scenario: AB-1 Customer reads the journal (elevation)
  When a customer's access token is used
  Then the response is 401 and nothing is returned
```

## Implementation
- Create: `src/modules/admin/admin.openapi.ts`, `tests/integration/admin/action-journal.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`, `src/modules/admin/admin.schemas.ts`
- Pattern: `src/modules/admin/admin.routes.ts`
- Signatures:
  - `listAdminActions(query: ListActionsQuery): Promise<{ items: AdminActionView[]; next_cursor: string | null }>`
- Errors: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.1: admin token required.
- v5.0.0-16.3.3: the journal is readable for audit.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | 5 newest first |
| filters | integration | AC-2 | each Examples row → matches |
| paging | integration | AC-3 | 2, 2, 1 |
| access | integration | AC-4 | 401 |
| customer token | security | AB-1, WSTG-ATHZ-03 | 401 |

Command: `npx vitest run tests/integration/admin/action-journal.test.ts`

## Out of scope
- Replaying an archived sync batch (SYNC module).

---
id: ADM-012
title: Administrator lists and opens reports
module: admin
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ADM-011, FND-009, ADM-006]
read_first: [src/modules/admin/admin.service.ts, src/modules/admin/report.routes.ts]
design_refs: [moderation/report]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.1]
---

# ADM-012 — Administrator lists and opens reports

## Story
As a moderator, I want to list and open reports so that I can decide what to do.

## Context
- Exists: reports (ADM-011); `adminAuthMiddleware`.
- Adds: `GET /api/v1/admin/reports?limit&cursor&status` (paginated, oldest PENDING first when `status=PENDING`, else newest first) and `GET /api/v1/admin/reports/{reportId}`; item `{ id, reporter: public person, target_person: public person | null, target_organization: { id, name, status } | null, reason, description, status, decision, resolved_by_id, reported_at, resolved_at }`. Admin token only.

## Acceptance criteria
```gherkin
Scenario: AC-1 List pending
  Given 3 PENDING and 2 RESOLVED reports
  When a MODERATOR lists status=PENDING
  Then 3 reports are returned oldest first
Scenario: AC-2 Open
  Then a report shows its reporter, its target and its text
Scenario Outline: AC-3 Access
  When the caller uses <token>
  Then the response is <status>
  Examples:
    | token                       | status |
    | an admin token              | 200    |
    | a normal access token       | 401    |
    | no token                    | 401    |
Scenario: AC-4 Unknown id
  Then a missing report answers 404 and a malformed id 400
```

## Abuse cases
```gherkin
Scenario: AB-1 A customer reads reports (elevation)
  When a customer's token is used
  Then the response is 401 and no report is returned
```

## Implementation
- Create: `tests/integration/admin/list-reports.test.ts`
- Modify: `src/modules/admin/report.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`, `src/modules/admin/admin.schemas.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `listReports(query: ListReportsQuery): Promise<{ items: AdminReportView[]; next_cursor: string | null }>`
  - `getReport(reportId: string): Promise<AdminReportView>`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: admin token and live administrator required.
- v5.0.0-15.3.1: explicit fields; people through `toPublicPerson`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | order |
| open | integration | AC-2 | fields |
| access | integration | AC-3 | each Examples row → status |
| unknown id | integration | AC-4 | 404, 400 |
| customer token | security | AB-1, WSTG-ATHZ-03 | 401 |

Command: `npx vitest run tests/integration/admin/list-reports.test.ts`

## Out of scope
- Deciding (ADM-013).

---
id: ADM-011
title: Person reports another person or a business
module: admin
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ADM-003, ACC-007, ADM-006, NTF-003]
read_first: [src/modules/notification/notification.routes.ts, src/modules/admin/admin.repository.ts]
design_refs: [moderation/report]
constraints: [C-28]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.4.1]
---

# ADM-011 — Person reports another person or a business

## Story
As a customer, I want to report a person or a business so that the platform team can act on abuse.

## Context
- Exists: `reports` (ADM-003); `authMiddleware`; `idempotent()`; `checkAndConsume`.
- Adds: `POST /api/v1/reports` with `{ id, target_person_id | target_organization_id, reason, description }` (exactly one target; `reason` 1 to 100, `description` 1 to 2000); response 201 `{ id, status: 'PENDING', reported_at }`. The reporter is the caller. The target must exist (404 otherwise); reporting oneself, or one's own organization as its owner, answers 400. Limit: 10 reports per person per day (`RATE_LIMITED` 429, provisional).
- `C-28`: A report has exactly one target, a person or an organization.

## Acceptance criteria
```gherkin
Scenario: AC-1 Report a person
  When a signed-in person reports another person with a reason and a description
  Then the response is 201 and a PENDING report exists with the caller as reporter
Scenario: AC-2 Report an organization
  Then the same works with target_organization_id
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                   | status                |
    | both targets or none                      | 400 VALIDATION_ERROR  |
    | an unknown target                         | 404 NOT_FOUND         |
    | the caller as target                      | 400 VALIDATION_ERROR  |
    | an empty reason or description            | 400 VALIDATION_ERROR  |
    | an 11th report in one day                 | 429 RATE_LIMITED      |
Scenario: AC-4 Repeat
  When the same id is posted twice
  Then one report exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Resolving one's own report (mass assignment)
  When the body contains status, decision or resolved_by_id
  Then the response is 400
Scenario: AB-2 Report flooding (denial of service)
  When one person posts 11 reports in a day
  Then the 11th is refused
```

## Implementation
- Create: `src/modules/admin/report.routes.ts`, `tests/integration/admin/create-report.test.ts`
- Modify: `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`, `src/app.ts`
- Pattern: `src/modules/notification/notification.routes.ts`
- Signatures:
  - `createReport(personId: string, input: CreateReportInput): Promise<ReportView>`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `RATE_LIMITED` 429
- Dependencies: `express`, `zod`, `ioredis`

## Security
- v5.0.0-15.3.3: strict schema; status and decision come from the server.
- v5.0.0-2.4.1: per-person daily limit.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| report person | integration | AC-1, C-28 | PENDING |
| report organization | integration | AC-2 | PENDING |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | one report |
| server fields | security | AB-1, CWE-915 | 400 |
| flooding | security | AB-2, WSTG-BUSL-07 | 429 |

Command: `npx vitest run tests/integration/admin/create-report.test.ts`

## Out of scope
- Handling reports (ADM-012, ADM-013).

---
id: ADM-013
title: Administrator resolves a report
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-012, AUTH-008, NTF-002, ADM-006]
read_first: [src/modules/admin/admin.service.ts, src/modules/auth/session.service.ts]
design_refs: [moderation/report, gouvernance-de-la-plateforme/adminaction]
constraints: [CM-33, C-28]
asvs: [v5.0.0-8.2.1, v5.0.0-7.4.2, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# ADM-013 — Administrator resolves a report

## Story
As a moderator, I want to dismiss a report or suspend its target so that abuse is stopped and every decision is traced.

## Context
- Exists: reports (ADM-011, ADM-012); `recordAdminAction` (ADM-002); `revokeSessions` (AUTH-008); `notify`.
- Adds: `POST /api/v1/admin/reports/{reportId}/resolve` with `{ decision: 'DISMISSED' | 'SUSPENSION', reason }` (`reason` 1 to 2000).
- One transaction: the report must be PENDING (409 `ALREADY_RESOLVED`); it becomes RESOLVED with `resolved_by_id` the calling administrator, `decision`, `resolved_at` now. DISMISSED writes a `DISMISS_REPORT` journal row. SUSPENSION sets the target's status to SUSPENDED (a person: `Person.status`, and all their sessions are revoked with reason `ACCOUNT_SUSPENDED`, `scope_version` +1; an organization: `Organization.status`), writes a `SUSPEND` row with `report_id`, and notifies the person or the organization's owner `account.suspended`.
- A target already SUSPENDED stays so and the decision is still recorded. An ANONYMIZED person cannot be suspended (409 `TARGET_ANONYMIZED`).
- `CM-33`: A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction.
- `C-28`: A report has exactly one target, a person or an organization.

## Acceptance criteria
```gherkin
Scenario: AC-1 Dismiss
  When a MODERATOR dismisses a PENDING report with a reason
  Then the report is RESOLVED with DISMISSED and one DISMISS_REPORT journal row exists
Scenario: AC-2 Suspend a person
  When the decision is SUSPENSION on a person target
  Then Person.status is SUSPENDED, every session of that person is revoked with ACCOUNT_SUSPENDED, a SUSPEND row with the report id exists, and the person is notified
Scenario: AC-3 Suspend an organization
  Then Organization.status is SUSPENDED, a SUSPEND row exists and the owner is notified
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                | status                 |
    | a report already RESOLVED              | 409 ALREADY_RESOLVED   |
    | an empty reason                        | 400 VALIDATION_ERROR   |
    | decision "BAN"                         | 400 VALIDATION_ERROR   |
    | an unknown report                      | 404 NOT_FOUND          |
    | an ANONYMIZED person target            | 409 TARGET_ANONYMIZED  |
Scenario: AC-5 Atomic
  When the journal insert fails
  Then the report and the target are unchanged
```

## Abuse cases
```gherkin
Scenario: AB-1 Suspension without trace (repudiation)
  When any suspension is made through a report
  Then a SUSPEND row with the administrator, target, report and reason exists
Scenario: AB-2 Customer resolves reports (elevation)
  When a customer token calls the route
  Then the response is 401 and nothing changes
```

## Implementation
- Create: `tests/integration/admin/resolve-report.test.ts`
- Modify: `src/modules/admin/report.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`, `src/modules/admin/admin.schemas.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `resolveReport(admin: AdminContext, reportId: string, input: { decision: 'DISMISSED' | 'SUSPENSION'; reason: string }): Promise<AdminReportView>`
- Errors: `ALREADY_RESOLVED` 409, `TARGET_ANONYMIZED` 409, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: admin token and live administrator.
- v5.0.0-7.4.2: a suspended person's sessions all end.
- v5.0.0-2.3.3: report, target status, sessions and journal are one transaction.
- v5.0.0-16.3.1: every decision writes the journal.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| dismiss | integration | AC-1, CM-33 | RESOLVED, journal |
| suspend person | integration | AC-2, CM-33 | status, sessions, journal, notice |
| suspend organization | integration | AC-3 | status, journal |
| refusals | integration | AC-4, C-28 | each Examples row → status |
| atomic | integration | AC-5, CWE-362 | unchanged |
| trace | security | AB-1, CWE-778 | journal row |
| customer token | security | AB-2, WSTG-ATHZ-03 | 401 |

Command: `npx vitest run tests/integration/admin/resolve-report.test.ts`

## Out of scope
- Suspending without a report (ADM-014).

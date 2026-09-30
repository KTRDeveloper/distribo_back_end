---
id: ADM-014
title: Administrator suspends or reactivates without a report
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-013, ADM-006]
read_first: [src/modules/admin/admin.service.ts, src/modules/admin/admin.repository.ts]
design_refs: [moderation/report, gouvernance-de-la-plateforme/adminaction]
constraints: [CM-33]
asvs: [v5.0.0-8.2.1, v5.0.0-7.4.2, v5.0.0-16.3.1]
---

# ADM-014 — Administrator suspends or reactivates without a report

## Story
As a moderator, I want to suspend or reactivate a person or a business directly so that I can act without waiting for a report.

## Context
- Exists: suspension effects (ADM-013).
- Adds: `POST /api/v1/admin/people/{personId}/suspend`, `.../reactivate`, `POST /api/v1/admin/organizations/{organizationId}/suspend`, `.../reactivate`, each with `{ reason }` (1 to 2000). Suspend sets SUSPENDED (a person also loses all sessions, `scope_version` +1); reactivate returns the status to ACTIVE. Each writes a `SUSPEND` or `REACTIVATE` journal row with no report and notifies the person or owner.
- Suspending a SUSPENDED target or reactivating a non-SUSPENDED one answers 409 `INVALID_STATE`; an ANONYMIZED person answers 409 `TARGET_ANONYMIZED`; an organization CLOSED by its owner cannot be reactivated here (409 `INVALID_STATE`).
- `CM-33`: A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction.

## Acceptance criteria
```gherkin
Scenario: AC-1 Suspend and reactivate a person
  When a MODERATOR suspends and then reactivates a person
  Then the statuses go ACTIVE, SUSPENDED, ACTIVE, the sessions ended at suspension, and two journal rows exist
Scenario: AC-2 Organization
  Then the same works for an organization
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                    | status                 |
    | suspending a SUSPENDED target              | 409 INVALID_STATE      |
    | reactivating an ACTIVE target              | 409 INVALID_STATE      |
    | reactivating a CLOSED organization         | 409 INVALID_STATE      |
    | an ANONYMIZED person                       | 409 TARGET_ANONYMIZED  |
    | an empty reason                            | 400 VALIDATION_ERROR   |
    | an unknown id                              | 404 NOT_FOUND          |
Scenario: AC-4 Reactivated person can sign in
  Then a reactivated person passes the login status check again
```

## Abuse cases
```gherkin
Scenario: AB-1 Untraced suspension (repudiation)
  When any suspension or reactivation succeeds
  Then a journal row with author, target and reason exists
Scenario: AB-2 Ordinary token (elevation)
  When a customer's token calls these routes
  Then the response is 401
```

## Implementation
- Create: `tests/integration/admin/suspend-reactivate.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`, `src/modules/admin/admin.schemas.ts`
- Pattern: `src/modules/admin/admin.routes.ts`
- Signatures:
  - `suspendPerson(admin: AdminContext, personId: string, input: { reason: string }): Promise<void>`
  - `reactivatePerson(admin: AdminContext, personId: string, input: { reason: string }): Promise<void>`
  - `suspendOrganization(admin: AdminContext, organizationId: string, input: { reason: string }): Promise<void>`
  - `reactivateOrganization(admin: AdminContext, organizationId: string, input: { reason: string }): Promise<void>`
- Errors: `INVALID_STATE` 409, `TARGET_ANONYMIZED` 409, `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: admin token and live administrator.
- v5.0.0-7.4.2: suspension ends sessions.
- v5.0.0-16.3.1: journaled.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| person cycle | integration | AC-1, CM-33 | statuses, sessions, journal |
| organization | integration | AC-2 | statuses, journal |
| refusals | integration | AC-3 | each Examples row → status |
| sign in again | integration | AC-4 | login passes |
| untraced | security | AB-1, CWE-778 | journal row |
| ordinary token | security | AB-2, WSTG-ATHZ-03 | 401 |

Command: `npx vitest run tests/integration/admin/suspend-reactivate.test.ts`

## Out of scope
- Effects of a suspended organization on orders (ORD-003 and ORD stories).

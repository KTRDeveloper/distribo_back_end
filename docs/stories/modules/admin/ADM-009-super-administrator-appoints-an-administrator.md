---
id: ADM-009
title: Super administrator appoints an administrator
module: admin
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ADM-006, ADM-005]
read_first: [src/modules/admin/admin.service.ts, src/modules/admin/admin.repository.ts]
design_refs: [gouvernance-de-la-plateforme/administrator, gouvernance-de-la-plateforme/adminaction]
constraints: [C-29]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3, v5.0.0-16.3.1]
---

# ADM-009 — Super administrator appoints an administrator

## Story
As a super-admin, I want to appoint a registered person as moderator or super-admin so that the platform team can grow.

## Context
- Exists: `requireAdminRole`, `createTotpSecret`, `recordAdminAction`.
- Adds: `POST /api/v1/admin/administrators` (SUPER_ADMIN) with `{ id, phone_number, role, reason }`; response 201 `{ id, person_public, role, otpauth_uri }`. The `otpauth_uri` is shown only in this response (Q-032). The person must be registered and not already a live administrator (409 `ALREADY_ADMINISTRATOR`). One transaction inserts the administrator (encrypted secret) and an `APPOINT_ADMIN` journal row with the caller as author, the person as target and the reason.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.

## Acceptance criteria
```gherkin
Scenario: AC-1 Appoint
  When a SUPER_ADMIN appoints a registered person as MODERATOR with reason "renfort"
  Then the administrator exists with an encrypted secret, the journal row exists, and the response carries the URI
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                | status                     |
    | a guest or unknown number              | 404 NOT_FOUND              |
    | a person who is already an administrator | 409 ALREADY_ADMINISTRATOR |
    | reason empty                           | 400 VALIDATION_ERROR       |
    | role "OWNER"                           | 400 VALIDATION_ERROR       |
    | a MODERATOR caller                     | 403 FORBIDDEN              |
Scenario: AC-3 The secret is not shown again
  Then no other response or listing contains the secret or the URI
```

## Abuse cases
```gherkin
Scenario: AB-1 Moderator appoints staff (vertical)
  When a MODERATOR posts an appointment
  Then the response is 403 and nothing is stored
```

## Implementation
- Create: `tests/integration/admin/appoint.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`
- Pattern: `src/modules/admin/admin.routes.ts`
- Signatures:
  - `appointAdministrator(admin: AdminContext, input: AppointInput): Promise<AppointedView>`
- Errors: `ALREADY_ADMINISTRATOR` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: super administrators only.
- v5.0.0-2.3.3: appointment and journal are one transaction.
- v5.0.0-16.3.1: the appointment is journaled with a reason.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| appoint | integration | AC-1, C-29 | rows and URI |
| refusals | integration | AC-2 | each Examples row → status |
| secret once | integration | AC-3 | absent elsewhere |
| moderator | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/admin/appoint.test.ts`

## Out of scope
- Removing (ADM-010).

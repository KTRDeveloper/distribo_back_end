---
id: ADM-010
title: Super administrator removes an administrator
module: admin
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ADM-009]
read_first: [src/modules/admin/admin.service.ts, src/modules/admin/admin.repository.ts]
design_refs: [gouvernance-de-la-plateforme/administrator, gouvernance-de-la-plateforme/adminaction]
constraints: [C-29]
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.1]
---

# ADM-010 — Super administrator removes an administrator

## Story
As a super-admin, I want to remove an administrator so that former staff lose access while their actions stay attributed.

## Context
- Exists: `POST /admin/administrators` (ADM-009).
- Adds: `DELETE /api/v1/admin/administrators/{administratorId}` with `{ reason }` in the body (SUPER_ADMIN); response 204. `removed_at` is set (the row stays for the journal) and a `REMOVE_ADMIN` journal row is written in the same transaction. The last live SUPER_ADMIN cannot be removed (409 `LAST_SUPER_ADMIN`). A removed administrator's token stops working at once (ADM-006).
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC (super administrators only), and is immutable.

## Acceptance criteria
```gherkin
Scenario: AC-1 Remove
  When a SUPER_ADMIN removes a moderator
  Then removed_at is set, a REMOVE_ADMIN row exists, and the moderator's next admin call answers 401
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                                    | status                 |
    | the last live SUPER_ADMIN                  | 409 LAST_SUPER_ADMIN   |
    | an administrator already removed           | 404 NOT_FOUND          |
    | reason empty                               | 400 VALIDATION_ERROR   |
    | a MODERATOR caller                         | 403 FORBIDDEN          |
Scenario: AC-3 History kept
  Then earlier journal rows of the removed administrator still exist
```

## Abuse cases
```gherkin
Scenario: AB-1 Moderator removes a super administrator (vertical)
  When a MODERATOR sends the delete
  Then the response is 403 and the administrator stays live
```

## Implementation
- Create: `tests/integration/admin/remove.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`
- Pattern: `src/modules/admin/admin.routes.ts`
- Signatures:
  - `removeAdministrator(admin: AdminContext, administratorId: string, input: { reason: string }): Promise<void>`
- Errors: `LAST_SUPER_ADMIN` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: super administrators only.
- v5.0.0-16.3.1: journaled with a reason.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| remove | integration | AC-1, C-29 | removed_at, journal, 401 next call |
| refusals | integration | AC-2 | each Examples row → status |
| history | integration | AC-3 | rows kept |
| moderator | security | AB-1, WSTG-ATHZ-03 | 403 |

Command: `npx vitest run tests/integration/admin/remove.test.ts`

## Out of scope
- Deleting the person.

---
id: ADM-017
title: Support releases the number of a person
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-016, ADM-014, PER-014]
read_first: [src/modules/admin/admin.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [gouvernance-de-la-plateforme/adminaction, identite-et-organisation/person]
constraints: [CM-41, CM-04, C-29]
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.1]
---

# ADM-017 — Support releases the number of a person

## Story
As a super-admin, I want to release the number of a person who still holds it so that the new holder of that number can register.

## Context
- Exists: `releaseRegisteredHolder(tx, phone)` in `auth.repository.ts`, `firePhoneReleased` (PER-014), `recordAdminAction`, `findPersonStatus`, `notify`; RELEASE_PHONE (ADM-016).
- Adds `POST /api/v1/admin/people/{personId}/release-phone` with `{ reason }` (1 to 2000), SUPER_ADMIN only, answer 204. Add the path to `admin.openapi.ts` and to the route lists in `tests/integration/api-docs/catalog.test.ts` and `per-001.test.ts`.
- New file `src/modules/auth/support-access.service.ts`: `releaseNumberOfPerson(tx, personId): Promise<string | null>` reads the registered person's active number, calls `releaseRegisteredHolder`, then `firePhoneReleased(number, tx)`; null for a guest or a person with no active number. Listed in the auth contracts.
- One transaction: the release, a RELEASE_PHONE row (author, person, reason) and the notice `admin.phone_released`. FR: "Le support a libéré votre numéro. Ajoutez votre nouveau numéro pour continuer." EN: "Support has released your number. Add your new number to keep using the app."
- Unknown id 404 `NOT_FOUND`; ANONYMIZED 409 `TARGET_ANONYMIZED`; no active number 409 `NO_ACTIVE_NUMBER`. Logs `warn` `phone_released_by_support`, ids only.
- `CM-41`: Number released by support (RELEASE_PHONE, super administrators only, reason required): when a former holder who is still active wrongly blocks the new one, support releases the number as a recycled-number claim does, and the person is notified.
- `CM-04`: Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number.
- `C-29`: `Administrator.totp_secret` is required; `recovery_email` differs from `Person.email`; `AdminAction` has exactly one target, a reason, `sync_archive_id` only for REPLAY_SYNC, and is immutable. REPLAY_SYNC, GIFT_DAYS, RECORD_PAYMENT, REFUND_PAYMENT, RELEASE_PHONE and RESTORE_ACCESS are for super administrators only; GIFT_DAYS, RECORD_PAYMENT and REFUND_PAYMENT target a business, RELEASE_PHONE and RESTORE_ACCESS a person.

## Acceptance criteria
```gherkin
Scenario: AC-1 Number released
  Given a registered person who holds a number
  When a SUPER_ADMIN posts a reason
  Then the response is 204 and `released_phone_number` holds the number, `phone_number` is empty and the sessions are untouched
  And `firePhoneReleased` ran once with the number, one RELEASE_PHONE row names author, person and reason, and the person has one notice
  And a visitor can now register with the number
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                              | status                |
    | an unknown id                        | 404 NOT_FOUND         |
    | an anonymized person                 | 409 TARGET_ANONYMIZED |
    | a guest or a number already released | 409 NO_ACTIVE_NUMBER  |
    | an empty reason                      | 400 VALIDATION_ERROR  |
Scenario: AC-3 A failing handler undoes the release
  Given a handler that throws
  When a SUPER_ADMIN releases a number
  Then the response is 500, the person keeps the number, and there is no journal row and no notice
```

## Abuse cases
```gherkin
Scenario: AB-1 A moderator frees a number (elevation)
  When a MODERATOR posts the request
  Then the response is 403 and the number is unchanged
Scenario: AB-2 A release with no trace (repudiation)
  Given the journal insert fails
  When a SUPER_ADMIN releases a number
  Then the number is not released
```

## Implementation
- Create: `src/modules/auth/support-access.service.ts`, `tests/integration/admin/release-phone.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `releasePhone(admin: AdminContext, personId: string, input: { reason: string }): Promise<void>`
  - `releaseNumberOfPerson(tx: Prisma.TransactionClient, personId: string): Promise<string | null>`
- Errors: `NOT_FOUND` 404, `TARGET_ANONYMIZED` 409, `NO_ACTIVE_NUMBER` 409, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: SUPER_ADMIN only, checked by the route and by the database.
- v5.0.0-16.3.1: the release, the journal row and the notice share one transaction; the log holds ids only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| release | integration | AC-1, CM-41, CM-04 | super admin releases → 204, number moved, handler ran, journal row, notice, sessions kept |
| refusals | integration | AC-2 | each Examples row → status, nothing changes |
| handler fails | integration | AC-3 | throwing handler → 500, number kept, no journal row, no notice |
| moderator | security | AB-1, C-29, CWE-269 | MODERATOR → 403, number unchanged |
| no trace | security | AB-2, CWE-778 | journal insert fails → number kept |

Command: `npx vitest run tests/integration/admin/release-phone.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- Registering the new holder: the registration stories of AUTH.

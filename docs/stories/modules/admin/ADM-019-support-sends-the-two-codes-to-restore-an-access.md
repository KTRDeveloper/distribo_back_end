---
id: ADM-019
title: Support sends the two codes to restore an access
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-018, ADM-016, ADM-014]
read_first: [src/modules/admin/admin.service.ts, src/modules/admin/admin.repository.ts]
design_refs: [identite-et-organisation/person, gouvernance-de-la-plateforme/adminaction]
constraints: [CM-40]
asvs: [v5.0.0-6.4.4, v5.0.0-6.4.6, v5.0.0-8.2.1]
---

# ADM-019 — Support sends the two codes to restore an access

## Story
As a super-admin, I want to send a code to the verified email of a person and a code to their new number so that I can give them their account back after they lost their SIM.

## Context
- Exists: `issueCode` with the purpose ACCESS_RESTORE (AUTH-027) and its fixed text (ADM-018), `requireAdminRole`, `normalizeE164`, `isCameroonMobile`, `findByActivePhone`.
- Adds `POST /api/v1/admin/people/{personId}/restore-access/start` with `{ new_phone_number }`, SUPER_ADMIN only, answer 204. Add the path to `admin.openapi.ts` and to the route lists in `tests/integration/api-docs/catalog.test.ts` and `per-001.test.ts`.
- `findPersonForRestore(personId)` in `admin.repository.ts` returns status, registered, email, emailVerified and phoneNumber of the person in the path.
- Checks, in this order, before any code is sent: unknown or unregistered person 404 `NOT_FOUND`; ANONYMIZED 409 `TARGET_ANONYMIZED`; SUSPENDED 409 `INVALID_STATE`; no verified email 409 `NO_VERIFIED_EMAIL`; not a +237 mobile 400 `VALIDATION_ERROR`; held by another person 409 `PHONE_TAKEN`; the person's own number 400 `SAME_NUMBER`.
- Then two `issueCode` calls with the person id and the purpose ACCESS_RESTORE: EMAIL to the saved verified email, SMS to the new number. Their send limits apply. Nothing is journaled here: the row comes with ADM-020. Logs `warn` `access_restore_started`, ids only.
- `CM-40`: Access restored by support (RESTORE_ACCESS, super administrators only) needs a verified email, a code sent to that email and a code sent to the new number (purpose ACCESS_RESTORE). The number is replaced like a number change (PhoneNumberChangeLog), every device is signed out and the person is notified. Without a verified email support can do nothing.

## Acceptance criteria
```gherkin
Scenario: AC-1 Two codes sent
  Given a registered person with a verified email
  When a SUPER_ADMIN posts a new +237 mobile number
  Then the response is 204 with no code in the body
  And one EMAIL code goes to the verified email and one SMS code to the new number, both for ACCESS_RESTORE and the person, and no journal row exists
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is sent
  Examples:
    | problem                                | status                |
    | an unknown id or a guest               | 404 NOT_FOUND         |
    | an anonymized person                   | 409 TARGET_ANONYMIZED |
    | a suspended person                     | 409 INVALID_STATE     |
    | a number held by someone else          | 409 PHONE_TAKEN       |
    | the person's own number                | 400 SAME_NUMBER       |
    | a number outside +237 mobiles          | 400 VALIDATION_ERROR  |
Scenario: AC-3 Too soon
  When the same start is posted twice within a minute
  Then the second answer is 429 `OTP_RATE_LIMITED`
```

## Abuse cases
```gherkin
Scenario: AB-1 An account with no verified email (spoofing)
  Given a person whose email is saved but not verified, and a person with no email
  When a SUPER_ADMIN starts the restoration of each
  Then both answers are 409 `NO_VERIFIED_EMAIL` and nothing is sent
Scenario: AB-2 A moderator starts a restoration (elevation)
  When a MODERATOR posts the request
  Then the response is 403 and nothing is sent
```

## Implementation
- Create: `tests/integration/admin/restore-access-start.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.repository.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `startAccessRestore(admin: AdminContext, personId: string, input: RestoreStartInput): Promise<void>`
  - `findPersonForRestore(personId: string): Promise<RestoreTarget | null>`
- Types:
  - `RestoreStartInput = { new_phone_number: string }`
  - `RestoreTarget = { status: PersonStatus; registered: boolean; email: string | null; emailVerified: boolean; phoneNumber: string | null }`
- Errors: `NOT_FOUND` 404, `TARGET_ANONYMIZED` 409, `INVALID_STATE` 409, `NO_VERIFIED_EMAIL` 409, `PHONE_TAKEN` 409, `SAME_NUMBER` 400, `VALIDATION_ERROR` 400, `OTP_RATE_LIMITED` 429
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-6.4.4: access is given back only on two proofs, the verified email and the new number.
- v5.0.0-6.4.6: the administrator starts the process and never sees a code.
- v5.0.0-8.2.1: SUPER_ADMIN only; the person comes from the path and the email from the database.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| two codes | integration | AC-1, CM-40 | start → 204, one EMAIL and one SMS challenge for the person, no journal row |
| refusals | integration | AC-2 | each Examples row → status, nothing queued |
| too soon | integration | AC-3 | two starts within a minute → second 429 |
| no verified email | security | AB-1, CWE-287 | email saved but not verified, and no email → 409, nothing queued |
| moderator | security | AB-2, CWE-269 | MODERATOR → 403, nothing queued |

Command: `npx vitest run tests/integration/admin/restore-access-start.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- Entering the codes and moving the account: ADM-020.
- Giving a verified email to a person who has none: the person does it in the application (AUTH-022, AUTH-023).

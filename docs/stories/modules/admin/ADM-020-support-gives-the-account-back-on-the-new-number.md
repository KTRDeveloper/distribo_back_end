---
id: ADM-020
title: Support gives the account back on the new number
module: admin
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ADM-019, ADM-017]
read_first: [src/modules/admin/admin.service.ts, src/modules/auth/auth.repository.ts]
design_refs: [identite-et-organisation/person, identite-et-organisation/phonenumberchangelog]
constraints: [CM-40]
asvs: [v5.0.0-6.4.4, v5.0.0-6.6.2, v5.0.0-7.4.1]
---

# ADM-020 — Support gives the account back on the new number

## Story
As a super-admin, I want to enter the two codes the person gives me so that their account moves to the new number and they can sign in again.

## Context
- Exists: the start and `findPersonForRestore` (ADM-019); `verifyCode`, `revokeSessions`, `recordAdminAction`, `notify`; `movePhoneNumber` in `auth.repository.ts`; `support-access.service.ts` (ADM-017).
- Adds `POST /api/v1/admin/people/{personId}/restore-access/complete` with `{ new_phone_number, email_code, sms_code, reason }`, SUPER_ADMIN only, answer 204. Add the path to `admin.openapi.ts` and to the route lists in `tests/integration/api-docs/catalog.test.ts` and `per-001.test.ts`.
- `moveAccountToNumber(tx, personId, newPhone): Promise<boolean>` in `support-access.service.ts` calls `movePhoneNumber`; false when the person has no number. Listed in the auth contracts.
- The checks of ADM-019 run again. Then `verifyCode` for the EMAIL code (target: the verified email) and the SMS code (target: the new number), each bound to the person (400 `OTP_INVALID`, 400 `OTP_EXPIRED`, 429 `OTP_LOCKED`).
- One transaction: `moveAccountToNumber`, `revokeSessions(personId, 'LOGOUT_ALL', { tx })`, a RESTORE_ACCESS row and the notice `admin.access_restored`. FR: "Le support a rendu l'accès à votre compte sur un nouveau numéro. Ce n'était pas vous ? Contactez-nous." EN: "Support has given your account back on a new number. Not you? Contact us."
- A number taken meanwhile answers 409 `PHONE_TAKEN`. Logs `warn` `access_restored`, ids only.
- `CM-40`: Access restored by support (RESTORE_ACCESS, super administrators only) needs a verified email, a code sent to that email and a code sent to the new number (purpose ACCESS_RESTORE). The number is replaced like a number change (PhoneNumberChangeLog), every device is signed out and the person is notified. Without a verified email support can do nothing.

## Acceptance criteria
```gherkin
Scenario: AC-1 Account moved
  Given a started restoration
  When a SUPER_ADMIN posts the two right codes with a reason
  Then the response is 204 and `phone_number` is the new number, verified now
  And one `PhoneNumberChangeLog` row holds the old number and the new one, and every refresh token of the person is revoked
  And one RESTORE_ACCESS row and one notice exist, and the person signs in with the new number
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the response is <status> and nothing changes
  Examples:
    | problem                | status               |
    | a wrong or used code   | 400 OTP_INVALID      |
    | an expired code        | 400 OTP_EXPIRED      |
    | a number taken meanwhile | 409 PHONE_TAKEN    |
    | an empty reason        | 400 VALIDATION_ERROR |
Scenario: AC-3 All or nothing
  Given the journal insert fails
  When the codes are right
  Then the number is unchanged and the sessions are kept
```

## Abuse cases
```gherkin
Scenario: AB-1 One proof is not enough (spoofing)
  Given the email code is right and the SMS code wrong, then the reverse
  When a SUPER_ADMIN posts each pair
  Then both answers are 400 and the number and the sessions are unchanged
Scenario: AB-2 Codes of another restoration (spoofing)
  Given two people each in a started restoration
  When the codes of the first are posted for the second
  Then the response is 400 `OTP_INVALID` and nothing changes
Scenario: AB-3 A moderator gives an account away (elevation)
  When a MODERATOR posts the request
  Then the response is 403 and nothing changes
```

## Implementation
- Create: `tests/integration/admin/restore-access-complete.test.ts`
- Modify: `src/modules/admin/admin.routes.ts`, `src/modules/admin/admin.service.ts`, `src/modules/admin/admin.schemas.ts`, `src/modules/admin/admin.openapi.ts`, `src/modules/auth/support-access.service.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `completeAccessRestore(admin: AdminContext, personId: string, input: RestoreCompleteInput): Promise<void>`
  - `moveAccountToNumber(tx: Prisma.TransactionClient, personId: string, newPhone: string): Promise<boolean>`
- Types:
  - `RestoreCompleteInput = { new_phone_number: string; email_code: string; sms_code: string; reason: string }`
- Errors: `OTP_INVALID` 400, `OTP_EXPIRED` 400, `OTP_LOCKED` 429, `NO_VERIFIED_EMAIL` 409, `PHONE_TAKEN` 409, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-6.4.4: both proofs are checked, each code bound to the person and its target.
- v5.0.0-6.6.2: a code of another restoration is refused.
- v5.0.0-7.4.1: every device is signed out in the same transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| restore | integration | AC-1, CM-40 | right codes → 204, number moved, change log, tokens revoked, journal row, notice, sign-in works |
| refusals | integration | AC-2 | each Examples row → status, nothing changes |
| atomic | integration | AC-3 | journal insert fails → number and sessions kept |
| one proof | security | AB-1, CWE-287 | one wrong code, both orders → 400, nothing changes |
| other restoration | security | AB-2, CWE-639 | codes of person A posted for person B → 400 |
| moderator | security | AB-3, CWE-269 | MODERATOR → 403 |

Command: `npx vitest run tests/integration/admin/restore-access-complete.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

## Out of scope
- Announcing the old number as released to the shop contacts (CM-36).

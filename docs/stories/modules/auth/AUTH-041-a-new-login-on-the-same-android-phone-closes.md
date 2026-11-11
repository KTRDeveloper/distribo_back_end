---
id: AUTH-041
title: A new login on the same Android phone closes its old session
module: auth
kind: feature
rev: 1
amends: [AUTH-008]
size: M
risk: high
depends_on: [AUTH-039, AUTH-040]
read_first: [src/modules/auth/session.service.ts, src/modules/auth/session.repository.ts]
design_refs: [a2-reconnaitre-un-telephone-android, a2-reconnaitre-un-telephone-android/le-champ-envoye, a2-reconnaitre-un-telephone-android/a-l-ouverture-d-une-session, a2-reconnaitre-un-telephone-android/fiches-existantes]
constraints: [C-59]
asvs: [v5.0.0-7.2.4, v5.0.0-7.4.1, v5.0.0-16.2.5]
---

# AUTH-041 — A new login on the same Android phone closes its old session

## Story
As a customer, I want my phone to appear once in my devices after I log in again, so that I recognize every session listed.

## Context
- `device.android_id`: optional, 1 to 16 lowercase hex characters (`^[0-9a-f]{1,16}$`); any other form gets 400. Add it to `deviceSchema` (`auth.schemas.ts`: register, login verify, reset confirm) and to `deviceInfoSchema` and `DeviceInfo` (`session.service.ts`).
- In the transaction of `issueSession`, when it is present: compute `hashAndroidId(personId, android_id)`; revoke the person's devices with that hash and `revoked_at` null, expired or not, and their live refresh tokens with reason `REPLACED` (like `revokeDevice`); then create the device with the hash.
- Two crossed logins of the same phone: the second hits the unique index (Prisma P2002); map it to 409 `SESSION_CONFLICT`, nothing applied, the gesture can be retried.
- Absent field (iPhone, old app): unchanged. Devices without a hash are never merged; a changed key simply recognizes nothing.
- The raw id is never stored, returned or logged; the new-login code and alert stay required.
- `C-59`: At most one open (not revoked) device per person and `android_id_hash`.

## Acceptance criteria
```gherkin
Scenario: AC-1 The same phone replaces its session
  Given person P logged in on a phone sending android_id "a1b2c3d4"
  When P logs in again on it
  Then the old device is revoked, its refresh token revoked with REPLACED, and P has one open device for that phone
Scenario: AC-2 An expired old session is also closed
  Given P's old device with that fingerprint and an expired refresh token
  When P logs in again on that phone
  Then the old device is revoked
Scenario: AC-3 No id, nothing merged
  When P logs in without android_id, or an old device of P has no fingerprint
  Then no device of P is revoked
Scenario Outline: AC-4 The id's form
  When a login verify sends android_id <value>
  Then the answer is <status>
  Examples:
    | value               | status |
    | "a1b2c3d4"          | 200    |
    | "A1B2C3D4"          | 400    |
    | "a1b2c3d4e5f607182" | 400    |
    | ""                  | 400    |
Scenario: AC-5 Crossed logins
  When two login verifies of the same phone run at the same time
  Then one succeeds and the other gets 409 SESSION_CONFLICT with nothing written
```

## Abuse cases
```gherkin
Scenario: AB-1 Closing another person's session
  Given person Q has an open session on a phone with android_id "a1b2c3d4"
  When P logs in sending android_id "a1b2c3d4"
  Then Q's session stays open
Scenario: AB-2 The raw id leaks
  When a login with android_id is answered and logged
  Then neither the answer, the logs nor the devices row hold "a1b2c3d4"
```

## Implementation
- Create: `tests/integration/auth/same-android-phone.test.ts`
- Modify: `src/modules/auth/auth.schemas.ts`, `src/modules/auth/session.service.ts`, `src/modules/auth/session.repository.ts`
- Pattern: `tests/integration/auth/devices.test.ts`
- Signatures:
  - `revokeByAndroidIdHash(tx: Prisma.TransactionClient, personId: string, hash: string): Promise<void>`
- Errors: `409` SESSION_CONFLICT: another login of the same phone is in progress
- Dependencies: `@prisma/client`

## Security
- v5.0.0-7.2.4: every login still issues new tokens; the old session's tokens are revoked in the same transaction.
- v5.0.0-7.4.1: a replaced session's refresh token is refused at once.
- v5.0.0-16.2.5: the Android id is never stored, returned or logged; only its keyed fingerprint is stored.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| replace | integration | AC-1 | old device revoked, REPLACED, one open device |
| expired old | integration | AC-2 | revoked |
| no id | integration | AC-3 | nothing revoked |
| form | integration | AC-4 | each Examples row → status |
| crossed | integration | AC-5, C-59 | one 200, one 409, one open device |
| other person | security | AB-1, CWE-639 | Q still open |
| no raw id | security | AB-2, CWE-532 | id absent from body, logs, row |

Command: `npx vitest run tests/integration/auth/same-android-phone.test.ts`

## Out of scope
- Which sessions count as open, and the alert (AUTH-042).
- Clearing the fingerprint at account deletion (PRIV-006).

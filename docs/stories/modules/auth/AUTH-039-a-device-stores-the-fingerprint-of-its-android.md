---
id: AUTH-039
title: A device stores the fingerprint of its Android id
module: auth
kind: migration
rev: 1
amends: [AUTH-007]
size: S
risk: high
depends_on: [AUTH-007]
read_first: [prisma/schema.prisma, tests/integration/organization/amount-held.test.ts]
design_refs: [a2-reconnaitre-un-telephone-android/ce-que-le-serveur-garde-champ-ajoute-a, a2-reconnaitre-un-telephone-android/contraintes-de-base-de-donnees-complete]
constraints: [C-59]
asvs: [v5.0.0-2.2.1]
---

# AUTH-039 — A device stores the fingerprint of its Android id

## Story
Technical story: add `android_id_hash` to devices and the `REPLACED` revocation reason, so that a new login can close the session the same phone left open.

## Context
- Additive migration: `devices.android_id_hash`, nullable `text`; existing rows keep it empty.
- A partial unique index on (`person_id`, `android_id_hash`) where `revoked_at` is null and the hash is set: at most one open device per person and fingerprint.
- Add `REPLACED` to the enum `RefreshTokenRevokedReason` and to the `RevokedReason` type in `session.repository.ts`.
- `prisma/schema.prisma`: `Device` gets `androidIdHash` (`@map`). Write the `//` comment above `Device` in plain words: one open device per person and phone fingerprint, why it is not in `@@unique` (it ignores closed devices), and this migration's name.
- No code writes the hash yet (AUTH-041).
- `Device` fields: `android_id_hash` string, nullable
- `C-59`: At most one open (not revoked) device per person and `android_id_hash`.

## Acceptance criteria
```gherkin
Scenario: AC-1 The column exists and stays empty
  When the columns of `devices` are read
  Then `android_id_hash` is a nullable text and every existing device has it empty
Scenario Outline: AC-2 One open device per person and fingerprint
  Given an open device of person P with fingerprint H
  When <second> is inserted
  Then the database <result>
  Examples:
    | second                                   | result          |
    | an open device of P with fingerprint H   | rejects (23505) |
    | a revoked device of P with fingerprint H | accepts         |
    | an open device of Q with fingerprint H   | accepts         |
    | an open device of P without fingerprint  | accepts         |
Scenario: AC-3 The new reason
  When a refresh token is revoked with reason REPLACED
  Then the database accepts it
```

## Abuse cases
```gherkin
Scenario: AB-1 Two open sessions by a raw insert
  When a raw insert adds a second open device of P with fingerprint H
  Then the database rejects it with 23505
```

## Implementation
- Create: `prisma/migrations/<timestamp>_auth_039_android_id_hash/migration.sql`, `tests/integration/auth/android-id-hash-column.test.ts`
- Modify: `prisma/schema.prisma`, `src/modules/auth/session.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: `prisma`, `@prisma/client`

## Security
- v5.0.0-2.2.1: the database refuses a second open session for the same phone, even when the code is bypassed.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| column | integration | AC-1 | nullable text, existing rows empty |
| uniqueness | integration | AC-2, C-59 | each Examples row → 23505 or accepted |
| reason | integration | AC-3 | REPLACED accepted |
| raw insert | security | AB-1, CWE-841 | 23505 |

Command: `npx vitest run tests/integration/auth/android-id-hash-column.test.ts`

## Out of scope
- Computing and writing the fingerprint (AUTH-040, AUTH-041).

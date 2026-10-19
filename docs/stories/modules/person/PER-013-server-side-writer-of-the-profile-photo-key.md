---
id: PER-013
title: Server-side writer of the profile photo key
module: person
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [PER-010, FND-013, PER-005]
read_first: [src/modules/person/person.repository.ts, docs/stories/modules/foundation/contracts.md]
design_refs: [identite-et-organisation/person, images/stockage]
constraints: [C-49]
asvs: [v5.0.0-15.3.3, v5.0.0-2.2.3]
---

# PER-013 — Server-side writer of the profile photo key

## Story
Technical story: provide the one function that writes or clears a person's photo key and hands back the previous key, so that the images module can delete the old file after the commit.

## Context
- Exists: `person.repository.ts` with `bumpScopeVersion(personId, tx?)` (PER-005); `imageKeySchema` and the folder `avatars` (FND-013); the column and its CHECKs (PER-010).
- Adds `setAvatarKey(personId, key, tx?)` in `person.repository.ts`: inside the caller's transaction (it opens its own when none is given) it locks the person row, reads the previous key, writes the new key (`null` clears it) and returns the previous key.
- Only the server calls it: the upload and removal routes of the images module (IMG-003). No profile schema accepts a key (PER-012).
- A key must match `imageKeySchema` and start with `avatars/`; otherwise a RangeError is thrown and nothing is written.
- A guest or an anonymized person cannot hold a key: the PER-010 CHECK rejects the write and the error is not caught.
- First usage: IMG-003. It ships here because the images module may import `person` only through its contract (ADR-004).
- `Person` fields: `avatar_key` string, nullable
- `C-49`: A guest has no `avatar_key`; a key is cited by one card only, across all tables; `Person.avatar_key` is written by the server only. The rules for product and variant keys belong to the images and catalog modules.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Set, replace and clear
  Given a registered person whose key is <before>
  When `setAvatarKey` is called with <given>
  Then it returns <returned> and the stored key is <given>
  Examples:
    | before | given  | returned |
    | empty  | key A  | null     |
    | key A  | key B  | key A    |
    | key B  | null   | key B    |
Scenario: AC-2 Unknown person
  When `setAvatarKey` is called with an id that is not a person
  Then it fails with 404 `NOT_FOUND` and writes nothing
Scenario: AC-3 A guest cannot hold a key
  When `setAvatarKey` is called for a guest
  Then the call fails and the guest's key stays empty
Scenario: AC-4 Same transaction as the caller
  Given the caller's transaction is rolled back after `setAvatarKey`
  Then the stored key is the one from before
Scenario: AC-5 Two replacements at once
  Given a person holds key A
  When two calls replace it with key B and key C at the same time
  Then one returns key A and the other returns the key the first wrote
```

## Abuse cases
```gherkin
Scenario: AB-1 A key from another folder or a crafted key (tampering)
  When `setAvatarKey` receives `products/<uuid>.webp`, `avatars/../x.webp` or an uppercase UUID
  Then it throws a RangeError and the stored key is unchanged
```

## Implementation
- Create: `tests/integration/person/avatar-key-writer.test.ts`
- Modify: `src/modules/person/person.repository.ts`
- Pattern: `src/modules/person/person.repository.ts`
- Signatures:
  - `setAvatarKey(personId: string, key: string | null, tx?: Prisma.TransactionClient): Promise<string | null>`
- Errors: `NOT_FOUND` 404
- Dependencies: `@prisma/client`

## Security
- v5.0.0-15.3.3: the photo key has exactly one writer, and it validates the key.
- v5.0.0-2.2.3: the row is locked before the previous key is read, so two writers never return the same previous key.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| set replace clear | integration | AC-1, C-49 | each Examples row → returned and stored values |
| unknown person | integration | AC-2 | random UUID → 404 NOT_FOUND |
| guest | integration | AC-3, C-49 | guest id → rejected, key empty |
| same transaction | integration | AC-4 | rollback after the call → previous key stored |
| concurrent | integration | AC-5 | `Promise.all` of two replacements → the two returned values are A and the first writer's key |
| crafted key | security | AB-1, CWE-22 | the three values → RangeError and key unchanged |

Command: `npx vitest run tests/integration/person/avatar-key-writer.test.ts`

## Out of scope
- Receiving, re-encoding and storing the file, and deleting the previous file: IMG-002 and IMG-003.
- Checking that the key is not cited by another card (IMG-004, IMG-006).

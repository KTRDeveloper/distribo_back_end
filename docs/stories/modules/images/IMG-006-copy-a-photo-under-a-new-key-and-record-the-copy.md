---
id: IMG-006
title: Copy a photo under a new key and record the copy
module: images
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [IMG-001, IMG-002]
read_first: [src/modules/images/image.repository.ts, src/modules/images/image.ports.ts]
design_refs: [images/ajouter-a-mon-catalogue, images/imagecopy]
constraints: [C-56, C-49]
asvs: [v5.0.0-5.3.2, v5.0.0-8.3.1]
---

# IMG-006 — Copy a photo under a new key and record the copy

## Story
Technical story: copy a product photo to a new file under a new random key with a small invisible variation, and record it in the registry, so that two shops copying one photo cannot be linked by their files.

## Context
- Exists: the ports and `FakeImageProcessor`, where `vary` adds random bytes (IMG-002); the table `image_copies` and its rules (IMG-001); `newImageKey`.
- New `image-copy.service.ts`: `copyImage(tx, sourceKey): Promise<string | null>`. A key outside `products/` throws a RangeError (a logo or a profile photo is never copied). It reads the source file (`get`); when the file is gone it returns null and the caller keeps the card without that photo.
- Otherwise it re-encodes with `vary: true`, stores the result under `newImageKey('products')`, then, in the caller's transaction, inserts the registry row: `root_key` is the `root_key` of the row whose `copy_key` is the source when there is one, else the source key. It returns the new key.
- `image.repository.ts` gains `findCopyRoot(tx, key)` and `insertImageCopy(tx, row)`; no other function writes the registry.
- The storage is not transactional: if the caller's transaction fails, the new file stays until the nightly cleanup (IMG-007). No route, answer or synchronization ever returns a registry row.
- `C-56`: `ImageCopy` has `copy_key` as primary key; `root_key` equals the source's `root_key` when the source is itself a copy, else the source key; written by the server only, in the transaction that stores the copy's key; never synchronized; never updated, deleted or purged.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 A first copy
  Given an original photo A
  When copyImage runs on A
  Then it returns a new key under `products/`, the stored bytes differ from those of A, and one registry row holds (new, A, A)
Scenario: AC-2 A copy of a copy
  Given B is a copy of A
  When copyImage runs on B
  Then the row is (C, B, A) and one query on root A returns B and C
Scenario: AC-3 Two copies of one photo
  When copyImage runs twice on A
  Then the two keys differ and the two stored files differ
Scenario Outline: AC-4 Nothing copied
  When copyImage runs on <input>
  Then the result is <result> and the registry is unchanged
  Examples:
    | input | result |
    | a key whose file is gone | null |
    | a key under logos/ | a RangeError |
```

## Abuse cases
```gherkin
Scenario: AB-1 Two shops share a file (information disclosure)
  When two shops copy the same photo
  Then no two stored files are equal and no key contains an organization or a date
Scenario: AB-2 The source's removal reaches the copy (tampering)
  When the source's file is removed with deleteImageFiles
  Then the copy's file stays and its registry row stays
```

## Implementation
- Create: `src/modules/images/image-copy.service.ts`, `tests/integration/images/image-copy.test.ts`
- Modify: `src/modules/images/image.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `copyImage(tx: Prisma.TransactionClient, sourceKey: string): Promise<string | null>`
  - `findCopyRoot(tx: Prisma.TransactionClient, key: string): Promise<string | null>`
  - `insertImageCopy(tx: Prisma.TransactionClient, row: { copyKey: string; sourceKey: string; rootKey: string }): Promise<void>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-5.3.2: the new path is a key the server generates, never derived from the source.
- v5.0.0-8.3.1: the registry has no route; only the server writes it, and the application account cannot change it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| first copy | integration | AC-1, C-56 | copy A → new key, different bytes, row (new, A, A) |
| copy of copy | integration | AC-2, C-56 | copy B → row (C, B, A), root query returns B and C |
| two copies | integration | AC-3 | copy A twice → keys and bytes differ |
| nothing copied | integration | AC-4 | gone file → null; logos key → RangeError; registry unchanged |
| shared file | security | AB-1, CWE-200 | two shops copy A → files differ, keys hold no id and no date |
| source removed | security | AB-2, C-49, CWE-639 | delete A's file → copy file and row stay |

Command: `npx vitest run tests/integration/images/image-copy.test.ts`

## Out of scope
- The stories that copy variants and photos between variants and call this function (catalog).
- Reading the registry from the administration area: moderation is postponed to v2.

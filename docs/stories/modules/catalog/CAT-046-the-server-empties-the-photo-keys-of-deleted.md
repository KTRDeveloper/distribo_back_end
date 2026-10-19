---
id: CAT-046
title: The server empties the photo keys of deleted products and variants
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-032]
read_first: [src/modules/catalog/catalog.repository.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, catalogue/productvariant]
constraints: [C-50]
asvs: [v5.0.0-2.3.3]
---

# CAT-046 — The server empties the photo keys of deleted products and variants

## Story
Technical story: provide the function that empties the photo keys of products and variants deleted a while ago and returns them, so that the images module can delete their files and a deleted card no longer holds any.

## Context
- Exists: products and variants are deleted by setting `deleted_at` (CAT-012, CAT-014); `image_keys` and the setters (CAT-032).
- New in `catalog.repository.ts`, in the caller's transaction: `releaseDeletedImageKeys(tx, deletedBefore, limit)`. For up to `limit` products and up to `limit` variants whose `deleted_at` is before `deletedBefore` and whose `image_keys` is not empty, oldest deletion first, it sets `image_keys` to empty and returns every key it released.
- A row that is not deleted, or deleted after the date, keeps its keys whatever the date given.
- First usage: the nightly cleanup of the images module (IMG-012), which then deletes the files.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.

## Acceptance criteria
```gherkin
Scenario: AC-1 Released
  Given a product deleted 30 hours ago with keys A and B, and a variant deleted 25 hours ago with key C
  When the function is called for the date 24 hours ago with limit 100
  Then it returns A, B and C and both rows hold no key
Scenario: AC-2 Kept
  Given a live product with key D and a product deleted 2 hours ago with key E
  When the same call is made
  Then both rows keep their keys and nothing is returned for them
Scenario: AC-3 Limit
  Given three products deleted long ago, each with a key
  When the function is called with limit 2
  Then the two oldest deletions are released and the third keeps its key
Scenario: AC-4 Repeat
  When the function is called twice with the same date
  Then the second call returns an empty list
```

## Abuse cases
```gherkin
Scenario: AB-1 A live card loses its photos (data loss)
  When the function is called with a date in the future
  Then a product or a variant that is not deleted keeps its keys
```

## Implementation
- Create: `tests/integration/catalog/release-image-keys.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `releaseDeletedImageKeys(tx: Prisma.TransactionClient, deletedBefore: Date, limit: number): Promise<string[]>`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.3: the keys are emptied and returned in one statement of the caller's transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| released | integration | AC-1, C-50 | deleted cards → keys returned, columns empty |
| kept | integration | AC-2 | live and recent → untouched |
| limit | integration | AC-3 | three rows, limit 2 → oldest two |
| repeat | integration | AC-4 | second call → empty list |
| live cards | security | AB-1, CWE-284 | future date → live rows untouched |

Command: `npx vitest run tests/integration/catalog/release-image-keys.test.ts`

## Out of scope
- Deleting the files and the nightly schedule: IMG-012.

---
id: IMG-012
title: The nightly cleanup releases the photos of deleted products and variants
module: images
kind: change
rev: 1
amends: [IMG-007]
size: S
risk: medium
depends_on: [IMG-007, CAT-046]
read_first: [src/modules/images/image-cleanup.service.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo]
constraints: [C-50]
asvs: [v5.0.0-2.3.3, v5.0.0-16.3.3]
---

# IMG-012 — The nightly cleanup releases the photos of deleted products and variants

## Story
As a super-admin, I want the nightly cleanup to also release the photos of deleted products and variants so that their files do not stay in storage for ever.

## Context
- Exists: `cleanupOrphanImages(now)` and `runImageCleanupJob` (IMG-007); `releaseDeletedImageKeys(tx, deletedBefore, limit)` (CAT-046); `deleteImageFiles` (IMG-002).
- Change: `cleanupOrphanImages` starts with a release step. Until a call returns no key, it opens a transaction, calls `releaseDeletedImageKeys(tx, now minus 24 hours, 500)`, commits, then passes the released keys to `deleteImageFiles`. The walk over the storage follows as before.
- A card deleted less than 24 hours ago keeps its keys and its files for that day. A card that is not deleted is never touched.
- The result becomes `{ scanned, deleted, released }`, `released` counting the keys emptied; the log `image_cleanup_done` carries the three counts.
- Fail closed: an error in the release step stops the run before the walk; `runImageCleanupJob` returns 1 and logs `image_cleanup_failed`.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.

## Acceptance criteria
```gherkin
Scenario: AC-1 Deleted cards release their photos
  Given a product deleted 30 hours ago with 2 photos and a variant deleted 25 hours ago with 1
  When the cleanup runs
  Then both rows hold no key, the three files are gone and `released` is 3
Scenario: AC-2 A recent deletion
  Given a product deleted 2 hours ago with a photo
  When the cleanup runs
  Then its key and its file are still there
Scenario: AC-3 The release fails
  Given `releaseDeletedImageKeys` throws
  When the job runs
  Then it returns 1, logs `image_cleanup_failed` and deletes no file
```

## Abuse cases
```gherkin
Scenario: AB-1 A live card loses its photo (data loss)
  Given a live product and a live variant with photos stored 30 hours ago
  When the cleanup runs
  Then their keys and files are untouched
```

## Implementation
- Create: `tests/integration/images/image-cleanup-deleted.test.ts`
- Modify: `src/modules/images/image-cleanup.service.ts`, `src/jobs/image-cleanup.ts`
- Pattern: `src/jobs/purge.ts`
- Signatures:
  - `cleanupOrphanImages(now: Date): Promise<{ scanned: number; deleted: number; released: number }>`
- Dependencies: `@prisma/client`, `pino`

## Security
- v5.0.0-2.3.3: keys are emptied in a transaction and their files deleted only after it commits.
- v5.0.0-16.3.3: the run logs counts, never keys.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| released | integration | AC-1, C-50 | deleted cards → keys empty, files gone, released 3 |
| recent | integration | AC-2 | deleted 2 hours ago → untouched |
| release fails | integration | AC-3 | throw → exit code 1, no file deleted |
| live cards | security | AB-1, CWE-284 | live product and variant → keys and files kept |

Command: `npx vitest run tests/integration/images/image-cleanup-deleted.test.ts tests/integration/images/image-cleanup.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/images/image-cleanup.test.ts | an assertion that compares the whole result with `{ scanned, deleted }` | add `released: 0`; assertions on single properties stay |

## Out of scope
- Scheduling the job (Q-010).

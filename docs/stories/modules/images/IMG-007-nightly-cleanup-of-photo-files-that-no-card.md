---
id: IMG-007
title: Nightly cleanup of photo files that no card cites
module: images
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [IMG-002]
read_first: [src/jobs/purge.ts, src/modules/images/image.service.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, donnees-personnelles-et-conservation/durees-de-conservation]
constraints: [C-50]
asvs: [v5.0.0-16.3.1]
---

# IMG-007 — Nightly cleanup of photo files that no card cites

## Story
As a super-admin, I want a nightly job that deletes photo files nobody cites so that an interrupted upload or copy leaves no file in the storage.

## Context
- Exists: `listFiles(after, limit)` with the storage time of each file, `findCitedKeys`, `deleteImageFiles` (IMG-002); `src/jobs/purge.ts` is the model of a job: it returns an exit code and scheduling stays outside (Q-010).
- New `image-cleanup.service.ts`: `cleanupOrphanImages(now): Promise<{ scanned: number; deleted: number }>`. It walks the storage in pages of 500 files; for the files stored more than 24 hours before `now` it asks `findCitedKeys` and deletes the others in one `deleteImageFiles` call per page.
- A file stored less than 24 hours ago is never deleted, even uncited: an upload may still be writing its card. A cited file is never deleted, whatever its age.
- Fail closed: if the storage list or the citation query fails, nothing more is deleted and the error is thrown.
- New `src/jobs/image-cleanup.ts` (`runImageCleanupJob(now?)`: exit code 0, or 1 on any error with `event` `image_cleanup_failed`) and the script `job:image-cleanup` in `package.json`. The end of a run logs `info` `image_cleanup_done` with both counts.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.

## Acceptance criteria
```gherkin
Scenario: AC-1 Old uncited files go
  Given a file stored 30 hours ago that no card cites
  When the cleanup runs
  Then the file is deleted and the result counts it
Scenario: AC-2 Recent and cited files stay
  Given an uncited file stored 2 hours ago, and a file stored 5 days ago that a product cites
  When the cleanup runs
  Then both files are still in storage
Scenario: AC-3 Many files
  Given 1200 old uncited files and 3 cited ones
  When the cleanup runs
  Then 1200 files are deleted, the 3 stay, and `scanned` is 1203
Scenario: AC-4 The exit code
  When the job runs with a working storage, then with a storage that fails to list
  Then the codes are 0 and 1
```

## Abuse cases
```gherkin
Scenario: AB-1 A failing citation check deletes live photos (tampering)
  Given the citation query throws
  When the cleanup runs on old files
  Then no file is deleted and the job exits with 1
```

## Implementation
- Create: `src/modules/images/image-cleanup.service.ts`, `src/jobs/image-cleanup.ts`, `tests/integration/images/image-cleanup.test.ts`
- Modify: `package.json`
- Pattern: `src/jobs/purge.ts`
- Signatures:
  - `cleanupOrphanImages(now: Date): Promise<{ scanned: number; deleted: number }>`
  - `runImageCleanupJob(now?: Date): Promise<number>`
- Dependencies: `pino`, `@prisma/client`, `tsx`

## Security
- v5.0.0-16.3.1: each run logs how many files it scanned and deleted, and a failure is logged as an event.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| old uncited | integration | AC-1, C-50 | 30-hour-old uncited file → deleted, counted |
| recent and cited | integration | AC-2, C-50 | 2-hour uncited and 5-day cited → both kept |
| many files | integration | AC-3 | 1203 files over three pages → 1200 deleted, 3 kept, scanned 1203 |
| exit code | integration | AC-4 | working → 0; listing fails → 1 |
| failing check | security | AB-1, CWE-755 | citation query throws → nothing deleted, exit 1 |

Command: `npx vitest run tests/integration/images/image-cleanup.test.ts`

## Out of scope
- Scheduling the job (Q-010).
- Purging old registry rows: the registry is never purged.

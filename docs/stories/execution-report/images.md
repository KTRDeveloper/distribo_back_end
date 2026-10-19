# Execution report: images

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

<!-- begin IMG-001 -->
## IMG-001 — Registry of copied photos

- Filed: 2026-10-19 15:23 UTC
- Status: **done**: image_copies table, root trigger, insert-only grant; 13 tests
- Risk: high · story: [IMG-001-registry-of-copied-photos.md](../modules/images/IMG-001-registry-of-copied-photos.md)
- Agent: 34,211 tokens, 12 tool uses, 1 min 58 s

### Agent report

**Summary:** Created the image_copies migration (checks, root trigger, insert-only grant), the ImageCopy model with its comment, and the integration test.

**Decisions:**
- Trigger lets a null source or root pass: the NOT NULL constraint runs after BEFORE triggers, so otherwise AC-3 would give 23514 instead of 23502.
- Trigger runs on INSERT and UPDATE, as `admin_actions_check_replay_role` does, so the owner account cannot change a root either.
- Migration named `20261019020000_img_001_image_copies`.

**Tests added beyond the story:**
- `tests/integration/images/image-copy-table.test.ts` › refuses a copy equal to its root: CHECK copy <> root (story Context checks); passed at once
- same file › keeps a copy of a copy of a copy on the same root: root stays A at depth 3 (C-56); passed at once
- same file › has indexes on root_key and source_key (Context); passed at once

**Evidence:** story tests 13/13; full suite 3349/3349, failing: none, 0 known; typecheck clean; lint 0 errors, 142 warnings
<!-- end IMG-001 -->

<!-- begin IMG-002 -->
## IMG-002 — Storage and photo-processing ports with fake adapters

- Filed: 2026-10-19 16:51 UTC
- Status: **done**: ports, fakes, deleteImageFiles, env settings; 22 tests green
- Risk: high · story: [IMG-002-storage-and-photo-processing-ports-with-fake.md](../modules/images/IMG-002-storage-and-photo-processing-ports-with-fake.md)
- Agent: 50,879 tokens, 21 tool uses, 4 min 10 s

### Agent report

**Summary:** Image storage and processor ports with fakes, findCitedKeys, deleteImageFiles and the three IMAGE_* settings are in place.

**Decisions:**
- Fake output layout: WebP-shaped header (bytes 16-23 copy the size), then SHA-256 of input bytes after offset 24, then 8 random bytes with `vary`; inspect works on the output too.
- Fake size read from bytes 16-23 for every format (the story names only the PNG layout).
- Cards count as citing while the column holds the key, even if soft-deleted (story says "held by").
- `FakeImageStorage` takes an optional clock so later cleanup tests can age files.
- One `image_delete_failed` warn per key that fails to delete (key id only, plus err).

**Tests added beyond the story:**
- `tests/integration/images/image-files.test.ts` › avatar/logo kept, malformed key untouched: avatar and logo citations, no malformed key reaching storage (C-49, ASVS 5.3.2); passed once implemented
- `tests/integration/images/image-files.test.ts` › findCitedKeys and empty list: only held keys returned (C-49)
- `tests/unit/images/fake-processor.test.ts` › jpeg/webp detection, vary, unreadable bytes, storage order and listing (AC-5 support)
- `tests/unit/images/image-settings.test.ts` › IMAGE_MAX_PIXELS=0 names the variable (AC-4)

**Other additions:**
- `deleteImageFiles` skips keys failing `imageKeySchema` with warn `image_delete_skipped` (fail closed against path-like keys; not in the story).
- AB-1 test: the product lets go of the key, the variant (created by the DB trigger) still holds it, so the file stays.

**Evidence:** story tests 22/22 (unit images + image-files); full suite 3762/3763, failing: quality-gates lint check (5 lint errors of mine, fixed afterwards; file rerun green: 36/36 with images tests), 0 known; typecheck clean; lint 0 errors, 158 warnings

**Follow-ups:**
- ADR-005 still proposed: no real S3 or image-library adapter.
<!-- end IMG-002 -->

<!-- begin IMG-003 -->
## IMG-003 — Receive a photo, check it and store a clean copy

- Filed: 2026-10-19 16:54 UTC
- Status: **done**: imageBody middleware and storeUploadedImage; 20 tests green
- Risk: high · story: [IMG-003-receive-a-photo-check-it-and-store-a-clean-copy.md](../modules/images/IMG-003-receive-a-photo-check-it-and-store-a-clean-copy.md)
- Agent: 43,589 tokens, 22 tool uses, 3 min 0 s

### Agent report

**Summary:** Added `imageBody()` middleware and `storeUploadedImage` (size, inspect, pixels, re-encode, put); all story tests pass.

**Decisions:**
- Empty or missing body: the middleware leaves an empty Buffer and the service answers 400 VALIDATION_ERROR (size 0), matching "a Buffer in req.body".
- Compressed bodies: `express.raw` runs with `inflate: false`, so a gzip body is refused (415) and no decompression bomb is possible.
- Media type is compared without parameters and in lower case (`IMAGE/PNG; charset=x` passes); a missing Content-Type gives UNSUPPORTED_IMAGE.
- A failed `reencode` with UnreadableImageError also maps to UNSUPPORTED_IMAGE (a real processor may fail only at decode).

**Tests added beyond the story:**
- `tests/integration/images/image-intake.test.ts` › exact byte limit accepted / one byte more refused: limit boundary (AC-2); passed at once
- same file › exact pixel limit accepted / one pixel more refused: limit boundary (AC-2); passed at once
- same file › no body, missing Content-Type, Content-Encoding gzip, media type with parameters: fail-closed paths (AC-2, v5.0.0-5.2.2); passed at once
- same file › storage failure stores nothing and rethrows (fail closed); passed at once

**Other additions:** none.

**Evidence:** story tests 20/20 (no red phase: the implementation was written before the first run); full suite 3783/3783, failing: none, 0 known; typecheck clean; lint 0 errors, 158 warnings (pre-existing)

**Follow-ups:**
- The fake processor reads sizes from PNG header offsets for every format; a real adapter (ADR-005) must re-run these tests.
<!-- end IMG-003 -->

<!-- begin IMG-004 -->
## IMG-004 — A person adds, replaces or removes their profile photo

- Filed: 2026-10-19 16:58 UTC
- Status: **done**: PUT/DELETE /users/me/avatar; suite 3790 passed
- Risk: medium · story: [IMG-004-a-person-adds-replaces-or-removes-their-profile.md](../modules/images/IMG-004-a-person-adds-replaces-or-removes-their-profile.md)
- Agent: 56,400 tokens, 20 tool uses, 3 min 13 s

### Agent report

**Summary:** PUT and DELETE /api/v1/users/me/avatar built on storeUploadedImage and setAvatarKey; all story tests green.

**Decisions:**
- Guest/anonymized mapping: 409 AVATAR_NOT_ALLOWED when the driver error message names people_guest_avatar_check or people_anonymized_avatar_check; any other error is rethrown (500).
- Transaction: the service calls setAvatarKey without tx (it opens its own transaction), so the service never touches prisma.
- AC-4 failure forced by wrapping setAvatarKey with vi.mock (spyOn on the Prisma client is not possible).
- DELETE logs avatar_changed even when there was no photo (repeat is harmless).

**Other additions:**
- `scripts/generate-openapi.ts`: import of images.openapi, else generate-script.test (live paths = generated paths) fails.
- Extra assertion in `tests/integration/per-001.test.ts` checking both PUT and DELETE are listed.

**Evidence:** story tests 27/27 (with api-docs and per-001); full suite 3790/3790, failing: none, 0 known; typecheck clean; lint 0 errors, 158 warnings (existing)

**Follow-ups:**
- openapi/openapi.json regenerated by the test run (new avatar path).
<!-- end IMG-004 -->

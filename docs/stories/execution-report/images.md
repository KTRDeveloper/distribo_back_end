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

<!-- begin IMG-005 -->
## IMG-005 — The owner adds, replaces or removes the business logo

- Filed: 2026-10-19 17:01 UTC
- Status: **done**: Owner logo PUT/DELETE; change_logo rule; 6 story tests green
- Risk: medium · story: [IMG-005-the-owner-adds-replaces-or-removes-the-business.md](../modules/images/IMG-005-the-owner-adds-replaces-or-removes-the-business.md)
- Agent: 55,823 tokens, 20 tool uses, 3 min 1 s

### Agent report

**Summary:** Owner-only PUT/DELETE `/organizations/{organizationId}/logo` with the `change_logo` rule, `logo.service.ts`, OpenAPI paths and route-list updates.

**Decisions:**
- `OrganizationActorContext` does not exist: used the existing `Actor` type (`req.actor`).
- The activity check runs twice in `replaceLogo`: before the file is stored (cheap refusal) and inside the key-write transaction (a business suspended meanwhile keeps its logo).
- `removeLogo` also requires an ACTIVE business (409), for consistency; the story only tests PUT.
- Router mounted in `src/app.ts` at `/organizations/:organizationId/logo`, before `/organizations`; `loadActor` runs after `authMiddleware`.

**Tests added beyond the story:**
- `tests/integration/images/logo.test.ts` › AC-3 and AB-2 also call DELETE as manager/seller/stranger/other business (403/404, nothing changes) (ACs plus the shared ability rule); passed at once with the implementation

**Other additions:**
- `openapi/openapi.json` regenerated for the two new paths.

**Evidence:** story tests 6/6 (plus the catalog and per-001 additions in the suite); full suite 3797/3797, failing: none, 0 known; typecheck clean; lint 0 errors, 162 warnings (existing)

**Follow-ups:**
- AB-1 sends a body just over 3 MB (3 MiB, the limit); the 403 comes before the body is read, with no connection reset in supertest.
<!-- end IMG-005 -->

<!-- begin IMG-006 -->
## IMG-006 — Copy a photo under a new key and record the copy

- Filed: 2026-10-19 17:03 UTC
- Status: **done**: copyImage, findCopyRoot, insertImageCopy; 7 tests green
- Risk: high · story: [IMG-006-copy-a-photo-under-a-new-key-and-record-the-copy.md](../modules/images/IMG-006-copy-a-photo-under-a-new-key-and-record-the-copy.md)
- Agent: 31,494 tokens, 13 tool uses, 2 min 23 s

### Agent report

**Summary:** Added `copyImage` (image-copy.service.ts) and the repository functions `findCopyRoot` / `insertImageCopy`; all tests green.

**Decisions:**
- Source key check: a key that is not canonical or not under `products/` throws RangeError (covers logos, avatars, path tricks), using `imageKeySchema`.
- Order: file is stored before the registry insert, so a failed transaction leaves only an orphan file (per the story, IMG-007 cleans it).

**Tests added beyond the story:**
- `tests/integration/images/image-copy.test.ts` › rolls back the registry row when the caller transaction fails: the row is written in the caller's transaction and the file stays (story Context, C-56); passed at once
- same file, "nothing copied" also checks avatars and a path-traversal key (AC-4, ASVS 5.3.2); passed at once

**Evidence:** story tests 7/7; full suite 3804/3804, failing: none, 0 known; typecheck clean; lint 0 errors, 162 warnings (existing)
<!-- end IMG-006 -->

<!-- begin IMG-007 -->
## IMG-007 — Nightly cleanup of photo files that no card cites

- Filed: 2026-10-19 17:06 UTC
- Status: **done**: 9 story tests pass; full suite 3813 pass
- Risk: medium · story: [IMG-007-nightly-cleanup-of-photo-files-that-no-card.md](../modules/images/IMG-007-nightly-cleanup-of-photo-files-that-no-card.md)
- Agent: 35,301 tokens, 16 tool uses, 2 min 13 s

### Agent report

**Summary:** Added `cleanupOrphanImages`, the `runImageCleanupJob` job and the `job:image-cleanup` script; all tests green.

**Decisions:**
- Age rule: a file is deleted only if stored strictly more than 24 h before `now` (exactly 24 h is kept).
- Non-canonical keys found in storage are counted in `scanned` but never sent to deletion nor counted in `deleted` (matches `deleteImageFiles`, ASVS 5.3.2).
- The service calls `findCitedKeys` itself to compute `deleted`; `deleteImageFiles` re-checks citations (second, safer check).
- Tests age files with fake `Date` while storing (the storage singleton has a fixed clock); the citation failure is simulated by wrapping `findCitedKeys` with `vi.mock`.

**Tests added beyond the story:**
- `image-cleanup.test.ts` › keeps a file stored exactly 24 hours before now: age boundary (C-50, "more than 24 hours"); passed at once
- `image-cleanup.test.ts` › throws and deletes nothing more when the storage list fails: fail closed (Context); passed at once

**Evidence:** story tests 9/9; full suite 3813/3813, failing: none, 0 known; typecheck clean; lint 0 errors, 162 warnings (existing)
<!-- end IMG-007 -->

<!-- begin IMG-008 -->
## IMG-008 — A manager adds or replaces a photo of a product

- Filed: 2026-10-19 17:09 UTC
- Status: **done**: PUT product photo route, change_photos rule, card-photos service; suite green
- Risk: medium · story: [IMG-008-a-manager-adds-or-replaces-a-photo-of-a-product.md](../modules/images/IMG-008-a-manager-adds-or-replaces-a-photo-of-a-product.md)
- Agent: 61,516 tokens, 23 tool uses, 3 min 9 s

### Agent report

**Summary:** Added `PUT .../products/{productId}/photos/{position}`, the `change_photos` rule and `card-photos.service.ts`; all tests green.

**Decisions:**
- Router: a new `productPhotoRoutes` mounted in `app.ts` at `/organizations/:organizationId/products/:productId/photos`, because the existing routers are mounted per path.
- Path check: a `checkPhotoPath` middleware (UUIDv7 product id, position 1 to 5) runs after `requireAbility` and before `imageBody()`, so a refused caller never gets a 400 and the body is not read for a bad position.
- Active check: the route calls `assertOrganizationActive` before storing, and `productCard.lock` repeats it inside the transaction, since `putCardPhoto` has no organization id.
- A position past the next free one is refused inside the transaction, after the lock; the new file is deleted on any transaction error.
- The `product_photos_changed` log is written by the route handler, because the service has no person id.

**Tests added beyond the story:**
- `tests/integration/images/product-photos.test.ts` › AC-1 lets the owner change a photo too: the OWNER role also has `change_photos` (story Context); passed at once
- `tests/integration/images/product-photos.test.ts` › AC-2 refuses a sixth photo: a limit boundary, 5 photos max (C-49); passed at once
- `tests/integration/images/product-photos.test.ts` › removes the new file when the position is refused after the product is locked: nothing stays in storage on a rejected gap (AC-4 logic); passed at once

**Other additions:**
- Prettier reformatted the files I touched in `src/modules/images`, `src/app.ts` and the two route-list tests.

**Evidence:** story tests 10/10 (plus api-docs and per-001 green); full suite 3824/3824, failing: none, 0 known; typecheck clean; lint 0 errors, 165 warnings (existing)

**Follow-ups:**
- IMG-010 (variants) can reuse `putCardPhoto`, but it hard-codes the `products` folder in `storeUploadedImage('products', ...)`; check that is right for variants.
<!-- end IMG-008 -->

<!-- begin IMG-009 -->
## IMG-009 — A manager removes a photo of a product

- Filed: 2026-10-19 17:12 UTC
- Status: **done**: DELETE photos/{photoId} by id; removeCardPhoto; 5 story tests + route lists
- Risk: medium · story: [IMG-009-a-manager-removes-a-photo-of-a-product.md](../modules/images/IMG-009-a-manager-removes-a-photo-of-a-product.md)
- Agent: 41,808 tokens, 15 tool uses, 2 min 9 s

### Agent report

**Summary:** Added DELETE .../products/{productId}/photos/{photoId} and removeCardPhoto; photos are removed by id, retries are harmless.

**Decisions:**
- photoId validation: any UUID (z.string().uuid()), because keys are UUIDv4 (newImageKey), not v7; compared lower-case against `products/<id>.webp`.
- productId in the path: UUIDv7 check as in the PUT route, answering 400 after the role check.
- Unknown id: no write, no file delete; returns the current list with 200.

**Tests added beyond the story:**
- `product-photo-remove.test.ts` › AC-1 owner removes the last photo: empty list and file gone (AC-1); passed with the implementation
- AB-1 (404 for another business) also asserts the no-op via the caller's own business id.

**Evidence:** story tests 5/5 (29/29 with api-docs and per-001); full suite 3830/3830, failing: none, 0 known; typecheck clean; lint 0 errors, 168 warnings
<!-- end IMG-009 -->

<!-- begin IMG-010 -->
## IMG-010 — A manager adds, replaces or removes the photos of a variant

- Filed: 2026-10-19 17:15 UTC
- Status: **done**: variant photo PUT/DELETE routes, change_photos rule for ProductVariant
- Risk: medium · story: [IMG-010-a-manager-adds-replaces-or-removes-the-photos.md](../modules/images/IMG-010-a-manager-adds-replaces-or-removes-the-photos.md)
- Agent: 48,191 tokens, 15 tool uses, 2 min 32 s

### Agent report

**Summary:** Added PUT/DELETE variant photo routes, `variantCard`, the MANAGER `change_photos` rule on `ProductVariant`, OpenAPI paths and route-list entries.

**Decisions:**
- Separate `variantPhotoRoutes` router mounted before the catalog routes: the path has its own params and the product router is mounted at `/photos`.
- The product-mismatch 404 is raised inside `lock`, so the transaction rolls back and the new file is deleted by `putCardPhoto`.
- Both routes log `variant_photos_changed` (the story names one event); the product removal uses a separate event, but the story gives only one name.

**Tests added beyond the story:**
- `tests/integration/images/variant-photos.test.ts` › seller 403 with a 3 MB body: role judged before the body is read (v5.0.0-8.2.1); passed at once
- `tests/integration/images/variant-photos.test.ts` › new file removed when the variant is under another product: no orphan file (IMG-008 rule, AC-2); passed at once

**Evidence:** story tests 7/7 (plus api-docs and per-001); full suite 3839/3839, failing: none, 0 known; typecheck clean; lint 0 errors, 172 warnings
<!-- end IMG-010 -->

<!-- begin IMG-011 -->
## IMG-011 — A manager takes a photo from another variant of the same product

- Filed: 2026-10-19 17:18 UTC
- Status: **done**: POST variants/:id/photos/copy; takeVariantPhoto; 12 tests
- Risk: medium · story: [IMG-011-a-manager-takes-a-photo-from-another-variant-of.md](../modules/images/IMG-011-a-manager-takes-a-photo-from-another-variant-of.md)
- Agent: 56,179 tokens, 18 tool uses, 2 min 57 s

### Agent report

**Summary:** Added POST .../variants/{variantId}/photos/copy and `takeVariantPhoto`; all story tests and the full suite pass.

**Decisions:**
- Body and path validated (strict Zod, source != destination) before `idempotent()`: a refused request never reserves its gesture id; the service re-checks source != destination.
- Check order in the transaction: lock destination, read source, 404 on product/photo mismatch, then 409 at 5 photos, then `copyImage`: no file is written for a refusal.
- If the transaction fails after `copyImage` wrote the file, the new file is deleted at once (like `putCardPhoto`) instead of waiting for the nightly cleanup.
- Wrote the code and tests together; the first run failed only on my fixture (variant name uniqueness), so I did not see a pure red-on-missing-route run.

**Tests added beyond the story:**
- `tests/integration/images/take-variant-photo.test.ts` › destination holding 4 photos still takes a fifth: limit boundary (AC-3, C-49); passed at once
- same file › a copy of a copy keeps the root of the first photo: root_key rule (C-56); passed at once

**Evidence:** story tests 39/39 (new file 12); full suite 3852/3852, failing: none, 0 known; typecheck clean; lint 0 errors, 175 warnings (pre-existing)
<!-- end IMG-011 -->

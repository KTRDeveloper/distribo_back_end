---
id: IMG-011
title: A manager takes a photo from another variant of the same product
module: images
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [IMG-010, IMG-006, ACC-007]
read_first: [src/modules/images/card-photos.service.ts, src/modules/images/image-copy.service.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, images/imagecopy]
constraints: [C-56]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# IMG-011 — A manager takes a photo from another variant of the same product

## Story
As a manager, I want to take a photo from another variant of the same product so that I do not send the same picture twice.

## Context
- Exists: `copyImage(tx, sourceKey)` (IMG-006); `lockVariantImageKeys` and `readVariantImageKeys` (CAT-044); `variantCard`, `PHOTOS_PER_CARD` (IMG-008, IMG-010); `idempotent()`; the rule `change_photos` on `ProductVariant`.
- New route `POST /api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/copy`, strict JSON `{ id, source_variant_id, source_photo_id }`: `id` the gesture id (UUIDv7), the others UUIDs; `source_photo_id` is the UUID file name of one of the source's keys. Order: `loadActor`, `requireAbility('change_photos', 'ProductVariant')`, the JSON parser, `idempotent()`. Answer 201 `{ image_urls }` of the destination variant.
- `takeVariantPhoto` in `card-photos.service.ts`, one transaction: lock the destination; read the source with `readVariantImageKeys` (no lock, so two crossed copies cannot block each other); the source must be a variant of the same business and the same product as the destination, and different from it; the key is found by `source_photo_id`. Then `copyImage`, append the new key with `variantCard(...).write`. The registry row is written by `copyImage`; the source keeps its photo.
- Refusals: no such variant, photo or product pair, or a source file that is gone (`copyImage` returns null): 404 `NOT_FOUND`; destination at `PHOTOS_PER_CARD`: 409 `PHOTO_LIMIT_REACHED`; source equal to destination: 400 `VALIDATION_ERROR`.
- Logs `info` `variant_photo_taken` with the organization, variant and person ids. Add the path to the route lists.
- `C-56`: `ImageCopy` has `copy_key` as primary key; `root_key` equals the source's `root_key` when the source is itself a copy, else the source key; written by the server only, in the transaction that stores the copy's key; never synchronized; never updated, deleted or purged.

## Acceptance criteria
```gherkin
Scenario: AC-1 Take a photo
  Given variant A holds photo P and variant B of the same product holds none
  When the manager takes P onto B
  Then the answer is 201, B holds one photo under a key other than P's, A is unchanged and `image_copies` has one row for it
Scenario: AC-2 Repeat
  When the same body is posted twice
  Then one copy exists
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the answer is <status> and nothing is stored
  Examples:
    | problem                                              | status                     |
    | a source variant of another product                  | 404 NOT_FOUND              |
    | a photo id the source does not hold                  | 404 NOT_FOUND              |
    | a source file that is gone from storage              | 404 NOT_FOUND              |
    | a destination that already holds 5 photos            | 409 PHOTO_LIMIT_REACHED    |
    | the destination as its own source                    | 400 VALIDATION_ERROR       |
    | an unknown field in the body                         | 400 VALIDATION_ERROR       |
    | a seller or a driver                                 | 403 FORBIDDEN              |
```

## Abuse cases
```gherkin
Scenario: AB-1 A variant of another business as the source (information disclosure)
  When a manager of business A names a variant and a photo of business B
  Then the answer is 404 and nothing is copied
```

## Implementation
- Create: `tests/integration/images/take-variant-photo.test.ts`
- Modify: `src/modules/images/card-photos.service.ts`, `src/modules/images/images.routes.ts`, `src/modules/images/images.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `takeVariantPhoto(organizationId: string, productId: string, variantId: string, input: TakePhotoInput): Promise<{ image_urls: string[] }>`
- Types:
  - `TakePhotoInput = { id: string; source_variant_id: string; source_photo_id: string }`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `PHOTO_LIMIT_REACHED` 409, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: the rules table decides before the body is read.
- v5.0.0-8.2.2: both variants are read inside the business of the session; a stranger's id answers 404.
- v5.0.0-2.3.3: the new key and the registry row are written in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| take | integration | AC-1, C-56 | copy onto B → 201, new key, registry row |
| repeat | integration | AC-2 | same body twice → one copy |
| refusals | integration | AC-3 | each Examples row → status, nothing stored |
| other business | security | AB-1, WSTG-ATHZ-02 | source of business B → 404, nothing copied |

Command: `npx vitest run tests/integration/images/take-variant-photo.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the photo copy path | add POST .../variants/{variantId}/photos/copy, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the photo copy path | add the same path, remove nothing |

## Out of scope
- Copying photos when a reseller copies articles: CAT-045.

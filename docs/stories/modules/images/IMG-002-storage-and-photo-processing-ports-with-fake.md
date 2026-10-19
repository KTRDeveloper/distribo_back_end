---
id: IMG-002
title: Storage and photo-processing ports with fake adapters
module: images
kind: technical
rev: 1
amends: []
size: M
risk: high
depends_on: [FND-013, PER-013, ORG-038]
read_first: [src/config/env.ts, docs/stories/decisions/ADR-005-image-and-storage-dependencies.md]
design_refs: [images/stockage]
constraints: [C-49, C-50]
asvs: [v5.0.0-5.3.2, v5.0.0-15.3.3]
---

# IMG-002 — Storage and photo-processing ports with fake adapters

## Story
Technical story: provide the storage port, the photo-processing port and their fake adapters, and one function that deletes photo files nobody cites, so that no story needs an image library or a storage account.

## Context
- Exists: `newImageKey`, `imageKeySchema` (FND-013). No package for images or S3 is allowed (ADR-005, proposed): the real adapters are not in any story.
- New `src/modules/images/image.ports.ts`: `ImageStorage` (`put`, `get` (null when absent), `delete` (an absent file is no error), `listFiles(after, limit)` in key order) and `ImageProcessor` (`inspect(bytes)` gives format jpeg, png or webp, width, height, and throws `UnreadableImageError`; `reencode(bytes, { vary })` gives WebP bytes without any metadata). Fakes: `FakeImageStorage` (a map with the storage time of each file) and `FakeImageProcessor` (format from the first bytes, size from the PNG header layout at bytes 16 to 23; the output keeps a digest of the bytes after offset 24 and, with `vary`, 8 random bytes). `getImageStorage()` and `getImageProcessor()` return the adapter set by `IMAGE_DRIVER` (only `fake`, default `fake`).
- New `image.repository.ts`: `findCitedKeys(keys): Promise<Set<string>>` finds the keys held by `people.avatar_key`, `organizations.logo_key`, `products.image_keys` or `product_variants.image_keys`.
- New `image.service.ts`: `deleteImageFiles(keys)` deletes from storage only the keys no card cites (C-50, C-49), ignores absent files and on a storage error logs `warn` `image_delete_failed` and does not fail the caller.
- `env.ts`: `IMAGE_DRIVER`, `IMAGE_MAX_BYTES` (default 3145728), `IMAGE_MAX_PIXELS` (default 12000000); `.env.example` lists the three.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.

## Acceptance criteria
```gherkin
Scenario: AC-1 Uncited files are deleted
  Given files A and B in storage and no card citing them
  When deleteImageFiles runs with A and B
  Then both files are gone
Scenario: AC-2 A cited file is kept
  Given file A is the key of a product and file B is cited by nobody
  When deleteImageFiles runs with A and B
  Then A is still in storage and B is gone
Scenario: AC-3 An absent file and a storage error
  When deleteImageFiles runs with a key that has no file, then with a storage that throws
  Then both calls return without error and the second logs one warning
Scenario Outline: AC-4 The settings
  When the environment is validated with <setting>
  Then validation <result>
  Examples:
    | setting | result |
    | none | passes, defaults |
    | IMAGE_DRIVER=s3 | fails, names it |
    | IMAGE_MAX_BYTES=0 | fails, names it |
Scenario: AC-5 The fake processor
  When a PNG of 40 by 30 with a marker in its extra bytes is inspected and re-encoded
  Then inspect gives png, 40 and 30, and the output is WebP bytes without the marker
```

## Abuse cases
```gherkin
Scenario: AB-1 A shared key deletes another card's photo (tampering)
  Given the same key held by a product and by a variant
  When the file of the product is removed with deleteImageFiles
  Then the file stays because the variant still cites it
```

## Implementation
- Create: `src/modules/images/image.ports.ts`, `src/modules/images/image.repository.ts`, `src/modules/images/image.service.ts`, `tests/integration/images/image-files.test.ts`
- Modify: `src/config/env.ts`, `.env.example`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `deleteImageFiles(keys: string[]): Promise<void>`
  - `findCitedKeys(keys: string[]): Promise<Set<string>>`
  - `getImageStorage(): ImageStorage`
  - `getImageProcessor(): ImageProcessor`
- Types:
  - `ImageStorage = { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer | null>; delete(key: string): Promise<void>; listFiles(after: string | null, limit: number): Promise<Array<{ key: string; storedAt: Date }>> }`
  - `ImageProcessor = { inspect(bytes: Buffer): Promise<{ format: 'jpeg' | 'png' | 'webp'; width: number; height: number }>; reencode(bytes: Buffer, options: { vary: boolean }): Promise<Buffer> }`
- Dependencies: `@prisma/client`, `zod`, `pino`

## Security
- v5.0.0-5.3.2: storage paths are built from keys the server generated, never from a name sent by a client.
- v5.0.0-15.3.3: only the server writes keys; no schema of this module accepts one.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| delete | integration | AC-1, C-50 | two uncited files → both deleted |
| cited | integration | AC-2, C-49 | a key held by a product → kept, the other deleted |
| absent and error | integration | AC-3 | absent key and throwing storage → no error, one warning |
| settings | unit | AC-4 | each Examples row → passes or names the variable |
| fake processor | unit | AC-5 | PNG 40x30 with a marker → inspect values, output without the marker |
| shared key | security | AB-1, CWE-639 | key on a product and a variant, file kept |

Command: `npx vitest run tests/integration/images/image-files.test.ts tests/unit/images`

## Out of scope
- Real S3 and image-library adapters: they wait for ADR-005.
- Receiving a photo from a phone: IMG-003.

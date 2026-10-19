---
id: IMG-008
title: A manager adds or replaces a photo of a product
module: images
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [IMG-005, CAT-044, ACC-008]
read_first: [src/modules/images/images.routes.ts, src/shared/access/ability.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, catalogue/product]
constraints: [C-49]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# IMG-008 — A manager adds or replaces a photo of a product

## Story
As a manager, I want to add or replace a photo of my product so that customers see what I sell.

## Context
- Exists: the images router with `imageBody`, `storeUploadedImage`, `deleteImageFiles`, `imageUrl` (IMG-003 to IMG-005); `lockProductImageKeys` (CAT-044), `setProductImageKeys` (CAT-032).
- Adds one row to `RULES` in `ability.ts`: MANAGER (the owner too), `ONLINE_FOR_ALL`, action `change_photos`, subject `Product`.
- New route in the images router: `PUT /api/v1/organizations/{organizationId}/products/{productId}/photos/{position}`, raw photo body, answer 200 `{ image_urls }`. Order: `loadActor`, `requireAbility('change_photos', 'Product')`, `imageBody()`.
- `position` is an integer from 1 to `PHOTOS_PER_CARD` (5). A held position is replaced; the one after the last adds; a farther one is 400.
- New `card-photos.service.ts` (`PHOTOS_PER_CARD`, `PhotoCard`, `productCard`, `putCardPhoto`): it stores the file with `storeUploadedImage('products', bytes)`, then in one transaction locks the list, changes it and writes it; after the commit it deletes the replaced file. If the transaction fails the new file is removed.
- Logs `info` `product_photos_changed` (organization, product, person ids). Add the path to the route lists.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add and replace
  Given a product with no photo
  When a manager sends a PNG at position 1, a JPEG at position 2, then a WebP at position 1
  Then the answers are 200 with 1, 2 and 2 URLs, and the first file is gone from storage
Scenario Outline: AC-2 Positions
  Given a product with 2 photos
  When a manager sends a good photo at position <position>
  Then the answer is <status>
  Examples:
    | position | status |
    | 3 | 200 |
    | 4 | 400 VALIDATION_ERROR |
    | 0 | 400 VALIDATION_ERROR |
Scenario Outline: AC-3 Refusals
  When <who> sends a good photo
  Then the answer is <status> and nothing changes
  Examples:
    | who | status |
    | a seller or a driver | 403 FORBIDDEN |
    | someone outside the business | 404 NOT_FOUND |
    | a manager of a suspended business | 409 ORGANIZATION_NOT_ACTIVE |
Scenario: AC-4 Failure leaves nothing behind
  Given the database write fails
  When a manager sends a photo
  Then the answer is 500, the list is unchanged and the new file is removed
```

## Abuse cases
```gherkin
Scenario: AB-1 A seller sends a huge body (elevation, resource exhaustion)
  When a seller sends 3 MB of photo
  Then the answer is 403 and the processor and the storage were not called
Scenario: AB-2 A manager changes another business's product (access control)
  When a manager of business A sends a photo for a product of business B
  Then the answer is 404 and the photos of B are unchanged
Scenario: AB-3 A key sent by the client (tampering)
  When the body is JSON `{"image_keys": ["products/x.webp"]}`
  Then the answer is 400 `UNSUPPORTED_IMAGE` and no key is written
```

## Implementation
- Create: `src/modules/images/card-photos.service.ts`, `tests/integration/images/product-photos.test.ts`
- Modify: `src/modules/images/images.routes.ts`, `src/modules/images/images.openapi.ts`, `src/shared/access/ability.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `putCardPhoto(card: PhotoCard, position: number, bytes: Buffer): Promise<{ image_urls: string[] }>`
  - `productCard(organizationId: string, productId: string): PhotoCard`
- Types:
  - `PhotoCard = { lock(tx: Prisma.TransactionClient): Promise<string[]>; write(tx: Prisma.TransactionClient, keys: string[]): Promise<string[]> }`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409, `VALIDATION_ERROR` 400, `UNSUPPORTED_IMAGE` 400
- Dependencies: `express`, `zod`, `@casl/ability`

## Security
- v5.0.0-8.2.1: the rules table decides before the body is read.
- v5.0.0-8.2.2: the product is looked up inside the session's business.
- v5.0.0-15.3.3: the only writable thing is the photo; the server builds the key.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add and replace | integration | AC-1, C-49 | three PUTs → 200, URL counts, first file gone |
| positions | integration | AC-2 | each Examples row → status |
| refusals | integration | AC-3 | each Examples row → status, nothing changes |
| failure | integration | AC-4 | forced write error → 500, list kept, new file removed |
| seller | security | AB-1, CWE-269 | seller with 3 MB body → 403, processor and storage untouched |
| other business | security | AB-2, WSTG-ATHZ-02 | manager A on product of B → 404, B unchanged |
| client key | security | AB-3, CWE-915 | JSON body with a key → 400, nothing written |

Command: `npx vitest run tests/integration/images/product-photos.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the product photo path | add PUT .../products/{productId}/photos/{position}, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the product photo path | add the same path, remove nothing |

## Out of scope
- Removing a photo: IMG-009. The photos of a variant: IMG-010.

---
id: IMG-009
title: A manager removes a photo of a product
module: images
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [IMG-008]
read_first: [src/modules/images/card-photos.service.ts, src/modules/images/images.routes.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, catalogue/product]
constraints: [C-50]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2]
---

# IMG-009 — A manager removes a photo of a product

## Story
As a manager, I want to remove a photo of my product so that customers no longer see it.

## Context
- Exists: `productCard`, `PhotoCard`, the rule `change_photos` on `Product` and the PUT route (IMG-008); `deleteImageFiles` (IMG-002).
- New route `DELETE /api/v1/organizations/{organizationId}/products/{productId}/photos/{photoId}`, no body, answer 200 `{ image_urls }`. Order: `loadActor`, `requireAbility('change_photos', 'Product')`, then the handler.
- `photoId` is the UUID that is the file name of a key (`products/<UUID>.webp`), found at the end of each URL. The photo is not addressed by its position: a retry would then remove another photo.
- New `removeCardPhoto(card, photoId)` in `card-photos.service.ts`: in one transaction it locks the list, drops the key whose file name is `photoId` and writes the list; after the commit it deletes that file.
- An id the product does not hold changes nothing and answers 200. A product that is deleted or of another business: 404. A suspended business: 409 `ORGANIZATION_NOT_ACTIVE`.
- Logs `info` `product_photo_removed` with the organization, product and person ids. Add the path to the route lists.
- `C-50`: A photo file is deleted from storage as soon as its key leaves its card or its card is deleted; a nightly cleanup deletes every file older than 24 hours that no card cites.

## Acceptance criteria
```gherkin
Scenario: AC-1 Remove
  Given a product with 2 photos
  When a manager deletes the first photo by its id, twice
  Then both answers are 200, the list holds the other photo only and the removed file is gone
Scenario: AC-2 An id the product does not hold
  When a manager deletes a random UUID
  Then the answer is 200, the list is unchanged and no file is deleted
Scenario Outline: AC-3 Refusals
  When <who> deletes a photo
  Then the answer is <status> and nothing changes
  Examples:
    | who                               | status                      |
    | a seller or a driver              | 403 FORBIDDEN               |
    | someone outside the business      | 404 NOT_FOUND               |
    | a manager of a suspended business | 409 ORGANIZATION_NOT_ACTIVE |
    | a manager, id that is no UUID     | 400 VALIDATION_ERROR        |
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager removes a photo of another business (access control)
  When a manager of business A deletes a photo id of a product of business B
  Then the answer is 404 and the photos and files of B are unchanged
```

## Implementation
- Create: `tests/integration/images/product-photo-remove.test.ts`
- Modify: `src/modules/images/card-photos.service.ts`, `src/modules/images/images.routes.ts`, `src/modules/images/images.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `removeCardPhoto(card: PhotoCard, photoId: string): Promise<{ image_urls: string[] }>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: the rules table decides before the handler runs.
- v5.0.0-8.2.2: the product is looked up inside the business of the session.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| remove | integration | AC-1, C-50 | DELETE twice → 200 both, other photo kept, file gone |
| unknown id | integration | AC-2 | random UUID → 200, list and files unchanged |
| refusals | integration | AC-3 | each Examples row → status, nothing changes |
| other business | security | AB-1, WSTG-ATHZ-02 | manager A on product of B → 404, B unchanged |

Command: `npx vitest run tests/integration/images/product-photo-remove.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the photo removal path | add DELETE .../products/{productId}/photos/{photoId}, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the photo removal path | add the same path, remove nothing |

## Out of scope
- Adding a photo: IMG-008. The photos of a variant: IMG-010.

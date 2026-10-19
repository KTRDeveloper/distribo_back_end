---
id: IMG-010
title: A manager adds, replaces or removes the photos of a variant
module: images
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [IMG-008, IMG-009]
read_first: [src/modules/images/card-photos.service.ts, src/shared/access/ability.ts]
design_refs: [images/ajouter-remplacer-retirer-une-photo, catalogue/productvariant]
constraints: [C-49]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# IMG-010 — A manager adds, replaces or removes the photos of a variant

## Story
As a manager, I want to add, replace or remove the photos of one variant so that a customer sees the red T-shirt and not the blue one.

## Context
- Exists: `putCardPhoto`, `removeCardPhoto`, `PhotoCard`, `PHOTOS_PER_CARD` and the product routes (IMG-008, IMG-009); `lockVariantImageKeys` (CAT-044) and `setVariantImageKeys` (CAT-032).
- Adds one row to `RULES` in `ability.ts`: MANAGER, `ONLINE_FOR_ALL`, action `change_photos`, subject `ProductVariant`.
- New routes in the images router: `PUT /api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}/photos/{position}` and `DELETE .../photos/{photoId}`, with the rules, positions and answers of IMG-008 and IMG-009. Order: `loadActor`, `requireAbility('change_photos', 'ProductVariant')`, then `imageBody()`.
- `variantCard(organizationId, productId, variantId)` in `card-photos.service.ts`: its `lock` calls `lockVariantImageKeys` and fails with 404 `NOT_FOUND` when the product id it returns is not the one of the path; its `write` calls `setVariantImageKeys`. An INACTIVE variant can change photos. Files are stored in the folder `products`.
- A variant with no photo shows those of its product (design 3.1): nothing to do here.
- Logs `info` `variant_photos_changed` with the organization, variant and person ids. Add the two paths to the route lists.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add, replace and remove
  Given a variant with no photo
  When a manager sends a PNG at position 1, a JPEG at position 1, then deletes the photo by its id
  Then the answers are 200 with 1, 1 and 0 URLs, and both files are gone from storage
Scenario: AC-2 A variant of another product
  When the product in the path is not the variant's product
  Then the answer is 404 `NOT_FOUND` and nothing changes
Scenario Outline: AC-3 Refusals and exceptions
  When <who> sends a good photo
  Then the answer is <status>
  Examples:
    | who                                  | status           |
    | a manager, on an INACTIVE variant    | 200              |
    | a seller or a driver                 | 403 FORBIDDEN    |
    | someone outside the business         | 404 NOT_FOUND    |
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager changes another business's variant (access control)
  When a manager of business A sends a photo for a variant of business B
  Then the answer is 404 and the photos of B are unchanged
```

## Implementation
- Create: `tests/integration/images/variant-photos.test.ts`
- Modify: `src/modules/images/card-photos.service.ts`, `src/modules/images/images.routes.ts`, `src/modules/images/images.openapi.ts`, `src/shared/access/ability.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `variantCard(organizationId: string, productId: string, variantId: string): PhotoCard`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409, `VALIDATION_ERROR` 400, `UNSUPPORTED_IMAGE` 400
- Dependencies: `express`, `@casl/ability`

## Security
- v5.0.0-8.2.1: the rules table decides before the body is read.
- v5.0.0-8.2.2: the variant is looked up inside the business of the session and must belong to the product of the path.
- v5.0.0-15.3.3: the only writable thing is the photo; the key is built by the server.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add, replace, remove | integration | AC-1, C-49 | PUT, PUT, DELETE → 200, URL counts, files gone |
| wrong product | integration | AC-2 | variant under another product → 404 |
| refusals | integration | AC-3 | each Examples row → status |
| other business | security | AB-1, WSTG-ATHZ-02 | manager A on variant of B → 404, B unchanged |

Command: `npx vitest run tests/integration/images/variant-photos.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | the route list lacks the variant photo paths | add PUT .../variants/{variantId}/photos/{position} and DELETE .../photos/{photoId}, remove nothing |
| tests/integration/per-001.test.ts | the route list lacks the variant photo paths | add the same two paths, remove nothing |

## Out of scope
- Taking a photo from another variant: IMG-011.

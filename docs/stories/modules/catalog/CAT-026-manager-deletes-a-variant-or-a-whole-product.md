---
id: CAT-026
title: Manager deletes a variant or a whole product
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [CAT-025, ORD-030]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.routes.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-45, C-48]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-2.3.3]
---

# CAT-026 — Manager deletes a variant or a whole product

## Story
As a manager, I want to delete an article or one of its sizes that I added by mistake so that my catalog stays clean, without losing any sale history.

## Context
- Exists: `editVariant` (CAT-025); `listOrderedVariantIds` of the order module (ORD-030).
- Adds: `DELETE /api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}` and `DELETE /api/v1/organizations/{organizationId}/products/{productId}`, both 204. Deleting sets `deleted_at` in one transaction; a product goes with all its variants.
- A variant is used when an order line or a live negotiated price cites it (C-48): new `findUsedVariantIds(tx, variantIds)` answers it, with `listOrderedVariantIds` for the lines. A used variant gives 409 `VARIANT_IN_USE`, nothing deleted: CAT-025 (INACTIVE) is the way out. One used variant refuses the whole product.
- The last live variant cannot be deleted alone: 409 `LAST_VARIANT` (C-45); delete the product.
- Deleting what is already deleted answers 204; an id outside the organization answers 404.
- `ability.ts`: add `delete` rows for `Product` and `ProductVariant`, MANAGER, `ONLINE_EXCEPT_OWNER`, with `fields: CATALOG_FIELDS`.
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.

## Acceptance criteria
```gherkin
Scenario: AC-1 Delete a variant never used
  Given a product with two variants
  When a MANAGER deletes one
  Then the answer is 204 and the variant has `deleted_at`
Scenario: AC-2 Delete a product
  Given a product with two unused variants
  When a MANAGER deletes the product
  Then the answer is 204 and the product and both variants are deleted
Scenario Outline: AC-3 A used variant stays
  Given a variant cited by <use>
  When a MANAGER deletes it, or deletes its product
  Then the answer is 409 `VARIANT_IN_USE` and nothing is deleted
  Examples:
    | use                           |
    | an order line                 |
    | a live negotiated price       |
Scenario: AC-4 Past use does not block
  Given a variant whose only negotiated price was deleted
  Then deleting it answers 204
Scenario: AC-5 The last variant
  When the only live variant of a product is deleted
  Then the answer is 409 `LAST_VARIANT`
Scenario Outline: AC-6 Other answers
  When <case>
  Then the answer is <status>
  Examples:
    | case                                         | status        |
    | the variant is already deleted               | 204           |
    | the id belongs to another business           | 404 NOT_FOUND |
```

## Abuse cases
```gherkin
Scenario: AB-1 Deleting sales history (tampering)
  When a MANAGER deletes the product of a variant that orders cite
  Then the answer is 409 and the order lines keep their variant
Scenario: AB-2 A seller deletes articles (vertical)
  When a SELLER calls either route
  Then the answer is 403
```

## Implementation
- Create: `tests/integration/catalog/delete-variant.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`, `src/shared/access/ability.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `deleteVariant(actor: Actor, productId: string, variantId: string): Promise<void>`
  - `deleteProduct(actor: Actor, productId: string): Promise<void>`
  - `findUsedVariantIds(tx: Prisma.TransactionClient, variantIds: string[]): Promise<Set<string>>`
- Errors: `VARIANT_IN_USE` 409, `LAST_VARIANT` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.1: manager online or owner (`delete Product`, `delete ProductVariant`).
- v5.0.0-8.2.2: product and variant are selected by id and organization id together.
- v5.0.0-2.3.3: checks and deletions run in one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| delete variant | integration | AC-1, C-45 | 204, deleted_at set |
| delete product | integration | AC-2 | product and variants deleted |
| used variant | integration | AC-3, C-48 | each Examples row → 409, nothing deleted |
| past use | integration | AC-4, C-48 | deleted price → 204 |
| last variant | integration | AC-5, C-45 | 409 |
| other answers | integration | AC-6 | each Examples row → status |
| history kept | security | AB-1, CWE-639 | 409, lines intact |
| seller | security | AB-2, WSTG-ATHZ-03 | 403 on both routes |

Command: `npx vitest run tests/integration/catalog/delete-variant.test.ts tests/integration/api-docs tests/integration/per-001.test.ts tests/unit/access/ability.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/access/ability.test.ts | the role loop expects `delete` on Product false for everyone | expect `read` false; add: a MANAGER online and the OWNER may delete Product and ProductVariant, a MANAGER offline may not |
| tests/integration/api-docs/catalog.test.ts | route list | add the two DELETE paths, remove nothing |
| tests/integration/per-001.test.ts | route list | add the two DELETE paths, remove nothing |

## Out of scope
- A deletion by synchronization: CAT-036.

---
id: CAT-022
title: Manager creates a product with its variants
module: catalog
kind: change
rev: 1
amends: [CAT-004]
size: M
risk: medium
depends_on: [CAT-004, CAT-014, CAT-016, CAT-018, CAT-021, CAT-038, ACC-008, FND-013]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.schemas.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-13, C-47]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.2.1]
---

# CAT-022 — Manager creates a product with its variants

## Story
As a manager, I want to add an article with its sizes or units in one step so that customers can order each of them.

## Context
- Exists: `POST .../products` with a flat body (CAT-004); `product_variants` (CAT-012); `variantLabel`, `simplifyText` (CAT-016); `assertRoomForProduct` (CAT-038); `imageUrl` (FND-013).
- Change: the body is `{ id, name, description?, category?, variants: [{ id, name?, unit, price, min_order_quantity? }] }`, 1 to 50 variants, the limits of CAT-004; a variant `name` is 1 to 100 when sent.
- One transaction runs `assertRoomForProduct` (C-46), writes the product with an empty `unit` (CAT-014 reads that as "the code writes the variants") and then each variant, ACTIVE, `price_updated_at` set by the server. Two variants with the same simplified name and unit: 409 `VARIANT_EXISTS`, nothing stored (C-47).
- Answer 201 `ProductView`, `image_urls` from `imageUrl`.
- `ability.ts`: export `CATALOG_FIELDS = ['name', 'description', 'category', 'unit', 'price', 'min_order_quantity', 'status']`; the `create Product` row gets `fields: CATALOG_FIELDS`; add the same row for `ProductVariant`.
- `C-13`: `ProductVariant.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 A product with variants
  When a MANAGER posts name "Riz parfumé" and variants "sac 25 kg" at 15000 and "sac 10 kg" at 7000
  Then the answer is 201 with both variants in order, ACTIVE, the first labelled "Riz parfumé — sac 25 kg"
Scenario Outline: AC-2 Refusals
  When the body has <problem>
  Then the answer is <status> and nothing is stored
  Examples:
    | problem                                         | status                      |
    | no variant, 51 variants, price 0 or 1.5, no unit | 400 VALIDATION_ERROR        |
    | a top-level unit or price, a variant status, or `organization_id`, `image_keys`, `paused_at` | 400 VALIDATION_ERROR |
    | two variants "Sac 10 kg" and " sac  10 KG "     | 409 VARIANT_EXISTS          |
    | a CLOSED or SUSPENDED organization              | 409 ORGANIZATION_NOT_ACTIVE |
Scenario: AC-3 Plan limit
  Given a FREE business with 30 products on sale
  When a MANAGER posts a product
  Then the answer is 409 `PRODUCT_LIMIT_REACHED` and nothing is stored; an unlimited plan answers 201
Scenario: AC-4 Repeat
  When the same body is posted twice
  Then one product and its variants exist and both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 A seller creates articles (vertical)
  When a SELLER or DRIVER posts
  Then the answer is 403
Scenario: AB-2 Another business (horizontal)
  When a member of A posts to the path of business B
  Then the answer is 404
```

## Implementation
- Create: `tests/integration/catalog/create-product-with-variants.test.ts`
- Modify: `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`, `src/shared/access/ability.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `createProduct(actor: Actor, input: CreateProductInput): Promise<ProductView>`
- Types:
  - `CreateProductInput = { id: string; name: string; description?: string; category?: string; variants: VariantInput[] }`
  - `VariantInput = { id: string; name?: string; unit: string; price: number; min_order_quantity?: number | string }`
  - `ProductView = { id: string; name: string; description: string | null; category: string | null; image_urls: string[]; paused: boolean; variants: VariantView[] }`
  - `VariantView = { id: string; name: string | null; unit: string; label: string; price: number; price_updated_at: string; min_order_quantity: string | null; image_urls: string[]; status: 'ACTIVE' | 'INACTIVE' }`
- Errors: `VALIDATION_ERROR` 400, `ORGANIZATION_NOT_ACTIVE` 409, `PRODUCT_LIMIT_REACHED` 409, `VARIANT_EXISTS` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner, by the rules table.
- v5.0.0-15.3.3: strict schema; status, photos, pause date and organization come from the server.
- v5.0.0-2.2.1: values are checked first.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| created | integration | AC-1, C-13 | 201, order, label |
| refusals | integration | AC-2, C-47 | each Examples row → status, no row |
| plan limit | integration | AC-3 | 30 on sale → 409 |
| repeat | integration | AC-4 | one product |
| seller | security | AB-1, WSTG-ATHZ-03 | 403, nothing stored |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/catalog/create-product-with-variants.test.ts tests/integration/catalog/create-product.test.ts tests/unit/access/ability.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/create-product.test.ts | bodies carry a top-level unit and price | send `variants`, expect the view with variants; other cases keep their meaning |

## Out of scope
- Adding, editing and deleting a variant of an existing product: CAT-024 to CAT-026.

---
id: CAT-023
title: Manager edits a product's name, description and category
module: catalog
kind: change
rev: 1
amends: [CAT-005]
size: S
risk: medium
depends_on: [CAT-005, CAT-022]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.schemas.ts]
design_refs: [catalogue/product]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-8.2.2]
---

# CAT-023 — Manager edits a product's name, description and category

## Story
As a manager, I want to rename an article or change its description and family so that my catalog stays right.

## Context
- Exists: `PATCH .../products/{productId}` changes name, unit, price, min_order_quantity, description, category and status, and answers the flat view with `negotiated_prices_to_review` (CAT-005); `ProductView` (CAT-022).
- Change: PATCH accepts only `name` (1 to 100), `description` (up to 2000, null clears) and `category` (up to 100, null clears), at least one. `unit`, `price`, `min_order_quantity` and `status` belong to variants and are a 400 (CAT-025). The answer is 200 with the `ProductView`; `negotiated_prices_to_review` leaves this route.
- A product that is deleted or of another organization answers 404. A paused product can be edited.
- `ability.ts`: the `update Product` row gets `fields: CATALOG_FIELDS`; add the same `update` row for `ProductVariant` (used from CAT-025).

## Acceptance criteria
```gherkin
Scenario: AC-1 Change fields
  When a MANAGER patches name and category
  Then the answer is 200 with the new values and the variants unchanged
Scenario: AC-2 Clear
  When description is sent as null
  Then the answer is 200 and description is null
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the answer is <status> and the product is unchanged
  Examples:
    | problem                                              | status                 |
    | no field, or name empty                              | 400 VALIDATION_ERROR   |
    | unit, price, min_order_quantity or status            | 400 VALIDATION_ERROR   |
    | organization_id, image_keys or paused_at             | 400 VALIDATION_ERROR   |
    | a product of another organization, or a deleted one  | 404 NOT_FOUND          |
    | a SELLER or DRIVER caller                            | 403 FORBIDDEN          |
```

## Abuse cases
```gherkin
Scenario: AB-1 A seller renames an article (vertical)
  When a SELLER patches the name
  Then the answer is 403 and the name is unchanged
Scenario: AB-2 Editing another business's product (horizontal)
  When a member of A patches a product of B under A's path
  Then the answer is 404 and B's product is unchanged
```

## Implementation
- Create: `tests/integration/catalog/edit-product-text.test.ts`
- Modify: `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`, `src/shared/access/ability.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `editProduct(actor: Actor, productId: string, input: EditProductInput): Promise<ProductView>`
- Types:
  - `EditProductInput = { name?: string; description?: string | null; category?: string | null }`
- Errors: `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@casl/ability`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-8.2.2: the product is selected by id and organization id together.
- v5.0.0-15.3.3: strict schema; prices and status can no longer be sent here.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| change | integration | AC-1 | 200, variants same |
| clear | integration | AC-2 | null description |
| refusals | integration | AC-3 | each Examples row → status |
| seller | security | AB-1, WSTG-ATHZ-03 | 403, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404, unchanged |

Command: `npx vitest run tests/integration/catalog/edit-product-text.test.ts tests/integration/catalog/edit-product.test.ts tests/unit/access/ability.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/edit-product.test.ts | cases patch price, unit, min_order_quantity and status of a product and expect negotiated_prices_to_review | keep only the name, description, category, role and other-business cases, and expect the product view; price cases move to CAT-025 |

## Out of scope
- Price, unit, minimum quantity and status: CAT-025.

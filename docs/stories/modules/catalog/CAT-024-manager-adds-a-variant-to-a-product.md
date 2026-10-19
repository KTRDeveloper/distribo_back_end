---
id: CAT-024
title: Manager adds a variant to a product
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [CAT-022, CAT-018, CAT-038]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.routes.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-13, C-46, C-47]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# CAT-024 — Manager adds a variant to a product

## Story
As a manager, I want to add a size, a colour or a format to an article so that customers can choose it.

## Context
- Exists: product creation with variants and `VariantView` (CAT-022); `assertRoomForProduct` (CAT-038); the unique index of C-47 (CAT-018).
- Adds: `POST /api/v1/organizations/{organizationId}/products/{productId}/variants` with `{ id, name?, unit, price, min_order_quantity? }`, the limits of CAT-022; answer 201 `VariantView`. The product must belong to the organization and not be deleted (else 404); a paused product accepts the variant.
- A live variant of the same product with the same simplified name and unit: 409 `VARIANT_EXISTS`. The service compares with `simplifyText`; a race falls on the unique index and gives the same answer.
- A product with no ACTIVE variant that is not paused returns to sale with this variant: `assertRoomForProduct` applies (C-46).
- `C-13`: `ProductVariant.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 Add
  Given a product "T-shirt" with one variant
  When a MANAGER posts name "Rouge / L", unit "pièce" and price 5000
  Then the answer is 201 with label "T-shirt — Rouge / L (pièce)" and status ACTIVE
Scenario Outline: AC-2 Refusals
  When the request has <problem>
  Then the answer is <status> and nothing is stored
  Examples:
    | problem                                               | status                      |
    | the name and unit of a live variant, in other case    | 409 VARIANT_EXISTS          |
    | price 0, or an empty unit                             | 400 VALIDATION_ERROR        |
    | status, product_id or organization_id in the body     | 400 VALIDATION_ERROR        |
    | a deleted product, or a product of another business   | 404 NOT_FOUND               |
    | a CLOSED or SUSPENDED organization                    | 409 ORGANIZATION_NOT_ACTIVE |
    | a SELLER or DRIVER caller                             | 403 FORBIDDEN               |
Scenario: AC-3 Back on sale
  Given a FREE business with 30 products on sale and a product whose variants are all INACTIVE
  When a variant is added to that product
  Then the answer is 409 `PRODUCT_LIMIT_REACHED`; for a product that has an ACTIVE variant it is 201
Scenario: AC-4 Repeat
  When the same body is posted twice
  Then one variant exists and both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 A seller adds variants (vertical)
  When a SELLER posts
  Then the answer is 403 and nothing is stored
Scenario: AB-2 A product of another business under one's own path (horizontal)
  When a member of A posts a variant to the product id of B
  Then the answer is 404 and B's product is unchanged
```

## Implementation
- Create: `tests/integration/catalog/add-variant.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `addVariant(actor: Actor, productId: string, input: VariantInput): Promise<VariantView>`
  - `findLiveVariantByText(tx: Prisma.TransactionClient, productId: string, name: string | undefined, unit: string): Promise<{ id: string; status: 'ACTIVE' | 'INACTIVE' } | null>`
- Errors: `VALIDATION_ERROR` 400, `ORGANIZATION_NOT_ACTIVE` 409, `PRODUCT_LIMIT_REACHED` 409, `VARIANT_EXISTS` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.1: manager online or owner, decided by the rules table (`create ProductVariant`).
- v5.0.0-8.2.2: the product is selected by id and organization id together.
- v5.0.0-15.3.3: strict schema; status and the keys of the product come from the server.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| add | integration | AC-1 | 201, label |
| refusals | integration | AC-2, C-13, C-47 | each Examples row → status |
| back on sale | integration | AC-3, C-46 | 30 on sale → 409; with an ACTIVE variant → 201 |
| repeat | integration | AC-4 | one variant |
| seller | security | AB-1, WSTG-ATHZ-03 | 403, nothing stored |
| other business | security | AB-2, WSTG-ATHZ-04 | 404, unchanged |

Command: `npx vitest run tests/integration/catalog/add-variant.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | route list | add the variant POST path, remove nothing |
| tests/integration/per-001.test.ts | route list | add the variant POST path, remove nothing |

## Out of scope
- Editing and deleting a variant: CAT-025, CAT-026.
- Photos of a variant: the images module.

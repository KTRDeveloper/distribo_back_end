---
id: CAT-025
title: Manager changes a variant's price, unit or availability
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [CAT-024, CAT-023, CAT-038]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.routes.ts]
design_refs: [catalogue/productvariant]
constraints: [C-13, C-46, C-47]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# CAT-025 — Manager changes a variant's price, unit or availability

## Story
As a manager, I want to change the price, the unit or the availability of one size of an article so that my catalog stays right.

## Context
- Exists: `addVariant`, `findLiveVariantByText` (CAT-024); the `update ProductVariant` rule (CAT-023); the price date trigger.
- Adds: `PATCH /api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}` with at least one of `name` (null clears), `unit`, `price`, `min_order_quantity` (null clears), `status` (ACTIVE or INACTIVE), the limits of CAT-022. Answer 200 `VariantView` plus `negotiated_prices_to_review`: the live negotiated prices of this variant older than the new `price_updated_at` (0 when the price did not change).
- The variant must belong to the product and the organization and not be deleted (else 404). A change that gives it the simplified name and unit of another live variant: 409 `VARIANT_EXISTS`.
- INACTIVE takes it off sale; old orders keep their lines. Back to ACTIVE on a product with no other ACTIVE variant that is not paused returns it to sale: `assertRoomForProduct` applies (C-46).
- `C-13`: `ProductVariant.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 Change fields
  When a MANAGER patches the name and the minimum quantity
  Then the answer is 200, `price_updated_at` unchanged
Scenario: AC-2 Price change
  Given 3 customers with a negotiated price set before now
  When the price goes from 15000 to 16000
  Then `price_updated_at` is now and `negotiated_prices_to_review` is 3
Scenario: AC-3 Withdraw and restore
  When the status is set INACTIVE, then ACTIVE
  Then both answers are 200
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the answer is <status> and the variant is unchanged
  Examples:
    | problem                                              | status               |
    | price 0, no field, or status "DELETED"               | 400 VALIDATION_ERROR |
    | product_id, organization_id or image_keys            | 400 VALIDATION_ERROR |
    | a name and unit equal to another live variant        | 409 VARIANT_EXISTS   |
    | a variant of another business, or a deleted one      | 404 NOT_FOUND        |
Scenario: AC-5 Back on sale at the limit
  Given a FREE business with 30 products on sale and a product whose only variant is INACTIVE
  When that variant is set ACTIVE
  Then the answer is 409 `PRODUCT_LIMIT_REACHED`
```

## Abuse cases
```gherkin
Scenario: AB-1 A seller changes a price (vertical)
  When a SELLER or DRIVER patches the price
  Then the answer is 403 and the price is unchanged
Scenario: AB-2 A variant of another business (horizontal)
  When a member of A patches a variant of B
  Then the answer is 404 and B's variant is unchanged
```

## Implementation
- Create: `tests/integration/catalog/edit-variant.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `editVariant(actor: Actor, productId: string, variantId: string, input: EditVariantInput): Promise<VariantView & { negotiated_prices_to_review: number }>`
- Types:
  - `EditVariantInput = { name?: string | null; unit?: string; price?: number; min_order_quantity?: number | string | null; status?: 'ACTIVE' | 'INACTIVE' }`
- Errors: `VALIDATION_ERROR` 400, `PRODUCT_LIMIT_REACHED` 409, `VARIANT_EXISTS` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.1: manager online or owner (`update ProductVariant`).
- v5.0.0-8.2.2: the variant is selected by id, product id and organization id together.
- v5.0.0-15.3.3: strict schema; keys, product and organization are not accepted.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| change fields | integration | AC-1, C-13 | 200, price date same |
| price change | integration | AC-2, C-13 | date moves, 3 to review |
| withdraw and restore | integration | AC-3 | statuses follow |
| refusals | integration | AC-4, C-47 | each Examples row → status |
| limit | integration | AC-5, C-46 | 30 on sale → 409 |
| seller price | security | AB-1, WSTG-ATHZ-03 | 403, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404, unchanged |

Command: `npx vitest run tests/integration/catalog/edit-variant.test.ts tests/integration/api-docs tests/integration/per-001.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/api-docs/catalog.test.ts | route list | add the variant PATCH path, remove nothing |
| tests/integration/per-001.test.ts | route list | add the variant PATCH path, remove nothing |

## Out of scope
- Deleting a variant: CAT-026.

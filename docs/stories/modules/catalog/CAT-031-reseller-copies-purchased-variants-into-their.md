---
id: CAT-031
title: Reseller copies purchased variants into their catalog
module: catalog
kind: change
rev: 1
amends: [CAT-011]
size: M
risk: medium
depends_on: [CAT-011, CAT-022, CAT-016, CAT-024, CAT-038]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-47]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# CAT-031 — Reseller copies purchased variants into their catalog

## Story
As a manager, I want to copy the articles I buy into my own catalog, size by size, with my own prices so that I can sell them.

## Context
- Exists: `POST .../products/copy` with `{ id, source_product_id, price }` copies one flat article (CAT-011); `findLiveVariantByText` (CAT-024); `assertRoomForProduct` (CAT-038); `simplifyText`.
- Change: body `{ id, source_product_id, destination, variants: [{ id, source_variant_id, price }] }`, 1 to 50 variants. `destination` is `{ product_id }` (a live product of the caller's organization) or `{ name? }` for a new product, whose id is the body's `id` and whose name defaults to the source's. Strict; no `status`, no photo.
- The source product must be live, not paused, of a supplier whose customer the caller's organization is in a live relationship, with every listed variant ACTIVE and not deleted (else 404). A new product takes the source's name, description and category; each variant its name and unit; never the price or the minimum quantity.
- A source variant matching a live variant of the destination (simplified name and unit) is not copied: `already_in_catalog` lists it with the existing id and status.
- A new product, or a destination with no ACTIVE variant that is not paused, runs `assertRoomForProduct` (C-46).
- Answer 201 `CopyProductResult`.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.

## Acceptance criteria
```gherkin
Scenario: AC-1 New product
  Given a supplier product "Riz" with ACTIVE variants "sac 25 kg" and "sac 50 kg"
  When a reseller copies both with prices 16000 and 31000 to a new product
  Then the answer is 201 with a product "Riz", two variants named and united as the source, priced as sent, `copied` listing both ids
Scenario: AC-2 Existing product
  Given the reseller has "Riz" with a live "sac 25 kg"
  When they copy both variants into it
  Then only "sac 50 kg" is created and `already_in_catalog` lists the 25 kg one with its status
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the answer is <status> and nothing is stored
  Examples:
    | problem                                                 | status                |
    | a source product of a supplier that is not theirs       | 404 NOT_FOUND         |
    | a source variant INACTIVE or of another product, or a destination of another organization | 404 NOT_FOUND |
    | a price of 0, or the same source variant twice          | 400 VALIDATION_ERROR  |
    | a full plan and a new product                           | 409 PRODUCT_LIMIT_REACHED |
    | a SELLER or DRIVER caller                               | 403 FORBIDDEN         |
Scenario: AC-4 Repeat
  When the same body is posted twice
  Then one copy exists
```

## Abuse cases
```gherkin
Scenario: AB-1 Copying a competitor's catalog (information disclosure)
  When an organization with no live relationship to the supplier posts its product id
  Then the answer is 404
Scenario: AB-2 Reading the supplier's price and minimum
  When the copy is made
  Then neither the answer nor the new rows carry the supplier's price or minimum
```

## Implementation
- Create: `tests/integration/catalog/copy-variants.test.ts`
- Modify: `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `copyProduct(actor: Actor, input: CopyProductInput): Promise<CopyProductResult>`
- Types:
  - `CopyProductInput = { id: string; source_product_id: string; destination: { product_id: string } | { name?: string }; variants: Array<{ id: string; source_variant_id: string; price: number }> }`
  - `CopyProductResult = { product: ProductView; copied: string[]; already_in_catalog: Array<{ source_variant_id: string; variant_id: string; status: 'ACTIVE' | 'INACTIVE' }> }`
- Errors: `VALIDATION_ERROR` 400, `PRODUCT_LIMIT_REACHED` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner, by the rules table.
- v5.0.0-8.2.2: the source is found through the caller's own customer relationship, the destination through the actor's organization.
- v5.0.0-15.3.3: strict schema; the supplier's price and minimum are never read.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| new product | integration | AC-1 | two variants copied |
| existing product | integration | AC-2, C-47 | one created, one reported |
| refusals | integration | AC-3 | each Examples row → status |
| repeat | integration | AC-4 | one copy |
| competitor | security | AB-1, WSTG-ATHZ-04 | 404, nothing stored |
| supplier price | security | AB-2, CWE-200 | no price or minimum copied |

Command: `npx vitest run tests/integration/catalog/copy-variants.test.ts tests/integration/catalog/copy-product.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/copy-product.test.ts | body `{ id, source_product_id, price }`, flat answer | send `destination` and `variants`, expect AC-1; relationship, scope and repeat cases keep their meaning |

## Out of scope
- Copying the photos of the source: CAT-045.

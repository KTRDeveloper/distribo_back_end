---
id: CAT-028
title: Customer browses a supplier's catalog by product and variant
module: catalog
kind: change
rev: 1
amends: [CAT-007]
size: M
risk: medium
depends_on: [CAT-007, CAT-022, CAT-016]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [CM-11]
asvs: [v5.0.0-8.2.2, v5.0.0-8.3.1]
---

# CAT-028 — Customer browses a supplier's catalog by product and variant

## Story
As a customer, I want to see a supplier's articles with each size and my own price so that I can order the right one.

## Context
- Exists: `GET .../catalog?limit&cursor&as_organization_id` lists ACTIVE products flat, with `price_is_negotiated` (CAT-007); `getReferencePrice`, `variantLabel`.
- Change: each item is `{ id, name, description, category, image_urls, variants: [{ id, name, unit, label, price, min_order_quantity, price_is_negotiated, image_urls }] }`. It lists the products not deleted and not paused that have at least one ACTIVE variant not deleted, newest first, and only those variants, oldest first. `image_urls` of a variant holds its own photos only; the phone falls back to the product's.
- `price` of a variant is the caller's negotiated price when the caller's own live relationship with this supplier has one, else the variant price (CM-11). With `as_organization_id` the organization's own relationship decides, the caller being its MANAGER or OWNER (else 404). Pages are of products.
- A CLOSED or SUSPENDED supplier, or an unknown id, answers 404 as before. Nothing reveals other customers' prices, the supplier's own suppliers, withdrawn variants or paused products.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the variant price), else the variant price.

## Acceptance criteria
```gherkin
Scenario: AC-1 Products and variants
  Given a supplier with a product of two ACTIVE variants and one INACTIVE
  When a customer browses
  Then the product appears once with its two ACTIVE variants and their labels
Scenario: AC-2 My price
  Given a negotiated price of 2800 for the first variant, whose price is 3000
  When the customer browses
  Then the first variant shows 2800 with `price_is_negotiated` true and the second its own price with false
Scenario Outline: AC-3 Left out
  When the supplier has <case>
  Then it is not returned
  Examples:
    | case                                           |
    | a product with all variants INACTIVE           |
    | a paused product                               |
    | a deleted product or a deleted variant         |
Scenario: AC-4 Organization as customer
  When `as_organization_id` names an organization of which the caller is not MANAGER or OWNER
  Then the answer is 404
```

## Abuse cases
```gherkin
Scenario: AB-1 Another customer's price leaks (information disclosure)
  Given two customers of one supplier with different negotiated prices for a variant
  When the first browses
  Then only the first price appears, in no field of the answer
```

## Implementation
- Create: `tests/integration/catalog/customer-catalog-variants.test.ts`
- Modify: `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `browseCatalog(personId: string, supplierOrganizationId: string, query: BrowseQuery): Promise<CatalogPage>`
- Types:
  - `CatalogItemView = { id: string; name: string; description: string | null; category: string | null; image_urls: string[]; variants: CatalogVariantView[] }`
  - `CatalogVariantView = { id: string; name: string | null; unit: string; label: string; price: number; min_order_quantity: string | null; price_is_negotiated: boolean; image_urls: string[] }`
- Errors: `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: negotiated prices are joined through the caller's own relationship only.
- v5.0.0-8.3.1: the visibility predicate of the relationship decides which customer record applies.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| products and variants | integration | AC-1 | one product, two variants |
| my price | integration | AC-2, CM-11 | 2800 and 3000 |
| left out | integration | AC-3 | each Examples row → absent |
| organization as customer | integration | AC-4 | 404 |
| other customer | security | AB-1, WSTG-ATHZ-02 | only own price |

Command: `npx vitest run tests/integration/catalog/customer-catalog-variants.test.ts tests/integration/catalog/customer-catalog.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/customer-catalog.test.ts | items are flat with unit and price of the product | expect products with `variants`, the ACTIVE ones only; the 404, as_organization_id and negotiated-price cases keep their meaning per variant |

## Out of scope
- Showing the product to a customer's phone through synchronization: customers browse online.

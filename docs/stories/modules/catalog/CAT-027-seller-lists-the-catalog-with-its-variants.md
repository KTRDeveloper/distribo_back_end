---
id: CAT-027
title: Seller lists the catalog with its variants
module: catalog
kind: change
rev: 1
amends: [CAT-006]
size: S
risk: low
depends_on: [CAT-006, CAT-022]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2]
---

# CAT-027 — Seller lists the catalog with its variants

## Story
As a seller, I want to see each article with its sizes so that I can quote the right one.

## Context
- Exists: `GET .../products?limit&cursor&status&category&q` answers flat items read from the old product columns (CAT-006); `ProductView` (CAT-022).
- Change: each item is a `ProductView` with all its variants not deleted, withdrawn ones included, oldest first. Products not deleted, newest first (`created_at` descending, then `id`); a paused product is listed with `paused: true`. The variants of a page come from one query on the page's ids, not one query per product.
- `status` ACTIVE keeps the products with at least one ACTIVE variant, INACTIVE those with none. `category` is an exact match. `q` (up to 100 characters) matches the product name or the name of any of its variants, case-insensitive.
- SELLER and above; a DRIVER gets 403. `catalog.openapi.ts` documents the new item.

## Acceptance criteria
```gherkin
Scenario: AC-1 Products with variants
  Given a product with two variants, one of them INACTIVE, and a product whose only variant is INACTIVE
  When a SELLER lists
  Then both products are returned with all their variants, newest product first
Scenario Outline: AC-2 Filters
  When the query is <query>
  Then the result is <result>
  Examples:
    | query                          | result                                         |
    | status=ACTIVE                  | only the first product                         |
    | status=INACTIVE                | only the second product                        |
    | q=rouge, a variant named Rouge | the product of that variant                    |
    | category=Boissons              | only the products of that category             |
Scenario: AC-3 Pages
  Given 3 products and limit 2
  When the first page and then the `cursor` page are read
  Then they hold 2 and 1 products with no repeat
Scenario: AC-4 Roles and scope
  Then a DRIVER gets 403, and a member of A listing the path of B gets 404
```

## Abuse cases
```gherkin
Scenario: AB-1 Listing another business's catalog (horizontal)
  When a member of A lists the products under B's path
  Then the answer is 404 and no product of B is returned
```

## Implementation
- Create: `tests/integration/catalog/list-products-with-variants.test.ts`
- Modify: `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `listProducts(actor: Actor, query: ListProductsQuery): Promise<ProductPage>`
- Types:
  - `ProductPage = { items: ProductView[]; next_cursor: string | null }`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: SELLER and above; a driver does not list the catalog.
- v5.0.0-8.2.2: products and variants are selected by the actor's organization id.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| products with variants | integration | AC-1 | both products, all variants |
| filters | integration | AC-2 | each Examples row → result |
| pages | integration | AC-3 | 2 then 1, no repeat |
| roles | integration | AC-4 | 403 and 404 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404, nothing returned |

Command: `npx vitest run tests/integration/catalog/list-products-with-variants.test.ts tests/integration/catalog/list-products.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/list-products.test.ts | items are flat with unit, price and status of the product | expect product views with `variants`; the filter, page and role cases keep their meaning with status taken from the variants |

## Out of scope
- What a customer sees of a supplier's catalog: CAT-028.

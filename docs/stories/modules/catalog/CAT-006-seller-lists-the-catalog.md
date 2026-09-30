---
id: CAT-006
title: Seller lists the catalog
module: catalog
kind: feature
rev: 1
amends: []
size: S
risk: low
depends_on: [CAT-004, FND-009, CAT-003]
read_first: [src/modules/catalog/catalog.routes.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product]
constraints: ['Product.status:enum']
asvs: [v5.0.0-8.2.2, v5.0.0-15.3.1, v5.0.0-1.2.4]
---

# CAT-006 — Seller lists the catalog

## Story
As a seller, I want to list my organization's articles so that I can pick what to sell.

## Context
- Exists: products (CAT-004, CAT-005); pagination helpers.
- Adds: `GET /api/v1/organizations/{organizationId}/products?limit&cursor&status&category&q` (SELLER and above; DRIVER gets 403), newest first, product view. `q` matches the name, case-insensitive, up to 100 characters.
- Adds `catalog.openapi.ts` documenting this route and the product routes of CAT-004 and CAT-005; `catalog.routes.ts` imports it for its side effect.
- `Product.status:enum`: one of ACTIVE, INACTIVE

## Acceptance criteria
```gherkin
Scenario: AC-1 List articles
  Given 3 ACTIVE and 1 INACTIVE product
  When a SELLER lists
  Then 4 items are returned newest first
Scenario Outline: AC-2 Filters
  When the query has <query>
  Then <count> items are returned
  Examples:
    | query              | count |
    | status=ACTIVE      | 3     |
    | status=INACTIVE    | 1     |
    | q=riz              | 1     |
    | category=Boissons  | 2     |
Scenario: AC-3 Pagination
  When limit 2 is used with the cursor
  Then the pages hold 2 and 2 items
Scenario: AC-4 Driver refused
  Then a DRIVER gets 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's catalog (horizontal)
  When a member of A lists the products of B
  Then the response is 404
Scenario: AB-2 Injection through the search (injection)
  When q is `'; DROP TABLE products; --`
  Then the response is 200 with no item and the table exists
```

## Implementation
- Create: `src/modules/catalog/catalog.openapi.ts`, `tests/integration/catalog/list-products.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.schemas.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `listProducts(actor: Actor, query: ListProductsQuery): Promise<{ items: ProductView[]; next_cursor: string | null }>`
- Errors: `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-8.2.2: the query filters on the actor's organization.
- v5.0.0-1.2.4: `q` is a bound parameter.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1 | 4 items |
| filters | integration | AC-2, Product.status:enum | each Examples row → count |
| paging | integration | AC-3 | 2 and 2 |
| driver | integration | AC-4 | 403 |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |
| injection | security | AB-2, WSTG-INPV-05, CWE-89 | table intact |

Command: `npx vitest run tests/integration/catalog/list-products.test.ts`

## Out of scope
- The customer's view of a catalog (CAT-007).

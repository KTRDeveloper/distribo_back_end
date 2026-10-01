---
id: CAT-002
title: Seller creates a product
module: catalog
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-001, AUTH-005]
read_first: [docs/stories/modules/auth/contracts.md, src/modules/auth/logout.routes.ts]
design_refs: [catalogue/product, catalogue/parcours]
constraints: ['Product:required', C-03, C-04, C-06]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.2.1]
---

# CAT-002 — Seller creates a product

## Story
As a seller, I want to add a product to my catalog so that buyers can see it.

## Context
- Exists: `Product` table with its database constraints (CAT-001); `requireAuth(roles)` sets `req.auth = { accountId, role }` (AUTH-005).
- Adds: `POST /api/v1/products`; `owner_id` comes from `req.auth`, `status` starts `ACTIVE`.
- `Product` fields: `name` string; `description` text, nullable; `price` bigint; `status` enum [ACTIVE / ARCHIVED / REMOVED]
- `Product:required`: NOT NULL: `owner_id`, `name`, `price`, `status`, `created_at`, `updated_at`
- `C-03`: `name` is 1 to 120 characters; `description` is at most 2,000 characters
- `C-04`: `price` > 0
- `C-06`: one seller never has two non-removed products with the same name (partial unique index on `owner_id`, `name` where `status` <> REMOVED)

## Acceptance criteria
```gherkin
Scenario: AC-1 Seller creates a product
  Given a signed-in SELLER
  When they POST /api/v1/products with name "Sac de riz 25 kg" and price 18000
  Then the response is 201 with the product, status ACTIVE and owner_id = their account id
Scenario Outline: AC-2 Field limits
  When a SELLER posts a product with <field> = <value>
  Then the response is <status>
  Examples:
    | field       | value      | status |
    | name        | empty      | 422    |
    | name        | 1 char     | 201    |
    | name        | 120 chars  | 201    |
    | name        | 121 chars  | 422    |
    | description | 2000 chars | 201    |
    | description | 2001 chars | 422    |
    | price       | 0          | 422    |
    | price       | 1          | 201    |
Scenario: AC-3 Duplicate name in the same catalog
  Given the seller has a non-removed product named "Huile 5 L"
  When they create another product named "Huile 5 L"
  Then the response is 409 PRODUCT_NAME_TAKEN
  And another seller can still create a product named "Huile 5 L"
Scenario: AC-4 Missing required field
  When a SELLER posts a product without name, or without price
  Then the response is 422 with the missing field path in details
```

## Abuse cases
```gherkin
Scenario: AB-1 Owner chosen by the client (horizontal)
  Given sellers A and B
  When A posts a valid product with owner_id = B's id
  Then the response is 422 and B's catalog is unchanged
Scenario: AB-2 Admin creates a product (vertical)
  When an ADMIN posts a valid product
  Then the response is 403 and no product is stored
Scenario: AB-3 Server-owned fields in the body (mass assignment)
  When a SELLER posts status "REMOVED" or a removed_reason
  Then the response is 422 and nothing is stored
Scenario: AB-4 No valid access token (unauthenticated)
  When the request has no token, an expired token or a token signed with another key
  Then the response is 401
```

## Implementation
- Create: `src/modules/catalog/product.schemas.ts`, `src/modules/catalog/product.service.ts`, `src/modules/catalog/product.routes.ts`, `tests/catalog/product.create.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/auth/logout.routes.ts`
- Signatures:
  - `createProduct(ownerId: string, input: CreateProductInput): Promise<ProductView>`
- Types:
  - `CreateProductInput = { name: string; description?: string; price: number }`
  - `ProductView = { id, name, description, price, status, created_at, updated_at }`
- Errors: `VALIDATION_FAILED` 422, `PRODUCT_NAME_TAKEN` 409, `FORBIDDEN` 403, `UNAUTHENTICATED` 401
- Dependencies: `express`, `zod`, `@prisma/client`

## Security
- v5.0.0-8.2.1: mount the route behind requireAuth(['SELLER']).
- v5.0.0-15.3.3: strict schema accepting only name, description and price.
- v5.0.0-2.2.1: validate lengths and price before any database call; map the unique violation of C-06 to 409.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| creates product | integration | AC-1 | valid body as SELLER → 201; row has owner_id = caller, status ACTIVE |
| field limits | integration | AC-2, C-03, C-04 | each Examples row of AC-2 → its status; nothing stored on 422 |
| required fields | integration | AC-4, Product:required | body without name, then without price → 422 with details |
| duplicate name | integration | AC-3, C-06 | second "Huile 5 L" for the same owner → 409; for another owner → 201 |
| owner from session | security | AB-1, WSTG-ATHZ-04 | owner_id of B in the body → 422; B still has 0 products |
| admin forbidden | security | AB-2, WSTG-ATHZ-03 | ADMIN token → 403; product count unchanged |
| mass assignment | security | AB-3 | status or removed_reason in the body → 422 |
| no valid token | security | AB-4, WSTG-ATHN-04 | no token, expired token, token signed with another key → 401 |

Command: `npx vitest run tests/catalog/product.create.test.ts`

## Out of scope
- Listing, editing and archiving products (CAT-003, CAT-004).
- Removal by an admin (CAT-006).

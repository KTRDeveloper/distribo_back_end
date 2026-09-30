---
id: CAT-004
title: Manager creates a product
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [CAT-001, ORG-005, ACC-002, ACC-007, CAT-003, FND-003]
read_first: [src/modules/organization/organization.routes.ts, src/shared/money.ts]
design_refs: [catalogue/product]
constraints: ['Product:required', C-13]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.2.1]
---

# CAT-004 — Manager creates a product

## Story
As a manager, I want to add an article to my catalog so that customers can order it.

## Context
- Exists: `products` (CAT-001); `loadActor`; `requireAbility('create', 'Product')` (ACC-002, online for MANAGER, always for OWNER); `parseQuantity`; `idempotent()`.
- Adds: `POST /api/v1/organizations/{organizationId}/products` with `{ id, name, unit, price, min_order_quantity?, description?, category? }`; response 201 with the product view `{ id, name, unit, price, price_updated_at, min_order_quantity, description, category, status, created_at }`.
- Limits: `name` 1 to 100, `unit` 1 to 100, `category` up to 100, `description` up to 2000 (Q-027); `price` an integer of at least 1; `min_order_quantity` a decimal string or number greater than 0 with at most 3 decimals. The organization must be ACTIVE.
- `Product:required`: NOT NULL: `organization_id`, `name`, `unit`, `price`, `price_updated_at`, `status`, `created_at`
- `C-13`: `Product.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Create
  When a MANAGER posts name "Riz parfumé — sac 25 kg", unit "sac 25 kg" and price 15000
  Then the response is 201 with status ACTIVE and price_updated_at set
Scenario Outline: AC-2 Limits
  When the body has <field> = <value>
  Then the response is <status>
  Examples:
    | field               | value       | status |
    | name                | empty       | 400    |
    | name                | 101 chars   | 400    |
    | unit                | empty       | 400    |
    | price               | 0           | 400    |
    | price               | 1.5         | 400    |
    | min_order_quantity  | 0           | 400    |
    | min_order_quantity  | 0.0001      | 400    |
    | min_order_quantity  | 2.5         | 201    |
Scenario: AC-3 Roles
  Then a SELLER or DRIVER gets 403 and an OWNER gets 201
Scenario: AC-4 Inactive organization
  When the organization is CLOSED or SUSPENDED
  Then the response is 409 `ORGANIZATION_NOT_ACTIVE`
Scenario: AC-5 Repeat
  When the same body is posted twice
  Then one product exists and both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller creates articles (vertical)
  When a SELLER or DRIVER posts
  Then the response is 403 and nothing is stored
Scenario: AB-2 Server-owned fields (mass assignment)
  When the body contains status, organization_id or price_updated_at
  Then the response is 400
Scenario: AB-3 Another business (horizontal)
  When a member of A posts to business B
  Then the response is 404
```

## Implementation
- Create: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `tests/integration/catalog/create-product.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`, `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `createProduct(actor: Actor, input: CreateProductInput): Promise<ProductView>`
- Types:
  - `CreateProductInput = { id: string; name: string; unit: string; price: number; min_order_quantity?: number | string; description?: string; category?: string }`
- Errors: `VALIDATION_ERROR` 400, `ORGANIZATION_NOT_ACTIVE` 409, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner, decided by the rules table.
- v5.0.0-15.3.3: strict schema; status and organization come from the server.
- v5.0.0-2.2.1: integer price and 3-decimal quantity checks before any database call.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| create | integration | AC-1, Product:required, C-13 | 201, ACTIVE |
| limits | integration | AC-2, C-13 | each Examples row → status |
| roles | integration | AC-3 | 403 and 201 |
| inactive organization | integration | AC-4 | 409 |
| repeat | integration | AC-5 | one row |
| seller | security | AB-1, WSTG-ATHZ-03 | 403 |
| mass assignment | security | AB-2, CWE-915 | 400 |
| other business | security | AB-3, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/catalog/create-product.test.ts`

## Out of scope
- OpenAPI registration of the catalog routes (CAT-006).

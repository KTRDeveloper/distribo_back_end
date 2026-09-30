---
id: CAT-005
title: Manager edits and retires a product
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [CAT-004, CAT-003]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.routes.ts]
design_refs: [catalogue/product]
constraints: [C-13, 'Product.status:enum']
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-8.2.2]
---

# CAT-005 — Manager edits and retires a product

## Story
As a manager, I want to change an article, including its price and its availability, so that my catalog stays right.

## Context
- Exists: `POST .../products` (CAT-004); rule `update` on Product (ACC-002).
- Adds: `PATCH /api/v1/organizations/{organizationId}/products/{productId}` with any of `name, unit, price, min_order_quantity (null clears), description, category, status` (ACTIVE or INACTIVE); response 200 with the product view and `negotiated_prices_to_review` (the number of live negotiated prices of this product whose `set_at` is older than the new `price_updated_at`; 0 when the price did not change).
- INACTIVE removes the article from sale; old orders keep their frozen lines. At least one field is required. Same limits as CAT-004.
- `C-13`: `Product.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `Product.status:enum`: one of ACTIVE, INACTIVE

## Acceptance criteria
```gherkin
Scenario: AC-1 Change fields
  When a MANAGER patches name and category
  Then the response is 200 with the new values and price_updated_at unchanged
Scenario: AC-2 Price change
  When the price goes from 15000 to 16000 and 3 customers have negotiated prices set before now
  Then price_updated_at is now and negotiated_prices_to_review is 3
Scenario: AC-3 Retire and restore
  When the status is set INACTIVE, then ACTIVE
  Then both answers are 200 and the product follows
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status>
  Examples:
    | problem                                   | status |
    | price 0                                   | 400    |
    | no field                                  | 400    |
    | status "DELETED"                          | 400    |
    | organization_id or price_updated_at sent  | 400    |
    | a product of another organization         | 404    |
    | a SELLER or DRIVER caller                 | 403    |
```

## Abuse cases
```gherkin
Scenario: AB-1 Seller changes a price (vertical)
  When a SELLER patches price
  Then the response is 403 and the price is unchanged
Scenario: AB-2 Editing another business's product (horizontal)
  When a member of A patches a product of B under A's path
  Then the response is 404 and B's product is unchanged
```

## Implementation
- Create: `tests/integration/catalog/edit-product.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`
- Pattern: `src/modules/catalog/catalog.routes.ts`
- Signatures:
  - `editProduct(actor: Actor, productId: string, input: EditProductInput): Promise<ProductView & { negotiated_prices_to_review: number }>`
- Errors: `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner.
- v5.0.0-8.2.2: the product is selected by id and organization id together.
- v5.0.0-15.3.3: strict schema.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| change fields | integration | AC-1 | 200, price_updated_at same |
| price change | integration | AC-2, C-13 | date moves, count 3 |
| retire and restore | integration | AC-3, Product.status:enum | statuses follow |
| refusals | integration | AC-4 | each Examples row → status |
| seller price | security | AB-1, WSTG-ATHZ-03 | 403, unchanged |
| other business | security | AB-2, WSTG-ATHZ-04 | 404, unchanged |

Command: `npx vitest run tests/integration/catalog/edit-product.test.ts`

## Out of scope
- Notifying customers of new default prices: they see them at their next order.

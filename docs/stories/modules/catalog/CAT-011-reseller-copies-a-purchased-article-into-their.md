---
id: CAT-011
title: Reseller copies a purchased article into their catalog
module: catalog
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-004, REL-016, ACC-007, CAT-003, CAT-006, REL-006]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/relationship/relationship.repository.ts]
design_refs: [catalogue/product]
constraints: ['Product:required', C-13]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# CAT-011 — Reseller copies a purchased article into their catalog

## Story
As a manager, I want to copy an article I buy into my own catalog so that I can resell it at my price.

## Context
- Exists: `POST .../products` (CAT-004); customer-side relationships (REL-016, REL-018).
- Adds: `POST /api/v1/organizations/{organizationId}/products/copy` with `{ id, source_product_id, price }` (MANAGER online or OWNER); response 201 product view.
- The source product must be ACTIVE and belong to a supplier organization for which the caller's organization is `customer_organization_id` in a live relationship (else 404). The copy takes `name`, `unit`, `description` and `category`, sets the caller's `price`, and keeps no link to the source. `min_order_quantity` is not copied.
- `Product:required`: NOT NULL: `organization_id`, `name`, `unit`, `price`, `price_updated_at`, `status`, `created_at`
- `C-13`: `Product.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Copy
  Given the organization buys from a supplier whose article has name "Pack 24", unit "carton de 24"
  When a MANAGER copies it with price 9000
  Then a new ACTIVE product of the caller's organization has those texts and price 9000
Scenario: AC-2 No link kept
  Then the copy has no reference to the source, and renaming the source does not change it
Scenario Outline: AC-3 Refusals
  When the source is <case>
  Then the response is 404 `NOT_FOUND`
  Examples:
    | case                                                  |
    | an INACTIVE product                                   |
    | a product of a supplier the organization does not buy from |
    | a product of the caller's own organization            |
Scenario: AC-4 Validation and roles
  Then price 0 answers 400 and a SELLER answers 403
```

## Abuse cases
```gherkin
Scenario: AB-1 Copying a competitor's catalog (information disclosure)
  When a business copies an article of a supplier it has no relationship with
  Then the response is 404 and nothing is created
```

## Implementation
- Create: `tests/integration/catalog/copy-product.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/catalog/catalog.routes.ts`
- Signatures:
  - `copyProduct(actor: Actor, input: { id: string; source_product_id: string; price: number }): Promise<ProductView>`
- Errors: `NOT_FOUND` 404, `FORBIDDEN` 403, `VALIDATION_ERROR` 400
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: the source is reachable only through a live relationship as customer.
- v5.0.0-15.3.3: strict schema with three fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| copy | integration | AC-1, C-13, Product:required | new product with the texts and price |
| no link | integration | AC-2 | independent after source rename |
| refusals | integration | AC-3 | each Examples row → 404 |
| validation and roles | integration | AC-4 | 400, 403 |
| competitor | security | AB-1, WSTG-ATHZ-04, CWE-200 | 404, nothing created |

Command: `npx vitest run tests/integration/catalog/copy-product.test.ts`

## Out of scope
- Any link between the copy and the source (none is kept by design).

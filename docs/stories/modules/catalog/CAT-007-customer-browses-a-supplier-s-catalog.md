---
id: CAT-007
title: Customer browses a supplier's catalog
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [CAT-003, CAT-006, REL-005]
read_first: [src/modules/catalog/catalog.repository.ts, src/modules/relationship/relationship.visibility.ts]
design_refs: [catalogue/product, relations-commerciales/customerprice]
constraints: [CM-11]
asvs: [v5.0.0-8.2.2, v5.0.0-8.2.3, v5.0.0-15.3.1]
---

# CAT-007 — Customer browses a supplier's catalog

## Story
As a customer, I want to see a business's articles with my own prices so that I order at the right price.

## Context
- Exists: `getReferencePrice`, products, `visibleRelationsWhere`.
- Adds: `GET /api/v1/organizations/{organizationId}/catalog?limit&cursor&as_organization_id` for any signed-in person. It lists ACTIVE, not deleted products of an ACTIVE organization: `{ id, name, unit, price, min_order_quantity, description, category, price_is_negotiated }`.
- `price` is the caller's negotiated price when the caller's own live relationship with this supplier has one, else the product price. With `as_organization_id`, the customer is that organization: the caller must be its MANAGER or OWNER (else 404), and the organization's own relationship decides.
- A CLOSED or SUSPENDED organization, or an unknown id, answers 404. Nothing reveals other customers' prices, the supplier's own suppliers or inactive articles.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the product price), else the product price.

## Acceptance criteria
```gherkin
Scenario: AC-1 Default prices
  When a person with no relationship browses a business
  Then ACTIVE articles are listed with the product price and price_is_negotiated false
Scenario: AC-2 Own negotiated price
  Given the caller has a negotiated price of 2800 on an article priced 3000
  Then that article shows 2800 and price_is_negotiated true, others show product prices
Scenario: AC-3 On behalf of an organization
  When a MANAGER browses with as_organization_id of their business
  Then the organization's negotiated prices apply
Scenario Outline: AC-4 Not found
  When the request is for <case>
  Then the response is 404 `NOT_FOUND`
  Examples:
    | case                                                       |
    | a CLOSED or SUSPENDED organization                         |
    | an unknown organization                                    |
    | as_organization_id of an organization the caller does not manage |
Scenario: AC-5 Inactive and deleted articles
  Then INACTIVE and deleted products never appear
```

## Abuse cases
```gherkin
Scenario: AB-1 Another customer's negotiated price (information disclosure)
  When customers A and B have different negotiated prices for one article
  Then each sees only their own and never the other's
Scenario: AB-2 Asking as another business (elevation)
  When a SELLER passes as_organization_id of their business
  Then the response is 404 because only a MANAGER or OWNER may act as customer
```

## Implementation
- Create: `tests/integration/catalog/customer-catalog.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/catalog/catalog.routes.ts`
- Signatures:
  - `browseCatalog(personId: string, organizationId: string, query: BrowseQuery): Promise<{ items: CatalogItemView[]; next_cursor: string | null }>`
- Types:
  - `CatalogItemView = { id: string; name: string; unit: string; price: number; min_order_quantity: string | null; description: string | null; category: string | null; price_is_negotiated: boolean }`
- Errors: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.2: negotiated prices are joined on the caller's own relationship id only.
- v5.0.0-8.2.3: field list excludes supplier-side data.
- v5.0.0-15.3.1: minimal fields.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| default prices | integration | AC-1 | product prices, flag false |
| own price | integration | AC-2, CM-11 | 2800 and flag true |
| on behalf | integration | AC-3 | organization prices |
| not found | integration | AC-4 | each Examples row → 404 |
| inactive | integration | AC-5 | absent |
| other customer's price | security | AB-1, WSTG-ATHZ-02, CWE-200 | each sees own only |
| wrong role | security | AB-2, WSTG-ATHZ-03 | 404 |

Command: `npx vitest run tests/integration/catalog/customer-catalog.test.ts`

## Out of scope
- Placing an order (ORD module).

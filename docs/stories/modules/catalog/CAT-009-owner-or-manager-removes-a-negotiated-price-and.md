---
id: CAT-009
title: Owner or manager removes a negotiated price and reads them
module: catalog
kind: feature
rev: 1
amends: []
size: M
risk: medium
depends_on: [CAT-008, FND-009, CAT-003]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.routes.ts]
design_refs: [relations-commerciales/customerprice]
constraints: [C-11]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.1]
---

# CAT-009 — Owner or manager removes a negotiated price and reads them

## Story
As a manager, I want to list a customer's negotiated prices, flagged when the article price changed since, and remove one so that old deals do not eat my margin.

## Context
- Exists: `PUT .../prices/{productId}` (CAT-008).
- Adds: `GET /api/v1/organizations/{organizationId}/customers/{relationshipId}/prices` (SELLER and above; paginated; `{ product_id, product_name, price, product_price, set_by_id, set_at, to_review }`, where `to_review` is true when the product's `price_updated_at` is later than `set_at`); `DELETE .../prices/{productId}` (204, sets `deleted_at`, MANAGER online or OWNER, same own-record rule; a registered customer gets `price.negotiated_changed`).
- A missing live price answers 404.
- `C-11`: `CustomerPrice` is unique per (relationship, product) among rows not deleted; the product belongs to the supplier of the relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 List with review flag
  Given a price set at 8h and the product price changed at 9h
  When a SELLER lists the customer's prices
  Then the item has to_review true and product_price and price
Scenario: AC-2 Remove
  When a MANAGER deletes a live price
  Then the response is 204, the price is deleted, and the customer's reference price is the product price again
Scenario: AC-3 Set again after removal
  When the price is set again
  Then a new live row is created
Scenario Outline: AC-4 Refusals
  When the delete has <problem>
  Then the response is <status>
  Examples:
    | problem                                   | status         |
    | no live price for that product            | 404 NOT_FOUND  |
    | a SELLER caller                           | 403 FORBIDDEN  |
    | a manager on their own record             | 403 OWN_RECORD |
```

## Abuse cases
```gherkin
Scenario: AB-1 Another business's prices (horizontal)
  When a member of A lists or deletes prices under a relationship of B
  Then the response is 404 and nothing changes
```

## Implementation
- Create: `tests/integration/catalog/list-remove-prices.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/catalog/catalog.routes.ts`
- Signatures:
  - `listCustomerPrices(actor: Actor, relationshipId: string, query: { limit: number; cursor?: string }): Promise<{ items: CustomerPriceListItem[]; next_cursor: string | null }>`
  - `removeCustomerPrice(actor: Actor, relationshipId: string, productId: string): Promise<void>`
- Errors: `NOT_FOUND` 404, `FORBIDDEN` 403, `OWN_RECORD` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: deletion needs manager online or owner.
- v5.0.0-8.2.2: relationship selected through the actor's organization.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list and flag | integration | AC-1 | to_review true |
| remove | integration | AC-2, C-11 | deleted; reference price back to product price |
| set again | integration | AC-3 | new live row |
| refusals | integration | AC-4 | each Examples row → status |
| other business | security | AB-1, WSTG-ATHZ-04 | 404 |

Command: `npx vitest run tests/integration/catalog/list-remove-prices.test.ts`

## Out of scope
- Copying prices (CAT-010).

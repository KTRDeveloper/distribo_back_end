---
id: CAT-030
title: Negotiated prices are listed and removed by variant
module: catalog
kind: change
rev: 1
amends: [CAT-009]
size: S
risk: low
depends_on: [CAT-009, CAT-029]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, relations-commerciales/customerprice]
constraints: [C-11]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2]
---

# CAT-030 — Negotiated prices are listed and removed by variant

## Story
As a manager, I want to see and remove the negotiated prices of a customer per size of an article so that I know which ones to review.

## Context
- Exists: `GET .../customers/{relationshipId}/prices` and `DELETE .../prices/{productId}` (CAT-009); the variant-based price (CAT-029).
- Change: a list item is `{ product_variant_id, label, price, variant_price, set_by_id, set_at, to_review }`: `label` from `variantLabel`, `variant_price` the variant's current price, `to_review` true when the variant's `price_updated_at` is later than `set_at`. Same pagination, roles (SELLER and above) and scope as before.
- `DELETE .../prices/{variantId}` answers 204 and sets `deleted_at` on the live price of that variant; none answers 404. A registered customer gets `price.negotiated_changed` naming the label. Roles, own-record rule and relationship checks are unchanged.
- `catalog.openapi.ts` documents the renamed parameter and the new item.
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.

## Acceptance criteria
```gherkin
Scenario: AC-1 List
  Given prices on two variants of one product, one set before the variant's last price change
  When a SELLER lists
  Then both items carry their label and `variant_price`, and only the older one has `to_review` true
Scenario: AC-2 Remove
  When a MANAGER deletes the price of the first variant
  Then the answer is 204, the list shows only the second, and a second delete answers 404
Scenario Outline: AC-3 Refusals
  When <case>
  Then the answer is <status>
  Examples:
    | case                                     | status         |
    | a DRIVER lists                           | 403 FORBIDDEN  |
    | a SELLER deletes                         | 403 FORBIDDEN  |
    | the caller is the customer person        | 403 OWN_RECORD |
    | the relationship is another business's   | 404 NOT_FOUND  |
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading another supplier's prices (horizontal)
  When a member of A lists the prices of a relationship of B
  Then the answer is 404 and nothing is returned
```

## Implementation
- Create: `tests/integration/catalog/variant-price-list.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `listCustomerPrices(actor: Actor, relationshipId: string, query: ListCustomerPricesQuery): Promise<CustomerPricePage>`
  - `removeCustomerPrice(actor: Actor, relationshipId: string, variantId: string): Promise<void>`
- Types:
  - `CustomerPriceListItem = { product_variant_id: string; label: string; price: number; variant_price: number; set_by_id: string; set_at: string; to_review: boolean }`
- Errors: `FORBIDDEN` 403, `OWN_RECORD` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: reading needs SELLER; removing needs MANAGER online or OWNER.
- v5.0.0-8.2.2: the relationship is selected through the organization's visible relations.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| list | integration | AC-1, C-11 | labels, to_review |
| remove | integration | AC-2 | 204 then 404 |
| refusals | integration | AC-3 | each Examples row → status |
| other business | security | AB-1, WSTG-ATHZ-04 | 404, nothing returned |

Command: `npx vitest run tests/integration/catalog/variant-price-list.test.ts tests/integration/catalog/list-remove-prices.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/list-remove-prices.test.ts | items carry `product_id`, `product_name` and `product_price`, and the delete path takes a product id | expect `product_variant_id`, `label` and `variant_price`, and a variant id in the path |

## Out of scope
- Setting and copying prices: CAT-029.

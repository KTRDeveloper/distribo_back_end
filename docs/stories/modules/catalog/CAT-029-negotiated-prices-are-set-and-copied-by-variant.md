---
id: CAT-029
title: Negotiated prices are set and copied by variant
module: catalog
kind: change
rev: 1
amends: [CAT-008, CAT-010]
size: M
risk: medium
depends_on: [CAT-008, CAT-010, CAT-015, CAT-022]
read_first: [src/modules/catalog/catalog.service.ts, src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, relations-commerciales/customerprice]
constraints: [C-11, C-04]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.2, v5.0.0-15.3.3]
---

# CAT-029 — Negotiated prices are set and copied by variant

## Story
As a manager, I want to set and copy a customer's price for one size of an article so that each size has its own negotiated price.

## Context
- Exists: `PUT .../customers/{relationshipId}/prices/{productId}` with `{ id, price }` (CAT-008) and `POST .../prices/copy` (CAT-010); `customer_prices.product_variant_id` and the unique index per variant (CAT-015); `upsertCustomerPrice`, `findSupplierRelationshipForPrice`.
- Change: the path ends with `{variantId}` and the answer is `{ product_variant_id, price, set_by_id, set_at }`. The variant must belong to the organization, not be deleted, any status (else 404). The row is written with `product_variant_id` and, because the old column is still required, `product_id` of the variant's product.
- `upsertCustomerPrice` takes the variant: it replaces the live price of the pair, else creates one (the last writer wins). The notification `price.negotiated_changed` names the variant `label`.
- Copy: each live source price is copied by `product_variant_id` onto the target, with the same two columns; the answer stays `{ copied }`. The own-record rule, relationship checks and roles are unchanged.
- `catalog.openapi.ts` documents the renamed parameter and answer.
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.

## Acceptance criteria
```gherkin
Scenario: AC-1 Set for a variant
  Given a product with two variants and a customer relationship
  When a MANAGER puts 2800 on the first variant
  Then the answer is 200 with `product_variant_id`, and the second variant has no negotiated price
Scenario: AC-2 Replace
  When 2700 is put on the same variant again
  Then one live price exists and it is 2700
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the answer is <status>
  Examples:
    | problem                                              | status               |
    | price 0                                              | 400 VALIDATION_ERROR |
    | a variant of another business, or a deleted one      | 404 NOT_FOUND        |
    | the caller is the customer person                    | 403 OWN_RECORD       |
    | a SELLER or DRIVER caller                            | 403 FORBIDDEN        |
Scenario: AC-4 Copy
  Given a source relationship with prices on two variants
  When they are copied to a target that already has a price on one of them
  Then the target has both prices, the existing one replaced, and the answer is `{ copied: 2 }`
```

## Abuse cases
```gherkin
Scenario: AB-1 A price for a variant of another supplier (tampering)
  When a manager of A puts a price on a variant id of business B
  Then the answer is 404 and no price row is written
Scenario: AB-2 A manager prices themselves (elevation)
  When a manager sets a price on their own customer record
  Then the answer is 403 `OWN_RECORD`
```

## Implementation
- Create: `tests/integration/catalog/variant-prices.test.ts`
- Modify: `src/modules/catalog/catalog.routes.ts`, `src/modules/catalog/catalog.schemas.ts`, `src/modules/catalog/catalog.service.ts`, `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.openapi.ts`
- Pattern: `src/modules/admin/report.routes.ts`
- Signatures:
  - `setCustomerPrice(actor: Actor, relationshipId: string, variantId: string, input: SetCustomerPriceInput): Promise<CustomerPriceView>`
  - `upsertCustomerPrice(tx: Prisma.TransactionClient, input: { id: string; relationshipId: string; variantId: string; productId: string; price: number; setById: string; now: Date }): Promise<void>`
- Types:
  - `CustomerPriceView = { product_variant_id: string; price: number; set_by_id: string; set_at: string }`
- Errors: `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `OWN_RECORD` 403, `NOT_FOUND` 404
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: manager online or owner; the rules table decides.
- v5.0.0-8.2.2: the variant is selected by id and the supplier's organization id together.
- v5.0.0-15.3.3: strict schema; the author and the date come from the server.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| set | integration | AC-1, C-11 | price on one variant only |
| replace | integration | AC-2, C-11 | one live row |
| refusals | integration | AC-3, C-04 | each Examples row → status |
| copy | integration | AC-4, C-11 | two prices, one replaced |
| other supplier | security | AB-1, WSTG-ATHZ-04 | 404, no row |
| own record | security | AB-2, CWE-269 | 403 |

Command: `npx vitest run tests/integration/catalog/variant-prices.test.ts tests/integration/catalog/set-customer-price.test.ts tests/integration/catalog/copy-prices.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/set-customer-price.test.ts | the path and the answer use `product_id` | use the variant id in the path and expect `product_variant_id`; the other cases keep their meaning |
| tests/integration/catalog/copy-prices.test.ts | rows are read and compared through `product_id` | compare through `product_variant_id`; the counts and refusals keep their meaning |

## Out of scope
- Listing and removing prices: CAT-030.

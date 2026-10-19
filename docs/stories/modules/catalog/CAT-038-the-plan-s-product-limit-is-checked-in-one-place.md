---
id: CAT-038
title: The plan's product limit is checked in one place
module: catalog
kind: technical
rev: 1
amends: []
size: S
risk: medium
depends_on: [CAT-014, ORG-045]
read_first: [src/modules/catalog/catalog.repository.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: [C-46]
asvs: [v5.0.0-2.3.2, v5.0.0-8.2.2]
---

# CAT-038 — The plan's product limit is checked in one place

## Story
Technical story: give the catalog one function that refuses a new product on sale when the plan's product limit is reached, so that every online route applies the same count.

## Context
- Exists: `Product.paused_at` and the variant status (CAT-012, CAT-014); `readPlanFields` (ORG-045) with `max_products`, empty for no limit.
- New in `catalog.repository.ts`: `countProductsOnSale(tx, organizationId)` counts the products that are not deleted, not paused and have a variant that is ACTIVE and not deleted (C-46). New in `catalog.service.ts`: `assertRoomForProduct(tx, organizationId)` reads the plan and throws `httpError(409, 'PRODUCT_LIMIT_REACHED', ...)` when `max_products` is set and the count has reached it.
- It is asked by the online routes that add a product to the sale: create, add a variant, put back on sale, copy. What arrives by synchronization is never refused here: it is paused afterwards.
- First usage: CAT-022.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Count
  Given a business with <products>
  When `countProductsOnSale` runs
  Then it answers <count>
  Examples:
    | products                                                                  | count |
    | two products with an ACTIVE variant, one deleted, one paused               | 2     |
    | a product whose variants are all INACTIVE or deleted                       | 0     |
    | a product of another business with an ACTIVE variant                       | 0     |
Scenario Outline: AC-2 Limit
  Given a plan with <limit> and 30 products on sale
  When `assertRoomForProduct` runs
  Then <result>
  Examples:
    | limit | result                                     |
    | 30    | it throws 409 `PRODUCT_LIMIT_REACHED`      |
    | 31    | it returns                                 |
    | none  | it returns                                 |
```

## Abuse cases
```gherkin
Scenario: AB-1 A product counted for another business (broken access control)
  When business A asks for its count while business B has 40 products on sale
  Then the count only holds A's products
```

## Implementation
- Create: `tests/integration/catalog/product-limit.test.ts`
- Modify: `src/modules/catalog/catalog.repository.ts`, `src/modules/catalog/catalog.service.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `countProductsOnSale(tx: Prisma.TransactionClient, organizationId: string): Promise<number>`
  - `assertRoomForProduct(tx: Prisma.TransactionClient, organizationId: string): Promise<void>`
- Errors: `PRODUCT_LIMIT_REACHED` 409
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.3.2: the limit is the one of the plan, read from the server, never from the request.
- v5.0.0-8.2.2: the count is bound to the organization id.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| count | integration | AC-1, C-46 | each Examples row → count |
| limit | integration | AC-2, C-46 | each Examples row → thrown or not |
| other business | security | AB-1, CWE-639 | A's count excludes B |

Command: `npx vitest run tests/integration/catalog/product-limit.test.ts`

## Out of scope
- Pausing the excess that arrives by synchronization: the billing and synchronization stories.

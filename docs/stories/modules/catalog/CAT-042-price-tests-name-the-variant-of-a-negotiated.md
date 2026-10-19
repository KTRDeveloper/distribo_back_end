---
id: CAT-042
title: Price tests name the variant of a negotiated price
module: catalog
kind: technical
rev: 1
amends: []
size: M
risk: low
depends_on: [CAT-040, CAT-029, CAT-030, CAT-039]
read_first: [tests/helpers/catalog-fixtures.ts, tests/integration/catalog/set-customer-price.test.ts]
design_refs: [relations-commerciales/customerprice, catalogue/productvariant]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# CAT-042 — Price tests name the variant of a negotiated price

## Story
Technical story: the tests that seed negotiated prices name a variant and no product, so that `customer_prices.product_id` can go without breaking them.

## Context
- Exists: `customer_prices.product_variant_id` (CAT-015) and `seedProduct` (CAT-040), which gives each product a variant with the same id. Eleven test files still insert prices with `product_id`, or read rows through it; CAT-043 drops that column.
- Each of these files inserts its prices with `product_variant_id`, set to the id it used for the product (the variant has the same id), and no longer passes `product_id`. Reads and comparisons of price rows use `product_variant_id`.
- Nothing else changes: the assertions, the ids and the order of the tests stay.

## Acceptance criteria
```gherkin
Scenario: AC-1 No test uses the product column
  When the eleven files below are read
  Then none inserts into `customer_prices` with `product_id` or reads a price row through it
Scenario: AC-2 Same behavior
  When the eleven files run
  Then they pass and assert what they asserted before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/catalog/price-seeds.test.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: the fixtures hold fake data only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no product column | unit | AC-1 | the eleven sources contain no price insert with product_id |
| same behavior | integration | AC-2 | the eleven files pass |

Command: `npx vitest run tests/unit/catalog/price-seeds.test.ts tests/integration/catalog tests/integration/order tests/integration/sync`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/catalog/copy-prices.test.ts | inserts and compares prices through `product_id` | uses `product_variant_id` |
| tests/integration/catalog/customer-catalog.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/catalog/edit-product.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/catalog/list-remove-prices.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/catalog/reference-price.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/catalog/set-customer-price.test.ts | reads and inserts prices with `product_id` | uses `product_variant_id` |
| tests/integration/order/enter-order.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/order/place-order.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/order/place-purchase.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/sync/pull-relationships.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |
| tests/integration/sync/rights-change.test.ts | inserts prices with `product_id` | inserts them with `product_variant_id` |

## Out of scope
- Dropping the column: CAT-043.

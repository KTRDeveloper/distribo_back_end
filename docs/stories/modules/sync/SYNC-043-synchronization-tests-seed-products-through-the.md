---
id: SYNC-043
title: Synchronization tests seed products through the catalog helper
module: sync
kind: technical
rev: 1
amends: []
size: M
risk: low
depends_on: [CAT-040, SYNC-029, SYNC-035]
read_first: [tests/helpers/catalog-fixtures.ts, tests/integration/sync/pull-catalog.test.ts]
design_refs: [catalogue/product, catalogue/productvariant]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# SYNC-043 — Synchronization tests seed products through the catalog helper

## Story
Technical story: the synchronization tests create their products with `seedProduct`, so that the old columns of `products` can go without breaking them.

## Context
- Exists: `seedProduct(client, input)` (CAT-040), which creates a product new-style and one variant with the same id. These twelve files still insert products with `unit`, `price`, `status` and `min_order_quantity`, which CAT-041 drops.
- Every product they create is created with `seedProduct`, passing the same id, name, unit, price and status as today. The variant has the product's id, so lines and prices that hold that id keep working.
- An update of `price` or `status` that targets `products` becomes an update of the variant of the same id; `deleted_at` and `server_updated_at` stay on the product.
- The sync tests keep their assertions, their ids and their order.

## Acceptance criteria
```gherkin
Scenario: AC-1 No test inserts the old columns
  When the twelve files below are read
  Then none inserts into `products` with a `unit` or a `price`, and none updates `price` or `status` on `products`
Scenario: AC-2 Same behavior
  When the twelve files run
  Then they pass and assert what they asserted before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/sync/seed-products.test.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: the fixtures hold fake data only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no old columns | unit | AC-1 | the twelve sources contain no insert of unit or price into products |
| same behavior | integration | AC-2 | the twelve files pass |

Command: `npx vitest run tests/unit/sync/seed-products.test.ts tests/integration/sync`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/controls-credit.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/controls-prices.test.ts | inserts a product and updates its price on `products` | seeds with `seedProduct`; the price is updated on the variant |
| tests/integration/sync/exceptions.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/forbidden-sends.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/judge.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/pull-catalog.test.ts | inserts products and updates price and status on `products` | seeds with `seedProduct`; price and status are updated on the variant, deletion stays on the product |
| tests/integration/sync/pull-orders.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/pull-relationships.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/push-closing.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/push-orders.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/replay.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/sync/rights-change.test.ts | inserts products with unit and price | inserts them with `seedProduct` |

## Out of scope
- Dropping the columns: CAT-041. Order and delivery tests: ORD-031, DLV-016.

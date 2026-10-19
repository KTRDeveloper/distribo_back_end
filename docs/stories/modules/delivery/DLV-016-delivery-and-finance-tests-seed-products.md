---
id: DLV-016
title: Delivery and finance tests seed products through the catalog helper
module: delivery
kind: technical
rev: 1
amends: []
size: S
risk: low
depends_on: [CAT-040, DLV-014]
read_first: [tests/helpers/catalog-fixtures.ts, tests/integration/delivery/counter-sale.test.ts]
design_refs: [catalogue/product, commandes-et-livraisons/orderline]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# DLV-016 — Delivery and finance tests seed products through the catalog helper

## Story
Technical story: the delivery and finance tests create their products with `seedProduct`, so that the old columns of `products` can go without breaking them.

## Context
- Exists: `seedProduct(client, input)` (CAT-040), which creates a product new-style and one variant with the same id. These tests still insert products with `unit`, `price`, `status` and `min_order_quantity`, which CAT-041 drops.
- Every product the ten files below create is created with `seedProduct`, passing the same id, name, unit, price and status as today. The variant has the product's id, so lines that hold that id keep working.
- Nothing else changes: the assertions, the ids and the order of the tests stay.

## Acceptance criteria
```gherkin
Scenario: AC-1 No test inserts the old columns
  When the ten files below are read
  Then none inserts into `products` with a `unit` or a `price`
Scenario: AC-2 Same behavior
  When the ten files run
  Then they pass and assert what they asserted before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/delivery/seed-products.test.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: the fixtures hold fake data only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no old columns | unit | AC-1 | the ten sources contain no insert of unit or price into products |
| same behavior | integration | AC-2 | the ten files pass |

Command: `npx vitest run tests/unit/delivery/seed-products.test.ts tests/integration/delivery tests/integration/finance/money-exceptions.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/abandoned-rests.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/delivery/assign.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/delivery/counter-sale.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/delivery/deliver.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/delivery/depart.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/delivery/driver-lists.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/delivery/fail.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/delivery/partial-delivery.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/delivery/unstarted-cleanup.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/finance/money-exceptions.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |

## Out of scope
- Dropping the columns: CAT-041.

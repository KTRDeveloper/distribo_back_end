---
id: ORD-031
title: Order tests seed products through the catalog helper
module: order
kind: technical
rev: 1
amends: []
size: M
risk: low
depends_on: [CAT-040, ORD-028]
read_first: [tests/helpers/catalog-fixtures.ts, tests/integration/order/line-rules.test.ts]
design_refs: [catalogue/product, commandes-et-livraisons/orderline]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# ORD-031 — Order tests seed products through the catalog helper

## Story
Technical story: the order tests create their products with `seedProduct`, so that the old columns of `products` can go without breaking them.

## Context
- Exists: `seedProduct(client, input)` (CAT-040), which creates a product new-style and one variant with the same id. The order tests still insert products with `unit`, `price`, `status` and `min_order_quantity`, which CAT-041 drops.
- Every product these fifteen files create is created with `seedProduct`, passing the same id, name, unit, price, minimum and status as today. The variant has the product's id, so order lines that hold that id keep working.
- An update of `status`, `min_order_quantity` or `deleted_at` that targets `products` in `line-rules.test.ts` becomes an update of the variant of the same id (`status`, `min_order_quantity`), or stays on the product (`deleted_at`). The same for `place-order.test.ts` and `place-purchase.test.ts`, which raise `minOrderQuantity`.
- Nothing else changes in these fifteen files: assertions, ids and test order stay.

## Acceptance criteria
```gherkin
Scenario: AC-1 No test inserts the old columns
  When the fifteen files below are read
  Then none inserts into `products` with a `unit` or a `price`, and none updates `status`, `price` or `min_order_quantity` on `products`
Scenario: AC-2 Same behavior
  When the fifteen files run
  Then they pass and assert what they asserted before
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/unit/order/seed-products.test.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: the fixtures hold fake data only.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no old columns | unit | AC-1 | the fifteen sources contain no insert of unit or price into products |
| same behavior | integration | AC-2 | the fifteen files pass |

Command: `npx vitest run tests/unit/order/seed-products.test.ts tests/integration/order`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/order/accept-order.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/cancel-order-customer.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/order/cancel-order-supplier.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/order/customer-orders.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/edit-order.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/enter-order.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/get-order.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/line-rules.test.ts | inserts products and updates their status, minimum and deletion on `products` | seeds with `seedProduct`; status and minimum are updated on the variant |
| tests/integration/order/list-orders.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/order-line-table.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/order/order-note.test.ts | inserts products with unit and price | inserts them with `seedProduct` |
| tests/integration/order/place-order.test.ts | inserts products and raises the minimum on `products` | seeds with `seedProduct`; the minimum is raised on the variant |
| tests/integration/order/place-purchase.test.ts | inserts products and raises the minimum on `products` | seeds with `seedProduct`; the minimum is raised on the variant |
| tests/integration/order/refuse-order.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |
| tests/integration/order/total-check.test.ts | inserts a product with unit and price | inserts it with `seedProduct` |

## Out of scope
- Dropping the columns: CAT-041. Delivery and synchronization tests: DLV-016, SYNC-043.

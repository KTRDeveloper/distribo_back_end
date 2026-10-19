---
id: ORD-033
title: Orders, rests and synced lines are saved without a product
module: order
kind: change
rev: 1
amends: [ORD-027, DLV-014, SYNC-029]
size: M
risk: medium
depends_on: [ORD-032, ORD-028, DLV-014, SYNC-029]
read_first: [src/modules/order/order.repository.ts, tests/integration/order/order-line-table.test.ts]
design_refs: [commandes-et-livraisons/orderline]
constraints: []
asvs: [v5.0.0-2.2.1]
---

# ORD-033 — Orders, rests and synced lines are saved without a product

## Story
Technical story: save order lines with their variant only, so that the product column of a line can be dropped.

## Context
- Exists: `product_id` of a line is optional (ORD-032). The code still writes it next to `product_variant_id`: `NewOrderLine.productId` (`order.repository.ts`, filled by `priceLine` in `order.service.ts`), `RestLine.productId` (`delivery.repository.ts`, copied in `delivery.service.ts`), and the line built by `createLine` in `adapters/order.push.ts`.
- Remove `productId` from `NewOrderLine`, `RestLine` and what builds them; the line is saved with its variant, and `product_id` stays empty.
- `no-line-product-id.test.ts` reads `src/` and `tests/` and lists the paths that insert into `order_lines` with `product_id`, or create an order line with `productId`.
- The tests listed by the scan insert their lines with `product_variant_id` (the variant has the product's id) and no `product_id`.

## Acceptance criteria
```gherkin
Scenario: AC-1 Placed and entered orders
  When an order is placed and another is entered with two lines each
  Then every saved line has its `product_variant_id` and an empty `product_id`
Scenario: AC-2 The rest of a delivery
  When a delivery leaves a rest for later
  Then the new lines have the variant of the short lines and an empty `product_id`
Scenario: AC-3 A line sent by a phone
  When a phone sends an order with one line
  Then the saved line has its variant and an empty `product_id`
Scenario: AC-4 No file writes the product of a line
  When the scan test reads `src/` and `tests/`
  Then it lists no path
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/order/line-without-product.test.ts`, `tests/unit/order/no-line-product-id.test.ts`
- Modify: `src/modules/order/order.repository.ts`, `src/modules/order/order.service.ts`, `src/modules/delivery/delivery.repository.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/sync/adapters/order.push.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Types:
  - `NewOrderLine = { id: string; productVariantId: string; labelApplied: string; quantity: string; referencePrice: bigint; unitPriceApplied: bigint; amount: bigint }`
  - `RestLine = { productVariantId: string; labelApplied: string; quantity: string; referencePrice: bigint; unitPriceApplied: bigint; amount: bigint; priceSetById: string | null; priceSetAt: Date | null }`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: the variant, checked by the database against the supplier, is the only reference a line keeps.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| placed and entered | integration | AC-1 | two orders → lines with variant, no product |
| rest | integration | AC-2 | partial delivery → rest lines without product |
| synced | integration | AC-3 | pushed order → line without product |
| scan | unit | AC-4 | read the sources → no path listed |

Command: `npx vitest run tests/integration/order/line-without-product.test.ts tests/unit/order/no-line-product-id.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| every file under `tests/` that the scan lists | inserts order lines with `product_id`, or creates them with `productId` | inserts them with `product_variant_id` and no `product_id` |

## Out of scope
- Dropping the column and its trigger: ORD-034.

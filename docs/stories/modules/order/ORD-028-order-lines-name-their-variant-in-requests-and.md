---
id: ORD-028
title: Order lines name their variant in requests and answers
module: order
kind: change
rev: 1
amends: [ORD-009, ORD-010, ORD-013, ORD-014, ORD-019, ORD-020, ORD-021]
size: S
risk: medium
depends_on: [ORD-027]
read_first: [src/modules/order/order.schemas.ts, src/modules/order/order.views.ts]
design_refs: [commandes-et-livraisons/orderline]
constraints: [C-20]
asvs: [v5.0.0-15.3.3, v5.0.0-15.3.1]
---

# ORD-028 — Order lines name their variant in requests and answers

## Story
As a seller, I want an order line to say which variant was sold so that my quantities are counted by variant and my customers see the exact item.

## Context
- Exists: both line schemas in `order.schemas.ts` take `product_id`; `OrderLineView` and the documents say `product_id` (ORD-027 already reads it as a variant id).
- Change: the two line schemas (place and enter/edit) take `product_variant_id` instead; they stay strict, so `product_id` answers 400. The line views in `order.views.ts` return `product_variant_id` from `line.productVariantId`, and `order.openapi.ts` documents the new name in requests and answers.
- A clean cut: no alias, the old name is refused.
- `ORD-027` already reads the id as a variant's; the counter sale reuses the seller's line schema, so it changes with it.
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; `label_applied` is composed by the shared label function; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward.
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; `label_applied` is composed by the shared label function; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward; `price_set_by_id` and `price_set_at` are set if and only if `unit_price_applied` differs from `reference_price`.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Requests use the new name
  When <gesture> sends lines with `product_variant_id`
  Then it succeeds, and the answer's lines carry `product_variant_id` and no `product_id`
  Examples:
    | gesture                     |
    | a customer places an order  |
    | a manager orders from a supplier |
    | a seller enters an order    |
    | a seller edits an order     |
    | a seller sells at the counter |
Scenario: AC-2 Reads show the variant
  When both parties list and open an order
  Then each line carries `product_variant_id`
Scenario: AC-3 The old name is gone
  When a line sends `product_id`
  Then the answer is 400 VALIDATION_ERROR
  And GET /api/v1/docs/openapi.json lists `product_variant_id` for the lines and no `product_id`
```

## Abuse cases
```gherkin
Scenario: AB-1 A line carries fields the server fixes (mass assignment)
  When a line carries `product_id`, `label_applied`, `reference_price` or `amount`
  Then the answer is 400 VALIDATION_ERROR and no order is stored
```

## Implementation
- Create: `tests/integration/order/line-variant-field.test.ts`
- Modify: `src/modules/order/order.schemas.ts`, `src/modules/order/order.views.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Types:
  - `OrderLineView.product_variant_id: string replaces product_id`
- Errors: `400` VALIDATION_ERROR for the old field name or any unknown field
- Dependencies: `zod`, `@asteasolutions/zod-to-openapi`

## Security
- v5.0.0-15.3.3: a line accepts an id, a variant id, a quantity and, for a seller, a price; every other field is refused.
- v5.0.0-15.3.1: the line view lists its fields one by one.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| requests | integration | AC-1, C-20 | each Examples row → success, new field in the answer |
| reads | integration | AC-2 | list and open as both parties → product_variant_id |
| old name | integration | AC-3 | product_id → 400; openapi.json names product_variant_id |
| extra fields | security | AB-1, CWE-915 | the four fields → 400, nothing stored |

Command: `npx vitest run tests/integration/order tests/integration/delivery/counter-sale.test.ts tests/integration/api-docs`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/order/place-order.test.ts | the lines send product_id | send product_variant_id with the same ids |
| tests/integration/order/place-purchase.test.ts | the lines send product_id | send product_variant_id with the same ids |
| tests/integration/order/enter-order.test.ts | the lines send product_id | send product_variant_id with the same ids |
| tests/integration/order/edit-order.test.ts | the lines send product_id | send product_variant_id with the same ids |
| tests/integration/delivery/counter-sale.test.ts | the lines send product_id | send product_variant_id with the same ids |

## Out of scope
- Removing `order_lines.product_id` (the contract story).
- The lines pushed by a phone: the synchronization stories.

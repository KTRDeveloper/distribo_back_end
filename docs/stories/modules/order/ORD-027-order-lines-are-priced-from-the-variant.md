---
id: ORD-027
title: Order lines are priced from the variant
module: order
kind: change
rev: 1
amends: [ORD-009, ORD-010, ORD-013, ORD-014]
size: S
risk: high
depends_on: [ORD-026, CAT-016, CAT-017, CAT-019]
read_first: [src/modules/order/order.service.ts, src/modules/order/order.repository.ts]
design_refs: [commandes-et-livraisons/orderline, commandes-et-livraisons/order]
constraints: [C-15, C-20, CM-11]
asvs: [v5.0.0-2.2.1, v5.0.0-8.2.2]
---

# ORD-027 — Order lines are priced from the variant

## Story
As a customer, I want my order priced and labelled from the variant I chose so that the price and the name on my order are those of that size, color or pack.

## Context
- Exists: `priceLine` (customer orders) and `priceEnteredLine` (seller orders, edits, counter sale) read `getActiveProduct` and label the line `<name> (<unit>)`.
- Change in `order.service.ts`: both read `getActiveVariant(tx, organizationId, id)`; the minimum uses the variant's `minOrderQuantity`; the reference price is `getReferencePrice(tx, relationshipId, variant.id)`; `labelApplied` is `variantLabel(variant.productName, variant.variantName, variant.unit)`.
- The line keeps `productId: variant.productId` and gains `productVariantId: variant.id` (`NewOrderLine` in `order.repository.ts`).
- The request field stays `product_id` and carries the variant id until ORD-028; an existing product's id equals its variant's id.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.
- `C-20`: `label_applied` is composed by the shared label function; `unit_price_applied` equals `reference_price` on a customer order.
- `CM-11`: Reference price = negotiated price when one exists, else the variant price.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; `label_applied` is composed by the shared label function; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward; `price_set_by_id` and `price_set_at` are set if and only if `unit_price_applied` differs from `reference_price`.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the variant price), else the variant price.

## Acceptance criteria
```gherkin
Scenario: AC-1 Label, variant and prices come from the variant
  Given the variant "Rouge / L" (unit "pièce") of "T-shirt", priced 3000, with a negotiated price of 2800
  When a seller enters an order for it at 2500
  Then label_applied is "T-shirt — Rouge / L (pièce)" and productVariantId is the variant's id
  And reference_price is 2800 and unit_price_applied 2500
Scenario Outline: AC-2 Minimum quantity of the variant
  Given a variant with minimum 5
  When <who> orders a quantity of 4
  Then the result is <result>
  Examples:
    | who                     | result               |
    | a customer              | 400 VALIDATION_ERROR |
    | a seller for a customer | accepted             |
Scenario Outline: AC-3 Variants that cannot be ordered
  When a line names <variant>
  Then the answer is 404 NOT_FOUND with the same message, and nothing is stored
  Examples:
    | variant                       |
    | an INACTIVE variant           |
    | a deleted variant             |
    | a variant of a paused product |
    | an id that does not exist     |
```

## Abuse cases
```gherkin
Scenario: AB-1 A customer names another supplier's variant (access control)
  When a customer orders a variant of a business that is not the relationship's supplier
  Then the answer is 404 NOT_FOUND and no order is stored
```

## Implementation
- Create: `tests/integration/order/order-by-variant.test.ts`
- Modify: `src/modules/order/order.service.ts`, `src/modules/order/order.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Signatures:
  - `priceLine(tx, supplierOrganizationId: string, relationshipId: string, line: { id: string; product_id: string; quantity: string | number }): Promise<NewOrderLine & { quantityMilli: bigint }>`
- Types:
  - `NewOrderLine = { id: string; productId: string; productVariantId: string; labelApplied: string; quantity: string; referencePrice: bigint; unitPriceApplied: bigint; amount: bigint }`
- Errors: `404` NOT_FOUND when the variant cannot be ordered (any reason, same message), `400` VALIDATION_ERROR for a quantity below the minimum on a customer order
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: price, label and amount are computed on the server from the variant.
- v5.0.0-8.2.2: the variant must belong to the relationship's supplier; every other case is 404.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| prices and label | integration | AC-1, C-20, CM-11 | variant with a negotiated price, seller gap → label by the shared function, variant stored, both prices |
| minimum | integration | AC-2, C-15 | each Examples row → refused or accepted |
| unavailable | integration | AC-3, C-15 | each Examples row → 404 and nothing stored |
| other supplier | security | AB-1, CWE-639 | variant of another business → 404, no order |

Command: `npx vitest run tests/integration/order`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/order/place-order.test.ts | it expects labels like 'Rice (sack)' | expect 'Rice — sack', the label of a variant without a name |

## Out of scope
- Renaming the request and answer field (ORD-028).
- The rest of a partial delivery, the counter sale insert and phone pushes (delivery and synchronization stories).

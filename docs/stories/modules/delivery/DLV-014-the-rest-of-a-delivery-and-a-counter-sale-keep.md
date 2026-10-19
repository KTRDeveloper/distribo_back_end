---
id: DLV-014
title: The rest of a delivery and a counter sale keep the variant of each line
module: delivery
kind: change
rev: 1
amends: [DLV-008, DLV-009]
size: XS
risk: medium
depends_on: [ORD-025, ORD-027]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/delivery/delivery.repository.ts]
design_refs: [commandes-et-livraisons/orderline]
constraints: []
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3]
---

# DLV-014 — The rest of a delivery and a counter sale keep the variant of each line

## Story
As a seller, I want the rest of a partial delivery and a counter sale to name the variant of each line so that stock-free sales still say which size or color was sold.

## Context
- Exists: `deliverOrder` with the rest `LATER` copies each short line into the order for the rest (`restLines`, `productId: line.productId`); `sellAtCounter` inserts the lines `priceEnteredLine` returns (ORD-027) as `CounterSaleLine`.
- Change in `delivery.repository.ts`: `RestLine` and `CounterSaleLine` gain `productVariantId: string`. In `delivery.service.ts`, `restLines` copies `productVariantId: line.productVariantId` next to `productId`; the counter sale takes it from the priced line through the spread it already uses.
- Why: the trigger of ORD-024 fills the variant only for a product's legacy variant; a line of a new-style variant would otherwise be refused by the not-null column (ORD-025).
- Label, quantity, prices and price author are copied as before: the rest keeps the original prices. The two inserts stay inside the delivery transaction.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The rest keeps the variant
  Given an order line of 5 units of <variant>
  When the order is delivered with 3 units and the rest LATER
  Then the order for the rest has a line of 2 units of the same variant, with the same label and prices
  Examples:
    | variant                                       |
    | the only variant of a product                 |
    | a variant "Rouge / L" among several variants  |
Scenario: AC-2 A counter sale names the variant
  When a seller sells a variant "Rouge / L" at the counter
  Then the stored line has the variant id and the product id of that variant
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/delivery/line-variant.test.ts`
- Modify: `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Types:
  - `RestLine = { productId: string; productVariantId: string; labelApplied: string; quantity: string; referencePrice: bigint; unitPriceApplied: bigint; amount: bigint; priceSetById: string | null; priceSetAt: Date | null }`
  - `CounterSaleLine gains productVariantId: string`
- Dependencies: `@prisma/client`

## Security
- v5.0.0-2.2.1: the copied line keeps the server-computed prices; nothing comes from the request.
- v5.0.0-2.3.3: the order for the rest and the delivery stay one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rest | integration | AC-1 | each Examples row → rest line with the variant, label and prices of the original |
| counter | integration | AC-2 | counter sale of a named variant → line with variant and product ids |

Command: `npx vitest run tests/integration/delivery`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/partial-delivery.test.ts | checks the label, quantity and prices of the rest lines | unchanged: the rest lines now also carry the variant, which the ORD-024 trigger already filled |
| tests/integration/delivery/counter-sale.test.ts | checks the sale lines and their prices | unchanged: the lines also carry the variant |

## Out of scope
- Lines pushed by a phone when it closes an order (the synchronization stories).

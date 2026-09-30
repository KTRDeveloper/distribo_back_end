---
id: DLV-008
title: Deliver only part of an order and settle the rest
module: delivery
kind: change
rev: 1
amends: [DLV-007]
size: M
risk: high
depends_on: [DLV-007]
read_first: [src/modules/delivery/delivery.service.ts, src/modules/order/order.calculations.ts]
design_refs: [commandes-et-livraisons/order/le-reste-d-une-livraison-partielle, commandes-et-livraisons/orderline]
constraints: [CM-22]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.3, v5.0.0-15.3.3]
---

# DLV-008 — Deliver only part of an order and settle the rest

## Story
As a driver, I want to record that only part of an order was delivered, and decide what happens to the rest, so that the customer pays for what they received.

## Context
- Exists: `deliverOrder` and its route (DLV-007); `lineAmountOf`, `orderTotal`.
- Changes: the deliver body accepts `lines: [{ line_id, delivered_quantity }]` (a decimal with at most 3 places, from 0 up to the ordered quantity; unlisted lines are fully delivered) and `rest: 'LATER' | 'ABANDON'`, required when any line is short. At least one line must have a delivered quantity above 0 (else 400).
- The sale and the credit rule use the recomputed total on delivered quantities. With `LATER` the server also creates, in the same transaction, a CONFIRMED order linked by `parent_order_id`, same relationship and delivery address, `delivery_cost` 0, with one line per short line: remaining quantity, same `label_applied`, `reference_price`, `unit_price_applied` and price author as the original line, amount rounded as usual. With `ABANDON` nothing is created.
- `CM-22`: Partial delivery: 'later' creates a CONFIRMED order for the remainder at the original order's prices, linked by parent_order_id; 'abandon' closes the order on what was delivered; abandon by a non-owner joins the owner's exceptions.

## Acceptance criteria
```gherkin
Scenario: AC-1 Partial with rest later
  Given a line of 10 sacks at 3000 and the driver delivers 8, rest LATER, collected 24000
  Then the line's delivered_quantity is 8 and its amount 24000, the SALE is 24000, and a CONFIRMED child order of 2 sacks at 3000 with parent_order_id exists
Scenario: AC-2 Abandon
  When the rest is ABANDON
  Then no child order exists and the original stays DELIVERED for what was delivered
Scenario Outline: AC-3 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is written
  Examples:
    | problem                                        | status               |
    | a short line without `rest`                    | 400 VALIDATION_ERROR |
    | delivered_quantity above the ordered one       | 400 VALIDATION_ERROR |
    | every delivered_quantity 0                     | 400 VALIDATION_ERROR |
    | delivered_quantity with 4 decimals             | 400 VALIDATION_ERROR |
    | a line of another order                        | 404 NOT_FOUND        |
Scenario: AC-4 Credit uses the delivered total
  When the limit would be exceeded only by the undelivered part
  Then the delivery is accepted
```

## Abuse cases
```gherkin
Scenario: AB-1 Hiding goods by abandoning the rest (repudiation)
  When a non-owner abandons a rest
  Then the delivered order keeps its short lines, which the owner's exceptions show (DLV-012)
Scenario: AB-2 Client-computed amounts (tampering)
  When the body carries amount or total_amount
  Then the response is 400
```

## Implementation
- Create: `tests/integration/delivery/partial-delivery.test.ts`
- Modify: `src/modules/delivery/delivery.schemas.ts`, `src/modules/delivery/delivery.service.ts`, `src/modules/delivery/delivery.repository.ts`
- Pattern: `src/modules/delivery/delivery.service.ts`
- Types:
  - `DeliverInput = DeliverInput & { lines?: Array<{ line_id: string; delivered_quantity: string | number }>; rest?: 'LATER' | 'ABANDON' }`
- Errors: `VALIDATION_ERROR` 400, `NOT_FOUND` 404
- Dependencies: `zod`, `@prisma/client`

## Security
- v5.0.0-2.2.1: quantities parsed with `parseQuantity`, amounts recomputed.
- v5.0.0-2.3.3: lines, sale, payment, rest order and caches are one transaction.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| partial and later | integration | AC-1, CM-22 | line, sale, child order |
| abandon | integration | AC-2 | no child |
| refusals | integration | AC-3 | each Examples row → status |
| credit on delivered total | integration | AC-4 | accepted |
| abandoned rest | security | AB-1, CWE-778 | short line remains visible |
| client amounts | security | AB-2, CWE-915 | 400 |

Command: `npx vitest run tests/integration/delivery/partial-delivery.test.ts tests/integration/delivery/deliver.test.ts`

## Out of scope
- Showing abandoned rests to the owner (DLV-012).

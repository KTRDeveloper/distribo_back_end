---
id: ORD-038
title: An order is refused when its total changed since the customer saw it
module: order
kind: change
rev: 1
amends: [ORD-009, ORD-010]
size: XS
risk: medium
depends_on: [ORD-010]
read_first: [src/modules/order/order.schemas.ts, tests/integration/order/order-line-variant-required.test.ts]
design_refs: [a1-modifier-remplacer-une-commande-en/le-total-vu-par-le-client, a1-modifier-remplacer-une-commande-en/etapes-complete-a-2]
constraints: [CM-16]
asvs: [v5.0.0-2.2.1, v5.0.0-2.3.1]
---

# ORD-038 — An order is refused when its total changed since the customer saw it

## Story
As a customer, I want my order refused when its total is not the one I saw, so that I never pay a price I did not accept.

## Context
- Exists: POST /api/v1/orders (ORD-009) and POST /api/v1/organizations/{organizationId}/purchases (ORD-010) price every line on the server.
- Both bodies get an optional `expected_total`: the total the customer saw, an integer of XAF from 0 to 9007199254740991. It sets no price and is never stored.
- After pricing, when `expected_total` is given and differs from the server total: 409 `TOTAL_CHANGED`, message "The total changed.", `details: { total }` with the server total; nothing is written (no order, line or notification).
- `idempotent()` replays that 409 for the same `id`: the phone shows the new total, then sends a new gesture with a new `id`.
- Absent: today's behavior (older app versions).
- The check is a pure helper, reused by ORD-039.
- `CM-16`: Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order).

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The total the customer saw
  Given lines whose server total is 12500
  When the customer places the order with expected_total <sent>
  Then the response is <response>
  Examples:
    | sent   | response                                                        |
    | 12500  | 201                                                             |
    | absent | 201                                                             |
    | 12000  | 409 TOTAL_CHANGED, details.total 12500, no order, line or notification |
Scenario: AC-2 The same rule on a purchase
  When a manager places a purchase whose expected_total differs from the server total
  Then the response is 409 TOTAL_CHANGED with details.total and nothing is stored
Scenario: AC-3 Confirming the new total
  Given a first try answered 409 TOTAL_CHANGED with details.total 12500
  When the customer sends the same lines with a new id and expected_total 12500
  Then the response is 201
```

## Abuse cases
```gherkin
Scenario: AB-1 A lower total to pay less
  When the customer sends expected_total 1 for lines worth 12500
  Then the response is 409 TOTAL_CHANGED and no price comes from the client
Scenario Outline: AB-2 A malformed total
  When expected_total is <value>
  Then the response is 400 VALIDATION_ERROR
  Examples:
    | value     |
    | -5        |
    | "12500"   |
    | 12500.5   |
```

## Implementation
- Create: `tests/integration/order/expected-total.test.ts`
- Modify: `src/modules/order/order.schemas.ts`, `src/modules/order/order.service.ts`, `src/modules/order/order.openapi.ts`
- Pattern: `tests/integration/order/order-line-variant-required.test.ts`
- Signatures:
  - `assertExpectedTotal(total: bigint, expected: number | undefined): void`
- Errors: `TOTAL_CHANGED` 409, `VALIDATION_ERROR` 400
- Dependencies: `zod`

## Security
- v5.0.0-2.2.1: `expected_total` is compared, never used as a price; prices stay server-computed (CM-16).
- v5.0.0-2.3.1: the gesture applies only when the customer confirmed the total the server computes.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| place | integration | AC-1, CM-16 | each Examples row → 201, or 409 with details.total and nothing stored |
| purchase | integration | AC-2 | different total → 409, nothing stored |
| new id | integration | AC-3 | new id with the server total → 201 |
| lower total | security | AB-1, WSTG-BUSL-01 | expected_total 1 → 409, prices unchanged |
| malformed | security | AB-2, WSTG-INPV-20 | each Examples row → 400 |

Command: `npx vitest run tests/integration/order/expected-total.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/order/place-order.test.ts | its bodies send no expected_total | unchanged: passes without edits |
| tests/integration/order/place-purchase.test.ts | its bodies send no expected_total | unchanged: passes without edits |

## Out of scope
- The replace gesture (ORD-039) and orders created through sync.

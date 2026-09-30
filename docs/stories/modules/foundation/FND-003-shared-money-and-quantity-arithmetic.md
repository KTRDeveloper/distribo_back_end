---
id: FND-003
title: Shared money and quantity arithmetic
module: foundation
kind: technical
rev: 1
amends: []
size: XS
risk: medium
depends_on: [FND-000]
read_first: [docs/stories/CONVENTIONS.md]
design_refs: [commandes-et-livraisons/orderline, legende]
constraints: [CM-14]
asvs: [v5.0.0-2.2.1]
---

# FND-003 — Shared money and quantity arithmetic

## Story
Technical story: provide the single rounding function for order lines, so that phone and server never differ by one franc.

## Context
- Adds: `src/shared/money.ts` with `parseQuantity` and `lineAmount`, no Node-only import.
- Quantities are integers in thousandths (`bigint`); amounts are integer francs (`bigint`); no floating point anywhere.
- `CM-14`: Line amount = quantity in thousandths times applied price, divided by 1000, rounded to the nearest franc with 0.5 rounded up, integer arithmetic only; 2.5 x 333 gives 833 (design lines 541, 545)

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Line amount rounds to the nearest franc, half up
  When lineAmount is called with quantity <quantity> and unit price <price>
  Then the result is <amount>
  Examples:
    | quantity | price | amount |
    | 2.5      | 333   | 833    |
    | 0.001    | 500   | 1      |
    | 0.001    | 499   | 0      |
    | 10       | 3000  | 30000  |
    | 0        | 3000  | 0      |
Scenario Outline: AC-2 Quantity parsing
  When parseQuantity is called with <text>
  Then the result is <milli> or a RangeError
  Examples:
    | text    | milli      |
    | 2.5     | 2500       |
    | 0.001   | 1          |
    | 0.0001  | RangeError |
    | -1      | RangeError |
    | 1e3     | RangeError |
Scenario: AC-3 Negative or non-integer inputs
  When lineAmount receives a negative quantity or price
  Then it throws a RangeError
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `src/shared/money.ts`, `tests/unit/shared/money.test.ts`
- Pattern: `tests/unit/crypto.test.ts`
- Signatures:
  - `parseQuantity(text: string): bigint`
  - `lineAmount(quantityMilli: bigint, unitPrice: bigint): bigint`
- Dependencies: none added

## Security
- v5.0.0-2.2.1: reject anything that is not a plain decimal with at most 3 decimals; never call `Number` or `parseFloat`.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| rounding | unit | AC-1, CM-14 | each Examples row → amount |
| parsing | unit | AC-2 | each Examples row → milli or RangeError |
| negative inputs | unit | AC-3 | quantity -1, price -1 → RangeError |

Command: `npx vitest run tests/unit/shared/money.test.ts`

## Out of scope
- Applying the function to orders (ORD stories).

---
id: DLV-017
title: A delivery paid in full is accepted even when the credit limit is already exceeded
module: delivery
kind: change
rev: 1
amends: [DLV-007, SYNC-017]
size: S
risk: medium
depends_on: [DLV-007]
read_first: [src/modules/delivery/delivery.service.ts, tests/integration/delivery/open-deliveries.test.ts]
design_refs: [a3-plafond-de-credit-deja-depasse/la-regle, a3-plafond-de-credit-deja-depasse/le-controle-complete-4-1-commande, a3-plafond-de-credit-deja-depasse/exemples-montants-en-xaf]
constraints: [CM-15]
asvs: [v5.0.0-2.3.1]
---

# DLV-017 — A delivery paid in full is accepted even when the credit limit is already exceeded

## Story
As a driver, I want to deliver an order paid in full even when the customer's old debt is above the limit, so that an old debt never blocks a paid sale.

## Context
- Today `deliverOrder` refuses when balance + total − collected exceeds `credit_limit`, so a customer already above the limit must also pay the old overrun.
- New pure functions in `src/shared/credit.ts`: `availableCredit` = limit − balance, never below 0, null for no limit; `creditCheck` gives `minCollect` = total − available and `exceededBy` = total − collected − available, both never below 0 (0 with no limit).
- `balance` is the relationship balance locked before the gesture, `total` the server total of the delivered quantities, `collected` the payments of the same gesture.
- Online: collected below `minCollect` → 409 `CREDIT_INSUFFICIENT` with `details.min_collect` = `minCollect`, nothing written (as today).
- Through sync (`viaSync`): never refused; `creditExceededBy` = `exceededBy`, so "plafond dépassé de …" names only this gesture's overrun. Issues already recorded stay.
- `CM-15`: At delivery, the unpaid part must not bring the balance above credit_limit (null limit = no limit); example: limit 50 000, balance 40 000, order 30 000 requires collecting at least 20 000 (design lines 290-299)

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The minimum and the overrun
  Given a balance before of <balance>, a credit limit of <limit> and a delivered total of <total>
  When the gesture collects <collected>
  Then the minimum is <min>, online the delivery is <online>, and through sync it is kept <sync>
  Examples:
    | balance | limit  | total | collected | min   | online                   | sync                 |
    | 120000  | 100000 | 10000 | 10000     | 10000 | accepted, balance 120000 | without an issue     |
    | 120000  | 100000 | 10000 | 9999      | 10000 | refused, nothing written | with an overrun of 1 |
    | 100000  | 100000 | 10000 | 10000     | 10000 | accepted, balance 100000 | without an issue     |
    | 90000   | 100000 | 30000 | 20000     | 20000 | accepted, balance 100000 | without an issue     |
    | 5000    | 0      | 10000 | 10000     | 10000 | accepted, balance 5000   | without an issue     |
    | -20000  | 0      | 30000 | 10000     | 10000 | accepted, balance 0      | without an issue     |
    | 120000  | none   | 10000 | 0         | 0     | accepted, balance 130000 | without an issue     |
Scenario: AC-2 The refusal names the minimum
  Given a balance of 120000 and a limit of 100000
  When the driver delivers 10000 collecting 9999 online
  Then the response is 409 CREDIT_INSUFFICIENT with details.min_collect 10000 and nothing is written
Scenario: AC-3 Under the limit nothing changes
  Given a limit of 50000 and a balance of 40000
  When the driver delivers 30000 collecting 19999 online
  Then the response is 409 CREDIT_INSUFFICIENT with details.min_collect 20000
```

## Abuse cases
```gherkin
Scenario: AB-1 An unpaid sale to a customer above the limit
  Given a balance of 120000 and a limit of 100000
  When the driver delivers 10000 collecting 0 online
  Then the response is 409 CREDIT_INSUFFICIENT with details.min_collect 10000 and nothing is written
```

## Implementation
- Create: `src/shared/credit.ts`, `tests/unit/delivery/credit-check.test.ts`, `tests/integration/delivery/credit-already-exceeded.test.ts`
- Modify: `src/modules/delivery/delivery.service.ts`
- Pattern: `tests/integration/delivery/open-deliveries.test.ts`
- Signatures:
  - `availableCredit(limit: bigint | null, balance: bigint): bigint | null`
  - `creditCheck(input: { limit: bigint | null; balance: bigint; total: bigint; collected: bigint }): { minCollect: bigint; exceededBy: bigint }`
- Errors: `CREDIT_INSUFFICIENT` 409
- Dependencies: none added

## Security
- v5.0.0-2.3.1: the minimum comes from the locked balance and the server total, never from the phone.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| credit rule | unit | AC-1, CM-15 | each Examples row → min and overrun |
| online rows | integration | AC-1 | rows 1, 4 and 6 accepted with their final balance |
| refusal | integration | AC-2 | 409, min_collect 10000, no line, entry or status change |
| sync row | integration | AC-1 | row 2 through `deliverOrder` with `viaSync` → DELIVERED, creditExceededBy 1 |
| under the limit | integration | AC-3 | min_collect 20000 |
| unpaid above limit | security | AB-1, WSTG-BUSL-01 | 409, nothing written |

Command: `npx vitest run tests/unit/delivery/credit-check.test.ts tests/integration/delivery/credit-already-exceeded.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/delivery/deliver.test.ts | its customers start within their limit, where the new check gives the same minimum | unchanged: passes without edits |
| tests/integration/sync/controls-credit.test.ts | its balance starts within the limit, so the overrun named is the same | unchanged: passes without edits |

## Out of scope
- The driver's available credit in sync rows (REL-032).

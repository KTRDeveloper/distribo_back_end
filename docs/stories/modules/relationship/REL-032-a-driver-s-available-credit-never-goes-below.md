---
id: REL-032
title: A driver's available credit never goes below zero
module: relationship
kind: change
rev: 1
amends: [REL-005]
size: S
risk: medium
depends_on: [DLV-017]
read_first: [src/modules/relationship/relationship.visibility.ts, src/shared/credit.ts]
design_refs: [a3-plafond-de-credit-deja-depasse/ce-que-recoit-le-livreur-precise-9-6]
constraints: []
asvs: [v5.0.0-15.3.1]
---

# REL-032 — A driver's available credit never goes below zero

## Story
As a driver, I want the available credit of a customer over their limit to read zero, so that I collect everything without learning the customer's debt.

## Context
- `relationship.visibility.ts` computes `available_credit` as `creditLimit - balance`: a customer over the limit gives a negative number, which reveals the overrun, and with limit 0 the whole debt.
- Compute it with `availableCredit(limit, balance)` from `src/shared/credit.ts` (DLV-017): never below 0, null with no limit.
- `projectForDriver` is pure and exported: test it directly with built rows.
- The same value feeds the driver's sync row (`relationship.adapter.ts`) and the delivery API; neither changes.
- The offline check is unchanged: at 0 the customer pays everything.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The driver's available credit
  Given a relationship with credit_limit <limit> and balance <balance>
  When a DRIVER of the supplier reads it
  Then available_credit is <available>
  Examples:
    | limit | balance | available |
    | 50000 | 20000   | 30000     |
    | 50000 | 50000   | 0         |
    | 50000 | 80000   | 0         |
    | 0     | 15000   | 0         |
    | none  | 15000   | null      |
```

## Abuse cases
```gherkin
Scenario: AB-1 Deducing the debt
  Given a customer with limit 0 and balance 15000
  When it is projected for a DRIVER (`projectForDriver`, also used by the sync row)
  Then the view holds no negative number, no balance and no limit
```

## Implementation
- Create: `tests/unit/relationship/driver-available-credit.test.ts`
- Modify: `src/modules/relationship/relationship.visibility.ts`
- Pattern: `tests/unit/shared/money.test.ts`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: the driver's view returns only the clamped available credit, never a value from which the debt can be read.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| clamp | unit | AC-1 | each Examples row → available |
| no debt leak | security | AB-1, CWE-200 | no negative value, no balance, no limit |

Command: `npx vitest run tests/unit/relationship/driver-available-credit.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/relationship/visibility.test.ts | its driver cases have a balance within the limit | unchanged: passes without edits |

## Out of scope
- The credit check at delivery (DLV-017).

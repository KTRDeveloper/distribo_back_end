---
id: ACC-004
title: Rules for money
module: access
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ACC-003]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou, finances/ledgerentry]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3]
---

# ACC-004 — Rules for money

## Story
Technical story: add the rules for ledger entries, expenses and handovers, so that money gestures have a role and an availability.

## Context
- Exists: `RULES` with the ACC-003 rules.
- Adds (who, where, action, subject, condition): DRIVER, ALWAYS, create, LedgerEntry, kind in SALE or PAYMENT (only through the delivery gesture, enforced by the route);
  SELLER, ALWAYS, create, LedgerEntry, kind PAYMENT;
  MANAGER, ONLINE, create, LedgerEntry, kind in CREDIT_NOTE, REFUND or OPENING_BALANCE; MANAGER, ONLINE, reverse, LedgerEntry;
  MANAGER, ONLINE, create, Expense; MANAGER, ONLINE, cancel, Expense; MANAGER, ONLINE, create, Handover; MANAGER, ONLINE, cancel, Handover.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Money gestures
  When abilityFor is built for <role> in <ctx> and asked <action> on a LedgerEntry of kind <kind>
  Then the answer is <result>
  Examples:
    | role    | ctx             | action  | kind            | result |
    | DRIVER  | phone, 30 days  | create  | PAYMENT         | true   |
    | DRIVER  | phone, 30 days  | create  | REFUND          | false  |
    | DRIVER  | phone, 30 days  | create  | CREDIT_NOTE     | false  |
    | SELLER  | phone, 30 days  | create  | PAYMENT         | true   |
    | SELLER  | phone, 30 days  | create  | REFUND          | false  |
    | MANAGER | online          | create  | REFUND          | true   |
    | MANAGER | phone, 0 days   | create  | REFUND          | false  |
    | MANAGER | online          | create  | OPENING_BALANCE | true   |
    | OWNER   | phone offline   | reverse | any             | true   |
    | SELLER  | online          | reverse | any             | false  |
Scenario: AC-2 Expenses and handovers
  Then MANAGER online and OWNER may create and cancel an Expense and a Handover, and SELLER and DRIVER may not in any context
Scenario: AC-3 Complete matrix
  When every role meets every context
  Then each rule of this story gives its predicted answer and every unlisted action is refused
```

## Abuse cases
```gherkin
Scenario: AB-1 Driver or seller moves money they should not (vertical)
  When a DRIVER or SELLER asks to reverse an entry, refund, grant a credit note, create an Expense or a Handover
  Then each answer is false
```

## Implementation
- Modify: `src/shared/access/ability.ts`, `tests/unit/access/ability.test.ts`
- Pattern: `src/shared/access/ability.ts`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-8.2.3: a ledger rule always carries a `kind` condition; there is no unconditional create on LedgerEntry.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| money gestures | unit | AC-1 | each Examples row → result |
| expense and handover | unit | AC-2 | roles and contexts → predicted answers |
| matrix | unit | AC-3 | 4 roles x 4 contexts x every rule → predicted answers |
| no money for lower roles | security | AB-1, WSTG-ATHZ-03 | driver and seller → reverse, refund, credit note, expense, handover all false |

Command: `npx vitest run tests/unit/access/ability.test.ts`

## Out of scope
- Reversal limits (once, not of a reversal): FIN stories.

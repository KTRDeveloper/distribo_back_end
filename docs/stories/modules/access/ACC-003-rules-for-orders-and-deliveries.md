---
id: ACC-003
title: Rules for orders and deliveries
module: access
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ACC-002]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou, annexe-la-table-des-regles/etapes-d-une-commande]
constraints: [CM-12]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.1]
---

# ACC-003 — Rules for orders and deliveries

## Story
Technical story: add the rules for the steps of an order and for deliveries, so that each step has a role and an availability.

## Context
- Exists: `RULES` with the ACC-002 rules.
- Adds (who, where, action, subject, condition): DRIVER, DAYS_3, depart, Order, status CONFIRMED; DRIVER, ALWAYS, deliver, Order, status IN_DELIVERY; DRIVER, ALWAYS, fail_delivery, Order, status IN_DELIVERY;
  SELLER, DAYS_3, create, Order; SELLER, DAYS_3, accept, Order, status PENDING; SELLER, DAYS_3, refuse, Order, status PENDING; SELLER, DAYS_3, cancel, Order, status in PENDING or CONFIRMED; SELLER, DAYS_3, deliver, Order, status CONFIRMED;
  SELLER, DAYS_3, update, Order, fields supplier_note; SELLER, DAYS_3, update, OrderLine, fields unit_price_applied; MANAGER, ONLINE, assign, Delivery.
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note (design lines 463-465, annex A.2)

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Steps of an order
  When abilityFor is built for <role> in <ctx> and asked <action> on an Order with status <status>
  Then the answer is <result>
  Examples:
    | role    | ctx           | action        | status      | result |
    | DRIVER  | phone, 2 days | depart        | CONFIRMED   | true   |
    | DRIVER  | phone, 4 days | depart        | CONFIRMED   | false  |
    | DRIVER  | phone, 4 days | deliver       | IN_DELIVERY | true   |
    | DRIVER  | phone, 4 days | fail_delivery | IN_DELIVERY | true   |
    | DRIVER  | phone, 0 days | deliver       | CONFIRMED   | false  |
    | DRIVER  | phone, 0 days | cancel        | CONFIRMED   | false  |
    | SELLER  | phone, 2 days | cancel        | CONFIRMED   | true   |
    | SELLER  | phone, 2 days | cancel        | DELIVERED   | false  |
    | SELLER  | phone, 2 days | deliver       | CONFIRMED   | true   |
    | SELLER  | phone, 2 days | accept        | PENDING     | true   |
    | SELLER  | phone, 2 days | accept        | CONFIRMED   | false  |
Scenario: AC-2 Assigning a delivery
  Then a MANAGER online can assign, a SELLER cannot, and a MANAGER on a phone 0 days from sync cannot
Scenario: AC-3 Complete matrix
  When every role meets every context
  Then each rule of this story gives its predicted answer and every unlisted action is refused
```

## Abuse cases
```gherkin
Scenario: AB-1 Driver acts beyond deliveries (vertical)
  When a DRIVER asks to accept, refuse, cancel, create an Order or update an OrderLine
  Then each answer is false
```

## Implementation
- Modify: `src/shared/access/ability.ts`, `tests/unit/access/ability.test.ts`
- Pattern: `src/shared/access/ability.ts`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-2.3.1: state conditions live in the rule, so an out-of-order step is refused by the same decision.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| steps | unit | AC-1, CM-12 | each Examples row → result |
| assign | unit | AC-2 | MANAGER online true; SELLER false; MANAGER phone 0 days false |
| matrix | unit | AC-3 | 4 roles x 4 contexts x every rule → predicted answers |
| driver limits | security | AB-1, WSTG-ATHZ-03 | driver → accept, refuse, cancel, create Order, update OrderLine all false |

Command: `npx vitest run tests/unit/access/ability.test.ts`

## Out of scope
- Customer-placed orders (the customer is not a collaborator).

---
id: ACC-002
title: Rules for relationships, catalog and prices
module: access
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ACC-001]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou, relations-commerciales/customerrelationship]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3]
---

# ACC-002 — Rules for relationships, catalog and prices

## Story
Technical story: add the rules that govern customers, catalog and negotiated prices, so that those routes have a decision to ask for.

## Context
- Exists: `RULES`, `abilityFor`, `atLeast` (ACC-001).
- Adds these rules (who, where, action, subject, fields):
  SELLER, DAYS_3, create, CustomerRelationship;
  SELLER, DAYS_3, update, CustomerRelationship, fields customer_label, delivery_address, supplier_notes (Q-030);
  MANAGER, ONLINE, update, CustomerRelationship, fields credit_limit;
  MANAGER, ONLINE, reassign, CustomerRelationship;
  MANAGER, ONLINE, end, CustomerRelationship; MANAGER, ONLINE, reopen, CustomerRelationship (Q-030);
  MANAGER, ONLINE, create, CustomerRelationship, condition `counter: true` (extra counters, Q-029);
  MANAGER, ONLINE, create and update, Product; MANAGER, ONLINE, create, update and delete, CustomerPrice.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Who can do what, and where
  When abilityFor is built for <role> in <ctx> and asked <action> on <subject> (field <field>)
  Then the answer is <result>
  Examples:
    | role    | ctx                    | action | subject              | field        | result |
    | DRIVER  | any                    | create | CustomerRelationship |              | false  |
    | SELLER  | phone, 2 days          | create | CustomerRelationship |              | true   |
    | SELLER  | phone, 4 days          | create | CustomerRelationship |              | false  |
    | SELLER  | phone, 2 days          | update | CustomerRelationship | customer_label | true |
    | SELLER  | phone, 2 days          | update | CustomerRelationship | credit_limit | false  |
    | MANAGER | online                 | update | CustomerRelationship | credit_limit | true   |
    | MANAGER | phone, 0 days          | update | CustomerRelationship | credit_limit | false  |
    | OWNER   | phone offline          | update | CustomerRelationship | credit_limit | true   |
    | MANAGER | phone, 0 days          | create | Product              |              | false  |
    | OWNER   | phone offline          | create | Product              |              | true   |
    | SELLER  | online                 | create | CustomerPrice        |              | false  |
Scenario: AC-2 Complete matrix
  When every role in DRIVER, SELLER, MANAGER, OWNER meets every context in `phone 0 days`, `phone 4 days`, `online`, `server judging a sync`
  Then each rule of this story gives the answer its `who` and `where` columns predict, and every action not listed is refused
```

## Abuse cases
```gherkin
Scenario: AB-1 Manager power used offline (elevation)
  When a MANAGER on a phone 0 days from sync asks to update `credit_limit`, create a Product or reassign a relationship
  Then each answer is false
```

## Implementation
- Modify: `src/shared/access/ability.ts`, `tests/unit/access/ability.test.ts`
- Pattern: `src/shared/access/ability.ts`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-8.2.3: field-level rules list the fields; no rule allows `update` without a field list on CustomerRelationship.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| examples | unit | AC-1 | each Examples row → result |
| matrix | unit | AC-2 | 4 roles x 4 contexts x every rule → predicted answers; unlisted actions false |
| manager offline | security | AB-1, WSTG-ATHZ-03 | MANAGER phone 0 days → credit_limit, Product create, reassign all false |

Command: `npx vitest run tests/unit/access/ability.test.ts`

## Out of scope
- Rules for orders, money and team (ACC-003 to ACC-005).
- Customer-side rights, which the relationship module decides by party.

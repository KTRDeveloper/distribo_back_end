---
id: ACC-005
title: Rules for team, subscription and organization
module: access
kind: technical
rev: 1
amends: []
size: XS
risk: high
depends_on: [ACC-004]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou, identite-et-organisation/collaboration]
constraints: []
asvs: [v5.0.0-8.2.1]
---

# ACC-005 — Rules for team, subscription and organization

## Story
Technical story: add the rules for the team, the subscription, closing the business and ordering from suppliers, so that gestures that change other people's rights always need the network.

## Context
- Exists: `RULES` with the ACC-004 rules.
- Adds (who, where, action, subject): OWNER, NETWORK, manage, Collaboration; OWNER, NETWORK, manage, Subscription; OWNER, NETWORK, transfer_ownership, Organization; OWNER, NETWORK, close, Organization; OWNER, NETWORK, reopen, Organization;
  MANAGER, NETWORK, order_from_supplier, CustomerRelationship; MANAGER, NETWORK, invite_supplier, CustomerRelationship.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Network-only gestures
  When abilityFor is built for <role> with <ctx> and asked <action> on <subject>
  Then the answer is <result>
  Examples:
    | role    | ctx       | action              | subject              | result |
    | OWNER   | online    | manage              | Collaboration        | true   |
    | OWNER   | offline   | manage              | Collaboration        | false  |
    | MANAGER | online    | manage              | Collaboration        | false  |
    | OWNER   | offline   | close               | Organization         | false  |
    | OWNER   | online    | close               | Organization         | true   |
    | MANAGER | online    | invite_supplier     | CustomerRelationship | true   |
    | MANAGER | offline   | order_from_supplier | CustomerRelationship | false  |
    | SELLER  | online    | invite_supplier     | CustomerRelationship | false  |
Scenario: AC-2 Complete matrix
  When every role meets every context
  Then each rule of this story gives its predicted answer and every unlisted action is refused
```

## Abuse cases
```gherkin
Scenario: AB-1 Manager changes rights (elevation)
  When a MANAGER asks to manage Collaboration or Subscription, close or transfer the Organization
  Then each answer is false in every context
```

## Implementation
- Modify: `src/shared/access/ability.ts`, `tests/unit/access/ability.test.ts`
- Pattern: `src/shared/access/ability.ts`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-8.2.1: NETWORK rules are never available offline, even for the owner.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| network only | unit | AC-1 | each Examples row → result |
| matrix | unit | AC-2 | 4 roles x 4 contexts x every rule → predicted answers |
| manager cannot change rights | security | AB-1, WSTG-ATHZ-03 | manager → all false |

Command: `npx vitest run tests/unit/access/ability.test.ts`

## Out of scope
- Routes that use these rules (ORG and REL modules).

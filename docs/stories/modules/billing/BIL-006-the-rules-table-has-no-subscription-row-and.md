---
id: BIL-006
title: The rules table has no subscription row and gains the keep rows
module: billing
kind: change
rev: 1
amends: [ACC-005]
size: XS
risk: medium
depends_on: [BIL-005, ORG-040]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/extrait-du-fichier, finances/subscription]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# BIL-006 — The rules table has no subscription row and gains the keep rows

## Story
Technical story: take the subscription out of the rules table and add the two rows that let an owner choose what to keep, so that no row grants `manage`.

## Context
- Exists: `{ who: OWNER, where: ONLINE_FOR_ALL, action: manage, subject: Subscription }` in `src/shared/access/ability.ts`; no route reads it after BIL-005. ORG-040 already replaced `manage` on Collaboration, so this is the last `manage` row.
- Remove it. The design gives the subscription no rule: it is paid on a website and only the server writes it. The owner reads their subscription screen with an OWNER check in billing (BIL-016).
- Add two OWNER rows, ONLINE_FOR_ALL, with no fields: `keep` on Collaboration and `keep` on Product (choose who and what to keep when the plan drops; the server writes the pause). They ship before their route (BIL-018).
- A new unit test fails when any row of `RULES` has the action `manage`.

## Acceptance criteria
```gherkin
Scenario: AC-1 The subscription has no rule
  When abilityFor is built for each role online
  Then can(manage, Subscription), can(read, Subscription), can(create, Subscription) and can(update, Subscription) are false for all four
Scenario Outline: AC-2 The keep rows
  When abilityFor is built for <role> with <ctx>
  Then can(keep, <subject>) is <result>
  Examples:
    | role    | ctx     | subject       | result |
    | OWNER   | online  | Collaboration | true   |
    | OWNER   | online  | Product       | true   |
    | OWNER   | offline | Product       | false  |
    | MANAGER | online  | Collaboration | false  |
Scenario: AC-3 No row grants manage
  When the rows of `RULES` are listed
  Then none has the action `manage`
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager keeps and drops team seats (elevation)
  When abilityFor is built for MANAGER, SELLER and DRIVER, online and offline
  Then can(keep, Collaboration) and can(keep, Product) are false for all six
```

## Implementation
- Create: `tests/unit/access/no-manage-rule.test.ts`
- Modify: `src/shared/access/ability.ts`
- Pattern: `tests/unit/access/require-ability.test.ts`
- Dependencies: none added

## Security
- v5.0.0-8.2.1: only the OWNER, online, holds `keep`; the server checks it on every request.
- v5.0.0-15.3.3: `keep` carries no field, so the route lists what its body may name.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no subscription rule | unit | AC-1 | four roles, four actions → false |
| keep rows | unit | AC-2 | each Examples row → result |
| no manage | unit | AC-3 | no row of RULES has action manage |
| keep by others | security | AB-1, CWE-285 | MANAGER, SELLER, DRIVER, online and offline → false |

Command: `npx vitest run tests/unit/access`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/access/ability.test.ts | the list of owner rows names `manage:Subscription` and one test expects `manage` on Subscription to be true for the owner | the list has no `manage:Subscription` and has `keep:Collaboration` and `keep:Product`; the owner can no longer `manage` Subscription |

## Out of scope
- The route that uses `keep`: BIL-018.

---
id: ACC-008
title: Availability values say who may act offline
module: access
kind: change
rev: 1
amends: [ACC-001, ACC-002, ACC-003, ACC-004, ACC-005]
size: XS
risk: high
depends_on: [ACC-005]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou, annexe-la-table-des-regles/extrait-du-fichier]
constraints: []
asvs: [v5.0.0-8.2.1]
---

# ACC-008 — Availability values say who may act offline

## Story
Technical story: rename the two connection-only availability values so that each says whether the owner may still act offline, and make the builder refuse any value it does not know.

## Context
- Exists: `Where = 'ALWAYS' | 'DAYS_3' | 'ONLINE' | 'NETWORK'` and `isAvailable` in `src/shared/access/ability.ts`; the ACC-002 to ACC-005 rules use these names.
- Renames: `ONLINE` becomes `ONLINE_EXCEPT_OWNER` (true for the owner even offline, else only when `online`); `NETWORK` becomes `ONLINE_FOR_ALL` (true only when `online`, owner included). The answers do not change.
- `isAvailable` returns false for a value it does not know. Today the switch has no default branch; a rule built at run time with a wrong value must grant nothing.
- The server judges everything that arrives by synchronization with `online: false`: `ONLINE_EXCEPT_OWNER` counts only for the owner, `ONLINE_FOR_ALL` for nobody, `DAYS_3` filters nothing (`onServer`).
- Only names change here: no rule is added, removed or moved. Rows for the new gestures ship with the story that first uses them.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Renamed values
  Given a MANAGER rule with where <where>
  When abilityFor is built for <role> with <ctx>
  Then can('create', subject) is <result>
  Examples:
    | where               | role    | ctx                | result |
    | ONLINE_EXCEPT_OWNER | MANAGER | online             | true   |
    | ONLINE_EXCEPT_OWNER | MANAGER | not online         | false  |
    | ONLINE_EXCEPT_OWNER | OWNER   | not online         | true   |
    | ONLINE_FOR_ALL      | OWNER   | not online         | false  |
    | ONLINE_FOR_ALL      | OWNER   | online             | true   |
Scenario: AC-2 Old names are gone
  When every row of `RULES` is read
  Then its `where` is one of the four new values
  And none is `ONLINE` or `NETWORK`
Scenario Outline: AC-3 The server judges a synchronization as offline
  Given a rule with where <where> and minimum role <min>
  When abilityFor is built for <role> with onServer true, online false, daysSinceSync 9
  Then can('create', subject) is <result>
  Examples:
    | where               | min     | role    | result |
    | ONLINE_EXCEPT_OWNER | MANAGER | OWNER   | true   |
    | ONLINE_EXCEPT_OWNER | MANAGER | MANAGER | false  |
    | ONLINE_FOR_ALL      | MANAGER | OWNER   | false  |
    | DAYS_3              | SELLER  | SELLER  | true   |
Scenario: AC-4 Nothing else changes
  When every role meets every context
  Then each rule gives the answer it gave before the rename
```

## Abuse cases
```gherkin
Scenario: AB-1 A mistyped availability opens an action (elevation)
  Given a rule whose where is `ONLINE` or `ANYWHERE`
  When abilityFor is built for the OWNER, online
  Then can returns false for its action
```

## Implementation
- Create: `tests/unit/access/availability-names.test.ts`
- Modify: `src/shared/access/ability.ts`
- Pattern: `src/shared/access/roles.ts`
- Signatures:
  - `isAvailable(where: Where, role: string, context: AccessContext): boolean`
- Types:
  - `Where = 'ALWAYS' | 'DAYS_3' | 'ONLINE_EXCEPT_OWNER' | 'ONLINE_FOR_ALL'`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-8.2.1: a value the function does not know grants nothing, so a typo in a rule never opens an action.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| renamed values | unit | AC-1 | each Examples row → result |
| old names gone | unit | AC-2 | every RULES row has one of the four values |
| server as offline | unit | AC-3 | each Examples row → result |
| nothing else changes | unit | AC-4 | the complete matrix of ability.test.ts passes with the new names |
| unknown value | security | AB-1, CWE-285 | where ONLINE or ANYWHERE, OWNER online → can false |

Command: `npx vitest run tests/unit/access`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/access/ability.test.ts | the availability table, the matrix and the money-rule prediction name `ONLINE` and `NETWORK` | same expectations with `ONLINE_EXCEPT_OWNER` and `ONLINE_FOR_ALL` |

## Out of scope
- Rows for the new gestures (team, contacts, logo, photos, keep, catalog fields): each ships with the story that first uses it.
- The three read rows of the design (activity, sales and purchase reports, money in and out): phone screens only, and the design names no subject for them (open question).
- Any route: none changes.

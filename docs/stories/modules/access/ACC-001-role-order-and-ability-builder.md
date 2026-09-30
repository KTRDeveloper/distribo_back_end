---
id: ACC-001
title: Role order and ability builder
module: access
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [FND-000]
read_first: [docs/stories/CONVENTIONS.md, tests/unit/crypto.test.ts]
design_refs: [acces-et-securite/la-couche-d-acces-et-la-table-des-regles, annexe-la-table-des-regles/extrait-du-fichier]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-8.3.1]
---

# ACC-001 — Role order and ability builder

## Story
Technical story: provide the role order and the function that turns the rules table into a CASL ability, so that every permission decision comes from one place that refuses by default.

## Context
- Adds: `src/shared/access/roles.ts` (`ROLES = ['DRIVER','SELLER','MANAGER','OWNER']`, `atLeast`) and `src/shared/access/ability.ts` (`RULES`, `abilityFor`), no Node-only import, using `createMongoAbility` from `@casl/ability`.
- `RULES` is an array of `{ who, where, action, subject, fields?, conditions? }`; it starts with one rule, `{ who: 'SELLER', where: 'DAYS_3', action: 'create', subject: 'CustomerRelationship' }`; ACC-002 to ACC-005 add the others.
- Availability `where`: `ALWAYS` true; `DAYS_3` true for the owner, on the server, or when `daysSinceSync < 3`; `ONLINE` true for the owner or when `online`; `NETWORK` true only when `online`.
- `abilityFor(role, ctx)` keeps the rules with `atLeast(role, who)` and an open `where`, and drops `who` and `where` before giving them to CASL.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 Role order
  When atLeast is called with role <role> and minimum <min>
  Then the result is <result>
  Examples:
    | role    | min     | result |
    | DRIVER  | DRIVER  | true   |
    | SELLER  | DRIVER  | true   |
    | DRIVER  | SELLER  | false  |
    | OWNER   | MANAGER | true   |
    | ADMIN   | DRIVER  | false  |
    | (empty) | DRIVER  | false  |
    | OWNER   | BOSS    | false  |
Scenario Outline: AC-2 Availability
  Given the rule `MANAGER` with where <where>
  When abilityFor is built for role <role> with context <ctx>
  Then can('create', subject) is <result>
  Examples:
    | where   | role    | ctx                                              | result |
    | DAYS_3  | SELLER  | daysSinceSync 2, not online, not on server       | true   |
    | DAYS_3  | SELLER  | daysSinceSync 3, not online, not on server       | false  |
    | DAYS_3  | SELLER  | daysSinceSync 9, on server                       | true   |
    | DAYS_3  | OWNER   | daysSinceSync 9, not online                      | true   |
    | ONLINE  | MANAGER | online                                           | true   |
    | ONLINE  | MANAGER | not online                                       | false  |
    | ONLINE  | OWNER   | not online                                       | true   |
    | NETWORK | OWNER   | not online                                       | false  |
    | NETWORK | OWNER   | online                                           | true   |
    | ALWAYS  | DRIVER  | not online, daysSinceSync 30                     | true   |
Scenario: AC-3 Deny by default
  When abilityFor is built for an unknown role
  Then can returns false for every action and subject
```

## Abuse cases
```gherkin
Scenario: AB-1 Unknown or forged role (elevation)
  When abilityFor receives 'ADMIN', 'owner' in lower case or an empty role
  Then the ability allows nothing
```

## Implementation
- Create: `src/shared/access/roles.ts`, `src/shared/access/ability.ts`, `tests/unit/access/ability.test.ts`
- Pattern: `tests/unit/crypto.test.ts`
- Signatures:
  - `atLeast(role: string, min: string): boolean`
  - `abilityFor(role: string, ctx: AccessContext): MongoAbility`
- Types:
  - `Role = 'DRIVER' | 'SELLER' | 'MANAGER' | 'OWNER'`
  - `Where = 'ALWAYS' | 'DAYS_3' | 'ONLINE' | 'NETWORK'`
  - `AccessRule = { who: Role; where: Where; action: string; subject: string; fields?: string[]; conditions?: Record<string, unknown> }`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-8.2.1: an unknown role or an unknown minimum is refused, never defaulted.
- v5.0.0-8.3.1: CASL is given no rule that the role and context do not allow.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| role order | unit | AC-1 | each Examples row → result |
| availability | unit | AC-2 | each Examples row → result |
| deny by default | unit | AC-3 | unknown role → can false for a sample of 5 actions |
| forged roles | security | AB-1, WSTG-ATHZ-03 | 'ADMIN', 'owner', '' → nothing allowed |

Command: `npx vitest run tests/unit/access/ability.test.ts`

## Out of scope
- The full rules (ACC-002 to ACC-005) and the middleware (ACC-006).

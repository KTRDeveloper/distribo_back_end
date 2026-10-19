---
id: ORG-040
title: The owner rules for the team and the contacts are written out
module: organization
kind: change
rev: 1
amends: [ACC-005, ORG-007, ORG-009, ORG-010]
size: S
risk: high
depends_on: [ACC-008, ORG-007, ORG-009, ORG-010]
read_first: [src/shared/access/ability.ts, tests/unit/access/ability.test.ts]
design_refs: [annexe-la-table-des-regles/qui-et-ou, annexe-la-table-des-regles/extrait-du-fichier]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3]
---

# ORG-040 — The owner rules for the team and the contacts are written out

## Story
Technical story: replace the single manage rule on the team with the rows the design lists, and add the rows for business contacts, so that the fields an owner may write are named.

## Context
- Exists: `{ who: OWNER, where: ONLINE_FOR_ALL, action: manage, subject: Collaboration }` in `src/shared/access/ability.ts`; the invite POST, the role PATCH and the revoke DELETE of `organization.routes.ts` call `requireAbility('manage', 'Collaboration')`.
- Replaces it by two OWNER rows, ONLINE_FOR_ALL: `create` Collaboration with fields `['role']` (invite) and `update` Collaboration with fields `['role', 'status']` (change a role, revoke). The three routes call `create` for the invite and `update` for the other two.
- Adds two OWNER rows, ONLINE_FOR_ALL: `create` and `delete` on OrganizationContact with fields `['kind', 'slot', 'value']`. They ship before their first use (ORG-024, ORG-027).
- Unchanged: `manage Subscription` (BIL-006 removes it), `transfer_ownership`, `close`, `reopen`.
- No route changes its answer: owner and network allowed, everyone else 403 FORBIDDEN.

## Acceptance criteria
```gherkin
Scenario Outline: AC-1 The owner's rows
  When abilityFor is built for <role> with <ctx>
  Then can(<action>, <subject>) is <result>
  Examples:
    | role    | ctx     | action | subject             | result |
    | OWNER   | online  | create | Collaboration       | true   |
    | OWNER   | online  | update | Collaboration       | true   |
    | OWNER   | online  | create | OrganizationContact | true   |
    | OWNER   | online  | delete | OrganizationContact | true   |
    | OWNER   | offline | create | OrganizationContact | false  |
    | OWNER   | offline | update | Collaboration       | false  |
    | MANAGER | online  | update | Collaboration       | false  |
    | MANAGER | online  | create | OrganizationContact | false  |
Scenario: AC-2 Writable fields are named
  Given the OWNER online
  Then `update` is allowed on the fields role and status of Collaboration, not on amount_held
  And `create` is allowed on the field role of Collaboration, not on status
Scenario: AC-3 No manage left on the team
  Then can('manage', 'Collaboration') is false for every role and context
  And no row of `RULES` names `manage` with the subject Collaboration
Scenario: AC-4 The routes keep their answers
  When the tests of invite, change-role and revoke run
  Then they pass as before
```

## Abuse cases
```gherkin
Scenario: AB-1 A manager changes the team or the contacts (elevation)
  Given a MANAGER, online
  When abilityFor is built
  Then it cannot create or update Collaboration, nor create or delete OrganizationContact
```

## Implementation
- Create: `tests/unit/access/owner-rules.test.ts`
- Modify: `src/shared/access/ability.ts`, `src/modules/organization/organization.routes.ts`
- Pattern: `src/shared/access/roles.ts`
- Dependencies: `@casl/ability`

## Security
- v5.0.0-8.2.1: the team and contact gestures stay owner-only, online, and refused for every other role.
- v5.0.0-15.3.3: the fields an owner may write on a collaboration or a contact are listed per action.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| owner rows | unit | AC-1 | each Examples row → result |
| fields | unit | AC-2 | update on role and status true, on amount_held false; create on role true, on status false |
| no manage | unit | AC-3 | can manage Collaboration false; no RULES row with manage and Collaboration |
| routes | integration | AC-4 | invite, change-role and revoke suites pass |
| manager refused | security | AB-1, CWE-285 | MANAGER online → the four actions false |

Command: `npx vitest run tests/unit/access tests/integration/organization/invite.test.ts tests/integration/organization/change-role.test.ts tests/integration/organization/revoke.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/unit/access/ability.test.ts | the rows, the rule list and the manager test name `manage` on Collaboration | same expectations with `create` and `update` on Collaboration |

## Out of scope
- The routes and services of the contacts (ORG-024 to ORG-027).
- Removing `manage Subscription` and the guard that no rule uses `manage` (BIL-006).

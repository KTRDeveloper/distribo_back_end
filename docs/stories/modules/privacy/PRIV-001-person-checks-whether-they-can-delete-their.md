---
id: PRIV-001
title: Person checks whether they can delete their account
module: privacy
kind: feature
rev: 1
amends: []
size: S
risk: medium
depends_on: [ORG-005, REL-016]
read_first: [src/modules/user/user.routes.ts, src/modules/organization/organization.repository.ts]
design_refs: [identite-et-organisation/person, donnees-personnelles-et-conservation/cadre-juridique-le-cameroun]
constraints: [CM-02]
asvs: [v5.0.0-8.2.2, v5.0.0-14.2.4]
---

# PRIV-001 — Person checks whether they can delete their account

## Story
As a customer, I want to know what blocks the deletion of my account so that I can fix it first.

## Context
- Exists: relationships as customer (REL module); organizations and roles (ORG module); `authMiddleware`.
- Adds: `GET /api/v1/users/me/deletion-check` returning `{ can_delete, blockers: [{ code, label }] }`. Blockers: `POSITIVE_BALANCE` for each relationship where the caller is `customer_person_id` and `balance` is above 0 (label: the supplier's name), and `OWNS_ORGANIZATION` for each ACTIVE or SUSPENDED organization the caller owns (label: its name; the message is "Transférez ou fermez d'abord <name>"). CLOSED organizations and PENDING invitations never block.
- Files: `src/modules/privacy/privacy.routes.ts`, `privacy.service.ts`, `privacy.repository.ts`, `privacy.schemas.ts`, and the mount in `src/app.ts`.
- `CM-02`: Account deletion is refused while the person has a positive balance on a relation where they are the customer, or owns an organization that is neither transferred nor closed.

## Acceptance criteria
```gherkin
Scenario: AC-1 Nothing blocks
  When a person with no debt and no business calls the route
  Then `can_delete` is true and blockers is empty
Scenario: AC-2 Debt blocks
  Given the person owes 5000 to a supplier
  Then blockers has one POSITIVE_BALANCE naming the supplier and can_delete is false
Scenario Outline: AC-3 Not blockers
  When the person's state is <state>
  Then it does not block
  Examples:
    | state                                              |
    | a balance of 0 or negative (an advance)            |
    | ownership of a CLOSED organization                 |
    | a MANAGER role in an organization                  |
Scenario: AC-4 Owner blocks
  Given the person owns an ACTIVE organization named "Boutique Fotso"
  Then blockers has OWNS_ORGANIZATION with that name
```

## Abuse cases
```gherkin
Scenario: AB-1 Reading another person's blockers (horizontal)
  When person A calls the route
  Then only A's relationships and organizations are considered
Scenario: AB-2 No token (unauthenticated)
  Then the response is 401
```

## Implementation
- Create: `src/modules/privacy/privacy.routes.ts`, `src/modules/privacy/privacy.service.ts`, `src/modules/privacy/privacy.repository.ts`, `src/modules/privacy/privacy.schemas.ts`, `tests/integration/privacy/deletion-check.test.ts`
- Modify: `src/app.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `deletionCheck(personId: string): Promise<{ can_delete: boolean; blockers: Array<{ code: string; label: string }> }>`
- Errors: `UNAUTHORIZED` 401
- Dependencies: `express`

## Security
- v5.0.0-8.2.2: every query filters on the person id from the token.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| nothing blocks | integration | AC-1, CM-02 | true |
| debt | integration | AC-2 | blocker |
| not blockers | integration | AC-3 | each Examples row → no blocker |
| owner | integration | AC-4 | blocker with name |
| other person | security | AB-1, WSTG-ATHZ-04 | own data only |
| no token | security | AB-2, WSTG-ATHN-04 | 401 |

Command: `npx vitest run tests/integration/privacy/deletion-check.test.ts`

## Out of scope
- The deletion itself (PRIV-002).

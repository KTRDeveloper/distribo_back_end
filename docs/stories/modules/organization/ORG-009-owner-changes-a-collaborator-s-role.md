---
id: ORG-009
title: Owner changes a collaborator's role
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-008]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: ['Collaboration.role:enum', CM-09, CM-03]
asvs: [v5.0.0-8.2.1, v5.0.0-8.2.3, v5.0.0-15.3.3]
---

# ORG-009 — Owner changes a collaborator's role

## Story
As an owner, I want to change a collaborator's role so that their powers match their job.

## Context
- Exists: collaborators (ORG-007, ORG-008); `requireAbility('manage', 'Collaboration')`.
- Adds: `PATCH /api/v1/organizations/{organizationId}/collaborators/{collaborationId}` with `{ role }` (MANAGER, SELLER or DRIVER). Response 200 with the collaboration view.
- The OWNER row cannot be changed (409 `OWNER_PROTECTED`); the target must belong to the organization and not be REVOKED. An ACTIVE target gets `scope_version` +1 and a notification `collaboration.role_changed`.
- `Collaboration.role:enum`: one of OWNER, MANAGER, SELLER, DRIVER
- `CM-09`: The OWNER can be neither demoted nor revoked; an ownership transfer makes the chosen ACTIVE collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately.
- `CM-03`: `Person.scope_version` is incremented by the server on every rights change.

## Acceptance criteria
```gherkin
Scenario: AC-1 Change
  When the owner sets a SELLER to MANAGER
  Then the response is 200 with role MANAGER, the collaborator's scope_version is +1 and they are notified
Scenario Outline: AC-2 Refusals
  When the owner targets <case>
  Then the response is <status> and nothing changes
  Examples:
    | case                                  | status                |
    | their own OWNER row                   | 409 OWNER_PROTECTED   |
    | role OWNER in the body                | 400 VALIDATION_ERROR  |
    | a REVOKED collaborator                | 404 NOT_FOUND         |
    | a collaboration of another business   | 404 NOT_FOUND         |
Scenario: AC-3 Invited target
  When the target is INVITED
  Then the role changes and no scope_version bump happens
```

## Abuse cases
```gherkin
Scenario: AB-1 Manager promotes themselves (vertical)
  When a MANAGER patches their own or another role
  Then the response is 403 and nothing changes
Scenario: AB-2 Other fields in the body (mass assignment)
  When the body contains status, person_id or amount_held
  Then the response is 400
```

## Implementation
- Create: `tests/integration/organization/change-role.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `changeRole(actor: Actor, collaborationId: string, role: 'MANAGER' | 'SELLER' | 'DRIVER'): Promise<CollaborationView>`
- Errors: `OWNER_PROTECTED` 409, `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `FORBIDDEN` 403
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: owner and network only.
- v5.0.0-8.2.3: only `role` is writable.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| change | integration | AC-1, CM-03, Collaboration.role:enum | 200, scope +1, notification |
| refusals | integration | AC-2, CM-09 | each Examples row → status |
| invited target | integration | AC-3 | no bump |
| manager | security | AB-1, WSTG-ATHZ-03 | 403 |
| extra fields | security | AB-2, CWE-915 | 400 |

Command: `npx vitest run tests/integration/organization/change-role.test.ts`

## Out of scope
- Transferring ownership (ORG-012).
